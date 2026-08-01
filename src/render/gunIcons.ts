import { GUN_HALF, type GunKind } from "../sim/guns";

/**
 * Foreground paths from game-icons.net (CC BY 3.0).
 * @see https://game-icons.net
 */
const GUN_ICON_PATHS: Record<GunKind, string> = {
  pistol:
    "M79.238 115.768l-28.51 67.863h406.15l-.273-67.862h-263.83v55.605h-15v-55.605h-16.68v55.605H146.1v-55.605h-17.434v55.605h-15v-55.605H79.238zm387.834 15.96v40.66h18.688v-40.66h-18.688zM56.768 198.63l20.566 32.015L28.894 406.5l101.68 7.174 21.54-97.996h115.74l14.664-80.252 174.55-3.873-.13-32.922H56.767zM263.44 235.85l-11.17 61.142h-96.05l12.98-59.05 12.53-.278-2.224 35.5 14.262 13.576 1.003-33.65 24.69-16.264 43.98-.976z",
  smg: "M424.701 61.255l10.607-10.607-11.795-11.794-10.606 10.607 11.802 11.802zm-84.188-30.582l.507-.507a14.225 14.225 0 0 1 20.117 0l1.877 1.877-10.565 10.565-11.928-11.927zM104.511 266.077l16.48-6.13 5.04 9.078-24.676 24.677c-6.503-7.068-5.174-19.278 3.156-27.609zm345.216 32.683l-3.207 30.018a637.174 637.174 0 0 1-148.607-34.353l23.704-23.705a606.974 606.974 0 0 0 128.11 28.04zm-320.19 183.974c-12.758-14.668-59.32-65.848-59.32-65.848-7.102-7.102-11.338-14.394-4.427-21.305 4.908-4.908 18.289-6.063 23.397-9.825l19.942 20.224.092.092a30.211 30.211 0 0 0 2.384 2.118c-3.913-.324-8.306 2.707-5.499 8.67 8.763 19.063 20.607 42.004 33.53 59.147 4.885 6.495-3.205 14.635-10.074 6.736zM379.26 42.392l31.197 31.197.955.955-.175.175a4.698 4.698 0 0 1-.664 5.017L300.222 217.479l-48.025-48.024 127.08-127.08zm-68.307 212.43l-72.062-72.061-146.739 146.74a9.514 9.514 0 0 0-2.342 9.584l9.452 30.067 23.298 23.614c6.512 6.511 12.068 1.055 38.655-25.532l1.28-1.28c10.265-10.266 31.262-14.186 37.425-1.262 2.592 5.432 16.247 70.317 16.247 70.317a7.106 7.106 0 0 0 9.011 5.191l39.677-12.184a6.108 6.108 0 0 0 2.824-1.33c2.974-2.973-5.889-8.612-8.646-15.373-2.758-6.761-8.721-23.888-14.502-40.765a5.65 5.65 0 0 1 1.354-5.823 5.591 5.591 0 0 1 1.769-1.188c6.678-2.84 32.982-24.842 34.893-26.753l.041-.041c5.466-5.731-3.563-31.321-7.118-38.996a8.01 8.01 0 0 1 1.612-9.037l33.896-33.896zM239.24 355.074a2480.24 2480.24 0 0 1-5.041-15.009 10.83 10.83 0 0 1 2.616-11.105l27.41-27.409a4.792 4.792 0 0 1 7.74 1.379c3.298 7.135 10.009 26.736 6.736 30.158l-.232.233c-3.987 3.987-26.13 22.392-32.053 24.959a5.356 5.356 0 0 1-7.16-3.223zm7.127-127.279a9.397 9.397 0 0 1 0 13.29l-98.84 98.839a9.397 9.397 0 0 1-13.29-13.29l98.84-98.839a9.397 9.397 0 0 1 13.314-.025z",
  shotgun:
    "M160.72 16C136 16.11 136 17.875 136 46v300c0 30 0 30 30 30h180c30 0 30 0 30-30V46c0-30 0-30-30-30H166c-1.875 0-3.633-.007-5.28 0zM196 76h120v210H196V76zm-46.656 345A13.333 13.333 0 0 0 136 434.344v48.312A13.333 13.333 0 0 0 149.344 496h213.312A13.333 13.333 0 0 0 376 482.656v-48.312A13.333 13.333 0 0 0 362.656 421H149.344z",
  sniper:
    "M256 16S136 76 136 226v120c0 30 0 30 30 30h180c30 0 30 0 30-30V226C376 76 256 16 256 16zm0 75s60 30 60 135v60H196v-60c0-105 60-135 60-135zM148.63 420.998A12.632 12.632 0 0 0 136 433.63v49.737a12.632 12.632 0 0 0 12.63 12.63h214.74a12.632 12.632 0 0 0 12.63-12.63V433.63A12.632 12.632 0 0 0 363.37 421H148.63z",
};

/** Dark ink used on top of coloured gun pads — matches power-up glyphs. */
export const GUN_ICON_INK = "#08101f";

const ICON_VIEW = 512;
const pathCache = new Map<GunKind, Path2D>();

function gunPath(kind: GunKind): Path2D {
  let path = pathCache.get(kind);
  if (!path) {
    path = new Path2D(GUN_ICON_PATHS[kind]);
    pathCache.set(kind, path);
  }
  return path;
}

/** Draw a gun silhouette centered at (x, y). */
export function drawGunIcon(
  ctx: CanvasRenderingContext2D,
  kind: GunKind,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const scale = size / ICON_VIEW;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-ICON_VIEW / 2, -ICON_VIEW / 2);
  ctx.fillStyle = color;
  ctx.fill(gunPath(kind));
  ctx.restore();
}

/** Coloured pickup pad with a dark weapon silhouette, like power-up tiles. */
export function drawGunPickup(
  ctx: CanvasRenderingContext2D,
  kind: GunKind,
  x: number,
  y: number,
  color: string,
  alpha = 1,
): void {
  const pad = GUN_HALF;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x - pad, y - pad, pad * 2, pad * 2);
  drawGunIcon(ctx, kind, x, y, pad * 1.65, GUN_ICON_INK);
  ctx.restore();
}

/** Weapon silhouette sticking out of a cube, rotated toward aim. */
export function drawGunHeld(
  ctx: CanvasRenderingContext2D,
  kind: GunKind,
  x: number,
  y: number,
  aim: number,
  reach: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(aim);
  ctx.translate(reach, 0);
  drawGunIcon(ctx, kind, 0, 0, 22, color);
  ctx.restore();
}

/** Small inline icon for the standings panel. */
export function createGunIconElement(kind: GunKind, color: string, size = 16): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "gun-icon";
  wrap.dataset.gunKind = kind;
  wrap.style.background = color;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${ICON_VIEW} ${ICON_VIEW}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", GUN_ICON_PATHS[kind]);
  path.setAttribute("fill", GUN_ICON_INK);

  svg.append(path);
  wrap.append(svg);
  return wrap;
}
