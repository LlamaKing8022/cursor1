/**
 * Bold arcade colours — primaries first so small rosters stay easy to tell
 * apart, then paler and darker shades once the field gets crowded.
 */
export const CUBE_COLORS = [
  "#f44336",
  "#2196f3",
  "#ffeb3b",
  "#4caf50",
  "#e91e63",
  "#9c27b0",
  "#ff9800",
  "#00bcd4",
  "#8bc34a",
  "#3f51b5",
  "#ffc107",
  "#009688",
  "#cddc39",
  "#673ab7",
  "#ff5722",
  "#607d8b",
  "#00e676",
  "#d500f9",
  "#795548",
  "#82b1ff",
  "#ff80ab",
  "#ffd180",
  "#4db6ac",
  "#b388ff",
] as const;

/** Plain colour words, in step with `CUBE_COLORS` and the team names. */
export const CUBE_NAMES = [
  "Red",
  "Blue",
  "Yellow",
  "Green",
  "Pink",
  "Purple",
  "Orange",
  "Cyan",
  "Lime",
  "Indigo",
  "Gold",
  "Teal",
  "Lemon",
  "Violet",
  "Coral",
  "Grey",
  "Mint",
  "Magenta",
  "Brown",
  "Sky",
  "Rose",
  "Peach",
  "Jade",
  "Lavender",
] as const;

export const MAX_CUBES = CUBE_COLORS.length;

export function colorFor(index: number): string {
  return CUBE_COLORS[index % CUBE_COLORS.length];
}

export function nameFor(index: number): string {
  const base = CUBE_NAMES[index % CUBE_NAMES.length];
  const cycle = Math.floor(index / CUBE_NAMES.length);
  return cycle === 0 ? base : `${base} ${cycle + 1}`;
}
