from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from .alerts.store import store
from .models.schemas import (
    AlertCreate,
    AlertStatusUpdate,
    HealthResponse,
    TowerStatus,
)

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"

app = FastAPI(title="TowerWatch", version="0.1.0")

_latest_jpeg: bytes | None = None
_latest_lock = asyncio.Lock()


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(ok=True, open_alerts=await store.open_count())


@app.post("/api/alerts")
async def create_alert(payload: AlertCreate):
    alert = await store.create_alert(payload)
    return alert


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


@app.websocket("/ws/alerts")
async def alerts_ws(websocket: WebSocket):
    await websocket.accept()
    queue = await store.subscribe()
    try:
        # Send current snapshot
        alerts = await store.list_alerts()
        status = await store.get_tower_status()
        await websocket.send_json(
            {
                "type": "snapshot",
                "alerts": [a.model_dump(mode="json") for a in alerts],
                "status": status.model_dump(mode="json") if status else None,
            }
        )
        while True:
            # Wait for either a store event or a client ping
            get_task = asyncio.create_task(queue.get())
            recv_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {get_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if get_task in done:
                event = get_task.result()
                await websocket.send_json(event)
            if recv_task in done:
                _ = recv_task.result()
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(queue)


@app.get("/", response_class=HTMLResponse)
async def index():
    index_path = FRONTEND / "index.html"
    return FileResponse(index_path)


if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")