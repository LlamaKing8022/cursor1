import type { GunKind } from "./guns";

export type SimEvent =
  | { type: "shot"; kind: GunKind; x: number }
  | { type: "wall_hit"; intensity: number; x: number }
  | { type: "cube_hit"; intensity: number; x: number };
