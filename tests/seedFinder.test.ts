import { scoreMatchCloseness } from "../src/sim/closeness";
import { runMatchToCompletion } from "../src/sim/matchRunner";
import { findBestSeedSync } from "../src/sim/seedFinder";
import { DEFAULT_ARENA_HEIGHT } from "../src/sim/arena";
import type { SimConfig } from "../src/sim/types";

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

function group(name: string, body: () => void): void {
  console.log(`\n${name}`);
  body();
}

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    mode: "battle",
    cubeCount: 8,
    seed: 12345,
    speed: 1,
    arenaStyle: "pillars",
    powerUpsEnabled: true,
    startingHp: 100,
    teamMode: false,
    teamCount: 2,
    collisionDamage: true,
    arenaHeight: DEFAULT_ARENA_HEIGHT,
    ...overrides,
  };
}

group("closeness scores stay in range", () => {
  for (const seed of [3, 17, 99, 4242]) {
    const config = baseConfig({ seed });
    const { sim } = runMatchToCompletion(config);
    const closeness = scoreMatchCloseness(sim, config);
    check(closeness.score >= 0 && closeness.score <= 1, `seed ${seed}: score in [0, 1]`);
    check(closeness.summary.length > 0, `seed ${seed}: summary present`);
    check(closeness.details.duration > 0, `seed ${seed}: duration recorded`);
  }
});

group("seed finder returns a finished candidate", () => {
  const { seed: _ignored, ...base } = baseConfig();
  const result = findBestSeedSync(base, {
    startSeed: 5000,
    scanCount: 24,
    refineRadius: 2,
    topK: 3,
  });

  check(result.scanned > 0, "scanned at least one seed");
  check(result.best.seed > 0, "best seed is non-zero");
  check(result.best.score >= 0, "best score is non-negative");
  check(result.top.length > 0, "top list is populated");
  check(result.top[0].seed === result.best.seed, "top list is sorted by score");
});

group("refining around a seed never does worse than the start seed alone", () => {
  const { seed: _ignored, ...base } = baseConfig();
  const startSeed = 120_004;
  const baseline = findBestSeedSync(base, {
    startSeed,
    scanCount: 1,
    refineRadius: 0,
    topK: 1,
  });
  const refined = findBestSeedSync(base, {
    startSeed,
    scanCount: 1,
    refineRadius: 8,
    topK: 1,
  });

  check(
    refined.best.score >= baseline.best.score,
    `refined score (${refined.best.score.toFixed(2)}) should be at least baseline (${baseline.best.score.toFixed(2)})`,
  );
});

group("race closeness rewards tight finishes", () => {
  const config = baseConfig({ mode: "race", seed: 55, powerUpsEnabled: false });
  const { sim } = runMatchToCompletion(config);
  const closeness = scoreMatchCloseness(sim, config);
  check(closeness.details.margin >= 0, "race margin is non-negative");
  check(closeness.score > 0, "finished race gets a positive score");
});

console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
