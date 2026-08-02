from __future__ import annotations

import math

from .types import DistressResult, Track


def score_distress(track: Track, fps: float = 12.0) -> DistressResult:
    """
    Rule-based distress score for the MVP.

    Inspired by lifeguard cues:
    - little forward progress (stuck / bobbing)
    - tall vertical aspect ratio (upright struggle)
    - bobbing / vertical oscillation
    - sudden shrink / possible submersion
    """
    if len(track.history) < max(4, int(fps * 1.5)):
        return DistressResult(score=0.0, reasons=["track too new"])

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

    reasons: list[str] = []
    score = 0.0

    # Low net progress while present long enough
    if duration >= 3.0 and net_dx < 0.035 and progress_ratio < 0.35:
        score += 0.34
        reasons.append("little forward progress")

    # Upright body shape more than a prone swimmer
    if aspect >= 1.55:
        score += 0.22
        reasons.append("upright / vertical posture")

    # Bobbing in place
    if y_amp >= 0.025 and net_dx < 0.05:
        score += 0.24
        reasons.append("bobbing in place")

    # Possible submersion / disappearance of body mass
    if shrink >= 0.35 and duration >= 2.5:
        score += 0.28
        reasons.append("sudden size drop / possible submersion")

    # Extra weight if several cues stack
    if len(reasons) >= 3:
        score += 0.12
        reasons.append("multiple distress cues")

    # Mild dampener for tracks that are clearly traveling (swimmers/surfers)
    if net_dx > 0.12 and progress_ratio > 0.55:
        score *= 0.35
        reasons.append("clear travel — score reduced")

    score = max(0.0, min(1.0, score))
    if not reasons:
        reasons.append("no distress cues")
    return DistressResult(score=score, reasons=reasons)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])