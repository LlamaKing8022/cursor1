from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class TrackSnapshot(BaseModel):
    track_id: int
    bbox: BoundingBox
    score: float
    reasons: list[str] = Field(default_factory=list)


class AlertCreate(BaseModel):
    tower_id: str
    tower_name: str = "Tower"
    zone: str = ""
    track_id: int
    score: float
    reasons: list[str] = Field(default_factory=list)
    bbox: BoundingBox
    frame_jpeg_b64: str | None = None
    note: str = ""


class Alert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=utc_now)
    tower_id: str
    tower_name: str
    zone: str
    track_id: int
    score: float
    reasons: list[str]
    bbox: BoundingBox
    frame_jpeg_b64: str | None = None
    note: str = ""
    status: Literal["open", "acknowledged", "dismissed", "responding"] = "open"


class AlertStatusUpdate(BaseModel):
    status: Literal["acknowledged", "dismissed", "responding", "open"]


class TowerStatus(BaseModel):
    tower_id: str
    tower_name: str
    zone: str
    camera_ok: bool
    tracks: int
    fps: float
    last_frame_at: datetime | None = None
    pipeline_mode: str = "demo"


class HealthResponse(BaseModel):
    ok: bool
    service: str = "towerwatch"
    version: str = "0.0.0"
    open_alerts: int