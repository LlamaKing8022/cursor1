import type { ArenaStyle, GameMode, Obstacle, Rect } from "./types";
import type { CustomMap, MapWall } from "./map";
import type { Rng } from "./rng";

export const BATTLE_WORLD = { width: 1000, height: 640 };
export const RACE_WORLD = { height: 640 };
export const DEFAULT_ARENA_HEIGHT = 640;
export const MIN_ARENA_HEIGHT = 640;
export const MAX_ARENA_HEIGHT = 1200;

/** Race tracks are long and scroll horizontally; length scales with difficulty. */
export function raceTrackLength(style: ArenaStyle): number {
  switch (style) {
    case "open":
      return 2600;
    case "pillars":
      return 3200;
    case "maze":
      return 3800;
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
  const generated =
    style === "open"
      ? mode === "race"
        ? raceGates(bounds, rng, 0.55)
        : []
      : mode === "race"
        ? raceGates(bounds, rng, style === "maze" ? 1 : 0.8)
        : style === "maze"
          ? battleMaze(bounds, rng)
          : battlePillars(bounds, rng);

  return generated.map((rect) => ({ ...rect, vx: 0, vy: 0 }));
}

function toObstacle(wall: MapWall): Obstacle {
  const speed = wall.direction === "none" ? 0 : wall.speed;
  return {
    x: wall.x,
    y: wall.y,
    width: wall.width,
    height: wall.height,
    vx: wall.direction === "left" ? -speed : wall.direction === "right" ? speed : 0,
    vy: wall.direction === "up" ? -speed : wall.direction === "down" ? speed : 0,
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
