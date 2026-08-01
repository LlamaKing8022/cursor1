export const TEAM_NAMES = ["Blue", "Red", "Green", "Gold"] as const;

export const TEAM_COLORS = ["#2196f3", "#f44336", "#4caf50", "#ffeb3b"] as const;

/** How many teams to field for a given roster size. */
export function teamCountFor(cubeCount: number): number {
  if (cubeCount <= 3) return 2;
  if (cubeCount <= 6) return 2;
  if (cubeCount <= 10) return 3;
  return 4;
}

export function teamForCube(index: number, teamCount: number): number {
  return index % teamCount;
}

export function teamName(team: number): string {
  return TEAM_NAMES[team % TEAM_NAMES.length] ?? `Team ${team + 1}`;
}

export function teamColor(team: number): string {
  return TEAM_COLORS[team % TEAM_COLORS.length] ?? "#ffffff";
}
