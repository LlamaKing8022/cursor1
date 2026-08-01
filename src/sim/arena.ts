import type { ArenaStyle, GameMode, Obstacle, Rect } from "./types";
import type { CustomMap, MapWall } from "./map";
import { DEFAULT_BREAKABLE_HITS } from "./map";
import type { Rng } from "./rng";

export const BATTLE_WORLD = { width: 1000, height: 640 };
export const RACE_WORLD = { height: 640 };
export const DEFAULT_ARENA_HEIGHT = 640;
export const MIN_ARENA_HEIGHT = 640;
export const MAX_ARENA_HEIGHT = 1200;

/**
 * Race tracks scroll horizontally. Racers cover ground by bouncing rather than
 * by being pushed along, so the denser a style's walls the shorter its track --
 * otherwise a gated layout like `maze` runs out the clock instead of finishing.
 */
export function raceTrackLength(style: ArenaStyle): number {
  switch (style) {
    case "open":
      return 2400;
    case "pillars":
      return 2200;
    case "maze":
      return 2000;
    case "corridors":
      return 2800;
    case "rings":
      return 2600;
    case "grid":
      return 2400;
  }
}

export function createBounds(
  mode: GameMode,
  style: ArenaStyle,
  customMap?: CustomMap | null,
  arenaHeight = DEFAULT_ARENA_HEIGHT,
): Rect {
  if (customMap) {
    return { x: 0, y: 0, width: customMap.width, height: customMap.height };
  }
  const height = clampArenaHeight(arenaHeight);
  if (mode === "race") {
    return { x: 0, y: 0, width: raceTrackLength(style), height };
  }
  return { x: 0, y: 0, width: BATTLE_WORLD.width, height };
}

function clampArenaHeight(value: number): number {
  return Math.min(MAX_ARENA_HEIGHT, Math.max(MIN_ARENA_HEIGHT, Math.round(value)));
}

export function createObstacles(
  mode: GameMode,
  style: ArenaStyle,
  bounds: Rect,
  rng: Rng,
  customMap?: CustomMap | null,
): Obstacle[] {
  if (customMap) {
    return customMap.walls.map((wall) => toObstacle(wall));
  }
  const generated = mode === "race" ? raceLayout(style, bounds, rng) : battleLayout(style, bounds, rng);

  return generated.map((rect) => solidObstacle(rect));
}

function battleLayout(style: ArenaStyle, bounds: Rect, rng: Rng): Rect[] {
  switch (style) {
    case "open":
      return [];
    case "pillars":
      return battlePillars(bounds, rng);
    case "maze":
      return battleMaze(bounds, rng);
    case "corridors":
      return battleCorridors(bounds, rng);
    case "rings":
      return battleRings(bounds, rng);
    case "grid":
      return battleGrid(bounds, rng);
  }
}

function raceLayout(style: ArenaStyle, bounds: Rect, rng: Rng): Rect[] {
  switch (style) {
    case "open":
      return raceGates(bounds, rng, 0.55);
    case "pillars":
      return raceGates(bounds, rng, 0.8);
    case "maze":
      return raceGates(bounds, rng, 1);
    case "corridors":
      return raceCorridors(bounds, rng);
    case "rings":
      return raceRings(bounds, rng);
    case "grid":
      return raceGrid(bounds, rng);
  }
}

function solidObstacle(rect: Rect): Obstacle {
  return { ...rect, vx: 0, vy: 0, breakable: false, hitsToBreak: 0, hitsRemaining: 0 };
}

function toObstacle(wall: MapWall): Obstacle {
  const speed = wall.direction === "none" ? 0 : wall.speed;
  const breakable = wall.breakable === true;
  const hitsToBreak = breakable ? (wall.hitsToBreak ?? DEFAULT_BREAKABLE_HITS) : 0;
  return {
    x: wall.x,
    y: wall.y,
    width: wall.width,
    height: wall.height,
    vx: wall.direction === "left" ? -speed : wall.direction === "right" ? speed : 0,
    vy: wall.direction === "up" ? -speed : wall.direction === "down" ? speed : 0,
    breakable,
    hitsToBreak,
    hitsRemaining: hitsToBreak,
  };
}

function battlePillars(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;

  obstacles.push({ x: cx - 70, y: cy - 70, width: 140, height: 140 });

  // Four pillars mirrored around the centre keeps the arena fair for everyone.
  const offsetX = bounds.width * 0.27;
  const offsetY = bounds.height * 0.26;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const size = rng.range(56, 88);
      obstacles.push({
        x: cx + sx * offsetX - size / 2,
        y: cy + sy * offsetY - size / 2,
        width: size,
        height: size,
      });
    }
  }
  return obstacles;
}

function battleMaze(bounds: Rect, rng: Rng): Rect[] {
  const obstacles = battlePillars(bounds, rng);
  const thickness = 22;

  obstacles.push(
    { x: bounds.width * 0.18, y: bounds.height * 0.12, width: thickness, height: bounds.height * 0.3 },
    {
      x: bounds.width * 0.18,
      y: bounds.height * 0.58,
      width: thickness,
      height: bounds.height * 0.3,
    },
    {
      x: bounds.width * 0.82 - thickness,
      y: bounds.height * 0.12,
      width: thickness,
      height: bounds.height * 0.3,
    },
    {
      x: bounds.width * 0.82 - thickness,
      y: bounds.height * 0.58,
      width: thickness,
      height: bounds.height * 0.3,
    },
    { x: bounds.width * 0.34, y: bounds.height * 0.46, width: bounds.width * 0.14, height: thickness },
    { x: bounds.width * 0.52, y: bounds.height * 0.46, width: bounds.width * 0.14, height: thickness },
  );
  return obstacles;
}

/**
 * Broken horizontal dividers split the arena into lanes. Every wall stops short
 * of the side walls so nobody can be pinned against the edge, and the middle of
 * the arena is left clear for the closing storm.
 */
function battleCorridors(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];
  const thickness = 24;
  const inset = bounds.width * 0.1;
  const span = bounds.width - inset * 2;

  for (const share of [1 / 3, 2 / 3]) {
    const y = bounds.height * share - thickness / 2;
    const gap = rng.range(150, 210);
    // Gaps sit on opposite sides so crossing the arena means weaving.
    const gapStart = share < 0.5 ? inset + span * 0.22 : inset + span * 0.58;

    obstacles.push({ x: inset, y, width: gapStart - inset, height: thickness });
    obstacles.push({
      x: gapStart + gap,
      y,
      width: inset + span - (gapStart + gap),
      height: thickness,
    });
  }

  // Short stubs by the side walls break up the outer lanes.
  const stub = rng.range(90, 130);
  obstacles.push(
    { x: bounds.width * 0.28, y: 0, width: thickness, height: stub },
    { x: bounds.width * 0.72 - thickness, y: bounds.height - stub, width: thickness, height: stub },
  );

  return obstacles;
}

/** A rectangular ring with an opening on each side. The middle stays empty. */
function battleRings(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const rx = bounds.width * 0.28;
  const ry = bounds.height * 0.3;
  const thickness = 22;
  const gap = rng.range(90, 130);

  for (const sy of [-1, 1]) {
    const y = cy + sy * ry - thickness / 2;
    obstacles.push({ x: cx - rx, y, width: rx - gap / 2, height: thickness });
    obstacles.push({ x: cx + gap / 2, y, width: rx - gap / 2, height: thickness });
  }

  for (const sx of [-1, 1]) {
    const x = cx + sx * rx - thickness / 2;
    obstacles.push({ x, y: cy - ry, width: thickness, height: ry - gap / 2 });
    obstacles.push({ x, y: cy + gap / 2, width: thickness, height: ry - gap / 2 });
  }

  return obstacles;
}

/** An even lattice of blocks, hollow in the centre so the endgame stays open. */
function battleGrid(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];
  const columns = 5;
  const rows = 3;

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const middle = column === (columns - 1) / 2 && row === (rows - 1) / 2;
      if (middle) continue;

      const size = rng.range(46, 62);
      obstacles.push({
        x: ((column + 1) * bounds.width) / (columns + 1) - size / 2,
        y: ((row + 1) * bounds.height) / (rows + 1) - size / 2,
        width: size,
        height: size,
      });
    }
  }

  return obstacles;
}

/**
 * Race lanes: long broken dividers running with the track. Bouncing off a lane
 * wall keeps a cube's horizontal direction, so these read as fast lanes rather
 * than as a barrier.
 */
function raceCorridors(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];
  const thickness = 22;
  const dividers = 3;
  const limit = bounds.width - 300;

  for (let i = 1; i <= dividers; i += 1) {
    const y = (bounds.height * i) / (dividers + 1) - thickness / 2;
    let x = rng.range(220, 420);

    while (x < limit) {
      const length = Math.min(rng.range(260, 520), limit - x);
      if (length < 80) break;
      obstacles.push({ x, y, width: length, height: thickness });
      x += length + rng.range(130, 260);
    }
  }

  // Half-height posts force the odd lane change.
  for (let x = 700; x < bounds.width - 420; x += 700) {
    const height = rng.range(140, 220);
    const fromTop = rng.next() < 0.5;
    obstacles.push({ x, y: fromTop ? 0 : bounds.height - height, width: 26, height });
  }

  return obstacles;
}

/** Race: loose rings of blocks to thread through, with room around each one. */
function raceRings(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];

  for (let cx = 420; cx < bounds.width - 320; cx += 460) {
    const radius = rng.range(80, 120);
    const cy = rng.range(radius + 50, bounds.height - radius - 50);
    const size = rng.range(44, 64);

    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      obstacles.push({
        x: cx + dx * radius - size / 2,
        y: cy + dy * radius - size / 2,
        width: size,
        height: size,
      });
    }
  }

  return obstacles;
}

/** Race: a jittered field of small blocks. Open enough to keep the pace up. */
function raceGrid(bounds: Rect, rng: Rng): Rect[] {
  const obstacles: Rect[] = [];

  for (let x = 380; x < bounds.width - 300; x += 260) {
    for (let y = 100; y < bounds.height - 100; y += 150) {
      const size = rng.range(38, 56);
      obstacles.push({
        x: x + rng.range(-24, 24),
        y: y + rng.range(-24, 24),
        width: size,
        height: size,
      });
    }
  }

  return obstacles;
}

/**
 * Race obstacles are vertical walls with a gap, so cubes must find the opening.
 * `density` scales how many gates appear along the track.
 */
function raceGates(bounds: Rect, rng: Rng, density: number): Rect[] {
  const obstacles: Rect[] = [];
  const spacing = 320 / Math.max(density, 0.2);
  const thickness = 26;

  for (let x = 420; x < bounds.width - 320; x += spacing) {
    const gapHeight = rng.range(130, 190);
    const gapTop = rng.range(40, bounds.height - gapHeight - 40);
    const jitter = rng.range(-30, 30);
    const wallX = x + jitter;

    if (gapTop > 12) {
      obstacles.push({ x: wallX, y: 0, width: thickness, height: gapTop });
    }
    const belowY = gapTop + gapHeight;
    if (bounds.height - belowY > 12) {
      obstacles.push({ x: wallX, y: belowY, width: thickness, height: bounds.height - belowY });
    }

    // Occasional floating block inside the lane to break up straight runs.
    if (rng.next() < 0.4 * density) {
      const size = rng.range(40, 70);
      obstacles.push({
        x: wallX + spacing * 0.45,
        y: rng.range(60, bounds.height - size - 60),
        width: size,
        height: size,
      });
    }
  }
  return obstacles;
}
