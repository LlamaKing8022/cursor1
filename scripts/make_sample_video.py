#!/usr/bin/env python3
"""Render a synthetic beach video so you can test upload + analysis without footage."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.analysis.writer import AnnotatedVideoWriter
from backend.app.pipeline.demo_scene import DemoBeachScene


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a sample beach video")
    parser.add_argument("--out", default=str(ROOT / "data" / "samples" / "sample_beach.mp4"))
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--fps", type=float, default=15.0)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--swimmers", type=int, default=6)
    parser.add_argument(
        "--distress-at",
        type=float,
        default=12.0,
        help="Seconds into the clip when one swimmer starts struggling",
    )
    args = parser.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    scene = DemoBeachScene(args.width, args.height, args.swimmers)
    writer = AnnotatedVideoWriter(out_path, args.width, args.height, args.fps)
    total_frames = int(args.seconds * args.fps)
    dt = 1.0 / args.fps
    triggered = False

    try:
        for frame_index in range(total_frames):
            if not triggered and frame_index * dt >= args.distress_at:
                scene.force_distress()
                triggered = True
            detections = scene.step(dt, distress_chance_per_second=0.0)
            writer.write(scene.render(detections))
    finally:
        writer.close()

    print(f"wrote {out_path} ({args.seconds:.0f}s @ {args.fps:.0f}fps, {writer.backend})")


if __name__ == "__main__":
    main()