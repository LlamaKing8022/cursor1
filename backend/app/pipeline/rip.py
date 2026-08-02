from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


class RipZoneMap:
    """
    Maintains a smoothed rip-current probability map in normalized frame space.

    Per-frame segmentation of water is jittery: a rip flickers in and out as waves
    break over it. Rips themselves persist for minutes, so confidence is
    accumulated over time and decayed slowly, which suppresses single-frame noise
    without hiding a rip that genuinely forms.
    """

    def __init__(self, grid: int = 96, smoothing: float = 0.9) -> None:
        self.grid = grid
        self.smoothing = min(max(smoothing, 0.0), 0.99)
        self.map = np.zeros((grid, grid), dtype=np.float32)
        self.updates = 0

    def update(self, mask: np.ndarray | None) -> None:
        """Blend a binary/float mask (any resolution) into the smoothed map."""
        if mask is None:
            observation = np.zeros((self.grid, self.grid), dtype=np.float32)
        else:
            if mask.dtype != np.float32:
                mask = mask.astype(np.float32)
            if mask.max() > 1.0:
                mask = mask / 255.0
            observation = cv2.resize(
                mask, (self.grid, self.grid), interpolation=cv2.INTER_AREA
            )
        alpha = self.smoothing
        self.map = alpha * self.map + (1.0 - alpha) * observation
        self.updates += 1

    def risk_at(self, x: float, y: float, radius: float = 0.02) -> float:
        """Peak smoothed risk in a small window around a normalized point."""
        if self.updates == 0:
            return 0.0
        gx = int(min(max(x, 0.0), 1.0) * (self.grid - 1))
        gy = int(min(max(y, 0.0), 1.0) * (self.grid - 1))
        pad = max(1, int(radius * self.grid))
        x0, x1 = max(0, gx - pad), min(self.grid, gx + pad + 1)
        y0, y1 = max(0, gy - pad), min(self.grid, gy + pad + 1)
        window = self.map[y0:y1, x0:x1]
        if window.size == 0:
            return 0.0
        return float(window.max())

    def as_frame_mask(self, width: int, height: int) -> np.ndarray:
        return cv2.resize(self.map, (width, height), interpolation=cv2.INTER_LINEAR)

    def coverage(self, threshold: float = 0.4) -> float:
        if self.updates == 0:
            return 0.0
        return float((self.map >= threshold).mean())


class RipSegmenter:
    """
    Rip current segmentation from a YOLO-seg model trained on RipVIS.

    Rips evolve over minutes, so inference runs every Nth frame rather than every
    frame; the smoothed map is what the pipeline reads.
    """

    def __init__(
        self,
        weights: str | Path,
        confidence: float = 0.25,
        interval_frames: int = 15,
        grid: int = 96,
        smoothing: float = 0.9,
        device: str | None = None,
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.confidence = confidence
        self.interval_frames = max(1, interval_frames)
        self.device = device
        self.zones = RipZoneMap(grid=grid, smoothing=smoothing)
        self._counter = 0

    def _predict_mask(self, frame_bgr: np.ndarray) -> np.ndarray | None:
        h, w = frame_bgr.shape[:2]
        kwargs = {"conf": self.confidence, "verbose": False}
        if self.device:
            kwargs["device"] = self.device
        results = self.model.predict(frame_bgr, **kwargs)
        combined = np.zeros((h, w), dtype=np.float32)
        found = False
        for result in results:
            masks = getattr(result, "masks", None)
            if masks is None or masks.data is None:
                continue
            data = masks.data.cpu().numpy()
            for layer in data:
                resized = cv2.resize(layer.astype(np.float32), (w, h))
                combined = np.maximum(combined, resized)
                found = True
        return combined if found else np.zeros((h, w), dtype=np.float32)

    def process(self, frame_bgr: np.ndarray, force: bool = False) -> RipZoneMap:
        """Run segmentation when due, then return the smoothed zone map."""
        run = force or (self._counter % self.interval_frames == 0)
        self._counter += 1
        if run:
            try:
                self.zones.update(self._predict_mask(frame_bgr))
            except Exception as exc:  # noqa: BLE001
                print(f"[towerwatch] rip segmentation failed: {exc}")
        return self.zones


def build_rip_segmenter(
    enabled: bool,
    weights: str | Path,
    confidence: float = 0.25,
    interval_frames: int = 15,
    grid: int = 96,
    smoothing: float = 0.9,
    device: str | None = None,
) -> RipSegmenter | None:
    """Return a segmenter, or None when disabled/unavailable, so callers degrade quietly."""
    if not enabled:
        return None
    path = Path(weights)
    if not path.exists():
        print(
            f"[towerwatch] rip model not found at {path}; rip detection off. "
            "Train one with scripts/train_rip_model.py"
        )
        return None
    try:
        return RipSegmenter(
            weights=path,
            confidence=confidence,
            interval_frames=interval_frames,
            grid=grid,
            smoothing=smoothing,
            device=device,
        )
    except ImportError:
        print("[towerwatch] ultralytics not installed; rip detection off")
        return None


def draw_rip_overlay(
    frame_bgr: np.ndarray, zones: RipZoneMap, threshold: float = 0.4
) -> np.ndarray:
    """Tint likely rip areas so a guard can see what the model is reacting to."""
    if zones.updates == 0:
        return frame_bgr
    h, w = frame_bgr.shape[:2]
    risk = zones.as_frame_mask(w, h)
    mask = risk >= threshold
    if not mask.any():
        return frame_bgr
    out = frame_bgr.copy()
    tint = np.zeros_like(out)
    tint[:, :] = (200, 120, 40)
    alpha = np.clip((risk - threshold) / max(1e-3, 1.0 - threshold), 0, 1) * 0.45
    alpha3 = np.dstack([alpha] * 3)
    out = (out * (1 - alpha3) + tint * alpha3).astype(np.uint8)

    contours, _ = cv2.findContours(
        (mask * 255).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(out, contours, -1, (230, 170, 60), 2)
    for contour in contours:
        if cv2.contourArea(contour) < (w * h) * 0.002:
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        cv2.putText(
            out,
            "RIP",
            (x + 4, max(16, y - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (230, 190, 90),
            2,
            cv2.LINE_AA,
        )
    return out