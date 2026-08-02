from __future__ import annotations

import asyncio
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..alerts.store import store
from .video import analyze_video


@dataclass
class AnalysisJob:
    id: str
    video_name: str
    video_path: Path
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    message: str = "waiting"
    error: str = ""
    result: dict[str, Any] | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "video_name": self.video_name,
            "status": self.status,
            "progress": round(self.progress, 1),
            "message": self.message,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "result": self.result,
        }


class JobManager:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.uploads_dir = data_dir / "uploads"
        self.analysis_dir = data_dir / "analysis"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.analysis_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, AnalysisJob] = {}
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="analysis")
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def output_dir(self, job_id: str) -> Path:
        return self.analysis_dir / job_id

    def get(self, job_id: str) -> AnalysisJob | None:
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[AnalysisJob]:
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    def _publish(self, job: AnalysisJob) -> None:
        if not self._loop:
            return
        payload = {"type": "analysis_job", "job": job.to_dict()}
        asyncio.run_coroutine_threadsafe(store.publish(payload), self._loop)

    def submit(self, video_path: Path, options: dict[str, Any]) -> AnalysisJob:
        job_id = uuid.uuid4().hex[:12]
        job = AnalysisJob(id=job_id, video_name=video_path.name, video_path=video_path)
        self._jobs[job_id] = job
        self._pool.submit(self._run, job, options)
        return job

    def _run(self, job: AnalysisJob, options: dict[str, Any]) -> None:
        job.status = "running"
        job.message = "analyzing footage"
        self._publish(job)

        def progress_cb(pct: float, message: str) -> None:
            job.progress = pct
            job.message = message
            self._publish(job)

        try:
            result = analyze_video(
                video_path=job.video_path,
                output_dir=self.output_dir(job.id),
                progress_cb=progress_cb,
                **options,
            )
            job.result = result.to_dict()
            job.status = "done"
            job.progress = 100.0
            job.message = f"{len(result.events)} distress events"
        except Exception as exc:  # noqa: BLE001
            job.status = "error"
            job.error = f"{exc}"
            job.message = "analysis failed"
            traceback.print_exc()
        finally:
            self._publish(job)