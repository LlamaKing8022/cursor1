import type { GunKind } from "./guns";
import type { PowerUpKind } from "./types";

export type SimEvent =
  | { type: "shot"; kind: GunKind; x: number }
  | { type: "wall_hit"; intensity: number; x: number }
  | { type: "wall_break"; x: number }
  | { type: "cube_hit"; intensity: number; x: number }
  | { type: "powerup"; kind: Extract<PowerUpKind, "heal" | "shield">; x: number };
