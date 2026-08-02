from __future__ import annotations

from .types import Detection


class Detector:
    """Person detector interface. Swap implementations without touching the pipeline."""

    name = "base"

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        raise NotImplementedError


class PassthroughDetector(Detector):
    """Used by the demo camera, which already knows swimmer boxes."""

    name = "demo"

    def __init__(self) -> None:
        self._pending: list[Detection] = []

    def set_detections(self, detections: list[Detection]) -> None:
        self._pending = detections

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        dets = self._pending
        self._pending = []
        return dets


class HogPersonDetector(Detector):
    """CPU OpenCV HOG person detector. Works best on above-water upright bodies."""

    name = "hog"

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
            sw, sh = small.shape[1], small.shape[0]
            detections.append(
                Detection(
                    x=float(x) / sw,
                    y=float(y) / sh,
                    w=float(bw) / sw,
                    h=float(bh) / sh,
                    confidence=float(weight),
                )
            )
        return detections


class MotionBlobDetector(Detector):
    """
    Background-subtraction detector for fixed tower cameras.

    Heads and shoulders in water are small, low-contrast, and often partly
    submerged, so a generic person detector misses them. For a static camera the
    reliable signal is "what moves differently from the water", which this
    detector isolates with MOG2 plus size/shape filtering.
    """

    name = "motion"

    def __init__(
        self,
        min_area_frac: float = 0.00012,
        max_area_frac: float = 0.02,
        history: int = 400,
        var_threshold: float = 36.0,
    ) -> None:
        import cv2

        self._cv2 = cv2
        self.min_area_frac = min_area_frac
        self.max_area_frac = max_area_frac
        self._bg = cv2.createBackgroundSubtractorMOG2(
            history=history, varThreshold=var_threshold, detectShadows=False
        )
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        cv2 = self._cv2
        h, w = frame_bgr.shape[:2]
        blurred = cv2.GaussianBlur(frame_bgr, (5, 5), 0)
        mask = self._bg.apply(blurred)
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._kernel, iterations=2)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        frame_area = float(w * h)
        detections: list[Detection] = []
        for contour in contours:
            area = cv2.contourArea(contour)
            frac = area / frame_area
            if frac < self.min_area_frac or frac > self.max_area_frac:
                continue
            bx, by, bw, bh = cv2.boundingRect(contour)
            aspect = bh / max(bw, 1)
            # Drop long thin wave lines that stretch across the frame
            if bw > w * 0.25 or (aspect < 0.25 and bw > w * 0.08):
                continue
            detections.append(
                Detection(
                    x=bx / w,
                    y=by / h,
                    w=bw / w,
                    h=bh / h,
                    confidence=min(1.0, 0.4 + frac * 30),
                )
            )
        detections.sort(key=lambda d: d.w * d.h, reverse=True)
        return detections[:40]


class YoloDetector(Detector):
    """Optional Ultralytics YOLO detector (`pip install ultralytics`)."""

    name = "yolo"

    def __init__(self, weights: str = "yolov8n.pt", confidence: float = 0.25) -> None:
        from ultralytics import YOLO

        self._model = YOLO(weights)
        self.confidence = confidence

    def detect(self, frame_bgr) -> list[Detection]:  # noqa: ANN001
        h, w = frame_bgr.shape[:2]
        results = self._model.predict(
            frame_bgr, conf=self.confidence, classes=[0], verbose=False
        )
        detections: list[Detection] = []
        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                detections.append(
                    Detection(
                        x=x1 / w,
                        y=y1 / h,
                        w=(x2 - x1) / w,
                        h=(y2 - y1) / h,
                        confidence=float(box.conf[0]),
                    )
                )
        return detections


def build_detector(source_or_mode: str) -> Detector:
    """Build a detector from a camera source or an explicit detector mode."""
    mode = source_or_mode
    if mode == "demo":
        return PassthroughDetector()
    if mode == "hog":
        return HogPersonDetector()
    if mode == "motion":
        return MotionBlobDetector()
    if mode == "yolo":
        return YoloDetector()
    # Real camera/video source without an explicit mode: motion works on fixed cams
    return MotionBlobDetector()