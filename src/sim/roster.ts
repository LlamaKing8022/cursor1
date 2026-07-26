/** Visually distinct colours, ordered so small rosters still look varied. */
export const CUBE_COLORS = [
  "#ff4d6d",
  "#4dabff",
  "#4dffa3",
  "#ffd166",
  "#c77dff",
  "#ff8c42",
  "#2ec4b6",
  "#ff5ce1",
  "#8ef26a",
  "#5b8cff",
  "#ff9db0",
  "#00e5ff",
  "#f9f871",
  "#a06cd5",
  "#ff6b3d",
  "#7bffd4",
] as const;

export const CUBE_NAMES = [
  "Crimson",
  "Azure",
  "Mint",
  "Amber",
  "Violet",
  "Ember",
  "Teal",
  "Fuchsia",
  "Lime",
  "Cobalt",
  "Blush",
  "Cyan",
  "Lemon",
  "Orchid",
  "Rust",
  "Aqua",
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
