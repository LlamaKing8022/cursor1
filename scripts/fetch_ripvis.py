#!/usr/bin/env python3
"""
Download the RipVIS rip-current dataset from Hugging Face.

RipVIS (Dumitriu et al., CVPR 2025) is fixed-camera / drone / phone beach footage
annotated for rip current instance segmentation — the closest public data to a
lifeguard tower view.

LICENSE: CC BY-NC 4.0 with extra conditions (non-commercial, attribution
required, no full-dataset redistribution). Read the dataset card before use:
https://huggingface.co/datasets/Irikos/RipVIS

Sizes (v1.8.4): train images ~6.6 GB, val images ~1.7 GB, videos are much larger.
Annotations alone are only a few MB, so `--annotations-only` is a cheap dry run.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

REPO_ID = "Irikos/RipVIS"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEST = ROOT / "data" / "ripvis"


def build_patterns(splits: list[str], annotations_only: bool, videos: bool) -> list[str]:
    patterns: list[str] = ["README.md"]
    for split in splits:
        patterns.append(f"{split}/coco_annotations/*")
        patterns.append(f"{split}/yolo_annotations.zip")
        if not annotations_only:
            patterns.append(f"{split}/sampled_images.zip")
        if videos:
            patterns.append(f"{split}/videos/*")
    return patterns


def extract_zips(dest: Path) -> None:
    for zip_path in sorted(dest.rglob("*.zip")):
        target = zip_path.with_suffix("")
        if target.exists() and any(target.iterdir()):
            print(f"  already extracted: {target.relative_to(dest)}")
            continue
        target.mkdir(parents=True, exist_ok=True)
        print(f"  extracting {zip_path.relative_to(dest)} -> {target.relative_to(dest)}")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the RipVIS dataset")
    parser.add_argument("--dest", default=str(DEFAULT_DEST))
    parser.add_argument(
        "--splits",
        default="train,val",
        help="Comma list of splits to fetch (train,val,test). test has no images.",
    )
    parser.add_argument(
        "--annotations-only",
        action="store_true",
        help="Skip the large image archives (a few MB total) — good for a first run",
    )
    parser.add_argument(
        "--videos", action="store_true", help="Also download full videos (very large)"
    )
    parser.add_argument(
        "--no-extract", action="store_true", help="Leave downloaded zips packed"
    )
    args = parser.parse_args()

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Missing dependency. Run: pip install huggingface_hub", file=sys.stderr)
        return 1

    splits = [s.strip() for s in args.splits.split(",") if s.strip()]
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    patterns = build_patterns(splits, args.annotations_only, args.videos)

    print(f"Downloading {REPO_ID} ({', '.join(splits)}) -> {dest}")
    print("Patterns:")
    for pattern in patterns:
        print(f"  {pattern}")
    print(
        "\nRipVIS is CC BY-NC 4.0 with additional conditions: non-commercial use,\n"
        "attribution required, no full-dataset redistribution.\n"
        "Cite Dumitriu et al., CVPR 2025 if you publish results.\n"
    )

    snapshot_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        local_dir=str(dest),
        allow_patterns=patterns,
        max_workers=4,
    )

    if not args.no_extract:
        print("Extracting archives:")
        extract_zips(dest)

    print(f"\nDone. Dataset at {dest}")
    print("Next: python3 scripts/prepare_ripvis.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())