import type { Rect } from "../sim/types";

export interface BrickWallOptions {
  hitsRemaining?: number;
  showHits?: boolean;
}

const BRICK_LIGHT = "#c45c44";
const BRICK_MID = "#a84832";
const BRICK_DARK = "#8a3a28";
const MORTAR = "#d9cec0";

/** Draws a brick wall inside the given rectangle. */
export function drawBrickWall(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: BrickWallOptions = {},
): void {
  const { hitsRemaining, showHits = false } = options;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  ctx.fillStyle = MORTAR;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  const brickH = 12;
  const brickW = 26;
  const rows = Math.ceil(rect.height / brickH) + 1;

  for (let row = 0; row < rows; row += 1) {
    const y = rect.y + row * brickH;
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    const cols = Math.ceil((rect.width + brickW) / brickW) + 1;

    for (let col = 0; col < cols; col += 1) {
      const x = rect.x + col * brickW - offset;
      const tone = (row + col) % 3;
      ctx.fillStyle = tone === 0 ? BRICK_LIGHT : tone === 1 ? BRICK_MID : BRICK_DARK;
      ctx.fillRect(x + 1, y + 1, brickW - 2, brickH - 2);
    }
  }

  ctx.restore();

  ctx.strokeStyle = "#6d2f20";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  if (showHits && hitsRemaining !== undefined && hitsRemaining > 0) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const size = Math.max(12, Math.min(22, Math.min(rect.width, rect.height) * 0.34));
    const label = String(hitsRemaining);

    ctx.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, size * 0.18);
    ctx.strokeStyle = "rgba(20, 10, 6, 0.9)";
    ctx.fillStyle = "#fff6e8";
    ctx.strokeText(label, cx, cy);
    ctx.fillText(label, cx, cy);
  }
}
