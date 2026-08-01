import type {
  ArenaStyle,
  Cube,
  GameMode,
  GunInstance,
  Obstacle,
  Rect,
  SimSnapshot,
} from "../sim/types";
import { GUNS, GUN_HALF } from "../sim/guns";
import { drawGunHeld, drawGunPickup } from "./gunIcons";
import { drawBrickWall } from "./brickWall";
import { drawFinishZone } from "./finishZone";
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
  heal: "#4caf50",
  rage: "#f44336",
  speed: "#ffeb3b",
  shield: "#2196f3",
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
    if (snapshot.finishZones.length > 0) {
      for (const zone of snapshot.finishZones) {
        drawFinishZone(ctx, zone, {
          checkerLight: this.theme.checkerLight,
          checkerDark: this.theme.checkerDark,
          goalInner: this.theme.goalInner,
          goalOuter: this.theme.goalOuter,
          border: this.theme.border,
        });
      }
    } else if (snapshot.finishX !== null) {
      this.drawFinishLine(snapshot.finishX, world);
    }
    this.drawBorders(world, snapshot.bounds);
    this.drawObstacles(snapshot.obstacles);
    this.drawPowerUps(snapshot);
    this.drawGroundGuns(snapshot);
    this.drawTrails(snapshot.cubes);
    this.drawParticles(snapshot);
    for (const cube of snapshot.cubes) {
      this.drawCube(cube);
    }
    this.drawHeldGuns(snapshot);
    this.drawBullets(snapshot);

    ctx.restore();
  }

  private paintBackdrop(width: number, height: number): void {
    const { ctx } = this;
    const tile = 24;
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const even = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
        ctx.fillStyle = even ? this.theme.checkerDark : this.theme.checkerLight;
        ctx.fillRect(x, y, tile, tile);
      }
    }
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

    ctx.fillStyle = this.theme.floor;
    ctx.fillRect(world.x, world.y, world.width, world.height);
    this.drawFloorSpeckles(world);

    if (this.mode === "battle" && active.width < world.width) {
      // Tint the ground the storm has already claimed.
      ctx.fillStyle = "rgba(122, 52, 116, 0.28)";
      ctx.fillRect(world.x, world.y, world.width, world.height);
      ctx.fillStyle = this.theme.floor;
      ctx.fillRect(active.x, active.y, active.width, active.height);
      this.drawFloorSpeckles(active);
    }
  }

  private drawFloorSpeckles(area: Rect): void {
    const { ctx } = this;
    const step = 26;
    ctx.fillStyle = this.theme.floorSpeckle;

    for (let x = area.x + step / 2; x < area.x + area.width; x += step) {
      for (let y = area.y + step / 2; y < area.y + area.height; y += step) {
        const cell = Math.floor(x / step) + Math.floor(y / step);
        if (cell % 3 !== 0) continue;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  /** Purely cosmetic shapes that give each map some colour of its own. */
  private drawDecor(world: Rect): void {
    const { ctx } = this;

    if (this.mode === "battle") {
      return;
    }

    // Race: soft lane bands and distance ticks in the accent colour.
    const accent = this.theme.accent;
    const bandHeight = world.height / 6;
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i += 1) {
      ctx.globalAlpha = i % 2 === 0 ? 0.08 : 0.03;
      ctx.fillRect(world.x, world.y + i * bandHeight, world.width, bandHeight);
    }

    const tick = 20;
    ctx.globalAlpha = 0.45;
    for (let x = 400; x < world.width - 100; x += 400) {
      ctx.fillRect(x, world.y, 7, tick);
      ctx.fillRect(x, world.y + world.height - tick, 7, tick);
    }

    ctx.globalAlpha = 0.14;
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
      ctx.strokeStyle = "rgba(122, 52, 116, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeRect(active.x, active.y, active.width, active.height);
    }

    ctx.strokeStyle = this.theme.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(world.x, world.y, world.width, world.height);
  }

  private drawFinishLine(finishX: number, world: Rect): void {
    const { ctx } = this;
    const squareSize = 16;
    const goalWidth = 34;
    const goalX = finishX - goalWidth;

    for (let y = 0; y < world.height; y += squareSize) {
      const row = Math.floor(y / squareSize);
      for (let x = goalX - squareSize * 2; x < finishX + squareSize; x += squareSize) {
        if (x >= goalX) continue;
        ctx.fillStyle = (row + Math.floor(x / squareSize)) % 2 === 0 ? "#f4f7ff" : "#1a237e";
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }

    const gradient = ctx.createRadialGradient(
      goalX + goalWidth / 2,
      world.height / 2,
      12,
      goalX + goalWidth / 2,
      world.height / 2,
      world.height / 2,
    );
    gradient.addColorStop(0, this.theme.goalInner);
    gradient.addColorStop(1, this.theme.goalOuter);
    ctx.fillStyle = gradient;
    ctx.fillRect(goalX, 0, goalWidth, world.height);

    ctx.strokeStyle = this.theme.border;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(finishX, 0);
    ctx.lineTo(finishX, world.height);
    ctx.stroke();
  }

  private drawObstacles(obstacles: Obstacle[]): void {
    const { ctx } = this;
    const fills = this.theme.obstacleFills;

    obstacles.forEach((rect, index) => {
      if (rect.breakable) {
        this.drawBreakableObstacle(rect);
        return;
      }

      ctx.fillStyle = fills[index % fills.length];
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = this.theme.obstacleStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      if (rect.vx !== 0 || rect.vy !== 0) {
        this.drawMotionArrow(rect);
      }
    });
  }

  private drawBreakableObstacle(rect: Obstacle): void {
    drawBrickWall(this.ctx, rect, {
      hitsRemaining: rect.hitsRemaining,
      showHits: true,
    });

    if (rect.vx !== 0 || rect.vy !== 0) {
      this.drawMotionArrow(rect);
    }
  }

  /** Chevrons showing which way a patrolling wall is currently travelling. */
  private drawMotionArrow(rect: Obstacle): void {
    const { ctx } = this;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const angle = Math.atan2(rect.vy, rect.vx);
    const size = Math.min(11, Math.max(rect.width, rect.height) / 4);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (const offset of [-size, size * 0.6]) {
      ctx.beginPath();
      ctx.moveTo(offset - size * 0.5, -size * 0.7);
      ctx.lineTo(offset + size * 0.5, 0);
      ctx.lineTo(offset - size * 0.5, size * 0.7);
      ctx.stroke();
    }
    ctx.restore();
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

  private drawGroundGuns(snapshot: SimSnapshot): void {
    const { ctx } = this;

    for (const gun of snapshot.guns) {
      if (gun.holder !== null) continue;
      const stats = GUNS[gun.kind];
      const reloading = gun.reloadTimer > 0;

      ctx.save();
      ctx.globalAlpha = reloading ? 0.3 : 1;
      drawGunPickup(ctx, gun.kind, gun.x, gun.y, stats.color);
      ctx.restore();

      if (reloading) {
        const progress = 1 - gun.reloadTimer / stats.reload;
        ctx.strokeStyle = stats.color;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(gun.x, gun.y, GUN_HALF + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawHeldGuns(snapshot: SimSnapshot): void {
    const { ctx } = this;
    const byId = new Map(snapshot.cubes.map((cube) => [cube.id, cube]));

    for (const gun of snapshot.guns) {
      if (gun.holder === null) continue;
      const holder = byId.get(gun.holder);
      if (!holder || !holder.alive) continue;

      const stats = GUNS[gun.kind];
      drawGunHeld(ctx, gun.kind, holder.x, holder.y, gun.aim, holder.half + 2, stats.color);

      this.drawAmmoPips(gun, holder);
    }
  }

  private drawAmmoPips(gun: GunInstance, holder: Cube): void {
    const { ctx } = this;
    const stats = GUNS[gun.kind];
    const total = Math.min(stats.magazine, 10);
    const shown = Math.ceil((gun.ammo / stats.magazine) * total);
    const pipWidth = 3;
    const gap = 1.6;
    const fullWidth = total * (pipWidth + gap) - gap;
    const startX = holder.x - fullWidth / 2;
    const y = holder.y + holder.half + 5;

    for (let i = 0; i < total; i += 1) {
      ctx.fillStyle = i < shown ? stats.color : "rgba(255, 255, 255, 0.16)";
      ctx.fillRect(startX + i * (pipWidth + gap), y, pipWidth, 3);
    }
  }

  private drawBullets(snapshot: SimSnapshot): void {
    const { ctx } = this;
    ctx.lineCap = "round";

    for (const bullet of snapshot.bullets) {
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const length = Math.min(16, speed * 0.02);
      ctx.strokeStyle = bullet.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y);
      ctx.lineTo(bullet.x - (bullet.vx / speed) * length, bullet.y - (bullet.vy / speed) * length);
      ctx.stroke();
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
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = cube.color;
      ctx.fillRect(left, top, size, size);
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = cube.flash > 0 ? "#ffffff" : cube.color;
    ctx.fillRect(left, top, size, size);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, size, size);

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

    ctx.fillStyle = "#1a237e";
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = ratio > 0.5 ? "#4caf50" : ratio > 0.25 ? "#ffeb3b" : "#f44336";
    ctx.fillRect(x, y, width * ratio, height);
  }
}
