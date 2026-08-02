from __future__ import annotations

import csv
import io
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LABEL_VALUES = {"true_positive", "false_positive", "unsure"}


class LabelStore:
    """
    Append-only label log plus extracted clips.

    Lifeguard verdicts on real footage are the training data for a supervised
    distress model, so each verdict is stored with the clip it refers to.
    """

    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir / "labels"
        self.clips_dir = self.dir / "clips"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.clips_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "labels.jsonl"

    def add(
        self,
        job_id: str,
        video_name: str,
        video_path: Path,
        event: dict[str, Any],
        label: str,
        notes: str = "",
        clip_padding_seconds: float = 4.0,
    ) -> dict[str, Any]:
        if label not in LABEL_VALUES:
            raise ValueError(f"label must be one of {sorted(LABEL_VALUES)}")

        clip_name = self._extract_clip(
            job_id=job_id,
            video_path=video_path,
            event=event,
            label=label,
            padding=clip_padding_seconds,
        )

        record = {
            "labeled_at": datetime.now(timezone.utc).isoformat(),
            "job_id": job_id,
            "video_name": video_name,
            "event_index": event.get("index"),
            "track_id": event.get("track_id"),
            "start_time": event.get("start_time"),
            "end_time": event.get("end_time"),
            "peak_score": event.get("peak_score"),
            "reasons": event.get("reasons", []),
            "bbox": event.get("bbox", {}),
            "label": label,
            "notes": notes,
            "clip": clip_name,
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        return record

    def _extract_clip(
        self,
        job_id: str,
        video_path: Path,
        event: dict[str, Any],
        label: str,
        padding: float,
    ) -> str:
        if not shutil.which("ffmpeg") or not video_path.exists():
            return ""
        start = max(0.0, float(event.get("start_time", 0.0)) - padding)
        end = float(event.get("end_time", start)) + padding
        duration = max(end - start, 2.0)
        out_dir = self.clips_dir / label
        out_dir.mkdir(parents=True, exist_ok=True)
        out_name = f"{job_id}_event{int(event.get('index', 0)):03d}.mp4"
        out_path = out_dir / out_name
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.2f}",
            "-i",
            str(video_path),
            "-t",
            f"{duration:.2f}",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            str(out_path),
        ]
        try:
            subprocess.run(cmd, check=True, timeout=300)
        except (subprocess.SubprocessError, OSError):
            return ""
        return f"{label}/{out_name}"

    def all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        records: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        return records

    def summary(self) -> dict[str, Any]:
        records = self.all()
        counts: dict[str, int] = {}
        for record in records:
            counts[record["label"]] = counts.get(record["label"], 0) + 1
        return {"total": len(records), "counts": counts}

    def to_csv(self) -> str:
        records = self.all()
        buffer = io.StringIO()
        fields = [
            "labeled_at",
            "video_name",
            "job_id",
            "event_index",
            "track_id",
            "start_time",
            "end_time",
            "peak_score",
            "label",
            "notes",
            "clip",
            "reasons",
        ]
        writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            row = dict(record)
            row["reasons"] = "; ".join(record.get("reasons", []))
            writer.writerow(row)
        return buffer.getvalue()