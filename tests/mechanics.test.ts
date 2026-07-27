import { FIXED_STEP, Simulation } from "../src/sim/simulation";
import { DEFAULT_ARENA_HEIGHT } from "../src/sim/arena";
import { MAP_HEIGHT, BREAKABLE_WALL_HP, createEmptyMap, normalizeMap, type CustomMap } from "../src/sim/map";
import { GUNS } from "../src/sim/guns";
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
    cubeCount: 6,
    seed: 31337,
    speed: 1,
    arenaStyle: "pillars",
    powerUpsEnabled: false,
    startingHp: 100,
    teamMode: false,
    teamCount: 2,
    collisionDamage: true,
    arenaHeight: DEFAULT_ARENA_HEIGHT,
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

/* ---------- Moving walls ---------- */

group("a wall with a direction actually moves", () => {
  const map = createEmptyMap("Movers");
  map.width = 1200;
  map.walls = [
    { x: 300, y: 200, width: 60, height: 120, direction: "right", speed: 40 },
    { x: 800, y: 200, width: 60, height: 120, direction: "none", speed: 40 },
  ];
  map.spawnZones = [{ x: 60, y: 60, width: 160, height: 160 }];

  const sim = new Simulation(configFor(map, "battle"));
  const mover = sim.obstacles[0];
  const staticWall = sim.obstacles[1];
  const startX = mover.x;

  check(mover.vx > 0 && mover.vy === 0, "the moving wall has rightward velocity");
  check(staticWall.vx === 0 && staticWall.vy === 0, "the static wall has no velocity");

  for (let i = 0; i < 120; i += 1) sim.step(FIXED_STEP);

  const travelled = mover.x - startX;
  check(travelled > 20 && travelled < 60, `moved about 40px in one second (actually ${travelled.toFixed(1)})`);
  check(staticWall.x === 800, "the static wall stayed put");
});

group("each direction moves the right way", () => {
  const cases = [
    { direction: "right" as const, axis: "x" as const, sign: 1 },
    { direction: "left" as const, axis: "x" as const, sign: -1 },
    { direction: "down" as const, axis: "y" as const, sign: 1 },
    { direction: "up" as const, axis: "y" as const, sign: -1 },
  ];

  for (const testCase of cases) {
    const map = createEmptyMap("Dir");
    map.width = 1200;
    map.walls = [
      { x: 500, y: 250, width: 60, height: 60, direction: testCase.direction, speed: 40 },
    ];
    map.spawnZones = [{ x: 60, y: 60, width: 120, height: 120 }];

    const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
    const wall = sim.obstacles[0];
    const before = testCase.axis === "x" ? wall.x : wall.y;
    for (let i = 0; i < 60; i += 1) sim.step(FIXED_STEP);
    const after = testCase.axis === "x" ? wall.x : wall.y;

    check(
      Math.sign(after - before) === testCase.sign,
      `${testCase.direction}: ${testCase.axis} went from ${before.toFixed(0)} to ${after.toFixed(0)}`,
    );
  }
});

group("moving walls turn around at the edges and stay in bounds", () => {
  const map = createEmptyMap("Patrol");
  map.width = 900;
  map.walls = [
    { x: 700, y: 100, width: 80, height: 80, direction: "right", speed: 120 },
    { x: 200, y: 500, width: 80, height: 80, direction: "down", speed: 120 },
  ];
  map.spawnZones = [{ x: 40, y: 40, width: 120, height: 120 }];

  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  let leftBounds = false;
  let reversedX = false;
  let reversedY = false;

  for (let i = 0; i < 120 * 30; i += 1) {
    sim.step(FIXED_STEP);
    for (const wall of sim.obstacles) {
      if (wall.x < -0.5 || wall.y < -0.5) leftBounds = true;
      if (wall.x + wall.width > map.width + 0.5) leftBounds = true;
      if (wall.y + wall.height > MAP_HEIGHT + 0.5) leftBounds = true;
    }
    if (sim.obstacles[0].vx < 0) reversedX = true;
    if (sim.obstacles[1].vy < 0) reversedY = true;
  }

  check(!leftBounds, "patrolling walls never left the map");
  check(reversedX, "the horizontal wall turned around");
  check(reversedY, "the vertical wall turned around");
});

group("moving walls push cubes instead of trapping them", () => {
  const map = createEmptyMap("Sweeper");
  map.width = 1000;
  // A tall wall sweeping right acts like a plough across the arena.
  map.walls = [{ x: 60, y: 0, width: 50, height: MAP_HEIGHT, direction: "right", speed: 90 }];
  map.spawnZones = [{ x: 200, y: 100, width: 300, height: 400 }];

  const sim = new Simulation(configFor(map, "battle", { cubeCount: 8, startingHp: 400 }));
  let insideWall = 0;
  let escaped = false;

  for (let i = 0; i < 120 * 12; i += 1) {
    sim.step(FIXED_STEP);
    const wall = sim.obstacles[0];
    for (const cube of sim.cubes) {
      if (!cube.alive) continue;
      if (cube.x < -1 || cube.x > map.width + 1 || cube.y < -1 || cube.y > MAP_HEIGHT + 1) {
        escaped = true;
      }
      // Allow a shallow overlap; being deep inside means it got run over.
      const overlapX = cube.half + wall.width / 2 - Math.abs(cube.x - (wall.x + wall.width / 2));
      if (overlapX > cube.half) insideWall += 1;
    }
  }

  check(!escaped, "no cube was pushed out of the map");
  check(insideWall === 0, `no cube ended up buried in the moving wall (${insideWall} samples)`);
});

group("matches on maps with moving walls still finish", () => {
  for (const mode of ["battle", "race"] as GameMode[]) {
    for (const seed of [3, 44, 555]) {
      const map = createEmptyMap("Movers");
      map.width = 1600;
      map.walls = [
        { x: 400, y: 0, width: 40, height: 300, direction: "down", speed: 60 },
        { x: 900, y: 300, width: 40, height: 300, direction: "up", speed: 60 },
        { x: 600, y: 250, width: 120, height: 40, direction: "right", speed: 45 },
      ];
      map.spawnZones = [{ x: 60, y: 60, width: 200, height: 500 }];

      const sim = runMatch(configFor(map, mode, { seed }));
      check(sim.status === "finished", `${mode}/seed ${seed}: concluded in ${sim.time.toFixed(1)}s`);
      check(sim.winner !== null, `${mode}/seed ${seed}: winner declared`);
    }
  }
});

/* ---------- Guns ---------- */

function gunMap(kind: keyof typeof GUNS = "pistol"): CustomMap {
  const map = createEmptyMap("Range");
  map.width = 1000;
  map.guns = [{ x: 300, y: 320, kind }];
  map.spawnZones = [{ x: 200, y: 240, width: 200, height: 160 }];
  return map;
}

group("guns start on the ground where they were placed", () => {
  const map = gunMap();
  const sim = new Simulation(configFor(map, "battle"));

  check(sim.guns.length === 1, "one gun instance per placed gun");
  check(sim.guns[0].x === 300 && sim.guns[0].y === 320, "gun sits on its placed position");
  check(sim.guns[0].holder === null, "gun starts unheld");
  check(sim.guns[0].ammo === GUNS.pistol.magazine, "gun starts with a full magazine");
  check(sim.bullets.length === 0, "no bullets before anyone picks it up");
});

group("a cube picks up a gun it touches", () => {
  const map = gunMap();
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 4 }));
  const gun = sim.guns[0];

  const cube = sim.cubes[0];
  cube.x = gun.x;
  cube.y = gun.y;
  sim.step(FIXED_STEP);

  check(gun.holder === cube.id, `gun was picked up by cube ${gun.holder}`);
  check(sim.gunHeldBy(cube.id)?.id === gun.id, "gunHeldBy reports the carrier");
});

group("only one cube can hold a given gun", () => {
  const map = gunMap();
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 4 }));
  const gun = sim.guns[0];

  sim.cubes[0].x = gun.x;
  sim.cubes[0].y = gun.y;
  sim.cubes[1].x = gun.x;
  sim.cubes[1].y = gun.y;
  sim.step(FIXED_STEP);

  const holders = sim.cubes.filter((cube) => sim.gunHeldBy(cube.id) !== null);
  check(holders.length === 1, `exactly one carrier (${holders.length})`);
});

group("a held gun fires at the nearest cube", () => {
  const map = gunMap("smg");
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 3 }));
  const gun = sim.guns[0];

  const shooter = sim.cubes[0];
  const near = sim.cubes[1];
  const far = sim.cubes[2];

  // Freeze everyone so aim is predictable.
  for (const cube of sim.cubes) {
    cube.vx = 0;
    cube.vy = 0;
  }
  shooter.x = 200;
  shooter.y = 320;
  near.x = 400;
  near.y = 320;
  far.x = 200;
  far.y = 100;

  gun.holder = shooter.id;
  gun.cooldown = 0;

  for (let i = 0; i < 40; i += 1) {
    for (const cube of sim.cubes) {
      cube.vx = 0;
      cube.vy = 0;
    }
    sim.step(FIXED_STEP);
    if (sim.bullets.length > 0) break;
  }

  check(sim.bullets.length > 0, `bullets were fired (${sim.bullets.length})`);
  check(Math.abs(gun.aim) < 0.4, `aimed at the near cube to the right (aim ${gun.aim.toFixed(2)})`);
  check(
    sim.bullets.every((bullet) => bullet.owner === shooter.id),
    "bullets belong to the shooter",
  );
  check(sim.bullets.every((bullet) => bullet.vx > 0), "bullets travel toward the target");
  check(far.hp === far.maxHp, "the far cube was not the target");
});

group("bullets damage other cubes but never the shooter", () => {
  const map = gunMap("smg");
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const victim = sim.cubes[1];

  shooter.x = 200;
  shooter.y = 320;
  victim.x = 420;
  victim.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  for (let i = 0; i < 120 * 3; i += 1) {
    for (const cube of sim.cubes) {
      cube.vx = 0;
      cube.vy = 0;
    }
    sim.step(FIXED_STEP);
    if (victim.hp < victim.maxHp) break;
  }

  check(victim.hp < victim.maxHp, `victim took damage (${victim.hp}/${victim.maxHp})`);
  check(shooter.hp === shooter.maxHp, "shooter was untouched by its own bullets");
  check(shooter.damageDealt > 0, "damage was credited to the shooter");
});

group("an emptied gun is dropped, reloads, and can be picked up again", () => {
  const map = gunMap("sniper");
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2, startingHp: 5000 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const other = sim.cubes[1];

  shooter.x = 200;
  shooter.y = 320;
  other.x = 700;
  other.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  // Fire until the magazine runs dry.
  for (let i = 0; i < 120 * 20 && gun.holder !== null; i += 1) {
    shooter.vx = 0;
    shooter.vy = 0;
    other.vx = 0;
    other.vy = 0;
    sim.step(FIXED_STEP);
  }

  check(gun.holder === null, "the gun was dropped once empty");
  check(gun.reloadTimer > 0, `the dropped gun is reloading (${gun.reloadTimer.toFixed(1)}s left)`);
  check(gun.ammo === GUNS.sniper.magazine, "the dropped gun refilled its magazine");
  check(
    Math.abs(gun.x - shooter.x) < 2 && Math.abs(gun.y - shooter.y) < 2,
    "the gun dropped where the carrier was standing",
  );

  // It should not be grabbable while still reloading.
  other.x = gun.x;
  other.y = gun.y;
  sim.step(FIXED_STEP);
  check(gun.holder === null, "a reloading gun cannot be picked up");

  for (let i = 0; i < 120 * 12 && gun.reloadTimer > 0; i += 1) {
    other.x = 900;
    other.y = 100;
    sim.step(FIXED_STEP);
  }
  check(gun.reloadTimer <= 0, "reload finished");

  other.x = gun.x;
  other.y = gun.y;
  sim.step(FIXED_STEP);
  check(gun.holder === other.id, "a second cube picked the gun back up");
  check(gun.ammo === GUNS.sniper.magazine, "the new carrier has a full magazine");
});

group("a dying carrier drops its gun with the ammo left in it", () => {
  const map = gunMap("pistol");
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const carrier = sim.cubes[0];

  gun.holder = carrier.id;
  gun.ammo = 4;
  sim.step(FIXED_STEP);

  // Read the count after the step, since the carrier may have taken a shot.
  const ammoBefore = gun.ammo;
  check(ammoBefore > 0, `carrier still has ammo before dying (${ammoBefore})`);

  carrier.hp = 0;
  carrier.alive = false;
  sim.step(FIXED_STEP);

  check(gun.holder === null, "the gun left the dead cube");
  check(gun.ammo === ammoBefore, `the remaining ammo was kept (${gun.ammo} vs ${ammoBefore})`);
  check(gun.reloadTimer < GUNS.pistol.reload, "a death drop is available again quickly");
});

group("the shotgun fires a spread of pellets", () => {
  const map = gunMap("shotgun");
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];

  shooter.x = 200;
  shooter.y = 320;
  sim.cubes[1].x = 600;
  sim.cubes[1].y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  for (let i = 0; i < 10 && sim.bullets.length === 0; i += 1) {
    sim.step(FIXED_STEP);
  }

  check(sim.bullets.length === GUNS.shotgun.pellets, `fired ${sim.bullets.length} pellets in one shot`);
  const angles = sim.bullets.map((bullet) => Math.atan2(bullet.vy, bullet.vx));
  check(new Set(angles).size > 1, "pellets spread across different angles");
});

group("bullets stop at walls and never leave the map", () => {
  const map = gunMap("smg");
  map.walls = [{ x: 320, y: 0, width: 40, height: MAP_HEIGHT, direction: "none", speed: 35 }];
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const behindWall = sim.cubes[1];

  shooter.x = 200;
  shooter.y = 320;
  behindWall.x = 600;
  behindWall.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  let strayBullet = false;
  for (let i = 0; i < 120 * 4; i += 1) {
    shooter.vx = 0;
    shooter.vy = 0;
    behindWall.vx = 0;
    behindWall.vy = 0;
    sim.step(FIXED_STEP);
    for (const bullet of sim.bullets) {
      if (bullet.x < 0 || bullet.y < 0 || bullet.x > map.width || bullet.y > MAP_HEIGHT) {
        strayBullet = true;
      }
      if (bullet.x > 360) strayBullet = true;
    }
  }

  check(!strayBullet, "no bullet passed through the wall or off the map");
  check(behindWall.hp === behindWall.maxHp, "the cube behind cover was never hit");
});

group("guns knock racers off course rather than damaging them", () => {
  const map = gunMap("smg");
  const sim = new Simulation(configFor(map, "race", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const target = sim.cubes[1];

  shooter.x = 200;
  shooter.y = 320;
  target.x = 420;
  target.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  let nudged = false;
  for (let i = 0; i < 120 * 3 && !nudged; i += 1) {
    const before = target.vx;
    sim.step(FIXED_STEP);
    if (target.vx - before > 40) nudged = true;
  }

  check(nudged, "a bullet gave the racer a shove");
  check(target.hp === target.maxHp, "racers take no bullet damage");
  check(target.alive, "racers cannot be shot out of the race");
});

group("matches with guns still finish and stay stable", () => {
  for (const mode of ["battle", "race"] as GameMode[]) {
    for (const seed of [8, 88, 888]) {
      const map = createEmptyMap("Armoury");
      map.width = 1600;
      map.spawnZones = [{ x: 60, y: 60, width: 200, height: 500 }];
      map.guns = [
        { x: 500, y: 160, kind: "pistol" },
        { x: 500, y: 480, kind: "smg" },
        { x: 900, y: 320, kind: "shotgun" },
        { x: 1300, y: 320, kind: "sniper" },
      ];

      const sim = runMatch(configFor(map, mode, { seed }));
      check(sim.status === "finished", `${mode}/seed ${seed}: concluded in ${sim.time.toFixed(1)}s`);
      check(sim.winner !== null, `${mode}/seed ${seed}: winner declared`);
      check(
        sim.cubes.every((cube) => Number.isFinite(cube.x) && Number.isFinite(cube.y)),
        `${mode}/seed ${seed}: positions stayed finite`,
      );
      check(sim.bullets.length < 400, `${mode}/seed ${seed}: bullet pool stayed bounded`);
    }
  }
});

group("gun matches replay identically from the same seed", () => {
  const build = () => {
    const map = createEmptyMap("Armoury");
    map.width = 1400;
    map.spawnZones = [{ x: 60, y: 60, width: 200, height: 400 }];
    map.guns = [
      { x: 500, y: 200, kind: "smg" },
      { x: 800, y: 400, kind: "shotgun" },
    ];
    return configFor(map, "battle", { seed: 24680 });
  };

  const first = runMatch(build());
  const second = runMatch(build());

  check(first.winner?.id === second.winner?.id, "same winner");
  check(Math.abs(first.time - second.time) < 1e-9, `same duration (${first.time} vs ${second.time})`);
});

/* ---------- Validation ---------- */

group("wall motion and guns survive validation", () => {
  const cleaned = normalizeMap({
    width: 1200,
    walls: [
      { x: 100, y: 100, width: 80, height: 80, direction: "sideways", speed: 40 },
      { x: 300, y: 100, width: 80, height: 80, direction: "left", speed: 9999 },
      { x: 500, y: 100, width: 80, height: 80, direction: "up" },
    ],
    guns: [
      { x: 400, y: 300, kind: "sniper" },
      { x: 9000, y: -50, kind: "bazooka" },
      { x: 200, y: 200 },
    ],
  });

  check(cleaned?.walls[0].direction === "none", "unknown direction falls back to static");
  check(cleaned?.walls[1].speed === 120, `absurd speed clamped (${cleaned?.walls[1].speed})`);
  check(cleaned?.walls[2].speed === 35, `missing speed defaults (${cleaned?.walls[2].speed})`);
  check(cleaned?.walls[2].direction === "up", "valid direction preserved");

  check(cleaned?.guns.length === 3, `all guns kept (${cleaned?.guns.length})`);
  check(cleaned?.guns[0].kind === "sniper", "valid gun kind preserved");
  check(cleaned?.guns[1].kind === "pistol", "unknown gun kind falls back to pistol");
  check(
    (cleaned?.guns[1].x ?? 0) <= 1200 && (cleaned?.guns[1].y ?? -1) >= 0,
    "out-of-bounds gun pulled inside the map",
  );
  check(cleaned?.guns[2].kind === "pistol", "missing gun kind defaults to pistol");
});

group("maps saved before these features still load", () => {
  // Shape of a map from the previous version: plain walls, no guns array.
  const legacy = normalizeMap({
    id: "map_legacy",
    name: "Legacy",
    width: 1200,
    palette: "maze",
    walls: [{ x: 100, y: 100, width: 120, height: 60 }],
    spawnZones: [{ x: 300, y: 300, width: 120, height: 120 }],
    powerUpSpots: [{ x: 600, y: 300, kind: "heal" }],
  });

  check(legacy !== null, "legacy map loaded");
  check(legacy?.walls[0].direction === "none", "legacy walls default to static");
  check(legacy?.walls[0].breakable !== true, "legacy walls are not breakable");
  check(legacy?.guns.length === 0, "legacy map gets an empty gun list");

  if (legacy) {
    const sim = runMatch(configFor(legacy, "battle", { seed: 5 }));
    check(sim.status === "finished", "a legacy map still plays");
    check(sim.obstacles.every((wall) => !wall.breakable), "legacy obstacles stay solid");
  }
});

group("breakable walls can be shot apart", () => {
  const map = gunMap("sniper");
  map.walls = [
    { x: 340, y: 0, width: 40, height: MAP_HEIGHT, direction: "none", speed: 35, breakable: true },
  ];
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const wall = sim.obstacles[0];

  check(wall.breakable, "wall is marked breakable");
  check(wall.hp === BREAKABLE_WALL_HP, `wall starts with full hp (${wall.hp})`);

  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const behindWall = sim.cubes[1];
  shooter.x = 250;
  shooter.y = 320;
  behindWall.x = 600;
  behindWall.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  let destroyed = false;
  for (let i = 0; i < 600 && !destroyed; i += 1) {
    shooter.vx = 0;
    shooter.vy = 0;
    behindWall.vx = 0;
    behindWall.vy = 0;
    sim.step(FIXED_STEP);
    if (sim.obstacles.length === 0) destroyed = true;
  }

  check(destroyed, "breakable wall was destroyed by gunfire");
});

group("solid custom walls still block bullets", () => {
  const map = gunMap("smg");
  map.walls = [{ x: 320, y: 0, width: 40, height: MAP_HEIGHT, direction: "none", speed: 35 }];
  const sim = new Simulation(configFor(map, "battle", { cubeCount: 2 }));
  const gun = sim.guns[0];
  const shooter = sim.cubes[0];
  const behindWall = sim.cubes[1];

  shooter.x = 200;
  shooter.y = 320;
  behindWall.x = 600;
  behindWall.y = 320;
  gun.holder = shooter.id;
  gun.cooldown = 0;

  for (let i = 0; i < 120 * 4; i += 1) {
    shooter.vx = 0;
    shooter.vy = 0;
    behindWall.vx = 0;
    behindWall.vy = 0;
    sim.step(FIXED_STEP);
  }

  check(sim.obstacles.length === 1, "solid wall stayed in place");
  check(!sim.obstacles[0].breakable, "solid wall is not breakable");
  check(behindWall.hp === behindWall.maxHp, "the cube behind cover was never hit");
});

group("breakable flag survives validation", () => {
  const cleaned = normalizeMap({
    width: 1200,
    walls: [{ x: 100, y: 100, width: 80, height: 80, direction: "none", speed: 35, breakable: true }],
  });

  check(cleaned?.walls[0].breakable === true, "breakable flag preserved");
  check(cleaned?.walls[0].direction === "none", "direction still normalized");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
