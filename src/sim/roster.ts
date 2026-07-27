/** Bold arcade colours — primaries first for small rosters. */
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
] as const;

export const CUBE_NAMES = [
  "Crimson",
  "Azure",
  "Amber",
  "Mint",
  "Rose",
  "Violet",
  "Ember",
  "Teal",
  "Lime",
  "Cobalt",
  "Gold",
  "Cyan",
  "Chartreuse",
  "Orchid",
  "Rust",
  "Slate",
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
