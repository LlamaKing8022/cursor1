#!/usr/bin/env python3
"""
Convert an extracted RipVIS download into an Ultralytics YOLO segmentation dataset.

RipVIS ships images and YOLO labels in separate archives whose internal layout has
changed between versions, so images and labels are matched by filename stem found
recursively rather than by a hardcoded path.
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "data" / "ripvis"
DEFAULT_OUT = ROOT / "data" / "ripvis" / "yolo"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def index_files(base: Path, suffixes: set[str] | None = None, suffix: str | None = None):
    """Map filename stem -> path for every matching file under base."""
    found: dict[str, Path] = {}
    duplicates: dict[str, int] = defaultdict(int)
    if not base.exists():
        return found, duplicates
    for path in base.rglob("*"):
        if not path.is_file():
            continue
        if suffixes and path.suffix.lower() not in suffixes:
            continue
        if suffix and path.suffix.lower() != suffix:
            continue
        stem = path.stem
        if stem in found:
            duplicates[stem] += 1
            continue
        found[stem] = path
    return found, duplicates


def valid_seg_label(path: Path) -> bool:
    """A YOLO segmentation line is a class id plus an even number of coordinates."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    if not text:
        # Background-only frames are legitimate negatives
        return True
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 7 or (len(parts) - 1) % 2 != 0:
            return False
    return True


def link(src: Path, dst: Path, mode: str) -> None:
    if dst.exists() or dst.is_symlink():
        return
    if mode == "copy":
        dst.write_bytes(src.read_bytes())
        return
    try:
        os.symlink(os.path.relpath(src, dst.parent), dst)
    except OSError:
        dst.write_bytes(src.read_bytes())


def prepare_split(
    src: Path, out: Path, split: str, mode: str, include_additional: bool
) -> dict:
    images_root = src / split / "sampled_images"
    labels_root = src / split / "yolo_annotations"

    images, _ = index_files(images_root, suffixes=IMAGE_SUFFIXES)
    labels, _ = index_files(labels_root, suffix=".txt")

    if not include_additional:
        images = {
            stem: path
            for stem, path in images.items()
            if "additional" not in str(path).lower()
        }

    out_images = out / "images" / split
    out_labels = out / "labels" / split
    out_images.mkdir(parents=True, exist_ok=True)
    out_labels.mkdir(parents=True, exist_ok=True)

    matched = 0
    skipped_bad = 0
    no_label = 0

    for stem, image_path in sorted(images.items()):
        label_path = labels.get(stem)
        if label_path is None:
            no_label += 1
            continue
        if not valid_seg_label(label_path):
            skipped_bad += 1
            continue
        link(image_path, out_images / image_path.name, mode)
        link(label_path, out_labels / f"{stem}.txt", mode)
        matched += 1

    return {
        "split": split,
        "images_found": len(images),
        "labels_found": len(labels),
        "matched": matched,
        "images_without_label": no_label,
        "invalid_labels": skipped_bad,
        "images_dir": str(out_images),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare RipVIS for YOLO segmentation")
    parser.add_argument("--src", default=str(DEFAULT_SRC))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--splits", default="train,val")
    parser.add_argument(
        "--mode",
        choices=["symlink", "copy"],
        default="symlink",
        help="symlink saves ~8 GB of duplication",
    )
    parser.add_argument(
        "--no-additional",
        action="store_true",
        help="Exclude the extra CVPRW-2023 images (the paper trains with them)",
    )
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not src.exists():
        print(f"No RipVIS download at {src}. Run scripts/fetch_ripvis.py first.")
        return 1

    splits = [s.strip() for s in args.splits.split(",") if s.strip()]
    reports = [
        prepare_split(src, out, split, args.mode, not args.no_additional)
        for split in splits
    ]

    yaml_path = out / "ripvis.yaml"
    train_dir = out / "images" / "train"
    val_dir = out / "images" / "val"
    yaml_path.write_text(
        "# RipVIS rip current segmentation (CC BY-NC 4.0 — non-commercial, attribution)\n"
        f"path: {out.resolve()}\n"
        f"train: {train_dir.relative_to(out)}\n"
        f"val: {val_dir.relative_to(out)}\n"
        "names:\n"
        "  0: rip_current\n",
        encoding="utf-8",
    )

    print("RipVIS -> YOLO segmentation dataset")
    for report in reports:
        print(
            f"  {report['split']}: {report['matched']} pairs "
            f"(images {report['images_found']}, labels {report['labels_found']}, "
            f"unmatched {report['images_without_label']}, invalid {report['invalid_labels']})"
        )
    print(f"\nWrote {yaml_path}")

    if all(r["matched"] == 0 for r in reports):
        print(
            "\nNo image/label pairs matched. If you used --annotations-only, re-run\n"
            "scripts/fetch_ripvis.py without that flag to get sampled_images.zip."
        )
        return 1

    print("Next: python3 scripts/train_rip_model.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())