import { DEFAULT_CUBE_SIZE, FIXED_STEP, Simulation } from "../src/sim/simulation";
import { DEFAULT_ARENA_HEIGHT } from "../src/sim/arena";
import {
  MAP_HEIGHT,
  MAX_MAP_HEIGHT,
  MAX_MAP_WIDTH,
  MIN_MAP_WIDTH,
  createEmptyMap,
  normalizeMap,
  type CustomMap,
} from "../src/sim/map";
import type { GameMode, SimConfig } from "../src/sim/types";

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

function configFor(map: CustomMap, mode: GameMode, overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    mode,
    cubeCount: 8,
    seed: 4242,
    speed: 1,
    arenaStyle: "pillars",
    powerUpsEnabled: true,
    startingHp: 100,
    teamMode: false,
    teamCount: 2,
    collisionDamage: true,
    arenaHeight: DEFAULT_ARENA_HEIGHT,
    cubeSize: DEFAULT_CUBE_SIZE,
    customMap: map,
    ...overrides,
  };
}

function runMatch(config: SimConfig, maxSeconds = 400) {
  const sim = new Simulation(config);
  const maxSteps = Math.ceil(maxSeconds / FIXED_STEP);
  let steps = 0;
  while (sim.status === "running" && steps < maxSteps) {
    sim.step(FIXED_STEP);
    steps += 1;
  }
  return sim;
}

/** A hand-built map roughly like something drawn in the editor. */
function sampleMap(): CustomMap {
  const map = createEmptyMap("Test arena");
  map.width = 1400;
  map.walls = [
    { x: 400, y: 0, width: 40, height: 240, direction: "none", speed: 35 },
    { x: 400, y: 400, width: 40, height: 240, direction: "none", speed: 35 },
    { x: 900, y: 260, width: 200, height: 40, direction: "none", speed: 35 },
  ];
  map.spawnZones = [
    { x: 60, y: 60, width: 200, height: 200 },
    { x: 60, y: 380, width: 200, height: 200 },
  ];
  map.powerUpSpots = [
    { x: 700, y: 120, kind: "heal" },
    { x: 700, y: 520, kind: "random" },
  ];
  map.finishZones = [{ x: map.width - 80, y: 0, width: 50, height: MAP_HEIGHT }];
  return map;
}

group("custom maps replace the generated arena", () => {
  const map = sampleMap();
  const sim = new Simulation(configFor(map, "battle"));

  check(sim.bounds.width === map.width, `bounds use the map width (${sim.bounds.width})`);
  check(sim.bounds.height === MAP_HEIGHT, "bounds use the fixed map height");
  check(sim.obstacles.length === map.walls.length, "every wall became an obstacle");
  check(
    sim.obstacles.every((obstacle, i) => obstacle.x === map.walls[i].x && obstacle.y === map.walls[i].y),
    "walls kept their positions",
  );
});

group("cubes spawn inside the drawn spawn zones", () => {
  for (const count of [2, 5, 8, 16]) {
    const map = sampleMap();
    const sim = new Simulation(configFor(map, "battle", { cubeCount: count }));

    const outside = sim.cubes.filter(
      (cube) =>
        !map.spawnZones.some(
          (zone) =>
            cube.x >= zone.x - 1 &&
            cube.x <= zone.x + zone.width + 1 &&
            cube.y >= zone.y - 1 &&
            cube.y <= zone.y + zone.height + 1,
        ),
    );
    check(outside.length === 0, `${count} cubes: all started inside a zone (${outside.length} outside)`);

    // Round-robin assignment should keep the zones roughly balanced.
    const perZone = map.spawnZones.map(
      (zone) =>
        sim.cubes.filter(
          (cube) =>
            cube.x >= zone.x - 1 &&
            cube.x <= zone.x + zone.width + 1 &&
            cube.y >= zone.y - 1 &&
            cube.y <= zone.y + zone.height + 1,
        ).length,
    );
    check(
      Math.max(...perZone) - Math.min(...perZone) <= 1,
      `${count} cubes: spread evenly across zones (${perZone.join("/")})`,
    );

    const stacked = sim.cubes.some((a, i) =>
      sim.cubes.some((b, j) => j > i && a.x === b.x && a.y === b.y),
    );
    check(!stacked, `${count} cubes: no two cubes spawned on the exact same spot`);
  }
});

group("maps with no spawn zones fall back to default positions", () => {
  const map = createEmptyMap("Bare");
  map.spawnZones = [];
  const sim = new Simulation(configFor(map, "battle"));

  check(sim.cubes.length === 8, "cubes still spawned");
  check(
    sim.cubes.every(
      (cube) => cube.x > 0 && cube.x < map.width && cube.y > 0 && cube.y < MAP_HEIGHT,
    ),
    "fallback spawns land inside the map",
  );
});

group("power-up pads appear where they were placed and respawn", () => {
  const map = sampleMap();
  const sim = new Simulation(configFor(map, "battle"));
  sim.step(FIXED_STEP);

  check(sim.powerUps.length === map.powerUpSpots.length, "one pickup per placed pad");
  check(
    sim.powerUps.every((powerUp) =>
      map.powerUpSpots.some((spot) => spot.x === powerUp.x && spot.y === powerUp.y),
    ),
    "pickups sit exactly on their pads",
  );
  check(
    sim.powerUps.every((powerUp) => powerUp.spotIndex !== null),
    "pickups remember which pad they belong to",
  );

  const healSpot = sim.powerUps.find((powerUp) => powerUp.x === 700 && powerUp.y === 120);
  check(healSpot?.kind === "heal", "a fixed-kind pad spawns that exact power-up");

  // Collect one by hand, then confirm it comes back after the cooldown.
  const collected = sim.powerUps[0];
  const cube = sim.cubes[0];
  cube.x = collected.x;
  cube.y = collected.y;
  sim.step(FIXED_STEP);
  check(
    !sim.powerUps.some((powerUp) => powerUp.id === collected.id),
    "the pickup disappears once collected",
  );

  cube.x = 60;
  cube.y = 60;
  let respawned = false;
  for (let i = 0; i < 120 * 14 && !respawned; i += 1) {
    sim.step(FIXED_STEP);
    respawned = sim.powerUps.some(
      (powerUp) => powerUp.x === collected.x && powerUp.y === collected.y,
    );
  }
  check(respawned, "the pad refills after its cooldown");
});

group("power-ups stay off when disabled", () => {
  const sim = new Simulation(configFor(sampleMap(), "battle", { powerUpsEnabled: false }));
  for (let i = 0; i < 600; i += 1) sim.step(FIXED_STEP);
  check(sim.powerUps.length === 0, "no pickups spawn on a map full of pads");
});

group("custom maps work in both modes and always finish", () => {
  for (const mode of ["battle", "race"] as GameMode[]) {
    for (const seed of [1, 22, 333, 4444]) {
      const sim = runMatch(configFor(sampleMap(), mode, { seed }));
      check(sim.status === "finished", `${mode}/seed ${seed}: match concluded`);
      check(sim.winner !== null, `${mode}/seed ${seed}: winner declared`);
    }
  }
});

group("race finish flags trigger wins on custom maps", () => {
  const map = sampleMap();
  const sim = new Simulation(configFor(map, "race"));
  check(sim.finishZones.length === 1, `map has ${sim.finishZones.length} finish zone(s)`);
  check(sim.finishX === null, "custom maps no longer auto-finish at the map edge");

  const finished = runMatch(configFor(map, "race", { seed: 99 }));
  check(finished.winner?.place === 1, "a cube reached the placed finish flag");
});

group("cubes stay inside a custom map", () => {
  const map = sampleMap();
  const sim = new Simulation(configFor(map, "battle", { speed: 2.5, cubeCount: 16 }));
  let escaped = false;

  for (let i = 0; i < 4000 && sim.status === "running"; i += 1) {
    sim.step(FIXED_STEP);
    for (const cube of sim.cubes) {
      if (cube.x < -80 || cube.y < -80 || cube.x > map.width + 80 || cube.y > MAP_HEIGHT + 80) {
        escaped = true;
      }
    }
  }
  check(!escaped, "no cube escaped the custom bounds");
});

group("map validation cleans up bad data", () => {
  const clamped = normalizeMap({ width: 99999, walls: [], spawnZones: [], powerUpSpots: [] });
  check(clamped?.width === MAX_MAP_WIDTH, `oversized width clamped to ${MAX_MAP_WIDTH}`);

  const tiny = normalizeMap({ width: 10 });
  check(tiny?.width === MIN_MAP_WIDTH, `undersized width raised to ${MIN_MAP_WIDTH}`);

  const tall = normalizeMap({ width: 1200, height: 2000, walls: [], spawnZones: [], powerUpSpots: [] });
  check(tall?.height === MAX_MAP_HEIGHT, `oversized height clamped to ${MAX_MAP_HEIGHT}`);

  const trimmed = normalizeMap({
    width: 1000,
    walls: [
      { x: 900, y: 100, width: 400, height: 50 }, // hangs off the right edge
      { x: 10, y: 10, width: 2, height: 2 }, // too small to matter
      { x: -50, y: -50, width: 200, height: 200 }, // starts outside
    ],
  });
  check(trimmed?.walls.length === 2, `degenerate wall dropped (${trimmed?.walls.length} kept)`);
  check(
    trimmed !== null && trimmed.walls.every((wall) => wall.x >= 0 && wall.x + wall.width <= 1000),
    "walls trimmed to the map",
  );

  const negative = normalizeMap({
    width: 1000,
    walls: [{ x: 300, y: 300, width: -120, height: -90 }],
  });
  check(negative?.walls.length === 1, "a backwards-dragged wall is still kept");
  check(
    (negative?.walls[0].width ?? 0) > 0 && (negative?.walls[0].height ?? 0) > 0,
    "backwards drag normalized to positive size",
  );

  const spots = normalizeMap({
    width: 1000,
    powerUpSpots: [
      { x: 5000, y: -20, kind: "heal" },
      { x: 500, y: 300, kind: "nonsense" },
    ],
  });
  check(spots?.powerUpSpots.length === 2, "both pads survive validation");
  check(
    (spots?.powerUpSpots[0].x ?? 0) <= 1000 && (spots?.powerUpSpots[0].y ?? -1) >= 0,
    "out-of-bounds pad pulled back inside",
  );
  check(spots?.powerUpSpots[1].kind === "random", "unknown pad type falls back to random");

  check(normalizeMap(null) === null, "null is rejected");
  check(normalizeMap("nope") === null, "a string is rejected");
  check(normalizeMap({}) !== null, "an empty object becomes a usable blank map");

  const named = normalizeMap({ name: "   " });
  check(named?.name === "Untitled map", "blank names get a placeholder");

  const palette = normalizeMap({ palette: "rainbow" });
  check(palette?.palette === "pillars", "unknown palette falls back to the default");
});

group("normalized maps are still playable", () => {
  const messy = normalizeMap({
    name: "Messy",
    width: 1500,
    walls: [{ x: 1400, y: 0, width: 500, height: 700 }],
    spawnZones: [{ x: 100, y: 100, width: 300, height: 300 }],
    powerUpSpots: [{ x: 9000, y: 9000, kind: "speed" }],
  });
  check(messy !== null, "messy map normalized");

  if (messy) {
    const sim = runMatch(configFor(messy, "battle", { seed: 7 }));
    check(sim.status === "finished", "a match on the cleaned-up map still concludes");
  }
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
