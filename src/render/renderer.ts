import type { Cube, GameMode, Rect, SimSnapshot } from "../sim/types";

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

  resetCamera(): void {
    this.cameraX = 0;
  }

  draw(snapshot: SimSnapshot, world: Rect, mode: GameMode, dt: number): void {
    const { ctx, canvas } = this;
    const viewWidth = canvas.width;
    const viewHeight = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    this.paintBackdrop(viewWidth, viewHeight);

    const camera = this.computeCamera(snapshot, world, mode, viewWidth, viewHeight, dt);
    const shake = snapshot.shake;
    const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
    const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;

    ctx.save();
    ctx.translate(camera.offsetX + shakeX, camera.offsetY + shakeY);
    ctx.scale(camera.scale, camera.scale);

    this.drawArena(world, snapshot.bounds, mode);
    this.drawGrid(world);
    if (snapshot.finishX !== null) {
      this.drawFinishLine(snapshot.finishX, world);
    }
    this.drawObstacles(snapshot.obstacles);
    this.drawPowerUps(snapshot);
    this.drawTrails(snapshot.cubes);
    this.drawParticles(snapshot);
    for (const cube of snapshot.cubes) {
      this.drawCube(cube, mode);
    }

    ctx.restore();
  }

  private paintBackdrop(width: number, height: number): void {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0b0f1c");
    gradient.addColorStop(1, "#05070f");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  private computeCamera(
    snapshot: SimSnapshot,
    world: Rect,
    mode: GameMode,
    viewWidth: number,
    viewHeight: number,
    dt: number,
  ): Camera {
    const padding = 24;

    if (mode === "battle") {
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
    const leader = snapshot.cubes.reduce(
      (best, cube) => (cube.x > best ? cube.x : best),
      0,
    );
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

  private drawArena(world: Rect, active: Rect, mode: GameMode): void {
    const { ctx } = this;

    ctx.fillStyle = "#111729";
    ctx.fillRect(world.x, world.y, world.width, world.height);

    if (mode === "battle" && active.width < world.width) {
      // Shade the ground the storm has already taken.
      ctx.fillStyle = "rgba(255, 77, 109, 0.12)";
      ctx.fillRect(world.x, world.y, world.width, world.height);
      ctx.fillStyle = "#111729";
      ctx.fillRect(active.x, active.y, active.width, active.height);
      ctx.strokeStyle = "rgba(255, 77, 109, 0.85)";
      ctx.lineWidth = 3;
      ctx.strokeRect(active.x, active.y, active.width, active.height);
    }

    ctx.strokeStyle = "rgba(120, 150, 255, 0.35)";
    ctx.lineWidth = 3;
    ctx.strokeRect(world.x, world.y, world.width, world.height);
  }

  private drawGrid(world: Rect): void {
    const { ctx } = this;
    const spacing = 64;
    ctx.strokeStyle = "rgba(120, 150, 255, 0.07)";
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

  private drawFinishLine(finishX: number, world: Rect): void {
    const { ctx } = this;
    const squareSize = 16;

    for (let y = 0; y < world.height; y += squareSize) {
      const row = Math.floor(y / squareSize);
      for (let i = 0; i < 2; i += 1) {
        ctx.fillStyle = (row + i) % 2 === 0 ? "#f4f7ff" : "#1a2138";
        ctx.fillRect(finishX + i * squareSize, y, squareSize, squareSize);
      }
    }

    ctx.strokeStyle = "rgba(244, 247, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(finishX, 0);
    ctx.lineTo(finishX, world.height);
    ctx.stroke();
  }

  private drawObstacles(obstacles: Rect[]): void {
    const { ctx } = this;
    for (const rect of obstacles) {
      ctx.fillStyle = "#1d2540";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = "rgba(140, 165, 255, 0.28)";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawPowerUps(snapshot: SimSnapshot): void {
    const { ctx } = this;
    for (const powerUp of snapshot.powerUps) {
      const pulse = 1 + Math.sin(powerUp.age * 6) * 0.12;
      const size = powerUp.half * 2 * pulse;
      const color = POWERUP_COLORS[powerUp.kind];

      ctx.save();
      ctx.translate(powerUp.x, powerUp.y);
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();

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
        ctx.globalAlpha = strength * 0.32;
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
      const alpha = particle.life / particle.maxLife;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawCube(cube: Cube, mode: GameMode): void {
    const { ctx } = this;
    const size = cube.half * 2;

    if (!cube.alive) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = cube.color;
      ctx.fillRect(cube.x - cube.half, cube.y - cube.half, size, size);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(cube.x, cube.y);

    ctx.shadowColor = cube.color;
    ctx.shadowBlur = cube.boostTime > 0 ? 26 : 14;
    ctx.fillStyle = cube.flash > 0 ? "#ffffff" : cube.color;
    ctx.fillRect(-cube.half, -cube.half, size, size);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-cube.half, -cube.half, size, size);

    if (cube.rageTime > 0) {
      ctx.strokeStyle = "#ff4d6d";
      ctx.lineWidth = 3;
      ctx.strokeRect(-cube.half - 4, -cube.half - 4, size + 8, size + 8);
    }
    if (cube.shieldTime > 0) {
      ctx.strokeStyle = "rgba(77, 171, 255, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, cube.half + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (mode === "battle") {
      this.drawHealthBar(cube);
    }
    this.drawLabel(cube);
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

  private drawLabel(cube: Cube): void {
    const { ctx } = this;
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(232, 236, 255, 0.75)";
    ctx.fillText(cube.name, cube.x, cube.y + cube.half + 6);
  }
}
