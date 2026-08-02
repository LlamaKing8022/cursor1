#!/usr/bin/env python3
"""Offline smoke test for tracker, distress scoring, and video analysis."""

from __future__ import annotations

import argparse
import sys
import tempfile
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


def _rip_track(track_id: int, offshore: bool) -> Track:
    """Track that travels steadily — offshore (seaward) or along the beach."""
    track = Track(track_id=track_id, x=0.5, y=0.7, w=0.03, h=0.045)
    t0 = time.time() - 6
    for i in range(24):
        if offshore:
            # Camera looks out to sea, so seaward drift means decreasing y
            x, y = 0.5 + i * 0.002, 0.70 - i * 0.006
        else:
            x, y = 0.2 + i * 0.02, 0.70
        track.history.append((t0 + i * 0.25, x, y, 0.03, 0.045))
    return track


def test_rip_zone_map_smoothing_and_sampling() -> None:
    import numpy as np

    from backend.app.pipeline.rip import RipZoneMap

    zones = RipZoneMap(grid=64, smoothing=0.5)
    assert zones.risk_at(0.5, 0.5) == 0.0, "no updates yet means no risk"

    mask = np.zeros((100, 100), dtype=np.float32)
    mask[40:60, 40:60] = 1.0  # rip patch in the middle
    for _ in range(12):
        zones.update(mask)

    inside = zones.risk_at(0.5, 0.5)
    outside = zones.risk_at(0.05, 0.05)
    assert inside > 0.8, inside
    assert outside < 0.2, outside

    # A single clean frame must not immediately erase a persistent rip
    zones.update(np.zeros((100, 100), dtype=np.float32))
    assert zones.risk_at(0.5, 0.5) > 0.3, "smoothing should resist one-frame dropout"
    assert 0.0 < zones.coverage(0.3) < 1.0


def test_rip_risk_escalates_offshore_drift() -> None:
    """A swimmer swept seaward in a rip must not be dismissed as a strong swimmer."""
    calm = score_distress(_rip_track(31, offshore=True), fps=12, rip_risk=0.0)
    in_rip = score_distress(_rip_track(32, offshore=True), fps=12, rip_risk=0.9)
    assert in_rip.score > calm.score, (calm, in_rip)
    assert any("rip" in r for r in in_rip.reasons), in_rip.reasons
    assert any("offshore" in r for r in in_rip.reasons), in_rip.reasons

    # Someone swimming along the beach outside a rip stays low
    alongshore = score_distress(_rip_track(33, offshore=False), fps=12, rip_risk=0.0)
    assert alongshore.score < 0.5, alongshore


def test_rip_exposure_monitor_advisory() -> None:
    from backend.app.pipeline.distress import RipExposureMonitor

    monitor = RipExposureMonitor(advisory_seconds=5.0, cooldown_seconds=60.0)
    assert monitor.update(1, 0.9, now=0.0) is None, "needs to persist first"
    assert monitor.update(1, 0.9, now=3.0) is None
    held = monitor.update(1, 0.9, now=6.0)
    assert held is not None and held >= 5.0, held
    assert monitor.update(1, 0.9, now=7.0) is None, "cooldown should suppress repeats"

    # Leaving the rip resets exposure
    assert monitor.update(2, 0.9, now=0.0) is None
    assert monitor.update(2, 0.1, now=3.0) is None
    assert monitor.update(2, 0.9, now=4.0) is None
    assert monitor.update(2, 0.9, now=10.0) is not None


def test_rip_segmenter_absent_weights_disables_cleanly() -> None:
    from backend.app.pipeline.rip import build_rip_segmenter

    assert build_rip_segmenter(enabled=False, weights="models/nope.pt") is None
    assert build_rip_segmenter(enabled=True, weights="/tmp/definitely-missing.pt") is None


def test_video_analysis_finds_event() -> None:
    """Render a short clip with a struggling swimmer and confirm analysis flags it."""
    from backend.app.analysis.video import analyze_video
    from backend.app.analysis.writer import AnnotatedVideoWriter
    from backend.app.pipeline.demo_scene import DemoBeachScene

    fps, seconds, width, height = 15.0, 45.0, 640, 360
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        video_path = tmp_path / "clip.mp4"
        # Seeded so motion detection + distress placement stay reproducible.
        scene = DemoBeachScene(width, height, swimmers=5, seed=7)
        writer = AnnotatedVideoWriter(video_path, width, height, fps)
        dt = 1.0 / fps
        triggered = False
        try:
            for frame_index in range(int(seconds * fps)):
                if not triggered and frame_index * dt >= 8.0:
                    scene.force_distress()
                    triggered = True
                detections = scene.step(dt, distress_chance_per_second=0.0)
                writer.write(scene.render(detections))
        finally:
            writer.close()

        result = analyze_video(
            video_path=video_path,
            output_dir=tmp_path / "out",
            detector_mode="motion",
            target_fps=8.0,
            write_annotated=False,
            confirm_seconds=2.5,
        )
        assert result.events, "expected at least one distress event"
        event = result.events[0]
        assert event.peak_score >= 0.72, event
        assert event.start_time > 8.0, event


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fast", action="store_true", help="skip the slower video analysis test"
    )
    args = parser.parse_args()

    test_traveling_swimmer_low_score()
    test_distress_pattern_high_score()
    test_tracker_keeps_id()
    test_rip_zone_map_smoothing_and_sampling()
    test_rip_risk_escalates_offshore_drift()
    test_rip_exposure_monitor_advisory()
    test_rip_segmenter_absent_weights_disables_cleanly()
    if not args.fast:
        test_video_analysis_finds_event()
    print("smoke_test: OK")