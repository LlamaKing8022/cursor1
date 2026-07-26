import type { ArenaStyle } from "../sim/types";

export interface ArenaTheme {
  /** Letterbox area outside the arena. */
  backdropTop: string;
  backdropBottom: string;
  floorTop: string;
  floorBottom: string;
  grid: string;
  border: string;
  /** Obstacles cycle through these so a map is not one flat colour. */
  obstacleFills: string[];
  obstacleStroke: string;
  accent: string;
}

const THEMES: Record<ArenaStyle, ArenaTheme> = {
  open: {
    backdropTop: "#061722",
    backdropBottom: "#030d14",
    floorTop: "#0f2739",
    floorBottom: "#0a1a28",
    grid: "rgba(94, 205, 232, 0.1)",
    border: "rgba(94, 205, 232, 0.45)",
    obstacleFills: ["#1b3d54", "#215065", "#17334a"],
    obstacleStroke: "rgba(125, 224, 247, 0.4)",
    accent: "#38bdf8",
  },
  pillars: {
    backdropTop: "#150f28",
    backdropBottom: "#0a0715",
    floorTop: "#211738",
    floorBottom: "#160f28",
    grid: "rgba(186, 137, 255, 0.1)",
    border: "rgba(196, 148, 255, 0.45)",
    obstacleFills: ["#3a2765", "#4a2f6f", "#2f2054"],
    obstacleStroke: "rgba(214, 172, 255, 0.42)",
    accent: "#c084fc",
  },
  maze: {
    backdropTop: "#081a15",
    backdropBottom: "#040f0c",
    floorTop: "#11291f",
    floorBottom: "#0b1c16",
    grid: "rgba(96, 224, 168, 0.1)",
    border: "rgba(104, 232, 176, 0.45)",
    obstacleFills: ["#1f4a37", "#2a5c43", "#3d5230"],
    obstacleStroke: "rgba(252, 199, 108, 0.45)",
    accent: "#fbbf24",
  },
};

export function themeFor(style: ArenaStyle): ArenaTheme {
  return THEMES[style];
}
