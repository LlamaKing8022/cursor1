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

/** Builds a palette that recolours the floor, walls and letterbox together. */
function palette(options: {
  floor: string;
  floorEdge: string;
  speckle: string;
  grid: string;
  walls: [string, string, string];
  wallStroke: string;
  checkerLight: string;
  checkerDark: string;
  accent: string;
}): ArenaTheme {
  return {
    ...BASE,
    floor: options.floor,
    floorTop: options.floor,
    floorBottom: options.floorEdge,
    floorSpeckle: options.speckle,
    grid: options.grid,
    obstacleFills: options.walls,
    obstacleStroke: options.wallStroke,
    checkerLight: options.checkerLight,
    checkerDark: options.checkerDark,
    backdropTop: options.checkerDark,
    backdropBottom: options.checkerDark,
    accent: options.accent,
  };
}

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
  corridors: palette({
    floor: "#c5e7f7",
    floorEdge: "#aad8ee",
    speckle: "rgba(21, 101, 192, 0.34)",
    grid: "rgba(23, 74, 110, 0.14)",
    walls: ["#215f8b", "#2b76aa", "#18496b"],
    wallStroke: "#123c58",
    checkerLight: "#5f7f96",
    checkerDark: "#22384a",
    accent: "#ff8f00",
  }),
  rings: palette({
    floor: "#ffe2b8",
    floorEdge: "#f6cd93",
    speckle: "rgba(191, 90, 30, 0.32)",
    grid: "rgba(122, 58, 31, 0.14)",
    walls: ["#a45530", "#bb6636", "#8a4527"],
    wallStroke: "#6d3520",
    checkerLight: "#9a7250",
    checkerDark: "#42291a",
    accent: "#00838f",
  }),
  grid: palette({
    floor: "#ded3f5",
    floorEdge: "#c8b8ec",
    speckle: "rgba(69, 39, 160, 0.3)",
    grid: "rgba(58, 46, 112, 0.15)",
    walls: ["#4b3c92", "#5a48ab", "#392d70"],
    wallStroke: "#2c2257",
    checkerLight: "#736898",
    checkerDark: "#2b2444",
    accent: "#c0ca33",
  }),
};

export function themeFor(style: ArenaStyle): ArenaTheme {
  return THEMES[style];
}
