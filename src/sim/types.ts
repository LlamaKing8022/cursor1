export type GameMode = "battle" | "race";

export type MatchStatus = "running" | "finished";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export type PowerUpKind = "heal" | "rage" | "speed" | "shield";

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
  half: number;
  age: number;
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
}

export type ArenaStyle = "open" | "pillars" | "maze";

export interface SimSnapshot {
  status: MatchStatus;
  time: number;
  cubes: Cube[];
  powerUps: PowerUp[];
  particles: Particle[];
  bounds: Rect;
  obstacles: Rect[];
  finishX: number | null;
  winner: Cube | null;
  standings: Cube[];
  shake: number;
}
