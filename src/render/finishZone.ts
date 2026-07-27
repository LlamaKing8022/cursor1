import type { Rect } from "../sim/types";

export interface FinishZoneTheme {
  checkerLight: string;
  checkerDark: string;
  goalInner: string;
  goalOuter: string;
  border: string;
}

const DEFAULT_THEME: FinishZoneTheme = {
  checkerLight: "#f4f7ff",
  checkerDark: "#1a237e",
  goalInner: "#c5e1a5",
  goalOuter: "#2e7d32",
  border: "#1a1a1a",
};

/** Draws a checkered finish flag zone. */
export function drawFinishZone(
  ctx: CanvasRenderingContext2D,
  zone: Rect,
  theme: FinishZoneTheme = DEFAULT_THEME,
): void {
  const squareSize = 16;
  const goalWidth = Math.min(34, Math.max(18, zone.width * 0.45));

  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.width, zone.height);
  ctx.clip();

  for (let y = zone.y; y < zone.y + zone.height; y += squareSize) {
    const row = Math.floor((y - zone.y) / squareSize);
    for (let x = zone.x - squareSize * 2; x < zone.x + zone.width + squareSize; x += squareSize) {
      if (x >= zone.x + goalWidth) continue;
      const col = Math.floor((x - zone.x) / squareSize);
      ctx.fillStyle = (row + col) % 2 === 0 ? theme.checkerLight : theme.checkerDark;
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }

  const gradient = ctx.createRadialGradient(
    zone.x + goalWidth / 2,
    zone.y + zone.height / 2,
    12,
    zone.x + goalWidth / 2,
    zone.y + zone.height / 2,
    zone.height / 2,
  );
  gradient.addColorStop(0, theme.goalInner);
  gradient.addColorStop(1, theme.goalOuter);
  ctx.fillStyle = gradient;
  ctx.fillRect(zone.x, zone.y, goalWidth, zone.height);

  ctx.restore();

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("FINISH", zone.x + 6, zone.y + 6);
}
