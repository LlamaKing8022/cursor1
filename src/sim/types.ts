import type { CustomMap } from "./map";
import type { GunKind } from "./guns";

export type GameMode = "battle" | "race";

export type MatchStatus = "running" | "finished";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A wall in play. Static walls simply have zero velocity. */
export interface Obstacle extends Rect {
  vx: number;
  vy: number;
  breakable: boolean;
  hp: number;
  maxHp: number;
}

export interface GunInstance {
  id: number;
  kind: GunKind;
  x: number;
  y: number;
  /** Cube id currently carrying it, or null while it lies on the ground. */
  holder: number | null;
  ammo: number;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  /** Seconds until a dropped gun can be picked up again. */
  reloadTimer: number;
  /** Current aim angle in radians, for drawing the barrel. */
  aim: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  /** Cube id that fired it, so bullets cannot hit their owner. */
  owner: number;
  color: string;
}

export interface Cube {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Half-extent: a cube spans [x - half, x + half] on each axis. */
  half: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  damageDealt: number;
  /** Seconds remaining on each temporary buff. */
  boostTime: number;
  shieldTime: number;
  rageTime: number;
  /** Countdown that drives the white hit-flash in the renderer. */
  flash: number;
  trail: Array<{ x: number; y: number }>;
  /** Race mode: finishing position, 1-indexed. Zero until the cube finishes. */
  place: number;
  finishTime: number;
  distanceTravelled: number;
  /** Battle mode: when the cube was eliminated. Zero while still alive. */
  deathTime: number;
  /** Id of the cube that landed the killing blow, or null for the storm. */
  killedBy: number | null;
  /** Battle team index. Zero when team mode is off. */
  team: number;
}

export type PowerUpKind = "heal" | "rage" | "speed" | "shield";

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
  half: number;
  age: number;
  /** Index into a custom map's power-up spots, or null for random spawns. */
  spotIndex: number | null;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface SimConfig {
  mode: GameMode;
  cubeCount: number;
  seed: number;
  /** Multiplier on baseline cube speed. */
  speed: number;
  arenaStyle: ArenaStyle;
  powerUpsEnabled: boolean;
  startingHp: number;
  /** Battle only: cubes are grouped into teams and the last team standing wins. */
  teamMode: boolean;
  /** Battle team count when team mode is on (2–4). */
  teamCount: number;
  /** Battle only: cube-cube impacts deal damage. Guns still hurt enemies. */
  collisionDamage: boolean;
  /** Generated-arena height in pixels. Custom maps use their own height. */
  arenaHeight: number;
  /** When set, replaces the generated arena with a hand-built map. */
  customMap?: CustomMap | null;
}

export type ArenaStyle = "open" | "pillars" | "maze";

export interface SimSnapshot {
  status: MatchStatus;
  time: number;
  cubes: Cube[];
  powerUps: PowerUp[];
  particles: Particle[];
  guns: GunInstance[];
  bullets: Bullet[];
  bounds: Rect;
  obstacles: Obstacle[];
  finishX: number | null;
  winner: Cube | null;
  standings: Cube[];
  shake: number;
}
