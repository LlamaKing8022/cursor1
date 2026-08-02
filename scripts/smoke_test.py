#!/usr/bin/env python3
"""Offline smoke test for tracker + distress scoring (no server required)."""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.pipeline.distress import score_distress
from backend.app.pipeline.tracker import IoUTracker
from backend.app.pipeline.types import Detection, Track


def test_traveling_swimmer_low_score() -> None:
    track = Track(track_id=1, x=0.1, y=0.5, w=0.03, h=0.04)
    t0 = time.time() - 6
    for i in range(24):
        x = 0.1 + i * 0.02
        track.history.append((t0 + i * 0.25, x, 0.5, 0.03, 0.04))
    result = score_distress(track, fps=12)
    assert result.score < 0.5, result


def test_distress_pattern_high_score() -> None:
    track = Track(track_id=2, x=0.4, y=0.55, w=0.028, h=0.07)
    t0 = time.time() - 7
    for i in range(28):
        # Almost no x progress, bobbing y, tall box, shrinking late
        y = 0.55 + (0.02 if i % 2 == 0 else -0.02)
        scale = 1.0 if i < 18 else 0.55
        track.history.append(
            (t0 + i * 0.25, 0.40 + i * 0.0004, y, 0.028 * scale, 0.07 * scale)
        )
    result = score_distress(track, fps=12)
    assert result.score >= 0.72, result
    assert any("progress" in r or "bobbing" in r or "submersion" in r for r in result.reasons)


def test_tracker_keeps_id() -> None:
    tracker = IoUTracker()
    a = tracker.update([Detection(0.2, 0.5, 0.04, 0.06)])
    b = tracker.update([Detection(0.21, 0.51, 0.04, 0.06)])
    assert len(a) == 1 and len(b) == 1
    assert a[0].track_id == b[0].track_id


if __name__ == "__main__":
    test_traveling_swimmer_low_score()
    test_distress_pattern_high_score()
    test_tracker_keeps_id()
    print("smoke_test: OK")