import type { Simulation } from "./simulation";
import type { SimConfig } from "./types";

const MATCH_TIME_LIMIT = 180;

export interface MatchStats {
  duration: number;
  firstDeathTime: number;
  lastDeathTime: number;
  deathTimes: number[];
  totalKills: number;
  totalDamage: number;
  firstFinishTime: number;
  finishTimes: number[];
  hitTimeLimit: boolean;
}

export function collectMatchStats(sim: Simulation, _config: SimConfig): MatchStats {
  const deathTimes = sim.cubes
    .map((cube) => cube.deathTime)
    .filter((time) => time > 0)
    .sort((a, b) => a - b);
  const finishTimes = sim.cubes
    .map((cube) => cube.finishTime)
    .filter((time) => time > 0)
    .sort((a, b) => a - b);

  return {
    duration: sim.time,
    firstDeathTime: deathTimes[0] ?? sim.time,
    lastDeathTime: deathTimes[deathTimes.length - 1] ?? 0,
    deathTimes,
    totalKills: sim.cubes.reduce((sum, cube) => sum + cube.kills, 0),
    totalDamage: sim.cubes.reduce((sum, cube) => sum + cube.damageDealt, 0),
    firstFinishTime: finishTimes[0] ?? sim.time,
    finishTimes,
    hitTimeLimit: sim.time >= MATCH_TIME_LIMIT - 0.5,
  };
}
