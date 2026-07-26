import type { ArenaStyle, Cube, GameMode, Rect, SimSnapshot } from "../sim/types";
import { themeFor, type ArenaTheme } from "./theme";

interface Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const POWERUP_GLYPHS = {
  heal: "+",
  rage: "!",
  speed: ">",
  shield: "O",
} as const;

const POWERUP_COLORS = {
  heal: "#4dffa3",
  rage: "#ff4d6d",
  speed: "#ffd166",
  shield: "#4dabff",
} as const;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraX = 0;
  private mode: GameMode = "battle";
  private theme: ArenaTheme = themeFor("pillars");

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /** Call when a new match starts, before the first `draw`. */
  setArena(mode: GameMode, style: ArenaStyle): void {
    this.mode = mode;
    this.theme = themeFor(style);
    this.cameraX = 0;
  }

  draw(snapshot: SimSnapshot, world: Rect, dt: number): void {
    const { ctx, canvas } = this;
    const viewWidth = canvas.width;
    const viewHeight = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    this.paintBackdrop(viewWidth, viewHeight);

    const camera = this.computeCamera(snapshot, world, viewWidth, viewHeight, dt);
    const shake = snapshot.shake;
    const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
    const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;

    ctx.save();
    ctx.translate(camera.offsetX + shakeX, camera.offsetY + shakeY);
    ctx.scale(camera.scale, camera.scale);

    this.drawFloor(world, snapshot.bounds);
    this.drawDecor(world);
    this.drawGrid(world);
    if (snapshot.finishX !== null) {
      this.drawFinishLine(snapshot.finishX, world);
    }
    this.drawBorders(world, snapshot.bounds);
    this.drawObstacles(snapshot.obstacles);
    this.drawPowerUps(snapshot);
    this.drawTrails(snapshot.cubes);
    this.drawParticles(snapshot);
    for (const cube of snapshot.cubes) {
      this.drawCube(cube);
    }

    ctx.restore();
  }

  private paintBackdrop(width: number, height: number): void {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, this.theme.backdropTop);
    gradient.addColorStop(1, this.theme.backdropBottom);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  private computeCamera(
    snapshot: SimSnapshot,
    world: Rect,
    viewWidth: number,
    viewHeight: number,
    dt: number,
  ): Camera {
    const padding = 24;

    if (this.mode === "battle") {
      const scale = Math.min(
        (viewWidth - padding * 2) / world.width,
        (viewHeight - padding * 2) / world.height,
      );
      return {
        scale,
        offsetX: (viewWidth - world.width * scale) / 2,
        offsetY: (viewHeight - world.height * scale) / 2,
      };
    }

    // Race: fit the track height, then follow the leading cube horizontally.
    const scale = (viewHeight - padding * 2) / world.height;
    const visibleWidth = viewWidth / scale;
    const leader = snapshot.cubes.reduce((best, cube) => (cube.x > best ? cube.x : best), 0);
    const desired = Math.min(
      Math.max(leader - visibleWidth * 0.55, 0),
      Math.max(world.width - visibleWidth, 0),
    );

    const blend = 1 - Math.exp(-4 * Math.max(dt, 1 / 240));
    this.cameraX += (desired - this.cameraX) * blend;

    return {
      scale,
      offsetX: -this.cameraX * scale,
      offsetY: (viewHeight - world.height * scale) / 2,
    };
  }

  private drawFloor(world: Rect, active: Rect): void {
    const { ctx } = this;

    const gradient = ctx.createLinearGradient(0, 0, world.width * 0.35, world.height);
    gradient.addColorStop(0, this.theme.floorTop);
    gradient.addColorStop(1, this.theme.floorBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(world.x, world.y, world.width, world.height);

    if (this.mode === "battle" && active.width < world.width) {
      // Tint the ground the storm has already claimed.
      ctx.fillStyle = "rgba(255, 77, 109, 0.16)";
      ctx.fillRect(world.x, world.y, world.width, world.height);
      ctx.fillStyle = gradient;
      ctx.fillRect(active.x, active.y, active.width, active.height);
    }
  }

  /** Purely cosmetic shapes that give each map some colour of its own. */
  private drawDecor(world: Rect): void {
    const { ctx } = this;
    const accent = this.theme.accent;

    if (this.mode === "battle") {
      const cx = world.width / 2;
      const cy = world.height / 2;

      ctx.strokeStyle = accent;
      for (const [radius, alpha] of [
        [world.height * 0.42, 0.07],
        [world.height * 0.28, 0.1],
        [world.height * 0.14, 0.13],
      ] as const) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Corner wedges to break up the empty edges of the floor.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.06;
      const wedge = Math.min(world.width, world.height) * 0.22;
      for (const [sx, sy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = sx === 0 ? world.x : world.x + world.width;
        const py = sy === 0 ? world.y : world.y + world.height;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (sx === 0 ? wedge : -wedge), py);
        ctx.lineTo(px, py + (sy === 0 ? wedge : -wedge));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }

    // Race: banded lanes plus accent stripes so speed is easy to read.
    const bandHeight = world.height / 6;
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i += 1) {
      ctx.globalAlpha = i % 2 === 0 ? 0.045 : 0.015;
      ctx.fillRect(world.x, world.y + i * bandHeight, world.width, bandHeight);
    }

    // Distance markers hug the top and bottom edges: a full-height stripe here
    // would read as a wall and make it unclear what the cubes can pass through.
    const tick = 20;
    ctx.globalAlpha = 0.5;
    for (let x = 400; x < world.width - 100; x += 400) {
      ctx.fillRect(x, world.y, 7, tick);
      ctx.fillRect(x, world.y + world.height - tick, 7, tick);
    }

    // Start pad.
    ctx.globalAlpha = 0.12;
    ctx.fillRect(world.x, world.y, 110, world.height);
    ctx.globalAlpha = 1;
  }

  private drawGrid(world: Rect): void {
    const { ctx } = this;
    const spacing = 64;
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = spacing; x < world.width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.height);
    }
    for (let y = spacing; y < world.height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(world.width, y);
    }
    ctx.stroke();
  }

  private drawBorders(world: Rect, active: Rect): void {
    const { ctx } = this;

    if (this.mode === "battle" && active.width < world.width) {
      ctx.strokeStyle = "rgba(255, 77, 109, 0.85)";
      ctx.lineWidth = 3;
      ctx.strokeRect(active.x, active.y, active.width, active.height);
    }

    ctx.strokeStyle = this.theme.border;
    ctx.lineWidth = 3;
    ctx.strokeRect(world.x, world.y, world.width, world.height);
  }

  private drawFinishLine(finishX: number, world: Rect): void {
    const { ctx } = this;
    const squareSize = 16;

    for (let y = 0; y < world.height; y += squareSize) {
      const row = Math.floor(y / squareSize);
      for (let i = 0; i < 2; i += 1) {
        ctx.fillStyle = (row + i) % 2 === 0 ? "#f4f7ff" : "#141d2c";
        ctx.fillRect(finishX + i * squareSize, y, squareSize, squareSize);
      }
    }

    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(finishX, 0);
    ctx.lineTo(finishX, world.height);
    ctx.stroke();
  }

  private drawObstacles(obstacles: Rect[]): void {
    const { ctx } = this;
    const fills = this.theme.obstacleFills;

    obstacles.forEach((rect, index) => {
      ctx.fillStyle = fills[index % fills.length];
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = this.theme.obstacleStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    });
  }

  private drawPowerUps(snapshot: SimSnapshot): void {
    const { ctx } = this;
    for (const powerUp of snapshot.powerUps) {
      const pulse = 1 + Math.sin(powerUp.age * 6) * 0.12;
      const size = powerUp.half * 2 * pulse;
      const color = POWERUP_COLORS[powerUp.kind];

      ctx.fillStyle = color;
      ctx.fillRect(powerUp.x - size / 2, powerUp.y - size / 2, size, size);

      ctx.fillStyle = "#08101f";
      ctx.font = "bold 15px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_GLYPHS[powerUp.kind], powerUp.x, powerUp.y + 1);
    }
  }

  private drawTrails(cubes: Cube[]): void {
    const { ctx } = this;
    for (const cube of cubes) {
      if (cube.trail.length < 2) continue;
      ctx.strokeStyle = cube.color;
      ctx.lineCap = "round";
      for (let i = 1; i < cube.trail.length; i += 1) {
        const from = cube.trail[i - 1];
        const to = cube.trail[i];
        const strength = i / cube.trail.length;
        ctx.globalAlpha = strength * 0.28;
        ctx.lineWidth = cube.half * strength * 0.9;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawParticles(snapshot: SimSnapshot): void {
    const { ctx } = this;
    for (const particle of snapshot.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawCube(cube: Cube): void {
    const { ctx } = this;
    const size = cube.half * 2;
    const left = cube.x - cube.half;
    const top = cube.y - cube.half;

    if (!cube.alive) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = cube.color;
      ctx.fillRect(left, top, size, size);
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = cube.flash > 0 ? "#ffffff" : cube.color;
    ctx.fillRect(left, top, size, size);

    if (cube.rageTime > 0) {
      ctx.strokeStyle = "#ff4d6d";
      ctx.lineWidth = 3;
      ctx.strokeRect(left - 4, top - 4, size + 8, size + 8);
    }
    if (cube.shieldTime > 0) {
      ctx.strokeStyle = "rgba(77, 171, 255, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cube.x, cube.y, cube.half + 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.mode === "battle") {
      this.drawHealthBar(cube);
    }
  }

  private drawHealthBar(cube: Cube): void {
    const { ctx } = this;
    const width = cube.half * 2.4;
    const height = 5;
    const x = cube.x - width / 2;
    const y = cube.y - cube.half - 14;
    const ratio = cube.hp / cube.maxHp;

    ctx.fillStyle = "rgba(6, 10, 20, 0.85)";
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = ratio > 0.5 ? "#4dffa3" : ratio > 0.25 ? "#ffd166" : "#ff4d6d";
    ctx.fillRect(x, y, width * ratio, height);
  }
}
