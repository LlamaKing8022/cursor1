import { describeCloseness, scoreMatchCloseness } from "./closeness";
import { runMatchToCompletion } from "./matchRunner";
import { randomSeed } from "./rng";
import type { SimConfig } from "./types";

export interface SeedCandidate {
  seed: number;
  score: number;
  summary: string;
  duration: number;
}

export interface SeedFinderOptions {
  /** First seed in the primary scan window. */
  startSeed?: number;
  /** How many consecutive seeds to simulate in the first pass. */
  scanCount?: number;
  /** How many seeds on each side of a promising hit to refine. */
  refineRadius?: number;
  /** How many top seeds to keep. */
  topK?: number;
  /** Optional callback after each simulated seed. */
  onProgress?: (done: number, total: number, best: SeedCandidate | null) => void;
  /** Yield to the event loop every N simulations (browser UI). */
  yieldEvery?: number;
}

export interface SeedFinderResult {
  best: SeedCandidate;
  top: SeedCandidate[];
  scanned: number;
}

const DEFAULT_SCAN_COUNT = 180;
const DEFAULT_REFINE_RADIUS = 6;
const DEFAULT_TOP_K = 5;

function withSeed(config: Omit<SimConfig, "seed">, seed: number): SimConfig {
  return { ...config, seed: seed >>> 0 };
}

function evaluateSeed(config: Omit<SimConfig, "seed">, seed: number): SeedCandidate {
  const { sim, timedOut } = runMatchToCompletion(withSeed(config, seed));
  const closeness = scoreMatchCloseness(sim, withSeed(config, seed));
  const score = timedOut ? closeness.score * 0.15 : closeness.score;

  return {
    seed: seed >>> 0,
    score,
    summary: describeCloseness(seed, closeness),
    duration: closeness.details.duration,
  };
}

function pushTop(top: SeedCandidate[], candidate: SeedCandidate, limit: number): void {
  top.push(candidate);
  top.sort((a, b) => b.score - a.score || a.seed - b.seed);
  if (top.length > limit) top.length = limit;
}

function uniqueSeeds(seeds: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const seed of seeds) {
    const normalized = seed >>> 0;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildSeedList(options: SeedFinderOptions): number[] {
  const start = options.startSeed ?? randomSeed();
  const scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
  const refineRadius = options.refineRadius ?? DEFAULT_REFINE_RADIUS;

  const primary: number[] = [];
  for (let offset = 0; offset < scanCount; offset += 1) {
    primary.push((start + offset) >>> 0);
  }

  const refined: number[] = [];
  for (const seed of primary) {
    for (let delta = -refineRadius; delta <= refineRadius; delta += 1) {
      if (delta === 0) continue;
      refined.push((seed + delta) >>> 0);
    }
  }

  return uniqueSeeds([...primary, ...refined]);
}

async function maybeYield(done: number, yieldEvery: number): Promise<void> {
  if (yieldEvery > 0 && done % yieldEvery === 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** Scans seeds and returns the closest matches for the given setup. */
export async function findCloseSeeds(
  config: Omit<SimConfig, "seed">,
  options: SeedFinderOptions = {},
): Promise<SeedFinderResult> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const yieldEvery = options.yieldEvery ?? 0;
  const seeds = buildSeedList(options);
  const top: SeedCandidate[] = [];
  let best: SeedCandidate | null = null;

  for (let index = 0; index < seeds.length; index += 1) {
    const candidate = evaluateSeed(config, seeds[index]);
    pushTop(top, candidate, topK);
    if (!best || candidate.score > best.score) best = candidate;
    options.onProgress?.(index + 1, seeds.length, best);
    await maybeYield(index + 1, yieldEvery);
  }

  if (!best) {
    const fallbackSeed = options.startSeed ?? randomSeed();
    best = evaluateSeed(config, fallbackSeed);
    top.push(best);
  }

  return {
    best,
    top: top.sort((a, b) => b.score - a.score || a.seed - b.seed),
    scanned: seeds.length,
  };
}

/** Synchronous helper for tests and quick one-off lookups. */
export function findBestSeedSync(
  config: Omit<SimConfig, "seed">,
  options: SeedFinderOptions = {},
): SeedFinderResult {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const seeds = buildSeedList(options);
  const top: SeedCandidate[] = [];
  let best: SeedCandidate | null = null;

  for (const seed of seeds) {
    const candidate = evaluateSeed(config, seed);
    pushTop(top, candidate, topK);
    if (!best || candidate.score > best.score) best = candidate;
    options.onProgress?.(top.length, seeds.length, best);
  }

  return {
    best: best ?? evaluateSeed(config, options.startSeed ?? 1),
    top: top.sort((a, b) => b.score - a.score || a.seed - b.seed),
    scanned: seeds.length,
  };
}
