import { Rng } from "./rng";
import { createBounds, createObstacles } from "./arena";
import { colorFor, nameFor } from "./roster";
import { mapFinishX, type CustomMap, type SpotKind } from "./map";
import { GUNS, GUN_HALF } from "./guns";
import type { SimEvent } from "./events";
import { teamColor, teamForCube } from "./teams";
import type {
  Bullet,
  Cube,
  GunInstance,
  MatchStatus,
  Obstacle,
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
/** Hand-placed pads reappear on a timer so they stay relevant all match. */
const SPOT_RESPAWN = 11;

export class Simulation {
  readonly config: SimConfig;
  readonly bounds: Rect;
  readonly obstacles: Obstacle[];
  readonly finishX: number | null;

  cubes: Cube[] = [];
  powerUps: PowerUp[] = [];
  particles: Particle[] = [];
  guns: GunInstance[] = [];
  bullets: Bullet[] = [];

  status: MatchStatus = "running";
  time = 0;
  winner: Cube | null = null;
  shake = 0;

  /** Shrinking play area in battle mode; equals `bounds` until the storm starts. */
  activeBounds: Rect;

  private rng: Rng;
  private readonly customMap: CustomMap | null;
  /** Seconds until each custom power-up pad becomes available again. */
  private readonly spotCooldowns: number[];
  private readonly stormDelay: number;
  private readonly stormChipDelay: number;
  private trailTimer = 0;
  private powerUpTimer = 2;
  private nextPowerUpId = 1;
  private finishedCount = 0;
  private raceEnding = false;
  private podiumTimer = 0;
  private stepDt = 0;
  private events: SimEvent[] = [];

  private readonly teamCount: number;

  constructor(config: SimConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.teamCount = config.teamMode
      ? Math.min(Math.max(2, config.teamCount), config.cubeCount)
      : 1;
    this.customMap = config.customMap ?? null;
    this.bounds = createBounds(config.mode, config.arenaStyle, this.customMap, config.arenaHeight);
    this.obstacles = createObstacles(
      config.mode,
      config.arenaStyle,
      this.bounds,
      this.rng,
      this.customMap,
    );
    this.spotCooldowns = (this.customMap?.powerUpSpots ?? []).map(() => 0);
    this.activeBounds = { ...this.bounds };
    this.finishX =
      config.mode === "race"
        ? this.customMap
          ? mapFinishX(this.customMap)
          : this.bounds.width - RACE_FINISH_MARGIN
        : null;
    this.stormDelay = STORM_BASE_DELAY + config.cubeCount;
    this.stormChipDelay = this.stormDelay + STORM_CHIP_GRACE;
    this.spawnCubes();
    this.spawnGuns();
  }

  get aliveCubes(): Cube[] {
    return this.cubes.filter((cube) => cube.alive);
  }

  /** Events raised during the last fixed step(s); drained by the audio layer. */
  drainEvents(): SimEvent[] {
    const batch = this.events;
    this.events = [];
    return batch;
  }

  private emit(event: SimEvent): void {
    if (this.stepDt <= 0) return;
    this.events.push(event);
  }

  /** Advances the match. `dt` should be a small fixed step (see `FIXED_STEP`). */
  step(dt: number): void {
    this.stepDt = dt;
    if (this.status === "finished") {
      this.updateParticles(dt);
      return;
    }

    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 12);

    if (this.config.mode === "battle") {
      this.updateStorm(dt);
    }

    this.updateObstacles(dt);

    for (const cube of this.cubes) {
      if (!cube.alive || cube.place > 0) continue;
      this.integrate(cube, dt);
      this.collideWithBounds(cube);
      this.collideWithObstacles(cube);
      // Moving walls can shove a cube past the edge, so clamp once more.
      this.collideWithBounds(cube);
    }

    this.resolveCubeCollisions();
    this.updateGuns(dt);
    this.updateBullets(dt);

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
      guns: this.guns,
      bullets: this.bullets,
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

      const team = this.config.teamMode ? teamForCube(i, this.teamCount) : 0;

      this.cubes.push({
        id: i,
        name: nameFor(i),
        color: this.config.teamMode ? teamColor(team) : colorFor(i),
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
        team,
      });
    }
  }

  private spawnPosition(index: number, count: number): { x: number; y: number } {
    const zones = this.customMap?.spawnZones ?? [];
    if (zones.length > 0) {
      return this.spawnInZone(index, count, zones);
    }

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

  /**
   * Deals cubes round-robin into the map's spawn zones, then lays each zone's
   * share out on a grid so they do not start stacked on top of each other.
   */
  private spawnInZone(index: number, count: number, zones: Rect[]): { x: number; y: number } {
    const zoneIndex = index % zones.length;
    const zone = zones[zoneIndex];
    const slot = Math.floor(index / zones.length);
    const slots = Math.floor((count - 1 - zoneIndex) / zones.length) + 1;

    const columns = Math.ceil(Math.sqrt(slots));
    const rows = Math.ceil(slots / columns);
    const column = slot % columns;
    const row = Math.floor(slot / columns);

    const x = zone.x + ((column + 0.5) * zone.width) / columns;
    const y = zone.y + ((row + 0.5) * zone.height) / rows;

    return {
      x: Math.min(Math.max(x, CUBE_HALF), this.bounds.width - CUBE_HALF),
      y: Math.min(Math.max(y, CUBE_HALF), this.bounds.height - CUBE_HALF),
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
    const ref = BASE_SPEED * this.config.speed * 2;

    if (cube.x - cube.half < b.x) {
      const speed = Math.abs(cube.vx);
      if (speed > 45) this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
      cube.x = b.x + cube.half;
      cube.vx = Math.abs(cube.vx) * RESTITUTION;
    } else if (cube.x + cube.half > b.x + b.width) {
      const speed = Math.abs(cube.vx);
      if (speed > 45) this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
      cube.x = b.x + b.width - cube.half;
      // In race mode the right wall sits past the finish line, so this only
      // matters for the battle arena.
      if (!isRace) cube.vx = -Math.abs(cube.vx) * RESTITUTION;
    }

    if (cube.y - cube.half < b.y) {
      const speed = Math.abs(cube.vy);
      if (speed > 45) this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
      cube.y = b.y + cube.half;
      cube.vy = Math.abs(cube.vy) * RESTITUTION;
    } else if (cube.y + cube.half > b.y + b.height) {
      const speed = Math.abs(cube.vy);
      if (speed > 45) this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
      cube.y = b.y + b.height - cube.half;
      cube.vy = -Math.abs(cube.vy) * RESTITUTION;
    }
  }

  /** Patrolling walls travel until they reach a map edge, then turn around. */
  private updateObstacles(dt: number): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.vx === 0 && obstacle.vy === 0) continue;

      obstacle.x += obstacle.vx * dt;
      obstacle.y += obstacle.vy * dt;

      if (obstacle.x < this.bounds.x) {
        obstacle.x = this.bounds.x;
        obstacle.vx = Math.abs(obstacle.vx);
      } else if (obstacle.x + obstacle.width > this.bounds.x + this.bounds.width) {
        obstacle.x = this.bounds.x + this.bounds.width - obstacle.width;
        obstacle.vx = -Math.abs(obstacle.vx);
      }

      if (obstacle.y < this.bounds.y) {
        obstacle.y = this.bounds.y;
        obstacle.vy = Math.abs(obstacle.vy);
      } else if (obstacle.y + obstacle.height > this.bounds.y + this.bounds.height) {
        obstacle.y = this.bounds.y + this.bounds.height - obstacle.height;
        obstacle.vy = -Math.abs(obstacle.vy);
      }
    }
  }

  private collideWithObstacles(cube: Cube): void {
    const ref = BASE_SPEED * this.config.speed * 2;

    for (const rect of this.obstacles) {
      const overlapX = cube.half + rect.width / 2 - Math.abs(cube.x - (rect.x + rect.width / 2));
      const overlapY = cube.half + rect.height / 2 - Math.abs(cube.y - (rect.y + rect.height / 2));
      if (overlapX <= 0 || overlapY <= 0) continue;

      // Push out along the shallower axis and reflect that component.
      if (overlapX < overlapY) {
        const side = cube.x < rect.x + rect.width / 2 ? -1 : 1;
        const speed = Math.abs(cube.vx);
        if (speed > 45) {
          this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
        }
        const ahead = side < 0 ? rect.x - cube.half : rect.x + rect.width + cube.half;
        const behind = side < 0 ? rect.x + rect.width + cube.half : rect.x - cube.half;

        cube.x = this.fitsHorizontally(ahead, cube.half) || rect.vx === 0 ? ahead : behind;
        cube.vx = Math.abs(cube.vx) * side * RESTITUTION;
        // A wall sweeping along this axis shoves the cube ahead of it.
        if (rect.vx !== 0 && Math.sign(rect.vx) === side) {
          cube.vx = side * Math.max(Math.abs(cube.vx), Math.abs(rect.vx));
        }
      } else {
        const side = cube.y < rect.y + rect.height / 2 ? -1 : 1;
        const speed = Math.abs(cube.vy);
        if (speed > 45) {
          this.emit({ type: "wall_hit", intensity: Math.min(speed / ref, 1.4), x: cube.x });
        }
        const ahead = side < 0 ? rect.y - cube.half : rect.y + rect.height + cube.half;
        const behind = side < 0 ? rect.y + rect.height + cube.half : rect.y - cube.half;

        cube.y = this.fitsVertically(ahead, cube.half) || rect.vy === 0 ? ahead : behind;
        cube.vy = Math.abs(cube.vy) * side * RESTITUTION;
        if (rect.vy !== 0 && Math.sign(rect.vy) === side) {
          cube.vy = side * Math.max(Math.abs(cube.vy), Math.abs(rect.vy));
        }
      }
    }
  }

  /**
   * A moving wall can pin a cube against the arena edge with nowhere to go. In
   * that case the cube is let out the back of the wall instead of being buried,
   * which reads better than a cube slowly vanishing into a solid block.
   */
  private fitsHorizontally(centre: number, half: number): boolean {
    return centre - half >= this.bounds.x - 0.5 && centre + half <= this.bounds.x + this.bounds.width + 0.5;
  }

  private fitsVertically(centre: number, half: number): boolean {
    return centre - half >= this.bounds.y - 0.5 && centre + half <= this.bounds.y + this.bounds.height + 0.5;
  }

  private areAllies(a: Cube, b: Cube): boolean {
    return this.config.teamMode && a.team === b.team;
  }

  private canDamage(attacker: Cube | null, target: Cube): boolean {
    if (!attacker || attacker.id === target.id) return false;
    if (this.areAllies(attacker, target)) return false;
    return true;
  }

  private survivingTeams(): number[] {
    const teams = new Set<number>();
    for (const cube of this.aliveCubes) teams.add(cube.team);
    return [...teams];
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
        const ref = BASE_SPEED * this.config.speed * 2;
        if (relativeSpeed > 50) {
          this.emit({
            type: "cube_hit",
            intensity: Math.min(relativeSpeed / ref, 1.5),
            x: (a.x + b.x) / 2,
          });
        }

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
          if (this.config.collisionDamage && !this.areAllies(a, b)) {
            this.applyCombat(a, b, relativeSpeed);
          } else {
            this.spawnParticles(
              (a.x + b.x) / 2,
              (a.y + b.y) / 2,
              3,
              this.rng.next() < 0.5 ? a.color : b.color,
            );
          }
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
    if (source && !this.canDamage(source, target)) return;

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

    if (this.hasCustomSpots()) {
      this.updateCustomSpots(dt);
    } else {
      this.powerUpTimer -= dt;
      if (this.powerUpTimer <= 0 && this.powerUps.length < MAX_POWERUPS) {
        this.powerUpTimer = POWERUP_INTERVAL;
        const spawned = this.trySpawnPowerUp();
        if (!spawned) this.powerUpTimer = 1;
      }
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
          if (powerUp.spotIndex !== null) {
            this.spotCooldowns[powerUp.spotIndex] = SPOT_RESPAWN;
          }
          this.powerUps.splice(i, 1);
        }
      }
    }
  }

  /* ---------- Guns ---------- */

  private spawnGuns(): void {
    const spots = this.customMap?.guns ?? [];
    this.guns = spots.map((spot, index) => ({
      id: index,
      kind: spot.kind,
      x: spot.x,
      y: spot.y,
      holder: null,
      ammo: GUNS[spot.kind].magazine,
      cooldown: 0,
      reloadTimer: 0,
      aim: 0,
    }));
  }

  private updateGuns(dt: number): void {
    for (const gun of this.guns) {
      if (gun.holder === null) {
        gun.reloadTimer = Math.max(0, gun.reloadTimer - dt);
        continue;
      }

      const holder = this.cubes[gun.holder];
      if (!holder || !holder.alive || holder.place > 0) {
        this.dropGun(gun, holder ?? null, false);
        continue;
      }

      gun.x = holder.x;
      gun.y = holder.y;

      const target = this.nearestTarget(holder);
      if (target) {
        gun.aim = Math.atan2(target.y - holder.y, target.x - holder.x);
      }

      gun.cooldown -= dt;
      if (!target || gun.cooldown > 0 || gun.ammo <= 0) continue;

      this.fire(gun, holder);
      gun.ammo -= 1;
      gun.cooldown = GUNS[gun.kind].fireInterval;

      if (gun.ammo <= 0) {
        this.dropGun(gun, holder, true);
      }
    }

    this.collectGuns();
  }

  private collectGuns(): void {
    for (const gun of this.guns) {
      if (gun.holder !== null || gun.reloadTimer > 0) continue;

      for (const cube of this.cubes) {
        if (!cube.alive || cube.place > 0) continue;
        if (this.gunHeldBy(cube.id)) continue;
        if (
          Math.abs(cube.x - gun.x) < cube.half + GUN_HALF &&
          Math.abs(cube.y - gun.y) < cube.half + GUN_HALF
        ) {
          gun.holder = cube.id;
          // Brief delay so a pickup does not fire on the same frame.
          gun.cooldown = 0.3;
          break;
        }
      }
    }
  }

  /**
   * `emptied` distinguishes the spec'd behaviour -- a gun shot dry is dropped
   * and refills on the ground -- from a carrier dying, which leaves the
   * remaining ammo for whoever grabs it next.
   */
  private dropGun(gun: GunInstance, holder: Cube | null, emptied: boolean): void {
    if (holder) {
      gun.x = Math.min(Math.max(holder.x, this.bounds.x + GUN_HALF), this.bounds.x + this.bounds.width - GUN_HALF);
      gun.y = Math.min(Math.max(holder.y, this.bounds.y + GUN_HALF), this.bounds.y + this.bounds.height - GUN_HALF);
    }
    gun.holder = null;

    if (emptied) {
      gun.ammo = GUNS[gun.kind].magazine;
      gun.reloadTimer = GUNS[gun.kind].reload;
    } else {
      gun.reloadTimer = 0.8;
    }
  }

  gunHeldBy(cubeId: number): GunInstance | null {
    return this.guns.find((gun) => gun.holder === cubeId) ?? null;
  }

  /** Closest cube that is still in play, ignoring the shooter itself. */
  private nearestTarget(shooter: Cube): Cube | null {
    let best: Cube | null = null;
    let bestDistance = Infinity;

    for (const cube of this.cubes) {
      if (cube.id === shooter.id || !cube.alive || cube.place > 0) continue;
      if (this.areAllies(shooter, cube)) continue;
      const distance = Math.hypot(cube.x - shooter.x, cube.y - shooter.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cube;
      }
    }
    return best;
  }

  private fire(gun: GunInstance, holder: Cube): void {
    const stats = GUNS[gun.kind];

    for (let pellet = 0; pellet < stats.pellets; pellet += 1) {
      const angle = gun.aim + this.rng.range(-stats.spread, stats.spread);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      this.bullets.push({
        x: holder.x + cos * (holder.half + 5),
        y: holder.y + sin * (holder.half + 5),
        vx: cos * stats.bulletSpeed,
        vy: sin * stats.bulletSpeed,
        life: stats.bulletLife,
        damage: stats.damage,
        owner: holder.id,
        color: stats.color,
      });
    }

    this.spawnParticles(holder.x + Math.cos(gun.aim) * 18, holder.y + Math.sin(gun.aim) * 18, 4, stats.color);
    this.shake = Math.min(1, this.shake + (gun.kind === "sniper" ? 0.3 : 0.08));
    this.emit({ type: "shot", kind: gun.kind, x: holder.x });

    if (this.bullets.length > 400) {
      this.bullets.splice(0, this.bullets.length - 400);
    }
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.life -= dt;

      if (bullet.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }

      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      if (
        bullet.x < this.bounds.x ||
        bullet.y < this.bounds.y ||
        bullet.x > this.bounds.x + this.bounds.width ||
        bullet.y > this.bounds.y + this.bounds.height
      ) {
        this.bullets.splice(i, 1);
        continue;
      }

      const hitWall = this.obstacles.find((rect) => this.pointInRect(bullet.x, bullet.y, rect));
      if (hitWall) {
        this.spawnParticles(bullet.x, bullet.y, 2, bullet.color);
        this.bullets.splice(i, 1);
        if (hitWall.breakable) {
          this.damageObstacle(hitWall, bullet.damage, bullet.x);
        }
        continue;
      }

      const hit = this.cubes.find(
        (cube) =>
          cube.id !== bullet.owner &&
          cube.alive &&
          cube.place === 0 &&
          Math.abs(cube.x - bullet.x) < cube.half &&
          Math.abs(cube.y - bullet.y) < cube.half &&
          this.canDamage(this.cubes[bullet.owner] ?? null, cube),
      );

      if (hit) {
        this.hitWithBullet(hit, bullet);
        this.bullets.splice(i, 1);
      }
    }
  }

  private hitWithBullet(target: Cube, bullet: Bullet): void {
    this.spawnParticles(bullet.x, bullet.y, 5, bullet.color);

    if (this.config.mode === "battle") {
      const shooter = this.cubes[bullet.owner] ?? null;
      this.damage(target, bullet.damage, shooter);
      return;
    }

    // Racers take no damage, so bullets knock them off course instead.
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
    target.vx += (bullet.vx / speed) * 90;
    target.vy += (bullet.vy / speed) * 90;
    target.flash = 0.1;
  }

  private pointInRect(x: number, y: number, rect: Rect): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  private damageObstacle(obstacle: Obstacle, amount: number, x: number): void {
    if (!obstacle.breakable || amount <= 0) return;

    obstacle.hp -= amount;
    if (obstacle.hp > 0) {
      this.emit({ type: "wall_hit", intensity: 0.45, x });
      return;
    }

    const cx = obstacle.x + obstacle.width / 2;
    const cy = obstacle.y + obstacle.height / 2;
    this.spawnParticles(cx, cy, 16, "#e8b878");
    this.spawnParticles(cx, cy, 10, "#c99563");
    this.emit({ type: "wall_break", x: cx });
    this.shake = Math.min(1, this.shake + 0.12);

    const index = this.obstacles.indexOf(obstacle);
    if (index >= 0) this.obstacles.splice(index, 1);
  }

  private hasCustomSpots(): boolean {
    return (this.customMap?.powerUpSpots.length ?? 0) > 0;
  }

  /** Hand-placed pads: one pickup per spot, reappearing after a cooldown. */
  private updateCustomSpots(dt: number): void {
    const spots = this.customMap?.powerUpSpots ?? [];

    for (let index = 0; index < spots.length; index += 1) {
      if (this.powerUps.some((powerUp) => powerUp.spotIndex === index)) continue;

      if (this.spotCooldowns[index] > 0) {
        this.spotCooldowns[index] -= dt;
        continue;
      }

      const spot = spots[index];
      this.powerUps.push({
        id: this.nextPowerUpId++,
        kind: this.resolveSpotKind(spot.kind),
        x: spot.x,
        y: spot.y,
        half: 13,
        age: 0,
        spotIndex: index,
      });
    }
  }

  private resolveSpotKind(kind: SpotKind): PowerUpKind {
    if (kind !== "random") return kind;
    return this.rng.pick(this.powerUpPool());
  }

  private powerUpPool(): PowerUpKind[] {
    return this.config.mode === "race"
      ? ["speed", "speed", "shield"]
      : ["heal", "rage", "speed", "shield"];
  }

  private trySpawnPowerUp(): boolean {
    const kinds = this.powerUpPool();
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

      this.powerUps.push({
        id: this.nextPowerUpId++,
        kind: this.rng.pick(kinds),
        x,
        y,
        half,
        age: 0,
        spotIndex: null,
      });
      return true;
    }
    return false;
  }

  private applyPowerUp(cube: Cube, kind: PowerUpKind): void {
    switch (kind) {
      case "heal":
        cube.hp = Math.min(cube.maxHp, cube.hp + 30);
        this.emit({ type: "powerup", kind: "heal", x: cube.x });
        break;
      case "rage":
        cube.rageTime = 8;
        break;
      case "speed":
        cube.boostTime = 6;
        break;
      case "shield":
        cube.shieldTime = 12;
        this.emit({ type: "powerup", kind: "shield", x: cube.x });
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

      if (this.config.teamMode) {
        const teams = this.survivingTeams();
        if (teams.length === 1 && alive.length > 0) {
          this.winner = alive.reduce((best, cube) => (cube.hp > best.hp ? cube : best), alive[0]);
          this.finish();
        } else if (alive.length === 0) {
          this.winner = this.lastCubeStanding();
          this.finish();
        } else if (this.time > HARD_TIME_LIMIT) {
          this.winner = this.bestTeamRepresentative();
          this.finish();
        }
        return;
      }

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

  /** On a timeout in team mode, pick the team with the most total HP left. */
  private bestTeamRepresentative(): Cube | null {
    const alive = this.aliveCubes;
    if (alive.length === 0) return this.lastCubeStanding();

    const totals = new Map<number, number>();
    for (const cube of alive) {
      totals.set(cube.team, (totals.get(cube.team) ?? 0) + cube.hp);
    }

    let bestTeam = alive[0].team;
    let bestTotal = totals.get(bestTeam) ?? 0;
    for (const [team, total] of totals) {
      if (total > bestTotal) {
        bestTeam = team;
        bestTotal = total;
      }
    }

    const teamCubes = alive.filter((cube) => cube.team === bestTeam);
    return teamCubes.reduce((best, cube) => (cube.hp > best.hp ? cube : best), teamCubes[0]);
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
