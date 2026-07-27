import type { ArenaStyle } from "../sim/types";

export interface ArenaTheme {
  /** Letterbox checkerboard colours outside the arena. */
  checkerLight: string;
  checkerDark: string;
  /** Playable floor. */
  floor: string;
  floorSpeckle: string;
  grid: string;
  border: string;
  /** Solid wall blocks. */
  obstacleFills: string[];
  obstacleStroke: string;
  breakableObstacleFill: string;
  breakableObstacleStroke: string;
  breakableObstacleCrack: string;
  accent: string;
  goalInner: string;
  goalOuter: string;
  /** @deprecated kept for editor backdrop fill */
  backdropTop: string;
  backdropBottom: string;
  floorTop: string;
  floorBottom: string;
}

const FLOOR = "#f8bbd0";
const WALL = "#8e3d87";
const WALL_DARK = "#7a3474";
const WALL_LIGHT = "#a24a9a";
const CHECKER_LIGHT = "#5c6b82";
const CHECKER_DARK = "#2a3a5c";
const GOAL_INNER = "#c5e1a5";
const GOAL_OUTER = "#2e7d32";

const BREAKABLE_WALL = "#c99563";
const BREAKABLE_WALL_DARK = "#a67a4d";
const BREAKABLE_CRACK = "rgba(58, 34, 18, 0.55)";

const BASE: Omit<ArenaTheme, "accent" | "obstacleFills"> = {
  checkerLight: CHECKER_LIGHT,
  checkerDark: CHECKER_DARK,
  floor: FLOOR,
  floorSpeckle: "rgba(76, 175, 80, 0.42)",
  grid: "rgba(142, 61, 135, 0.12)",
  border: "#1a1a1a",
  obstacleStroke: "#6d2f68",
  breakableObstacleFill: BREAKABLE_WALL,
  breakableObstacleStroke: BREAKABLE_WALL_DARK,
  breakableObstacleCrack: BREAKABLE_CRACK,
  goalInner: GOAL_INNER,
  goalOuter: GOAL_OUTER,
  backdropTop: CHECKER_DARK,
  backdropBottom: CHECKER_DARK,
  floorTop: FLOOR,
  floorBottom: "#f3aac4",
};

const THEMES: Record<ArenaStyle, ArenaTheme> = {
  open: {
    ...BASE,
    obstacleFills: [WALL, WALL_LIGHT, WALL_DARK],
    accent: "#2196f3",
  },
  pillars: {
    ...BASE,
    obstacleFills: [WALL, "#953f8f", WALL_DARK],
    accent: "#1a237e",
  },
  maze: {
    ...BASE,
    obstacleFills: [WALL_DARK, WALL, "#9e458f"],
    accent: "#4caf50",
  },
};

export function themeFor(style: ArenaStyle): ArenaTheme {
  return THEMES[style];
}
