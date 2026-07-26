export type GunKind = "pistol" | "smg" | "shotgun" | "sniper";

export interface GunStats {
  name: string;
  /** Emoji shown on the pickup and in the standings list. */
  icon: string;
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  magazine: number;
  bulletSpeed: number;
  /** Projectiles per trigger pull; the shotgun fires a spread. */
  pellets: number;
  /** Half-angle of random spread, in radians. */
  spread: number;
  /** Seconds a dropped, emptied gun takes to become usable again. */
  reload: number;
  /** Bullet lifetime in seconds, which is what limits range. */
  bulletLife: number;
  color: string;
}

export const GUNS: Record<GunKind, GunStats> = {
  pistol: {
    name: "Pistol",
    icon: "🔫",
    damage: 9,
    fireInterval: 0.5,
    magazine: 9,
    bulletSpeed: 620,
    pellets: 1,
    spread: 0.04,
    reload: 5,
    bulletLife: 1.3,
    color: "#ffd166",
  },
  smg: {
    name: "SMG",
    icon: "💨",
    damage: 4,
    fireInterval: 0.11,
    magazine: 28,
    bulletSpeed: 700,
    pellets: 1,
    spread: 0.14,
    reload: 6.5,
    bulletLife: 1,
    color: "#4dabff",
  },
  shotgun: {
    name: "Shotgun",
    icon: "💥",
    damage: 5,
    fireInterval: 0.95,
    magazine: 5,
    bulletSpeed: 560,
    pellets: 6,
    spread: 0.3,
    reload: 7,
    bulletLife: 0.55,
    color: "#ff8c42",
  },
  sniper: {
    name: "Sniper",
    icon: "🎯",
    damage: 34,
    fireInterval: 1.7,
    magazine: 3,
    bulletSpeed: 1150,
    pellets: 1,
    spread: 0.012,
    reload: 8,
    bulletLife: 2.2,
    color: "#ff4d6d",
  },
};

export const GUN_KINDS = Object.keys(GUNS) as GunKind[];

/** Half-extent of a gun lying on the ground, used for pickup overlap. */
export const GUN_HALF = 12;

/** Canvas font string that renders emoji reliably across platforms. */
export const GUN_ICON_FONT =
  '16px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function isGunKind(value: unknown): value is GunKind {
  return typeof value === "string" && value in GUNS;
}
