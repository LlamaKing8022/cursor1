import { scoreMatchCloseness } from "./closeness";
import { collectMatchStats, type MatchStats } from "./matchStats";
import type { Simulation } from "./simulation";
import type { SimConfig } from "./types";

export interface MatchEngagement {
  score: number;
  summary: string;
  details: {
    duration: number;
    firstAction: number;
    combatPace: number;
    fightSpan: number;
    closeness: number;
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const LIVELY_TARGET_SECONDS = 40;

/** Bell-curve preference around a target duration. */
function durationSweetSpot(duration: number, target: number, spread: number): number {
  const delta = (duration - target) / spread;
  return Math.exp(-0.5 * delta * delta);
}

/** Lively battles should land near 40 seconds, not drag on. */
function battleDurationScore(duration: number): number {
  const sweetSpot = durationSweetSpot(duration, LIVELY_TARGET_SECONDS, 11);

  if (duration < 18) return sweetSpot * 0.62;
  if (duration > 95) return sweetSpot * 0.12;
  if (duration > 70) return sweetSpot * 0.38;
  if (duration > 55) return sweetSpot * 0.68;

  return sweetSpot;
}

function raceDurationScore(duration: number, hitTimeLimit: boolean): number {
  if (hitTimeLimit) return 0.15;

  const sweetSpot = durationSweetSpot(duration, LIVELY_TARGET_SECONDS, 12);
  if (duration < 16) return sweetSpot * 0.7;
  if (duration > 90) return sweetSpot * 0.2;
  if (duration > 65) return sweetSpot * 0.45;

  return sweetSpot;
}

function battleFirstActionScore(firstDeathTime: number): number {
  if (firstDeathTime <= 18) return 1;
  if (firstDeathTime <= 32) return clamp01(1 - (firstDeathTime - 18) / 28);
  if (firstDeathTime <= 55) return clamp01(0.55 - (firstDeathTime - 32) / 70);
  return clamp01(0.18 - (firstDeathTime - 55) / 180);
}

function battleCombatPace(stats: MatchStats, config: SimConfig): number {
  const minutes = Math.max(stats.duration / 60, 1 / 60);
  const killsPerMinute = stats.totalKills / minutes;
  const damagePerMinute = stats.totalDamage / minutes;

  const killTarget = Math.max(1.1, config.cubeCount * 0.22);
  const damageBudget = config.startingHp * Math.max(1, config.cubeCount - 1);
  const damageTarget = damageBudget * (config.collisionDamage ? 0.42 : 0.2);

  const killScore = clamp01(killsPerMinute / killTarget);
  const damageScore = clamp01(damagePerMinute / Math.max(1, damageTarget));
  return killScore * 0.48 + damageScore * 0.52;
}

function battleFightSpan(stats: MatchStats): number {
  if (stats.deathTimes.length < 2) return 0.2;

  const span = stats.lastDeathTime - stats.firstDeathTime;
  const spanRatio = span / Math.max(1, stats.duration);
  const spread = mean(
    stats.deathTimes.slice(1).map((time, index) => time - stats.deathTimes[index]),
  );

  const spanScore = clamp01(spanRatio / 0.58);
  const cadenceScore = clamp01(spread / 18);
  const endClusterPenalty =
    stats.duration > 48 && spanRatio < 0.22 ? 0.35 : spanRatio < 0.32 ? 0.68 : 1;

  return spanScore * 0.62 + cadenceScore * 0.38 * endClusterPenalty;
}

function scoreBattleEngagement(sim: Simulation, config: SimConfig): MatchEngagement {
  const stats = collectMatchStats(sim, config);
  const closeness = scoreMatchCloseness(sim, config);

  const duration = battleDurationScore(stats.duration);
  const firstAction = battleFirstActionScore(stats.firstDeathTime);
  const combatPace = battleCombatPace(stats, config);
  const fightSpan = battleFightSpan(stats);

  const stallPenalty =
    stats.duration > 58 && stats.firstDeathTime > 34
      ? 0.45
      : stats.duration > 50 && fightSpan < 0.3
        ? 0.62
        : 1;
  const timeoutPenalty = stats.hitTimeLimit ? 0.25 : 1;

  const action =
    duration * 0.34 + firstAction * 0.22 + combatPace * 0.24 + fightSpan * 0.2;
  const score = (action * 0.68 + closeness.score * 0.32) * stallPenalty * timeoutPenalty;

  let summary = "Lively match";
  if (stats.hitTimeLimit) summary = "Timed out";
  else if (firstAction < 0.35 && stats.duration > 60) summary = "Slow start";
  else if (combatPace < 0.35 && stats.duration > 55) summary = "Low action";
  else if (fightSpan < 0.35 && stats.duration > 48) summary = "Late brawl";
  else if (Math.abs(stats.duration - LIVELY_TARGET_SECONDS) <= 8 && combatPace >= 0.5) {
    summary = "~40s scrap";
  } else if (duration >= 0.85 && combatPace >= 0.55) summary = "Fast and scrappy";
  else if (closeness.score >= 0.62) summary = "Active close finish";

  return {
    score,
    summary,
    details: {
      duration: stats.duration,
      firstAction,
      combatPace,
      fightSpan,
      closeness: closeness.score,
    },
  };
}

function raceFirstActionScore(firstFinishTime: number, hitTimeLimit: boolean): number {
  if (hitTimeLimit) return 0.1;
  if (firstFinishTime <= 24) return 1;
  if (firstFinishTime <= 48) return clamp01(1 - (firstFinishTime - 24) / 40);
  return clamp01(0.35 - (firstFinishTime - 48) / 120);
}

function racePackMovement(stats: MatchStats, sim: Simulation): number {
  if (stats.finishTimes.length < 2) return 0.2;

  const leader = stats.finishTimes[0];
  const withinTen = stats.finishTimes.filter((time) => time - leader <= 10).length;
  const packScore = clamp01(withinTen / Math.max(2, sim.cubes.length * 0.55));

  const gaps = stats.finishTimes.slice(1).map((time) => time - stats.finishTimes[0]);
  const avgGap = mean(gaps);
  const gapScore = clamp01(1 - avgGap / 16);

  return packScore * 0.55 + gapScore * 0.45;
}

function scoreRaceEngagement(sim: Simulation, config: SimConfig): MatchEngagement {
  const stats = collectMatchStats(sim, config);
  const closeness = scoreMatchCloseness(sim, config);

  const duration = raceDurationScore(stats.duration, stats.hitTimeLimit);
  const firstAction = raceFirstActionScore(stats.firstFinishTime, stats.hitTimeLimit);
  const combatPace = racePackMovement(stats, sim);
  const fightSpan = clamp01(stats.finishTimes.length / Math.max(1, sim.cubes.length));

  const score =
    (duration * 0.36 + firstAction * 0.2 + combatPace * 0.26 + fightSpan * 0.18) * 0.62 +
    closeness.score * 0.38;

  let summary = "Pacy race";
  if (stats.hitTimeLimit) summary = "Timed out";
  else if (firstAction < 0.4 && stats.duration > 65) summary = "Slow opener";
  else if (Math.abs(stats.duration - LIVELY_TARGET_SECONDS) <= 8 && combatPace >= 0.55) {
    summary = "~40s sprint";
  } else if (combatPace >= 0.7) summary = "Tight pack sprint";
  else if (duration >= 0.85) summary = "Quick race";

  return {
    score,
    summary,
    details: {
      duration: stats.duration,
      firstAction,
      combatPace,
      fightSpan,
      closeness: closeness.score,
    },
  };
}

export function scoreMatchEngagement(sim: Simulation, config: SimConfig): MatchEngagement {
  if (sim.status !== "finished" || !sim.winner) {
    return {
      score: 0,
      summary: "Incomplete",
      details: {
        duration: sim.time,
        firstAction: 0,
        combatPace: 0,
        fightSpan: 0,
        closeness: 0,
      },
    };
  }

  return config.mode === "race" ? scoreRaceEngagement(sim, config) : scoreBattleEngagement(sim, config);
}

export function describeEngagement(seed: number, engagement: MatchEngagement): string {
  const pct = Math.round(engagement.score * 100);
  const seconds = Math.round(engagement.details.duration);
  return `Seed ${seed} · ${engagement.summary} (${pct}%, ${seconds}s)`;
}
