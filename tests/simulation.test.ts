import { FIXED_STEP, Simulation } from "../src/sim/simulation";
import { DEFAULT_ARENA_HEIGHT } from "../src/sim/arena";
import type { ArenaStyle, GameMode, SimConfig } from "../src/sim/types";

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

/** Runs a match to completion. Returns the sim plus how long it took. */
function runMatch(config: SimConfig, maxSeconds = 400) {
  const sim = new Simulation(config);
  const maxSteps = Math.ceil(maxSeconds / FIXED_STEP);
  let steps = 0;

  while (sim.status === "running" && steps < maxSteps) {
    sim.step(FIXED_STEP);
    steps += 1;
  }
  return { sim, seconds: steps * FIXED_STEP };
}

const MODES: GameMode[] = ["battle", "race"];
const STYLES: ArenaStyle[] = ["open", "pillars", "maze"];

group("every match reaches a conclusion", () => {
  for (const mode of MODES) {
    for (const arenaStyle of STYLES) {
      for (const seed of [1, 7, 99, 4242, 987654]) {
        const { sim, seconds } = runMatch(baseConfig({ mode, arenaStyle, seed }));
        check(
          sim.status === "finished",
          `${mode}/${arenaStyle}/seed ${seed} finished (stopped at ${seconds.toFixed(0)}s)`,
        );
        check(sim.winner !== null, `${mode}/${arenaStyle}/seed ${seed} produced a winner`);
      }
    }
  }
});

group("battle mode leaves exactly one survivor", () => {
  for (const seed of [3, 31, 314, 3141, 31415]) {
    const { sim } = runMatch(baseConfig({ mode: "battle", seed }));
    const alive = sim.aliveCubes;
    check(alive.length <= 1, `seed ${seed}: ${alive.length} cubes alive at the end`);
    if (sim.winner && alive.length === 1) {
      check(sim.winner.id === alive[0].id, `seed ${seed}: winner is the survivor`);
    }
    const eliminated = sim.cubes.filter((cube) => !cube.alive).length;
    check(eliminated === sim.cubes.length - alive.length, `seed ${seed}: elimination count is consistent`);
  }
});

group("a mutual knockout still names a winner", () => {
  // Sweeping seeds so this covers whichever ones end in a simultaneous kill.
  let mutualKnockouts = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const { sim } = runMatch(baseConfig({ mode: "battle", arenaStyle: "maze", seed }));
    check(sim.winner !== null, `seed ${seed}: winner declared`);
    if (sim.winner && !sim.winner.alive) {
      mutualKnockouts += 1;
      const latestDeath = Math.max(...sim.cubes.map((cube) => cube.deathTime));
      check(
        sim.winner.deathTime === latestDeath,
        `seed ${seed}: photo-finish winner survived longest`,
      );
    }
  }
  console.log(`  (${mutualKnockouts}/60 maze matches ended in a mutual knockout)`);
});

group("race mode awards the win to the first finisher", () => {
  for (const seed of [5, 55, 555, 5555]) {
    const { sim } = runMatch(baseConfig({ mode: "race", seed, powerUpsEnabled: false }));
    check(sim.winner !== null, `seed ${seed}: a cube won`);
    if (sim.winner && sim.winner.place > 0) {
      check(sim.winner.place === 1, `seed ${seed}: winner holds first place`);
      const others = sim.cubes.filter((cube) => cube.place > 0 && cube.id !== sim.winner!.id);
      check(
        others.every((cube) => cube.finishTime >= sim.winner!.finishTime),
        `seed ${seed}: nobody finished before the winner`,
      );
      const places = sim.cubes.filter((c) => c.place > 0).map((c) => c.place);
      check(new Set(places).size === places.length, `seed ${seed}: finishing places are unique`);
    }
  }
});

/**
 * Racers are moved by nothing but their own bouncing, so reaching the flag is
 * never guaranteed -- a cube can spend the whole match rattling around behind a
 * gate. What must hold is that the match still concludes and, when someone does
 * cross, the win is theirs and the match wraps up promptly.
 */
group("races conclude, and a crossing ends the match promptly", () => {
  let crossed = 0;
  let total = 0;

  for (const arenaStyle of STYLES) {
    for (const seed of [2, 12, 120, 1200, 12000]) {
      const { sim } = runMatch(baseConfig({ mode: "race", arenaStyle, seed }));
      const label = `${arenaStyle}/seed ${seed}`;
      total += 1;

      check(sim.status === "finished", `${label}: match concluded`);
      check(sim.winner !== null, `${label}: a winner was named`);

      if (sim.winner && sim.winner.place === 1) {
        crossed += 1;
        // The match lingers briefly after the win so the podium can fill out.
        const lingered = sim.time - sim.winner.finishTime;
        check(lingered <= 2.6, `${label}: stopped ${lingered.toFixed(2)}s after the win`);
      }
    }
  }

  console.log(`  (${crossed}/${total} races were settled at the flag rather than on time)`);
});

group("battles are decided by fighting, not by the storm", () => {
  let stormDecided = 0;
  const total = 40;

  for (let seed = 1; seed <= total; seed += 1) {
    const { sim } = runMatch(baseConfig({ mode: "battle", seed, cubeCount: 8 }));
    // The last cube to fall decides the match; a null killer means the storm did it.
    const finalDeath = sim.cubes
      .filter((cube) => !cube.alive)
      .reduce<(typeof sim.cubes)[number] | null>(
        (latest, cube) => (latest === null || cube.deathTime > latest.deathTime ? cube : latest),
        null,
      );
    if (finalDeath && finalDeath.killedBy === null) stormDecided += 1;
    check(sim.time < 120, `seed ${seed}: match ran ${sim.time.toFixed(1)}s`);
  }

  check(
    stormDecided <= total * 0.3,
    `storm delivered the final blow in ${stormDecided}/${total} matches (want <= 30%)`,
  );
  console.log(`  (storm decided ${stormDecided}/${total})`);
});

group("cube counts from 2 to 16 all work", () => {
  for (let count = 2; count <= 16; count += 1) {
    for (const mode of MODES) {
      const { sim } = runMatch(baseConfig({ mode, cubeCount: count, seed: 2000 + count }));
      check(sim.cubes.length === count, `${mode}: spawned ${sim.cubes.length}/${count} cubes`);
      check(sim.status === "finished", `${mode} with ${count} cubes finished`);
    }
  }
});

group("physics stays stable", () => {
  for (const mode of MODES) {
    for (const arenaStyle of STYLES) {
      const config = baseConfig({ mode, arenaStyle, speed: 2.5, cubeCount: 16, seed: 777 });
      const sim = new Simulation(config);
      const tolerance = 80;
      let escaped = false;
      let invalid = false;

      for (let i = 0; i < 6000 && sim.status === "running"; i += 1) {
        sim.step(FIXED_STEP);
        for (const cube of sim.cubes) {
          if (!Number.isFinite(cube.x) || !Number.isFinite(cube.y)) invalid = true;
          if (!Number.isFinite(cube.vx) || !Number.isFinite(cube.vy)) invalid = true;
          if (
            cube.x < -tolerance ||
            cube.y < -tolerance ||
            cube.x > sim.bounds.width + tolerance ||
            cube.y > sim.bounds.height + tolerance
          ) {
            escaped = true;
          }
        }
      }

      check(!invalid, `${mode}/${arenaStyle}: no NaN positions or velocities`);
      check(!escaped, `${mode}/${arenaStyle}: no cube escaped the arena`);
    }
  }
});

group("cubes keep moving instead of stalling", () => {
  const sim = new Simulation(baseConfig({ mode: "battle", seed: 4004, powerUpsEnabled: false }));
  for (let i = 0; i < 1200; i += 1) sim.step(FIXED_STEP);

  const stalled = sim.aliveCubes.filter((cube) => Math.hypot(cube.vx, cube.vy) < 40);
  check(stalled.length === 0, `${stalled.length} cubes were nearly motionless after 10s`);
});

group("same seed replays identically", () => {
  for (const mode of MODES) {
    const config = baseConfig({ mode, seed: 8888 });
    const first = runMatch({ ...config }).sim;
    const second = runMatch({ ...config }).sim;

    check(first.winner?.id === second.winner?.id, `${mode}: same winner`);
    check(
      Math.abs(first.time - second.time) < 1e-9,
      `${mode}: same match duration (${first.time} vs ${second.time})`,
    );
    check(
      first.cubes.every((cube, i) => Math.abs(cube.x - second.cubes[i].x) < 1e-9),
      `${mode}: identical final positions`,
    );
  }

  const a = runMatch(baseConfig({ seed: 1111 })).sim;
  const b = runMatch(baseConfig({ seed: 2222 })).sim;
  check(a.time !== b.time || a.winner?.id !== b.winner?.id, "different seeds diverge");
});

group("power-ups spawn and get collected", () => {
  const sim = new Simulation(baseConfig({ mode: "battle", seed: 6161, powerUpsEnabled: true }));
  let everSpawned = false;
  let everCollected = false;

  for (let i = 0; i < 3600 && sim.status === "running"; i += 1) {
    sim.step(FIXED_STEP);
    if (sim.powerUps.length > 0) everSpawned = true;
    // A buff can only be active because a cube walked into a pickup.
    if (sim.cubes.some((cube) => cube.boostTime > 0 || cube.shieldTime > 0 || cube.rageTime > 0)) {
      everCollected = true;
    }
  }

  check(everSpawned, "power-ups appeared during the match");
  check(everCollected, "a cube collected a power-up");

  const disabled = new Simulation(baseConfig({ mode: "battle", seed: 6161, powerUpsEnabled: false }));
  let buffSeen = false;
  for (let i = 0; i < 3600 && disabled.status === "running"; i += 1) {
    disabled.step(FIXED_STEP);
    if (disabled.powerUps.length > 0) buffSeen = true;
  }
  check(!buffSeen, "no power-ups spawn when the option is off");
});

group("kills are attributed to the cube that landed the blow", () => {
  const sim = new Simulation(baseConfig({ mode: "battle", seed: 909, cubeCount: 10 }));
  while (sim.status === "running") sim.step(FIXED_STEP);

  const dead = sim.cubes.filter((cube) => !cube.alive);
  check(dead.length > 0, "some cubes were eliminated");

  for (const cube of dead) {
    check(cube.deathTime > 0, `${cube.name} recorded a death time`);
    if (cube.killedBy !== null) {
      check(cube.killedBy !== cube.id, `${cube.name} was not credited with killing itself`);
    }
  }

  const totalKills = sim.cubes.reduce((sum, cube) => sum + cube.kills, 0);
  const attributed = dead.filter((cube) => cube.killedBy !== null).length;
  check(totalKills === attributed, `kill counts match attributed deaths (${totalKills} vs ${attributed})`);
});

group("standings are ordered sensibly", () => {
  const battle = new Simulation(baseConfig({ mode: "battle", seed: 4321 }));
  for (let i = 0; i < 2400; i += 1) battle.step(FIXED_STEP);
  const battleStandings = battle.standings();
  const firstDead = battleStandings.findIndex((cube) => !cube.alive);
  if (firstDead !== -1) {
    check(
      battleStandings.slice(firstDead).every((cube) => !cube.alive),
      "battle: survivors are listed above eliminated cubes",
    );
  }

  const race = new Simulation(baseConfig({ mode: "race", seed: 4321 }));
  for (let i = 0; i < 2400; i += 1) race.step(FIXED_STEP);
  const raceStandings = race.standings();
  const unfinished = raceStandings.filter((cube) => cube.place === 0);
  check(
    unfinished.every((cube, i) => i === 0 || unfinished[i - 1].x >= cube.x),
    "race: unfinished cubes are sorted by progress",
  );
});

group("team mode finishes with one team left", () => {
  for (const seed of [11, 22, 33, 44]) {
    const { sim } = runMatch(baseConfig({ mode: "battle", seed, teamMode: true, cubeCount: 8 }));
    check(sim.status === "finished", `seed ${seed}: finished`);
    check(sim.winner !== null, `seed ${seed}: winner declared`);
    const survivingTeams = new Set(sim.cubes.filter((cube) => cube.alive).map((cube) => cube.team));
    check(survivingTeams.size <= 1, `seed ${seed}: at most one team survived`);
  }
});

group("collision damage off keeps cubes healthy from bumps alone", () => {
  const sim = new Simulation(
    baseConfig({
      mode: "battle",
      seed: 555,
      collisionDamage: false,
      powerUpsEnabled: false,
      cubeCount: 8,
      arenaStyle: "open",
    }),
  );
  for (let i = 0; i < 600; i += 1) sim.step(FIXED_STEP);
  const allFull = sim.cubes.every((cube) => cube.hp === cube.maxHp && cube.alive);
  check(allFull, "open arena with collision damage off: cubes kept full hp during early chaos");
});

group("arena height changes generated bounds", () => {
  const sim = new Simulation(baseConfig({ arenaHeight: 960, arenaStyle: "open" }));
  check(sim.bounds.height === 960, "taller generated arena uses the requested height");
  check(sim.bounds.height !== DEFAULT_ARENA_HEIGHT, "height differs from the default");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
