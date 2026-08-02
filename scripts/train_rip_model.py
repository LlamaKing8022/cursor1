#!/usr/bin/env python3
"""
Fine-tune a YOLO segmentation model on RipVIS and install it for TowerWatch.

The RipVIS authors report YOLO baselines with recall-weighted metrics (F2), since
missing a rip is worse than flagging a calm patch of water. Defaults here follow
that bias: a low confidence threshold at inference, tuned later per beach.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "ripvis" / "yolo" / "ripvis.yaml"
DEFAULT_DEST = ROOT / "models" / "rip_seg.pt"


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a rip current segmenter")
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    parser.add_argument(
        "--weights",
        default="yolo11n-seg.pt",
        help="Starting checkpoint. Use yolo11s-seg.pt or larger with a GPU.",
    )
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default=None, help="e.g. 0 for GPU, cpu for CPU")
    parser.add_argument("--project", default=str(ROOT / "runs" / "rip"))
    parser.add_argument("--name", default="ripvis-seg")
    parser.add_argument("--dest", default=str(DEFAULT_DEST))
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(
            f"No dataset config at {data_path}.\n"
            "Run scripts/fetch_ripvis.py then scripts/prepare_ripvis.py first."
        )
        return 1

    try:
        from ultralytics import YOLO
    except ImportError:
        print("Missing dependency. Run: pip install ultralytics", file=sys.stderr)
        return 1

    model = YOLO(args.weights)
    results = model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        task="segment",
    )

    save_dir = Path(getattr(results, "save_dir", Path(args.project) / args.name))
    best = save_dir / "weights" / "best.pt"
    if not best.exists():
        print(f"Training finished but no weights at {best}")
        return 1

    dest = Path(args.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, dest)
    print(f"\nInstalled rip model: {dest}")
    print("Enable it in config/default.yaml:\n\n  rip:\n    enabled: true\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())