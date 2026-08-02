from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from ..pipeline.detector import build_detector
from ..pipeline.distress import score_distress
from ..pipeline.tracker import IoUTracker


@dataclass
class DistressEvent:
    index: int
    track_id: int
    start_time: float
    end_time: float
    peak_score: float
    reasons: list[str]
    bbox: dict[str, float]
    snapshot: str = ""

    @property
    def duration(self) -> float:
        return max(self.end_time - self.start_time, 0.0)

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "track_id": self.track_id,
            "start_time": round(self.start_time, 2),
            "end_time": round(self.end_time, 2),
            "duration": round(self.duration, 2),
            "peak_score": round(self.peak_score, 3),
            "reasons": self.reasons,
            "bbox": self.bbox,
            "snapshot": self.snapshot,
        }


@dataclass
class AnalysisResult:
    video_name: str
    duration: float
    source_fps: float
    processed_fps: float
    frames_processed: int
    detector: str
    events: list[DistressEvent] = field(default_factory=list)
    annotated_video: str = ""

    def to_dict(self) -> dict:
        return {
            "video_name": self.video_name,
            "duration": round(self.duration, 2),
            "source_fps": round(self.source_fps, 2),
            "processed_fps": round(self.processed_fps, 2),
            "frames_processed": self.frames_processed,
            "detector": self.detector,
            "annotated_video": self.annotated_video,
            "events": [e.to_dict() for e in self.events],
        }


def _draw(frame: np.ndarray, tracks, scores: dict[int, float], threshold: float) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]
    for track in tracks:
        score = scores.get(track.track_id, 0.0)
        if score >= threshold:
            color = (40, 40, 230)
        elif score >= threshold * 0.6:
            color = (40, 180, 230)
        else:
            color = (70, 200, 110)
        x1, y1 = int(track.x * w), int(track.y * h)
        x2, y2 = int((track.x + track.w) * w), int((track.y + track.h) * h)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            out,
            f"#{track.track_id} {score:.2f}",
            (x1, max(16, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1,
            cv2.LINE_AA,
        )
    return out


def analyze_video(
    video_path: Path,
    output_dir: Path,
    detector_mode: str = "motion",
    target_fps: float = 10.0,
    max_dimension: int = 960,
    score_threshold: float = 0.72,
    confirm_seconds: float = 3.0,
    history_seconds: float = 8.0,
    min_track_age_seconds: float = 2.0,
    event_cooldown_seconds: float = 20.0,
    write_annotated: bool = True,
    progress_cb: Callable[[float, str], None] | None = None,
) -> AnalysisResult:
    """Run the tower pipeline over an uploaded video and return distress events."""
    from .writer import AnnotatedVideoWriter

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path.name}")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    if source_fps <= 1 or source_fps > 240:
        source_fps = 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    stride = max(1, round(source_fps / max(target_fps, 1.0)))
    processed_fps = source_fps / stride

    scale = 1.0
    if src_w and max(src_w, src_h) > max_dimension:
        scale = max_dimension / max(src_w, src_h)
    out_w = max(int((src_w or max_dimension) * scale) // 2 * 2, 2)
    out_h = max(int((src_h or max_dimension) * scale) // 2 * 2, 2)

    output_dir.mkdir(parents=True, exist_ok=True)
    snapshots_dir = output_dir / "snapshots"
    snapshots_dir.mkdir(exist_ok=True)

    detector = build_detector(detector_mode)
    tracker = IoUTracker()

    writer: AnnotatedVideoWriter | None = None
    if write_annotated:
        writer = AnnotatedVideoWriter(
            output_dir / "annotated.mp4", out_w, out_h, processed_fps
        )

    events: list[DistressEvent] = []
    open_event: dict[int, DistressEvent] = {}
    high_since: dict[int, float] = {}
    last_event_at: dict[int, float] = {}

    frame_index = -1
    processed = 0
    last_reported = -1.0

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            frame_index += 1
            if frame_index % stride != 0:
                continue

            video_time = frame_index / source_fps
            frame = cv2.resize(frame, (out_w, out_h))
            detections = detector.detect(frame)
            tracks = tracker.update(
                detections, history_seconds=history_seconds, now=video_time
            )

            scores: dict[int, float] = {}
            for track in tracks:
                result = score_distress(track, fps=processed_fps)
                scores[track.track_id] = result.score
                age_seconds = track.age_frames / max(processed_fps, 1e-3)

                if age_seconds < min_track_age_seconds:
                    high_since.pop(track.track_id, None)
                    continue

                if result.score >= score_threshold:
                    high_since.setdefault(track.track_id, video_time)
                    held = video_time - high_since[track.track_id]
                    active = open_event.get(track.track_id)
                    if active is not None:
                        active.end_time = video_time
                        if result.score > active.peak_score:
                            active.peak_score = result.score
                            active.reasons = result.reasons
                    elif held >= confirm_seconds and (
                        video_time - last_event_at.get(track.track_id, -1e9)
                        >= event_cooldown_seconds
                    ):
                        event = DistressEvent(
                            index=len(events),
                            track_id=track.track_id,
                            start_time=high_since[track.track_id],
                            end_time=video_time,
                            peak_score=result.score,
                            reasons=result.reasons,
                            bbox={
                                "x": round(track.x, 4),
                                "y": round(track.y, 4),
                                "w": round(track.w, 4),
                                "h": round(track.h, 4),
                            },
                        )
                        snapshot = _draw(frame, [track], scores, score_threshold)
                        snap_name = f"event_{event.index:03d}.jpg"
                        cv2.imwrite(
                            str(snapshots_dir / snap_name),
                            snapshot,
                            [int(cv2.IMWRITE_JPEG_QUALITY), 82],
                        )
                        event.snapshot = snap_name
                        events.append(event)
                        open_event[track.track_id] = event
                        last_event_at[track.track_id] = video_time
                else:
                    high_since.pop(track.track_id, None)
                    if track.track_id in open_event:
                        open_event.pop(track.track_id, None)

            live_ids = {t.track_id for t in tracks}
            for tid in list(open_event):
                if tid not in live_ids:
                    open_event.pop(tid, None)

            if writer:
                writer.write(_draw(frame, tracks, scores, score_threshold))

            processed += 1
            if progress_cb and total_frames > 0:
                pct = min(99.0, frame_index / total_frames * 100)
                if pct - last_reported >= 1.0:
                    last_reported = pct
                    progress_cb(pct, f"{len(events)} events so far")
    finally:
        cap.release()
        if writer:
            writer.close()

    duration = (total_frames / source_fps) if total_frames else (frame_index / source_fps)
    if progress_cb:
        progress_cb(100.0, f"done — {len(events)} events")

    return AnalysisResult(
        video_name=video_path.name,
        duration=duration,
        source_fps=source_fps,
        processed_fps=processed_fps,
        frames_processed=processed,
        detector=detector.name,
        events=events,
        annotated_video="annotated.mp4" if writer else "",
    )