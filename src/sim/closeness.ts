import type { Simulation } from "./simulation";
import type { SimConfig } from "./types";

const MATCH_TIME_LIMIT = 180;

export interface MatchCloseness {
  /** Higher means a tighter, more engaging finish. */
  score: number;
  summary: string;
  details: {
    duration: number;
    margin: number;
    competitiveness: number;
    pacing: number;
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

/** Bell-curve preference around a target duration. */
function durationSweetSpot(seconds: number, target: number, spread: number): number {
  const delta = (seconds - target) / spread;
  return Math.exp(-0.5 * delta * delta);
}

function battleMargin(sim: Simulation, config: SimConfig): number {
  const winner = sim.winner;
  if (!winner) return 0;

  if (config.teamMode) {
    const alive = sim.aliveCubes;
    const winnerTeam = winner.team;
    const winnerHp = alive
      .filter((cube) => cube.team === winnerTeam)
      .reduce((sum, cube) => sum + cube.hp, 0);

    const rivalHp = alive
      .filter((cube) => cube.team !== winnerTeam)
      .reduce((sum, cube) => sum + cube.hp, 0);

    if (winnerHp + rivalHp <= 0) return 0;
    return clamp01(rivalHp / (winnerHp + rivalHp));
  }

  if (winner.alive) {
    const hpRemaining = winner.hp / Math.max(1, config.startingHp);
    const hpScore = clamp01(1 - hpRemaining);

    const lastDeath = Math.max(
      0,
      ...sim.cubes.filter((cube) => cube.id !== winner.id).map((cube) => cube.deathTime),
    );
    const timeSinceLastKill = Math.max(0, sim.time - lastDeath);
    const timeScore = clamp01(1 - timeSinceLastKill / 28);
    return hpScore * 0.62 + timeScore * 0.38;
  }

  const deathTimes = sim.cubes.map((cube) => cube.deathTime).filter((time) => time > 0);
  if (deathTimes.length < 2) return 0.35;
  deathTimes.sort((a, b) => a - b);
  const lastGap = deathTimes[deathTimes.length - 1] - deathTimes[deathTimes.length - 2];
  return clamp01(1 - lastGap / 18);
}

function battleCompetitiveness(sim: Simulation): number {
  const kills = sim.cubes.map((cube) => cube.kills);
  const damage = sim.cubes.map((cube) => cube.damageDealt);
  const killBalance = clamp01(1 - stdDev(kills) / 2.4);
  const damageBalance = clamp01(1 - stdDev(damage) / Math.max(1, mean(damage) * 0.9));
  return killBalance * 0.55 + damageBalance * 0.45;
}

function scoreBattle(sim: Simulation, config: SimConfig): MatchCloseness {
  const duration = sim.time;
  const pacing = durationSweetSpot(duration, 78, 34);
  const margin = battleMargin(sim, config);
  const competitiveness = battleCompetitiveness(sim);
  const timeoutPenalty = duration >= MATCH_TIME_LIMIT - 0.5 ? 0.35 : 1;
  const rushPenalty = duration < 18 ? 0.45 : 1;

  const score =
    (margin * 0.42 + competitiveness * 0.28 + pacing * 0.3) * timeoutPenalty * rushPenalty;

  const summary =
    margin >= 0.72
      ? "Photo finish"
      : margin >= 0.5
        ? "Tight ending"
        : competitiveness >= 0.62
          ? "Balanced brawl"
          : "Decent scrap";

  return {
    score,
    summary,
    details: { duration, margin, competitiveness, pacing },
  };
}

function raceMargin(sim: Simulation): number {
  const finishers = sim.cubes
    .filter((cube) => cube.place > 0)
    .sort((a, b) => a.place - b.place);
  if (finishers.length < 2) return 0;

  const leader = finishers[0];
  const second = finishers[1];
  const gap12 = Math.max(0, second.finishTime - leader.finishTime);
  const gapScore = clamp01(1 - gap12 / 7.5);

  const pack = finishers.filter((cube) => cube.finishTime - leader.finishTime <= 14).length;
  const packScore = clamp01(pack / Math.max(2, sim.cubes.length * 0.65));

  return gapScore * 0.62 + packScore * 0.38;
}

function raceCompetitiveness(sim: Simulation): number {
  const finishers = sim.cubes.filter((cube) => cube.place > 0);
  if (finishers.length < 2) return 0;

  const leader = finishers.reduce((best, cube) => (cube.place < best.place ? cube : best), finishers[0]);
  const gaps = finishers
    .filter((cube) => cube.id !== leader.id)
    .map((cube) => Math.max(0, cube.finishTime - leader.finishTime));
  const avgGap = mean(gaps);
  const spread = stdDev(gaps);
  const tightPack = clamp01(1 - avgGap / 18);
  const evenSpread = clamp01(1 - spread / 12);
  return tightPack * 0.7 + evenSpread * 0.3;
}

function scoreRace(sim: Simulation): MatchCloseness {
  const duration = sim.time;
  const pacing = durationSweetSpot(duration, 62, 28) * (duration >= MATCH_TIME_LIMIT - 0.5 ? 0.35 : 1);
  const margin = raceMargin(sim);
  const competitiveness = raceCompetitiveness(sim);

  const score = margin * 0.5 + competitiveness * 0.25 + pacing * 0.25;
  const summary =
    margin >= 0.72 ? "Neck-and-neck finish" : margin >= 0.5 ? "Close podium" : "Tight pack";

  return {
    score,
    summary,
    details: { duration, margin, competitiveness, pacing },
  };
}

export function scoreMatchCloseness(sim: Simulation, config: SimConfig): MatchCloseness {
  if (sim.status !== "finished" || !sim.winner) {
    return {
      score: 0,
      summary: "Incomplete",
      details: { duration: sim.time, margin: 0, competitiveness: 0, pacing: 0 },
    };
  }

  return config.mode === "race" ? scoreRace(sim) : scoreBattle(sim, config);
}

export function describeCloseness(seed: number, closeness: MatchCloseness): string {
  const pct = Math.round(closeness.score * 100);
  return `Seed ${seed} · ${closeness.summary} (${pct}%)`;
}
