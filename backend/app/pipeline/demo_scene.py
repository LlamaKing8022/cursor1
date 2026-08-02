from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .types import Detection


@dataclass
class DemoSwimmer:
    swimmer_id: int
    x: float
    y: float
    vx: float
    style: str = "swim"  # swim | distress | surf
    phase: float = field(default_factory=lambda: random.random() * math.tau)
    since: float = field(default_factory=time.time)
    w: float = 0.035
    h: float = 0.055


class DemoBeachScene:
    """Synthetic ocean scene so the MVP runs without a real tower camera."""

    def __init__(self, width: int = 1280, height: int = 720, swimmers: int = 6) -> None:
        self.width = width
        self.height = height
        self.swimmers = [
            self._spawn(i + 1, force_style="surf" if i == 0 else "swim")
            for i in range(swimmers)
        ]
        self._t0 = time.time()
        self._next_distress_check = self._t0 + 2.0

    def _spawn(self, swimmer_id: int, force_style: str | None = None) -> DemoSwimmer:
        style = force_style or "swim"
        y = random.uniform(0.42, 0.82)
        if style == "surf":
            return DemoSwimmer(
                swimmer_id=swimmer_id,
                x=random.uniform(0.05, 0.2),
                y=y,
                vx=random.uniform(0.045, 0.07),
                style="surf",
                w=0.05,
                h=0.03,
            )
        return DemoSwimmer(
            swimmer_id=swimmer_id,
            x=random.uniform(0.1, 0.85),
            y=y,
            vx=random.uniform(0.012, 0.028) * random.choice([-1, 1]),
            style="swim",
            w=0.03,
            h=0.045,
        )

    def maybe_trigger_distress(self, chance_per_second: float) -> None:
        now = time.time()
        if now < self._next_distress_check:
            return
        self._next_distress_check = now + 1.0
        active = [s for s in self.swimmers if s.style == "swim"]
        if not active:
            return
        if random.random() < chance_per_second:
            victim = random.choice(active)
            victim.style = "distress"
            victim.since = now
            victim.vx = random.uniform(-0.004, 0.004)
            victim.w = 0.028
            victim.h = 0.07

    def step(self, dt: float, distress_chance_per_second: float = 0.04) -> list[Detection]:
        self.maybe_trigger_distress(distress_chance_per_second)
        now = time.time()
        detections: list[Detection] = []

        for swimmer in self.swimmers:
            if swimmer.style == "distress":
                # Bob in place: little x progress, strong y oscillation, tall box
                swimmer.x += swimmer.vx * dt
                swimmer.y += math.sin((now - swimmer.since) * 3.1 + swimmer.phase) * 0.012
                # Occasional "submersion" shrink pulses
                pulse = 0.55 + 0.45 * abs(math.sin((now - swimmer.since) * 1.7))
                w = swimmer.w * pulse
                h = swimmer.h * (0.75 + 0.35 * pulse)
            elif swimmer.style == "surf":
                swimmer.x += swimmer.vx * dt
                swimmer.y += math.sin(now * 2.0 + swimmer.phase) * 0.002
                w, h = swimmer.w, swimmer.h
                if swimmer.x > 1.05:
                    swimmer.x = -0.05
                    swimmer.y = random.uniform(0.45, 0.75)
            else:
                swimmer.x += swimmer.vx * dt
                swimmer.y += math.sin(now * 1.3 + swimmer.phase) * 0.0015
                w, h = swimmer.w, swimmer.h
                if swimmer.x < -0.05 or swimmer.x > 1.05:
                    swimmer.vx *= -1
                    swimmer.x = min(max(swimmer.x, 0.0), 1.0)

            # Recover distress after a while so demos keep cycling
            if swimmer.style == "distress" and now - swimmer.since > 18:
                swimmer.style = "swim"
                swimmer.vx = random.uniform(0.012, 0.028) * random.choice([-1, 1])
                swimmer.w, swimmer.h = 0.03, 0.045

            swimmer.y = min(max(swimmer.y, 0.38), 0.9)
            detections.append(
                Detection(
                    x=max(0.0, swimmer.x - w / 2),
                    y=max(0.0, swimmer.y - h / 2),
                    w=w,
                    h=h,
                    confidence=0.99,
                    label=swimmer.style,
                )
            )
        return detections

    def render(self, detections: list[Detection] | None = None) -> np.ndarray:
        h, w = self.height, self.width
        frame = np.zeros((h, w, 3), dtype=np.uint8)

        # Sky gradient
        for row in range(int(h * 0.38)):
            t = row / max(h * 0.38, 1)
            frame[row, :] = (
                int(210 - 40 * t),
                int(170 - 20 * t),
                int(120 + 30 * t),
            )

        # Ocean
        ocean_top = int(h * 0.38)
        for row in range(ocean_top, h):
            t = (row - ocean_top) / max(h - ocean_top, 1)
            frame[row, :] = (
                int(150 - 40 * t),
                int(110 + 20 * t),
                int(40 + 10 * t),
            )

        # Soft wave bands
        t = time.time()
        for i in range(6):
            yy = int(ocean_top + (i + 1) * (h - ocean_top) / 7)
            shift = int(18 * math.sin(t * 1.2 + i))
            cv2.line(
                frame,
                (0, yy + shift // 3),
                (w, yy - shift // 3),
                (190, 170, 90),
                1,
                cv2.LINE_AA,
            )

        # Shore foam
        cv2.rectangle(frame, (0, ocean_top - 8), (w, ocean_top + 10), (220, 220, 210), -1)

        if detections:
            for det in detections:
                x1 = int(det.x * w)
                y1 = int(det.y * h)
                x2 = int((det.x + det.w) * w)
                y2 = int((det.y + det.h) * h)
                color = (40, 90, 220) if det.label == "distress" else (40, 180, 120)
                if det.label == "surf":
                    color = (210, 140, 40)
                cv2.ellipse(
                    frame,
                    ((x1 + x2) // 2, (y1 + y2) // 2),
                    (max(4, (x2 - x1) // 2), max(6, (y2 - y1) // 2)),
                    0,
                    0,
                    360,
                    color,
                    -1,
                    cv2.LINE_AA,
                )

        # Tower HUD chrome
        cv2.putText(
            frame,
            "TOWERWATCH DEMO FEED",
            (24, 42),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (245, 245, 245),
            2,
            cv2.LINE_AA,
        )
        return frame