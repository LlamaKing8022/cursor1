import { Rng } from "./rng";
import { createBounds, createObstacles } from "./arena";
import { colorFor, nameFor } from "./roster";
import type {
  Cube,
  MatchStatus,
  Particle,
  PowerUp,
  PowerUpKind,
  Rect,
  SimConfig,
  SimSnapshot,
} from "./types";

const BASE_SPEED = 250;
const CUBE_HALF = 16;
const RESTITUTION = 1;
const TRAIL_LENGTH = 14;
const TRAIL_INTERVAL = 0.05;

/**
 * Battle: the arena closes in to push survivors together. Chip damage only
 * kicks in much later, as a last-resort backstop, so most matches are decided
 * by an actual fight rather than by the storm.
 *
 * Small rosters collide less often, so the storm arrives sooner for them.
 */
const STORM_BASE_DELAY = 16;
const STORM_CHIP_GRACE = 28;
const STORM_SPEED = 18;
const STORM_CHIP_DPS = 2.5;

/** Race: forward pull ramps up so nobody can dawdle forever. */
const RACE_FORWARD_ACCEL = 620;
const RACE_FINISH_MARGIN = 70;
const RACE_PODIUM_GRACE = 2.5;
const HARD_TIME_LIMIT = 180;

const POWERUP_INTERVAL = 4.5;
const MAX_POWERUPS = 5;

export class Simulation {
  readonly config: SimConfig;
  readonly bounds: Rect;
  readonly obstacles: Rect[];
  readonly finishX: number | null;

  cubes: Cube[] = [];
  powerUps: PowerUp[] = [];
  particles: Particle[] = [];

  status: MatchStatus = "running";
  time = 0;
  winner: Cube | null = null;
  shake = 0;

  /** Shrinking play area in battle mode; equals `bounds` until the storm starts. */
  activeBounds: Rect;

  private rng: Rng;
  private readonly stormDelay: number;
  private readonly stormChipDelay: number;
  private trailTimer = 0;
  private powerUpTimer = 2;
  private nextPowerUpId = 1;
  private finishedCount = 0;
  private raceEnding = false;
  private podiumTimer = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.bounds = createBounds(config.mode, config.arenaStyle);
    this.obstacles = createObstacles(config.mode, config.arenaStyle, this.bounds, this.rng);
    this.activeBounds = { ...this.bounds };
    this.finishX = config.mode === "race" ? this.bounds.width - RACE_FINISH_MARGIN : null;
    this.stormDelay = STORM_BASE_DELAY + config.cubeCount;
    this.stormChipDelay = this.stormDelay + STORM_CHIP_GRACE;
    this.spawnCubes();
  }

  get aliveCubes(): Cube[] {
    return this.cubes.filter((cube) => cube.alive);
  }

  /** Advances the match. `dt` should be a small fixed step (see `FIXED_STEP`). */
  step(dt: number): void {
    if (this.status === "finished") {
      this.updateParticles(dt);
      return;
    }

    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 12);

    if (this.config.mode === "battle") {
      this.updateStorm(dt);
    }

    for (const cube of this.cubes) {
      if (!cube.alive || cube.place > 0) continue;
      this.integrate(cube, dt);
      this.collideWithBounds(cube);
      this.collideWithObstacles(cube);
    }

    this.resolveCubeCollisions();

    if (this.config.powerUpsEnabled) {
      this.updatePowerUps(dt);
    }

    if (this.config.mode === "race") {
      this.updateRaceProgress(dt);
    }

    this.updateTimers(dt);
    this.updateTrails(dt);
    this.updateParticles(dt);
    this.checkForEnd();
  }

  snapshot(): SimSnapshot {
    return {
      status: this.status,
      time: this.time,
      cubes: this.cubes,
      powerUps: this.powerUps,
      particles: this.particles,
      bounds: this.activeBounds,
      obstacles: this.obstacles,
      finishX: this.finishX,
      winner: this.winner,
      standings: this.standings(),
      shake: this.shake,
    };
  }

  /** Leaderboard order: race sorts by progress, battle by survival then damage. */
  standings(): Cube[] {
    const cubes = [...this.cubes];
    if (this.config.mode === "race") {
      return cubes.sort((a, b) => {
        if (a.place > 0 && b.place > 0) return a.place - b.place;
        if (a.place > 0) return -1;
        if (b.place > 0) return 1;
        return b.x - a.x;
      });
    }
    return cubes.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive && b.alive) return b.hp - a.hp;
      // Both eliminated: whoever lasted longer placed higher.
      return b.deathTime - a.deathTime || b.kills - a.kills || b.damageDealt - a.damageDealt;
    });
  }

  private spawnCubes(): void {
    const count = this.config.cubeCount;
    for (let i = 0; i < count; i += 1) {
      const spawn = this.spawnPosition(i, count);
      const heading = this.rng.direction();
      const speed = BASE_SPEED * this.config.speed;

      this.cubes.push({
        id: i,
        name: nameFor(i),
        color: colorFor(i),
        x: spawn.x,
        y: spawn.y,
        vx: this.config.mode === "race" ? Math.abs(heading.x) * speed : heading.x * speed,
        vy: heading.y * speed,
        half: CUBE_HALF,
        hp: this.config.startingHp,
        maxHp: this.config.startingHp,
        alive: true,
        kills: 0,
        damageDealt: 0,
        boostTime: 0,
        shieldTime: 0,
        rageTime: 0,
        flash: 0,
        trail: [],
        place: 0,
        finishTime: 0,
        distanceTravelled: 0,
        deathTime: 0,
        killedBy: null,
      });
    }
  }

  private spawnPosition(index: number, count: number): { x: number; y: number } {
    if (this.config.mode === "race") {
      // Stacked in a start column so the race begins fairly.
      const columns = Math.ceil(count / 8);
      const perColumn = Math.ceil(count / columns);
      const column = Math.floor(index / perColumn);
      const row = index % perColumn;
      const spacing = (this.bounds.height - 80) / Math.max(perColumn - 1, 1);
      return {
        x: 70 + column * 60,
        y: 40 + row * spacing,
      };
    }

    // Battle spawns sit on a ring so nobody starts inside the centre block.
    const angle = (index / count) * Math.PI * 2;
    const radiusX = this.bounds.width * 0.38;
    const radiusY = this.bounds.height * 0.36;
    return {
      x: this.bounds.width / 2 + Math.cos(angle) * radiusX,
      y: this.bounds.height / 2 + Math.sin(angle) * radiusY,
    };
  }

  private integrate(cube: Cube, dt: number): void {
    if (this.config.mode === "race") {
      const urgency = 1 + Math.max(0, this.time - 45) * 0.05;
      cube.vx += RACE_FORWARD_ACCEL * urgency * dt;
    }

    const previousX = cube.x;
    const previousY = cube.y;
    cube.x += cube.vx * dt;
    cube.y += cube.vy * dt;
    cube.distanceTravelled += Math.hypot(cube.x - previousX, cube.y - previousY);

    this.regulateSpeed(cube, dt);
  }

  /**
   * Nudges each cube toward a target speed. Without this, elastic collisions
   * gradually leave cubes crawling and the match stops being fun to watch.
   */
  private regulateSpeed(cube: Cube, dt: number): void {
    const target = BASE_SPEED * this.config.speed * (cube.boostTime > 0 ? 1.55 : 1);
    const speed = Math.hypot(cube.vx, cube.vy);

    if (speed < 1e-3) {
      const heading = this.rng.direction();
      cube.vx = heading.x * target;
      cube.vy = heading.y * target;
      return;
    }

    const blend = 1 - Math.exp(-6 * dt);
    const scale = 1 + (target / speed - 1) * blend;
    cube.vx *= scale;
    cube.vy *= scale;
  }

  private collideWithBounds(cube: Cube): void {
    const b = this.activeBounds;
    const isRace = this.config.mode === "race";

    if (cube.x - cube.half < b.x) {
      cube.x = b.x + cube.half;
      cube.vx = Math.abs(cube.vx) * RESTITUTION;
    } else if (cube.x + cube.half > b.x + b.width) {
      cube.x = b.x + b.width - cube.half;
      // In race mode the right wall sits past the finish line, so this only
      // matters for the battle arena.
      if (!isRace) cube.vx = -Math.abs(cube.vx) * RESTITUTION;
    }

    if (cube.y - cube.half < b.y) {
      cube.y = b.y + cube.half;
      cube.vy = Math.abs(cube.vy) * RESTITUTION;
    } else if (cube.y + cube.half > b.y + b.height) {
      cube.y = b.y + b.height - cube.half;
      cube.vy = -Math.abs(cube.vy) * RESTITUTION;
    }
  }

  private collideWithObstacles(cube: Cube): void {
    for (const rect of this.obstacles) {
      const overlapX = cube.half + rect.width / 2 - Math.abs(cube.x - (rect.x + rect.width / 2));
      const overlapY = cube.half + rect.height / 2 - Math.abs(cube.y - (rect.y + rect.height / 2));
      if (overlapX <= 0 || overlapY <= 0) continue;

      // Push out along the shallower axis and reflect that component.
      if (overlapX < overlapY) {
        const side = cube.x < rect.x + rect.width / 2 ? -1 : 1;
        cube.x += side * overlapX;
        cube.vx = Math.abs(cube.vx) * side * RESTITUTION;
      } else {
        const side = cube.y < rect.y + rect.height / 2 ? -1 : 1;
        cube.y += side * overlapY;
        cube.vy = Math.abs(cube.vy) * side * RESTITUTION;
      }
    }
  }

  private resolveCubeCollisions(): void {
    const active = this.cubes.filter((cube) => cube.alive && cube.place === 0);

    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const overlapX = a.half + b.half - Math.abs(a.x - b.x);
        const overlapY = a.half + b.half - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const relativeSpeed = Math.hypot(a.vx - b.vx, a.vy - b.vy);

        if (overlapX < overlapY) {
          const side = a.x < b.x ? -1 : 1;
          a.x += (side * overlapX) / 2;
          b.x -= (side * overlapX) / 2;
          const temp = a.vx;
          a.vx = b.vx * RESTITUTION;
          b.vx = temp * RESTITUTION;
        } else {
          const side = a.y < b.y ? -1 : 1;
          a.y += (side * overlapY) / 2;
          b.y -= (side * overlapY) / 2;
          const temp = a.vy;
          a.vy = b.vy * RESTITUTION;
          b.vy = temp * RESTITUTION;
        }

        if (this.config.mode === "battle") {
          this.applyCombat(a, b, relativeSpeed);
        } else {
          this.spawnParticles(
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
            3,
            this.rng.next() < 0.5 ? a.color : b.color,
          );
        }
      }
    }
  }

  private applyCombat(a: Cube, b: Cube, relativeSpeed: number): void {
    const reference = BASE_SPEED * this.config.speed * 2;
    const impact = Math.min(relativeSpeed / reference, 1.6);
    const base = 8 + impact * 24;

    this.damage(b, base * (a.rageTime > 0 ? 2 : 1), a);
    this.damage(a, base * (b.rageTime > 0 ? 2 : 1), b);

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.spawnParticles(midX, midY, 8, "#ffffff");
    this.shake = Math.min(1, this.shake + impact * 0.35);
  }

  private damage(target: Cube, amount: number, source: Cube | null): void {
    if (!target.alive || amount <= 0) return;

    if (target.shieldTime > 0) {
      target.shieldTime = 0;
      target.flash = 0.18;
      return;
    }

    const dealt = Math.min(amount, target.hp);
    target.hp -= dealt;
    target.flash = 0.14;
    if (source) source.damageDealt += dealt;

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deathTime = this.time;
      target.killedBy = source ? source.id : null;
      this.spawnParticles(target.x, target.y, 26, target.color);
      this.shake = Math.min(1, this.shake + 0.5);
      if (source) source.kills += 1;
    }
  }

  private updateStorm(dt: number): void {
    if (this.time < this.stormDelay) return;

    const shrink = STORM_SPEED * dt;
    const minWidth = 260;
    const minHeight = 200;

    if (this.activeBounds.width > minWidth) {
      this.activeBounds.x += shrink / 2;
      this.activeBounds.width -= shrink;
    }
    if (this.activeBounds.height > minHeight) {
      this.activeBounds.y += (shrink * 0.64) / 2;
      this.activeBounds.height -= shrink * 0.64;
    }

    // Guarantees the match ends even if survivors never touch each other.
    if (this.time < this.stormChipDelay) return;
    const elapsed = this.time - this.stormChipDelay;
    const dps = STORM_CHIP_DPS * (1 + elapsed * 0.12);
    for (const cube of this.aliveCubes) {
      this.damage(cube, dps * dt, null);
    }
  }

  private updatePowerUps(dt: number): void {
    for (const powerUp of this.powerUps) {
      powerUp.age += dt;
    }

    this.powerUpTimer -= dt;
    if (this.powerUpTimer <= 0 && this.powerUps.length < MAX_POWERUPS) {
      this.powerUpTimer = POWERUP_INTERVAL;
      const spawned = this.trySpawnPowerUp();
      if (!spawned) this.powerUpTimer = 1;
    }

    for (const cube of this.cubes) {
      if (!cube.alive || cube.place > 0) continue;
      for (let i = this.powerUps.length - 1; i >= 0; i -= 1) {
        const powerUp = this.powerUps[i];
        if (
          Math.abs(cube.x - powerUp.x) < cube.half + powerUp.half &&
          Math.abs(cube.y - powerUp.y) < cube.half + powerUp.half
        ) {
          this.applyPowerUp(cube, powerUp.kind);
          this.powerUps.splice(i, 1);
        }
      }
    }
  }

  private trySpawnPowerUp(): boolean {
    const kinds: PowerUpKind[] =
      this.config.mode === "race" ? ["speed", "speed", "shield"] : ["heal", "rage", "speed", "shield"];
    const half = 13;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const b = this.activeBounds;
      // Keep race pickups ahead of the pack so they are worth chasing.
      const minX = this.config.mode === "race" ? Math.min(b.width - 200, this.leaderX() + 120) : b.x + 40;
      const maxX = this.config.mode === "race" ? Math.min(b.width - 120, minX + 700) : b.x + b.width - 40;
      const x = this.rng.range(minX, Math.max(minX + 1, maxX));
      const y = this.rng.range(b.y + 40, b.y + b.height - 40);

      const blocked = this.obstacles.some(
        (rect) =>
          Math.abs(x - (rect.x + rect.width / 2)) < half + rect.width / 2 + 6 &&
          Math.abs(y - (rect.y + rect.height / 2)) < half + rect.height / 2 + 6,
      );
      if (blocked) continue;

      this.powerUps.push({ id: this.nextPowerUpId++, kind: this.rng.pick(kinds), x, y, half, age: 0 });
      return true;
    }
    return false;
  }

  private applyPowerUp(cube: Cube, kind: PowerUpKind): void {
    switch (kind) {
      case "heal":
        cube.hp = Math.min(cube.maxHp, cube.hp + 30);
        break;
      case "rage":
        cube.rageTime = 8;
        break;
      case "speed":
        cube.boostTime = 6;
        break;
      case "shield":
        cube.shieldTime = 12;
        break;
    }
    this.spawnParticles(cube.x, cube.y, 12, cube.color);
  }

  private leaderX(): number {
    return this.cubes.reduce((max, cube) => (cube.x > max ? cube.x : max), 0);
  }

  private updateRaceProgress(dt: number): void {
    if (this.finishX === null) return;

    for (const cube of this.cubes) {
      if (!cube.alive || cube.place > 0) continue;
      if (cube.x + cube.half < this.finishX) continue;

      this.finishedCount += 1;
      cube.place = this.finishedCount;
      cube.finishTime = this.time;
      this.spawnParticles(cube.x, cube.y, 24, cube.color);

      if (cube.place === 1) {
        this.winner = cube;
        this.raceEnding = true;
        this.podiumTimer = RACE_PODIUM_GRACE;
        this.shake = 1;
      }
    }

    // Keep running briefly after the win so the podium fills out.
    if (this.raceEnding) {
      this.podiumTimer = Math.max(0, this.podiumTimer - dt);
    }
  }

  private updateTimers(dt: number): void {
    for (const cube of this.cubes) {
      cube.boostTime = Math.max(0, cube.boostTime - dt);
      cube.shieldTime = Math.max(0, cube.shieldTime - dt);
      cube.rageTime = Math.max(0, cube.rageTime - dt);
      cube.flash = Math.max(0, cube.flash - dt);
    }
  }

  private updateTrails(dt: number): void {
    this.trailTimer += dt;
    if (this.trailTimer < TRAIL_INTERVAL) return;
    this.trailTimer = 0;

    for (const cube of this.cubes) {
      if (!cube.alive || cube.place > 0) {
        if (cube.trail.length > 0) cube.trail.shift();
        continue;
      }
      cube.trail.push({ x: cube.x, y: cube.y });
      if (cube.trail.length > TRAIL_LENGTH) cube.trail.shift();
    }
  }

  private spawnParticles(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i += 1) {
      const heading = this.rng.direction();
      const speed = this.rng.range(60, 320);
      const life = this.rng.range(0.25, 0.7);
      this.particles.push({
        x,
        y,
        vx: heading.x * speed,
        vy: heading.y * speed,
        life,
        maxLife: life,
        size: this.rng.range(2, 5),
        color,
      });
    }
    // Cap the pool so long matches cannot balloon memory.
    if (this.particles.length > 600) {
      this.particles.splice(0, this.particles.length - 600);
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 1 - 2.4 * dt;
      particle.vy *= 1 - 2.4 * dt;
    }
  }

  private checkForEnd(): void {
    if (this.config.mode === "battle") {
      const alive = this.aliveCubes;
      if (alive.length === 1) {
        this.winner = alive[0];
        this.finish();
      } else if (alive.length === 0) {
        // A mutual knockout can wipe out the last cubes on the same frame.
        this.winner = this.lastCubeStanding();
        this.finish();
      } else if (this.time > HARD_TIME_LIMIT) {
        this.winner = alive.reduce((best, cube) => (cube.hp > best.hp ? cube : best), alive[0]);
        this.finish();
      }
      return;
    }

    const everyoneHome = this.cubes.every((cube) => cube.place > 0);
    if (this.raceEnding && (this.podiumTimer <= 0 || everyoneHome)) {
      this.finish();
    } else if (this.time > HARD_TIME_LIMIT) {
      // Nobody made it: award the win to whoever got furthest.
      this.winner =
        this.winner ?? this.cubes.reduce((best, cube) => (cube.x > best.x ? cube : best), this.cubes[0]);
      this.finish();
    }
  }

  /** Tiebreak for a mutual knockout: longest survival, then kills, then damage. */
  private lastCubeStanding(): Cube | null {
    if (this.cubes.length === 0) return null;
    return this.cubes.reduce((best, cube) => {
      if (cube.deathTime !== best.deathTime) return cube.deathTime > best.deathTime ? cube : best;
      if (cube.kills !== best.kills) return cube.kills > best.kills ? cube : best;
      return cube.damageDealt > best.damageDealt ? cube : best;
    }, this.cubes[0]);
  }

  private finish(): void {
    if (this.status === "finished") return;
    this.status = "finished";
    if (this.winner) {
      this.spawnParticles(this.winner.x, this.winner.y, 40, this.winner.color);
    }
  }
}

export const FIXED_STEP = 1 / 120;
