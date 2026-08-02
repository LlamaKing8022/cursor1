from __future__ import annotations

import asyncio
import re
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .alerts.store import store
from .analysis.jobs import JobManager
from .analysis.labels import LabelStore
from .config import load_config
from .models.schemas import (
    AlertCreate,
    AlertStatusUpdate,
    HealthResponse,
    TowerStatus,
)

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
DATA_DIR = ROOT / "data"

ALLOWED_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mpg", ".mpeg"}

APP_VERSION = "0.2.0"

app = FastAPI(title="TowerWatch", version=APP_VERSION)


@app.middleware("http")
async def no_store_ui(request: Request, call_next):
    """Keep the tablet UI from serving a cached build after an update."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
    return response

config = load_config()
jobs = JobManager(DATA_DIR)
labels = LabelStore(DATA_DIR)

_latest_jpeg: bytes | None = None
_latest_lock = asyncio.Lock()


@app.on_event("startup")
async def _bind_loop() -> None:
    jobs.bind_loop(asyncio.get_running_loop())


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        ok=True, version=APP_VERSION, open_alerts=await store.open_count()
    )


@app.post("/api/alerts")
async def create_alert(payload: AlertCreate):
    return await store.create_alert(payload)


@app.get("/api/alerts")
async def list_alerts(status: str | None = None):
    return await store.list_alerts(status=status)


@app.post("/api/alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, payload: AlertStatusUpdate):
    alert = await store.update_status(alert_id, payload.status)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@app.post("/api/tower/status")
async def update_tower_status(payload: TowerStatus):
    await store.set_tower_status(payload)
    return {"ok": True}


@app.get("/api/tower/status")
async def get_tower_status():
    status = await store.get_tower_status()
    if not status:
        raise HTTPException(status_code=404, detail="No tower status yet")
    return status


@app.post("/api/stream/frame")
async def upload_frame(request: Request):
    global _latest_jpeg
    body = await request.body()
    async with _latest_lock:
        _latest_jpeg = body
    return {"ok": True, "bytes": len(body)}


@app.get("/api/stream/latest.jpg")
async def latest_frame():
    async with _latest_lock:
        data = _latest_jpeg
    if not data:
        raise HTTPException(status_code=404, detail="No frame yet")
    return Response(content=data, media_type="image/jpeg")


def _safe_stem(name: str) -> str:
    stem = Path(name).stem
    return re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:60] or "video"


@app.post("/api/videos")
async def upload_video(
    file: UploadFile = File(...),
    detector: str = Form("motion"),
    target_fps: float = Form(10.0),
    score_threshold: float | None = Form(None),
    confirm_seconds: float | None = Form(None),
    write_annotated: bool = Form(True),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video type '{suffix}'. Allowed: "
            + ", ".join(sorted(ALLOWED_VIDEO_SUFFIXES)),
        )
    if detector not in {"motion", "hog", "yolo"}:
        raise HTTPException(status_code=400, detail="detector must be motion, hog, or yolo")

    stored_name = f"{_safe_stem(file.filename or 'video')}_{uuid.uuid4().hex[:8]}{suffix}"
    dest = jobs.uploads_dir / stored_name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out, length=1024 * 1024)
    await file.close()

    if dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file was empty")

    options = {
        "detector_mode": detector,
        "target_fps": max(1.0, min(target_fps, 30.0)),
        "max_dimension": config.analysis.max_dimension,
        "score_threshold": score_threshold
        if score_threshold is not None
        else config.pipeline.score_threshold,
        "confirm_seconds": confirm_seconds
        if confirm_seconds is not None
        else config.pipeline.confirm_seconds,
        "history_seconds": config.pipeline.history_seconds,
        "min_track_age_seconds": config.pipeline.min_track_age_seconds,
        "event_cooldown_seconds": config.analysis.event_cooldown_seconds,
        "write_annotated": write_annotated,
    }
    job = jobs.submit(dest, options)
    return job.to_dict()


@app.get("/api/analysis/jobs")
async def list_jobs():
    return [job.to_dict() for job in jobs.list_jobs()]


@app.get("/api/analysis/jobs/{job_id}")
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/api/analysis/{job_id}/video")
async def annotated_video(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    path = jobs.output_dir(job_id) / "annotated.mp4"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Annotated video not ready")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/analysis/{job_id}/source")
async def source_video(job_id: str):
    job = jobs.get(job_id)
    if not job or not job.video_path.exists():
        raise HTTPException(status_code=404, detail="Source video not found")
    return FileResponse(job.video_path, media_type="video/mp4")


@app.get("/api/analysis/{job_id}/snapshots/{name}")
async def snapshot(job_id: str, name: str):
    if not re.fullmatch(r"[A-Za-z0-9._-]+\.jpg", name):
        raise HTTPException(status_code=400, detail="Bad snapshot name")
    path = jobs.output_dir(job_id) / "snapshots" / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/analysis/{job_id}/events/{event_index}/label")
async def label_event(job_id: str, event_index: int, payload: dict):
    job = jobs.get(job_id)
    if not job or not job.result:
        raise HTTPException(status_code=404, detail="Analysis not found")
    events = job.result.get("events", [])
    event = next((e for e in events if e.get("index") == event_index), None)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    label = str(payload.get("label", ""))
    notes = str(payload.get("notes", ""))
    try:
        record = await asyncio.to_thread(
            labels.add,
            job_id,
            job.video_name,
            job.video_path,
            event,
            label,
            notes,
            config.analysis.clip_padding_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await store.publish({"type": "label", "label": record, "summary": labels.summary()})
    return {"ok": True, "record": record, "summary": labels.summary()}


@app.get("/api/labels/summary")
async def labels_summary():
    return labels.summary()


@app.get("/api/labels/export.csv", response_class=PlainTextResponse)
async def labels_csv():
    return PlainTextResponse(
        labels.to_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=towerwatch_labels.csv"},
    )


@app.websocket("/ws/alerts")
async def alerts_ws(websocket: WebSocket):
    await websocket.accept()
    queue = await store.subscribe()
    try:
        alerts = await store.list_alerts()
        status = await store.get_tower_status()
        await websocket.send_json(
            {
                "type": "snapshot",
                "alerts": [a.model_dump(mode="json") for a in alerts],
                "status": status.model_dump(mode="json") if status else None,
                "jobs": [job.to_dict() for job in jobs.list_jobs()],
                "label_summary": labels.summary(),
            }
        )
        while True:
            get_task = asyncio.create_task(queue.get())
            recv_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {get_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if get_task in done:
                await websocket.send_json(get_task.result())
            if recv_task in done:
                _ = recv_task.result()
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(queue)


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(FRONTEND / "index.html")


if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")