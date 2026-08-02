from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np


class AnnotatedVideoWriter:
    """
    Writes annotated review video.

    Prefers piping raw frames to ffmpeg/libx264 because browsers cannot play the
    MPEG-4 Part 2 stream that OpenCV falls back to.
    """

    def __init__(self, path: Path, width: int, height: int, fps: float) -> None:
        self.path = path
        self.width = width
        self.height = height
        self.fps = max(fps, 1.0)
        self._proc: subprocess.Popen[bytes] | None = None
        self._cv_writer: cv2.VideoWriter | None = None
        self._backend = "opencv-mp4v"

        if shutil.which("ffmpeg"):
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{width}x{height}",
                "-r",
                f"{self.fps:.4f}",
                "-i",
                "-",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "26",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(path),
            ]
            try:
                self._proc = subprocess.Popen(
                    cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
                )
            except OSError:
                self._proc = None
            else:
                self._backend = "ffmpeg-h264"

        if self._proc is None:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            self._cv_writer = cv2.VideoWriter(str(path), fourcc, self.fps, (width, height))

    @property
    def backend(self) -> str:
        return self._backend

    def write(self, frame: np.ndarray) -> None:
        if frame.shape[1] != self.width or frame.shape[0] != self.height:
            frame = cv2.resize(frame, (self.width, self.height))
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.write(frame.tobytes())
            except BrokenPipeError:
                self._proc = None
        elif self._cv_writer:
            self._cv_writer.write(frame)

    def close(self) -> None:
        if self._proc:
            if self._proc.stdin:
                try:
                    self._proc.stdin.close()
                except BrokenPipeError:
                    pass
            self._proc.wait(timeout=120)
            self._proc = None
        if self._cv_writer:
            self._cv_writer.release()
            self._cv_writer = None