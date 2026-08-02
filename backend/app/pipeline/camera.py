from __future__ import annotations

import time
from typing import Any

import cv2
import numpy as np

from .demo_scene import DemoBeachScene
from .detector import Detector, PassthroughDetector
from .types import Detection


class FrameSource:
    def read(self) -> tuple[np.ndarray, list[Detection] | None]:
        raise NotImplementedError

    def release(self) -> None:
        return None


class DemoFrameSource(FrameSource):
    def __init__(
        self,
        width: int,
        height: int,
        fps: float,
        swimmers: int,
        distress_chance_per_second: float,
        detector: Detector,
    ) -> None:
        self.fps = fps
        self.distress_chance = distress_chance_per_second
        self.scene = DemoBeachScene(width, height, swimmers)
        self.detector = detector
        self._last = time.time()

    def read(self) -> tuple[np.ndarray, list[Detection] | None]:
        now = time.time()
        dt = min(max(now - self._last, 1.0 / 60.0), 0.2)
        self._last = now
        detections = self.scene.step(dt, self.distress_chance)
        if isinstance(self.detector, PassthroughDetector):
            self.detector.set_detections(detections)
        frame = self.scene.render(detections)
        return frame, detections


class CvFrameSource(FrameSource):
    def __init__(self, source: Any) -> None:
        # source may be int webcam index or path/URL string
        if isinstance(source, str) and source.isdigit():
            source = int(source)
        self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open camera source: {source}")

    def read(self) -> tuple[np.ndarray, list[Detection] | None]:
        ok, frame = self.cap.read()
        if not ok or frame is None:
            # Loop video files
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
            if not ok or frame is None:
                raise RuntimeError("Camera/video frame read failed")
        return frame, None

    def release(self) -> None:
        self.cap.release()


def build_frame_source(
    source: str,
    width: int,
    height: int,
    fps: float,
    swimmers: int,
    distress_chance_per_second: float,
    detector: Detector,
) -> FrameSource:
    if source == "demo":
        return DemoFrameSource(
            width=width,
            height=height,
            fps=fps,
            swimmers=swimmers,
            distress_chance_per_second=distress_chance_per_second,
            detector=detector,
        )
    return CvFrameSource(source)