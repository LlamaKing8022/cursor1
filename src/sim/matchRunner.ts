import { FIXED_STEP, Simulation } from "./simulation";
import type { SimConfig } from "./types";

export interface MatchRunResult {
  sim: Simulation;
  /** Wall-clock match duration in seconds. */
  seconds: number;
  /** True when the sim hit the step cap without finishing. */
  timedOut: boolean;
}

/** Runs a match headlessly until it finishes or hits the step cap. */
export function runMatchToCompletion(
  config: SimConfig,
  maxSeconds = 400,
): MatchRunResult {
  const sim = new Simulation(config);
  const maxSteps = Math.ceil(maxSeconds / FIXED_STEP);
  let steps = 0;

  while (sim.status === "running" && steps < maxSteps) {
    sim.step(FIXED_STEP);
    steps += 1;
  }

  return {
    sim,
    seconds: steps * FIXED_STEP,
    timedOut: sim.status !== "finished",
  };
}
