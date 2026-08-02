from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config" / "default.yaml"


class TowerConfig(BaseModel):
    id: str = "tower-1"
    name: str = "Tower 1"
    zone: str = "Main swim area"


class CameraConfig(BaseModel):
    source: str = "demo"
    width: int = 1280
    height: int = 720
    fps: float = 12


class PipelineConfig(BaseModel):
    history_seconds: float = 8
    confirm_seconds: float = 3.0
    score_threshold: float = 0.72
    alert_cooldown_seconds: float = 45
    min_track_age_seconds: float = 2.0


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    alert_url: str = "http://127.0.0.1:8000/api/alerts"
    stream_url: str = "http://127.0.0.1:8000/api/stream/frame"


class DemoConfig(BaseModel):
    swimmers: int = 6
    distress_chance_per_second: float = 0.04


class AnalysisConfig(BaseModel):
    detector: str = "motion"
    target_fps: float = 10.0
    max_dimension: int = 960
    event_cooldown_seconds: float = 20.0
    clip_padding_seconds: float = 4.0
    write_annotated_video: bool = True


class AppConfig(BaseModel):
    tower: TowerConfig = Field(default_factory=TowerConfig)
    camera: CameraConfig = Field(default_factory=CameraConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    demo: DemoConfig = Field(default_factory=DemoConfig)
    analysis: AnalysisConfig = Field(default_factory=AnalysisConfig)


def load_config(path: str | Path | None = None) -> AppConfig:
    cfg_path = Path(path) if path else DEFAULT_CONFIG
    data: dict[str, Any] = {}
    if cfg_path.exists():
        with cfg_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    return AppConfig.model_validate(data)