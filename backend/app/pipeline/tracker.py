from __future__ import annotations

import time

from .types import Detection, Track


def _iou(a: Detection | Track, b: Detection | Track) -> float:
    ax2, ay2 = a.x + a.w, a.y + a.h
    bx2, by2 = b.x + b.w, b.y + b.h
    ix1, iy1 = max(a.x, b.x), max(a.y, b.y)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


class IoUTracker:
    """Lightweight multi-object tracker for beach person boxes."""

    def __init__(self, iou_threshold: float = 0.25, max_missed: int = 12) -> None:
        self.iou_threshold = iou_threshold
        self.max_missed = max_missed
        self._next_id = 1
        self.tracks: dict[int, Track] = {}

    def update(self, detections: list[Detection], history_seconds: float = 8.0) -> list[Track]:
        now = time.time()
        track_ids = list(self.tracks.keys())
        unmatched_tracks = set(track_ids)
        unmatched_dets = set(range(len(detections)))
        pairs: list[tuple[float, int, int]] = []

        for tid in track_ids:
            track = self.tracks[tid]
            for di, det in enumerate(detections):
                score = _iou(track, det)
                if score >= self.iou_threshold:
                    pairs.append((score, tid, di))

        pairs.sort(reverse=True)
        used_tracks: set[int] = set()
        used_dets: set[int] = set()
        for score, tid, di in pairs:
            if tid in used_tracks or di in used_dets:
                continue
            det = detections[di]
            track = self.tracks[tid]
            track.x, track.y, track.w, track.h = det.x, det.y, det.w, det.h
            track.age_frames += 1
            track.missed = 0
            track.history.append((now, track.cx, track.cy, track.w, track.h))
            cutoff = now - history_seconds
            track.history = [h for h in track.history if h[0] >= cutoff]
            used_tracks.add(tid)
            used_dets.add(di)
            unmatched_tracks.discard(tid)
            unmatched_dets.discard(di)

        for tid in list(unmatched_tracks):
            track = self.tracks[tid]
            track.missed += 1
            if track.missed > self.max_missed:
                del self.tracks[tid]

        for di in unmatched_dets:
            det = detections[di]
            tid = self._next_id
            self._next_id += 1
            track = Track(
                track_id=tid,
                x=det.x,
                y=det.y,
                w=det.w,
                h=det.h,
                history=[(now, det.x + det.w / 2, det.y + det.h / 2, det.w, det.h)],
            )
            self.tracks[tid] = track

        return list(self.tracks.values())