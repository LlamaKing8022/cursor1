from __future__ import annotations

import math

from .types import DistressResult, Track

# Above this smoothed rip probability a swimmer is treated as being in a rip.
RIP_RISK_THRESHOLD = 0.45


def score_distress(track: Track, fps: float = 12.0, rip_risk: float = 0.0) -> DistressResult:
    """
    Rule-based distress score for the MVP.

    Inspired by lifeguard cues:
    - little forward progress (stuck / bobbing)
    - tall vertical aspect ratio (upright struggle)
    - bobbing / vertical oscillation
    - sudden shrink / possible submersion

    `rip_risk` is the smoothed rip-current probability at the swimmer's position.
    """
    if len(track.history) < max(4, int(fps * 1.5)):
        return DistressResult(score=0.0, reasons=["track too new"], rip_risk=rip_risk)

    xs = [h[1] for h in track.history]
    ys = [h[2] for h in track.history]
    ws = [h[3] for h in track.history]
    hs = [h[4] for h in track.history]
    ts = [h[0] for h in track.history]
    duration = max(ts[-1] - ts[0], 1e-3)

    # Horizontal progress in normalized frame units (0-1 coords expected)
    net_dx = abs(xs[-1] - xs[0])
    path_len = sum(abs(xs[i] - xs[i - 1]) for i in range(1, len(xs)))
    progress_ratio = net_dx / max(path_len, 1e-3)

    # Vertical bobbing amplitude
    y_amp = max(ys) - min(ys)
    mean_h = sum(hs) / len(hs)
    aspect = mean_h / max(sum(ws) / len(ws), 1e-3)

    # Size collapse near end can indicate submersion / distance loss
    early_area = (sum(ws[:3]) / 3) * (sum(hs[:3]) / 3)
    late_area = (sum(ws[-3:]) / 3) * (sum(hs[-3:]) / 3)
    shrink = 1.0 - (late_area / max(early_area, 1e-6))

    # Offshore drift: in a tower view the horizon is up, so decreasing y is seaward
    net_dy_offshore = ys[0] - ys[-1]

    in_rip = rip_risk >= RIP_RISK_THRESHOLD
    reasons: list[str] = []
    score = 0.0

    if duration >= 3.0 and net_dx < 0.035 and progress_ratio < 0.35:
        score += 0.34
        reasons.append("little forward progress")

    if aspect >= 1.55:
        score += 0.22
        reasons.append("upright / vertical posture")

    if y_amp >= 0.025 and net_dx < 0.05:
        score += 0.24
        reasons.append("bobbing in place")

    if shrink >= 0.35 and duration >= 2.5:
        score += 0.28
        reasons.append("sudden size drop / possible submersion")

    if len(reasons) >= 3:
        score += 0.12
        reasons.append("multiple distress cues")

    swept_offshore = (
        in_rip and duration >= 3.0 and net_dy_offshore >= 0.03 and progress_ratio > 0.5
    )

    if in_rip:
        score += 0.18
        reasons.append("inside likely rip current")
        if swept_offshore:
            # Being carried seaward is the danger itself, not evidence of swimming
            score += 0.22
            reasons.append("drifting offshore in current")

    # Travelling swimmers and surfers are usually fine — but not if a rip is moving
    # them, so the dampener is skipped when the swimmer is being swept out.
    if net_dx > 0.12 and progress_ratio > 0.55 and not swept_offshore:
        score *= 0.35
        reasons.append("clear travel — score reduced")

    score = max(0.0, min(1.0, score))
    if not reasons:
        reasons.append("no distress cues")
    return DistressResult(score=score, reasons=reasons, rip_risk=rip_risk)


class RipExposureMonitor:
    """
    Tracks how long each swimmer stays inside a rip zone.

    A swimmer in a rip is a rescue about to happen, so this raises an early
    advisory before any distress cue appears — preventive rather than reactive.
    """

    def __init__(
        self,
        advisory_seconds: float = 6.0,
        cooldown_seconds: float = 90.0,
        risk_threshold: float = RIP_RISK_THRESHOLD,
    ) -> None:
        self.advisory_seconds = advisory_seconds
        self.cooldown_seconds = cooldown_seconds
        self.risk_threshold = risk_threshold
        self._since: dict[int, float] = {}
        self._last_advisory: dict[int, float] = {}

    def update(self, track_id: int, rip_risk: float, now: float) -> float | None:
        """Return seconds-in-rip when an advisory should fire, else None."""
        if rip_risk < self.risk_threshold:
            self._since.pop(track_id, None)
            return None
        start = self._since.setdefault(track_id, now)
        held = now - start
        if held < self.advisory_seconds:
            return None
        if now - self._last_advisory.get(track_id, -1e9) < self.cooldown_seconds:
            return None
        self._last_advisory[track_id] = now
        return held

    def forget(self, track_ids: set[int]) -> None:
        for tid in list(self._since):
            if tid not in track_ids:
                self._since.pop(tid, None)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])