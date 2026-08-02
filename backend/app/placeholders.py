"""Small helpers for API responses."""

from __future__ import annotations

import cv2
import numpy as np

_PLACEHOLDER_JPEG: bytes | None = None


def placeholder_frame_jpeg(
    width: int = 1280,
    height: int = 720,
    title: str = "TowerWatch",
    subtitle: str = "Waiting for camera feed",
    hint: str = "Run ./scripts/run_edge.sh or ./scripts/run_demo.sh",
) -> bytes:
    """Return a JPEG placeholder when the edge worker has not posted a frame yet."""
    global _PLACEHOLDER_JPEG
    if _PLACEHOLDER_JPEG is not None:
        return _PLACEHOLDER_JPEG

    frame = np.zeros((height, width, 3), dtype=np.uint8)
    for row in range(height):
        t = row / max(height, 1)
        frame[row, :] = (int(18 + 20 * t), int(48 + 30 * t), int(64 + 20 * t))

    ocean = int(height * 0.42)
    frame[ocean:, :] = (int(40 + 20 * 0.5), int(90 + 30 * 0.5), int(120 + 20 * 0.5))
    frame[:ocean, :] = (int(180), int(150), int(110))

    cv2.putText(
        frame,
        title,
        (48, 96),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.6,
        (245, 245, 245),
        3,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        subtitle,
        (48, 150),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (210, 210, 210),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        hint,
        (48, height - 48),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (180, 200, 210),
        2,
        cv2.LINE_AA,
    )

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        raise RuntimeError("placeholder JPEG encode failed")
    _PLACEHOLDER_JPEG = buf.tobytes()
    return _PLACEHOLDER_JPEG