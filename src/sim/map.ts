import type { ArenaStyle, PowerUpKind, Rect } from "./types";

/** Height is fixed so the renderer's camera and aspect handling stay simple. */
export const MAP_HEIGHT = 640;
export const MIN_MAP_WIDTH = 800;
export const MAX_MAP_WIDTH = 3600;

export const MIN_WALL_SIZE = 14;
export const MIN_ZONE_SIZE = 40;

/** `random` re-rolls the pickup type every time the pad respawns. */
export type SpotKind = PowerUpKind | "random";

export interface PowerUpSpot {
  x: number;
  y: number;
  kind: SpotKind;
}

export interface CustomMap {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: ArenaStyle;
  walls: Rect[];
  spawnZones: Rect[];
  powerUpSpots: PowerUpSpot[];
}

const PALETTES: ArenaStyle[] = ["open", "pillars", "maze"];
const SPOT_KINDS: SpotKind[] = ["random", "heal", "rage", "speed", "shield"];

export function createEmptyMap(name = "New map"): CustomMap {
  return {
    id: createMapId(),
    name,
    width: 1200,
    height: MAP_HEIGHT,
    palette: "pillars",
    walls: [],
    spawnZones: [],
    powerUpSpots: [],
  };
}

export function createMapId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `map_${Date.now().toString(36)}_${random}`;
}

export function cloneMap(map: CustomMap): CustomMap {
  return {
    ...map,
    walls: map.walls.map((wall) => ({ ...wall })),
    spawnZones: map.spawnZones.map((zone) => ({ ...zone })),
    powerUpSpots: map.powerUpSpots.map((spot) => ({ ...spot })),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Trims a rectangle to the map and returns null if what is left is too small to
 * be useful. Used both while editing and when loading maps from storage.
 */
function sanitizeRect(raw: unknown, width: number, minSize: number): Rect | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<Rect>;
  if (
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.width) ||
    !isFiniteNumber(candidate.height)
  ) {
    return null;
  }

  const left = clamp(Math.min(candidate.x, candidate.x + candidate.width), 0, width);
  const right = clamp(Math.max(candidate.x, candidate.x + candidate.width), 0, width);
  const top = clamp(Math.min(candidate.y, candidate.y + candidate.height), 0, MAP_HEIGHT);
  const bottom = clamp(Math.max(candidate.y, candidate.y + candidate.height), 0, MAP_HEIGHT);

  const rect: Rect = { x: left, y: top, width: right - left, height: bottom - top };
  if (rect.width < minSize || rect.height < minSize) return null;
  return rect;
}

function sanitizeSpot(raw: unknown, width: number): PowerUpSpot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<PowerUpSpot>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null;

  const kind = SPOT_KINDS.includes(candidate.kind as SpotKind) ? (candidate.kind as SpotKind) : "random";
  return {
    x: clamp(candidate.x, 16, width - 16),
    y: clamp(candidate.y, 16, MAP_HEIGHT - 16),
    kind,
  };
}

/** Parses untrusted data (localStorage) into a usable map, or null if hopeless. */
export function normalizeMap(raw: unknown): CustomMap | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<CustomMap>;

  const width = isFiniteNumber(candidate.width)
    ? clamp(Math.round(candidate.width), MIN_MAP_WIDTH, MAX_MAP_WIDTH)
    : 1200;
  const palette = PALETTES.includes(candidate.palette as ArenaStyle)
    ? (candidate.palette as ArenaStyle)
    : "pillars";

  const walls = Array.isArray(candidate.walls)
    ? candidate.walls
        .map((wall) => sanitizeRect(wall, width, MIN_WALL_SIZE))
        .filter((wall): wall is Rect => wall !== null)
    : [];
  const spawnZones = Array.isArray(candidate.spawnZones)
    ? candidate.spawnZones
        .map((zone) => sanitizeRect(zone, width, MIN_ZONE_SIZE))
        .filter((zone): zone is Rect => zone !== null)
    : [];
  const powerUpSpots = Array.isArray(candidate.powerUpSpots)
    ? candidate.powerUpSpots
        .map((spot) => sanitizeSpot(spot, width))
        .filter((spot): spot is PowerUpSpot => spot !== null)
    : [];

  const name =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name.trim().slice(0, 40)
      : "Untitled map";

  return {
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : createMapId(),
    name,
    width,
    height: MAP_HEIGHT,
    palette,
    walls,
    spawnZones,
    powerUpSpots,
  };
}

/** Where the race finish line sits on a custom map. */
export function mapFinishX(map: CustomMap): number {
  return map.width - 70;
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
