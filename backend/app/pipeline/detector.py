from __future__ import annotations

from .types import Detection


class Detector:
    """Person detector interface. Swap in YOLO later without changing the pipeline."""

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        raise NotImplementedError


class PassthroughDetector(Detector):
    """Used by the demo camera, which already knows swimmer boxes."""

    def __init__(self) -> None:
        self._pending: list[Detection] = []

    def set_detections(self, detections: list[Detection]) -> None:
        self._pending = detections

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        dets = self._pending
        self._pending = []
        return dets


class HogPersonDetector(Detector):
    """CPU OpenCV HOG person detector for real camera/video sources."""

    def __init__(self) -> None:
        import cv2

        self._cv2 = cv2
        self._hog = cv2.HOGDescriptor()
        self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        cv2 = self._cv2
        h, w = frame_bgr.shape[:2]
        scale = 640 / max(w, 1)
        small = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)))
        boxes, weights = self._hog.detectMultiScale(
            small, winStride=(8, 8), padding=(8, 8), scale=1.05
        )
        detections: list[Detection] = []
        for (x, y, bw, bh), weight in zip(boxes, weights):
            if float(weight) < 0.4:
                continue
            detections.append(
                Detection(
                    x=float(x) / scale / w,
                    y=float(y) / scale / h,
                    w=float(bw) / scale / w,
                    h=float(bh) / scale / h,
                    confidence=float(weight),
                )
            )
        return detections


def build_detector(source: str) -> Detector:
    if source == "demo":
        return PassthroughDetector()
    return HogPersonDetector()