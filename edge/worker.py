#!/usr/bin/env python3
"""TowerWatch edge worker: camera -> detect -> track -> distress score -> alerts."""

from __future__ import annotations

import argparse
import base64
import sys
import time
from pathlib import Path

import cv2
import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import load_config
from backend.app.pipeline.camera import build_frame_source
from backend.app.pipeline.detector import build_detector
from backend.app.pipeline.distress import score_distress
from backend.app.pipeline.tracker import IoUTracker


def draw_overlay(frame: np.ndarray, tracks, scores: dict[int, float]) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]
    for track in tracks:
        x1 = int(track.x * w)
        y1 = int(track.y * h)
        x2 = int((track.x + track.w) * w)
        y2 = int((track.y + track.h) * h)
        score = scores.get(track.track_id, 0.0)
        if score >= 0.72:
            color = (40, 40, 230)
        elif score >= 0.45:
            color = (40, 180, 230)
        else:
            color = (60, 200, 90)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        label = f"#{track.track_id} {score:.2f}"
        cv2.putText(
            out,
            label,
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )
    return out


def encode_jpeg(frame: np.ndarray, quality: int = 75) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return buf.tobytes()


def main() -> None:
    parser = argparse.ArgumentParser(description="TowerWatch edge worker")
    parser.add_argument("--config", default=str(ROOT / "config" / "default.yaml"))
    parser.add_argument("--source", default=None, help="Override camera source")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.source:
        cfg.camera.source = args.source

    detector = build_detector(cfg.camera.source)
    source = build_frame_source(
        source=cfg.camera.source,
        width=cfg.camera.width,
        height=cfg.camera.height,
        fps=cfg.camera.fps,
        swimmers=cfg.demo.swimmers,
        distress_chance_per_second=cfg.demo.distress_chance_per_second,
        detector=detector,
    )
    tracker = IoUTracker()

    high_since: dict[int, float] = {}
    last_alert_at: dict[int, float] = {}
    frame_times: list[float] = []

    print(
        f"[towerwatch] starting edge worker for {cfg.tower.name} "
        f"(source={cfg.camera.source})"
    )

    with httpx.Client(timeout=5.0) as client:
        while True:
            loop_start = time.time()
            frame, _ = source.read()
            # Ensure consistent size for overlay math
            frame = cv2.resize(frame, (cfg.camera.width, cfg.camera.height))
            detections = detector.detect(frame)
            tracks = tracker.update(detections, history_seconds=cfg.pipeline.history_seconds)

            scores: dict[int, float] = {}
            for track in tracks:
                result = score_distress(track, fps=cfg.camera.fps)
                scores[track.track_id] = result.score
                age_s = track.age_frames / max(cfg.camera.fps, 1e-3)
                if age_s < cfg.pipeline.min_track_age_seconds:
                    high_since.pop(track.track_id, None)
                    continue

                if result.score >= cfg.pipeline.score_threshold:
                    high_since.setdefault(track.track_id, loop_start)
                    held = loop_start - high_since[track.track_id]
                    cooled = loop_start - last_alert_at.get(track.track_id, 0)
                    if (
                        held >= cfg.pipeline.confirm_seconds
                        and cooled >= cfg.pipeline.alert_cooldown_seconds
                    ):
                        overlay = draw_overlay(frame, [track], scores)
                        jpeg = encode_jpeg(overlay, quality=80)
                        payload = {
                            "tower_id": cfg.tower.id,
                            "tower_name": cfg.tower.name,
                            "zone": cfg.tower.zone,
                            "track_id": track.track_id,
                            "score": result.score,
                            "reasons": result.reasons,
                            "bbox": {
                                "x": track.x,
                                "y": track.y,
                                "w": track.w,
                                "h": track.h,
                            },
                            "frame_jpeg_b64": base64.b64encode(jpeg).decode("ascii"),
                            "note": "Possible drowning / distress — verify visually",
                        }
                        try:
                            resp = client.post(cfg.server.alert_url, json=payload)
                            resp.raise_for_status()
                            last_alert_at[track.track_id] = loop_start
                            print(
                                f"[towerwatch] ALERT track #{track.track_id} "
                                f"score={result.score:.2f} reasons={result.reasons}"
                            )
                        except Exception as exc:  # noqa: BLE001
                            print(f"[towerwatch] failed to post alert: {exc}")
                else:
                    high_since.pop(track.track_id, None)

            annotated = draw_overlay(frame, tracks, scores)
            jpeg = encode_jpeg(annotated, quality=70)
            try:
                client.post(
                    cfg.server.stream_url,
                    content=jpeg,
                    headers={"Content-Type": "application/octet-stream"},
                )
            except Exception:
                pass

            frame_times.append(time.time())
            frame_times = [t for t in frame_times if time.time() - t < 2.0]
            fps = len(frame_times) / 2.0 if len(frame_times) > 1 else 0.0
            try:
                client.post(
                    cfg.server.alert_url.replace("/api/alerts", "/api/tower/status"),
                    json={
                        "tower_id": cfg.tower.id,
                        "tower_name": cfg.tower.name,
                        "zone": cfg.tower.zone,
                        "camera_ok": True,
                        "tracks": len(tracks),
                        "fps": round(fps, 2),
                        "last_frame_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "pipeline_mode": cfg.camera.source,
                    },
                )
            except Exception:
                pass

            # Pace toward target fps
            elapsed = time.time() - loop_start
            sleep_for = (1.0 / cfg.camera.fps) - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)


if __name__ == "__main__":
    main()