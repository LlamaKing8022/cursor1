import type { ArenaStyle, PowerUpKind, Rect } from "./types";
import { isGunKind, type GunKind } from "./guns";

/** Default map height; generated arenas use the same range. */
export const MAP_HEIGHT = 640;
export const MIN_MAP_WIDTH = 800;
export const MAX_MAP_WIDTH = 3600;
export const MIN_MAP_HEIGHT = 640;
export const MAX_MAP_HEIGHT = 1200;

export const MIN_WALL_SIZE = 14;
export const MIN_ZONE_SIZE = 40;
export const MIN_FINISH_ZONE_SIZE = 32;
export const DEFAULT_FINISH_ZONE_WIDTH = 48;
export const DEFAULT_FINISH_ZONE_HEIGHT = 220;

export const MIN_WALL_SPEED = 10;
export const MAX_WALL_SPEED = 120;
export const DEFAULT_WALL_SPEED = 35;
export const DEFAULT_BREAKABLE_HITS = 3;
export const MIN_BREAKABLE_HITS = 1;
export const MAX_BREAKABLE_HITS = 20;

/** `random` re-rolls the pickup type every time the pad respawns. */
export type SpotKind = PowerUpKind | "random";

export interface PowerUpSpot {
  x: number;
  y: number;
  kind: SpotKind;
}

export type WallDirection = "none" | "left" | "right" | "up" | "down";

/** A wall with a direction patrols that way and reverses at the map edges. */
export interface MapWall extends Rect {
  direction: WallDirection;
  speed: number;
  /** Breakable walls crumble after cubes slam into them enough times. */
  breakable?: boolean;
  /** Hits required before a breakable wall is destroyed. */
  hitsToBreak?: number;
}

export interface GunSpot {
  x: number;
  y: number;
  kind: GunKind;
}

export interface CustomMap {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: ArenaStyle;
  walls: MapWall[];
  spawnZones: Rect[];
  finishZones: Rect[];
  powerUpSpots: PowerUpSpot[];
  guns: GunSpot[];
}

const PALETTES: ArenaStyle[] = ["open", "pillars", "maze"];
const SPOT_KINDS: SpotKind[] = ["random", "heal", "rage", "speed", "shield"];
const WALL_DIRECTIONS: WallDirection[] = ["none", "left", "right", "up", "down"];

export function createEmptyMap(name = "New map"): CustomMap {
  return {
    id: createMapId(),
    name,
    width: 1200,
    height: MAP_HEIGHT,
    palette: "pillars",
    walls: [],
    spawnZones: [],
    finishZones: [],
    powerUpSpots: [],
    guns: [],
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
    finishZones: map.finishZones.map((zone) => ({ ...zone })),
    powerUpSpots: map.powerUpSpots.map((spot) => ({ ...spot })),
    guns: map.guns.map((gun) => ({ ...gun })),
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
function sanitizeRect(raw: unknown, width: number, mapHeight: number, minSize: number): Rect | null {
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
  const top = clamp(Math.min(candidate.y, candidate.y + candidate.height), 0, mapHeight);
  const bottom = clamp(Math.max(candidate.y, candidate.y + candidate.height), 0, mapHeight);

  const rect: Rect = { x: left, y: top, width: right - left, height: bottom - top };
  if (rect.width < minSize || rect.height < minSize) return null;
  return rect;
}

/** Maps saved before moving walls existed simply have no direction. */
function sanitizeWall(raw: unknown, width: number, mapHeight: number): MapWall | null {
  const rect = sanitizeRect(raw, width, mapHeight, MIN_WALL_SIZE);
  if (!rect) return null;

  const candidate = raw as Partial<MapWall>;
  const direction = WALL_DIRECTIONS.includes(candidate.direction as WallDirection)
    ? (candidate.direction as WallDirection)
    : "none";
  const speed = isFiniteNumber(candidate.speed)
    ? clamp(Math.round(candidate.speed), MIN_WALL_SPEED, MAX_WALL_SPEED)
    : DEFAULT_WALL_SPEED;

  const breakable = candidate.breakable === true;
  const hitsToBreak = breakable
    ? clamp(
        isFiniteNumber(candidate.hitsToBreak) ? Math.round(candidate.hitsToBreak) : DEFAULT_BREAKABLE_HITS,
        MIN_BREAKABLE_HITS,
        MAX_BREAKABLE_HITS,
      )
    : undefined;

  return { ...rect, direction, speed, breakable, hitsToBreak };
}

function sanitizeGun(raw: unknown, width: number, mapHeight: number): GunSpot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<GunSpot>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null;

  return {
    x: clamp(candidate.x, 16, width - 16),
    y: clamp(candidate.y, 16, mapHeight - 16),
    kind: isGunKind(candidate.kind) ? candidate.kind : "pistol",
  };
}

function sanitizeSpot(raw: unknown, width: number, mapHeight: number): PowerUpSpot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<PowerUpSpot>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null;

  const kind = SPOT_KINDS.includes(candidate.kind as SpotKind) ? (candidate.kind as SpotKind) : "random";
  return {
    x: clamp(candidate.x, 16, width - 16),
    y: clamp(candidate.y, 16, mapHeight - 16),
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
  const height = isFiniteNumber(candidate.height)
    ? clamp(Math.round(candidate.height), MIN_MAP_HEIGHT, MAX_MAP_HEIGHT)
    : MAP_HEIGHT;
  const palette = PALETTES.includes(candidate.palette as ArenaStyle)
    ? (candidate.palette as ArenaStyle)
    : "pillars";

  const walls = Array.isArray(candidate.walls)
    ? candidate.walls
        .map((wall) => sanitizeWall(wall, width, height))
        .filter((wall): wall is MapWall => wall !== null)
    : [];
  const spawnZones = Array.isArray(candidate.spawnZones)
    ? candidate.spawnZones
        .map((zone) => sanitizeRect(zone, width, height, MIN_ZONE_SIZE))
        .filter((zone): zone is Rect => zone !== null)
    : [];
  const finishZones = Array.isArray(candidate.finishZones)
    ? candidate.finishZones
        .map((zone) => sanitizeRect(zone, width, height, MIN_FINISH_ZONE_SIZE))
        .filter((zone): zone is Rect => zone !== null)
    : [];
  const powerUpSpots = Array.isArray(candidate.powerUpSpots)
    ? candidate.powerUpSpots
        .map((spot) => sanitizeSpot(spot, width, height))
        .filter((spot): spot is PowerUpSpot => spot !== null)
    : [];
  const guns = Array.isArray(candidate.guns)
    ? candidate.guns.map((gun) => sanitizeGun(gun, width, height)).filter((gun): gun is GunSpot => gun !== null)
    : [];

  const name =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name.trim().slice(0, 40)
      : "Untitled map";

  return {
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : createMapId(),
    name,
    width,
    height,
    palette,
    walls,
    spawnZones,
    finishZones,
    powerUpSpots,
    guns,
  };
}

/** @deprecated Custom maps now use hand-placed finish zones instead. */
export function mapFinishX(map: CustomMap): number {
  return map.width - 70;
}

export function raceTargetX(map: CustomMap): number | null {
  if (map.finishZones.length === 0) return null;
  return Math.min(...map.finishZones.map((zone) => zone.x));
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
