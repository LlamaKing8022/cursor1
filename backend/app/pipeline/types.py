from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Detection:
    x: float
    y: float
    w: float
    h: float
    confidence: float = 1.0
    label: str = "person"


@dataclass
class Track:
    track_id: int
    x: float
    y: float
    w: float
    h: float
    age_frames: int = 1
    missed: int = 0
    history: list[tuple[float, float, float, float, float]] = field(default_factory=list)
    # history entries: (timestamp, cx, cy, w, h)

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass
class DistressResult:
    score: float
    reasons: list[str]