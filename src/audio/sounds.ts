import type { GunKind } from "../sim/guns";
import type { SimEvent } from "../sim/events";

const MASTER_GAIN = 0.42;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  private arenaWidth = 1600;
  private readonly lastPlayed = new Map<string, number>();

  /** Call once after a user gesture so the browser allows audio. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    void this.ctx.resume();
  }

  setArenaWidth(width: number): void {
    this.arenaWidth = Math.max(width, 1);
  }

  handle(events: readonly SimEvent[]): void {
    if (!this.ctx || !this.master || events.length === 0) return;

    for (const event of events) {
      switch (event.type) {
        case "shot":
          this.playShot(event.kind, event.x);
          break;
        case "wall_hit":
          this.playWallHit(event.intensity, event.x);
          break;
        case "cube_hit":
          this.playCubeHit(event.intensity, event.x);
          break;
        case "powerup":
          this.playPowerUp(event.kind, event.x);
          break;
      }
    }
  }

  private pan(x: number): StereoPannerNode | null {
    if (!this.ctx || !this.master) return null;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.65, Math.min(0.65, (x / this.arenaWidth) * 2 - 1));
    panner.connect(this.master);
    return panner;
  }

  private canPlay(key: string, minGapMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < minGapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private playShot(kind: GunKind, x: number): void {
    if (!this.ctx) return;
    const dest = this.pan(x);
    if (!dest) return;

    const t = this.ctx.currentTime;

    switch (kind) {
      case "pistol":
        this.noiseBurst(dest, t, 0.055, 0.55, 2200, 0.12);
        this.tone(dest, t, 280, 90, 0.09, 0.35, "square");
        break;
      case "smg":
        this.noiseBurst(dest, t, 0.028, 0.38, 3400, 0.08);
        this.tone(dest, t, 520, 220, 0.045, 0.22, "square");
        break;
      case "shotgun":
        this.noiseBurst(dest, t, 0.11, 0.95, 900, 0.2);
        this.tone(dest, t, 120, 45, 0.14, 0.5, "sine");
        this.tone(dest, t, 70, 35, 0.18, 0.35, "triangle");
        break;
      case "sniper":
        this.noiseBurst(dest, t, 0.085, 0.9, 1400, 0.16);
        this.tone(dest, t, 180, 55, 0.12, 0.55, "square");
        this.tone(dest, t, 95, 40, 0.2, 0.4, "sine");
        break;
    }
  }

  private playWallHit(intensity: number, x: number): void {
    if (!this.ctx || intensity < 0.18) return;
    if (!this.canPlay("wall", 28)) return;

    const dest = this.pan(x);
    if (!dest) return;

    const t = this.ctx.currentTime;
    const gain = 0.25 + intensity * 0.45;
    const duration = 0.04 + intensity * 0.07;
    const freq = 180 + intensity * 420;

    this.noiseBurst(dest, t, duration, gain, freq, duration * 1.4);
    this.tone(dest, t, freq * 0.7, freq * 0.35, duration, gain * 0.55, "triangle");
  }

  private playCubeHit(intensity: number, x: number): void {
    if (!this.ctx || intensity < 0.12) return;
    if (!this.canPlay("cube", 22)) return;

    const dest = this.pan(x);
    if (!dest) return;

    const t = this.ctx.currentTime;
    const gain = 0.3 + intensity * 0.5;
    const duration = 0.05 + intensity * 0.08;
    const base = 260 + intensity * 380;

    this.tone(dest, t, base, base * 0.55, duration, gain * 0.7, "square");
    this.tone(dest, t, base * 1.12, base * 0.7, duration * 0.85, gain * 0.45, "sine");
    this.noiseBurst(dest, t, duration * 0.6, gain * 0.35, 1800 + intensity * 800, duration);
  }

  private playPowerUp(kind: "heal" | "shield", x: number): void {
    if (!this.ctx) return;

    const dest = this.pan(x);
    if (!dest) return;

    const t = this.ctx.currentTime;

    if (kind === "heal") {
      // Bright ascending chime — restorative pickup.
      this.tone(dest, t, 520, 780, 0.11, 0.42, "sine");
      this.tone(dest, t + 0.07, 780, 1040, 0.13, 0.38, "sine");
      this.tone(dest, t + 0.14, 1040, 1320, 0.16, 0.32, "triangle");
      this.noiseBurst(dest, t + 0.05, 0.06, 0.12, 4200, 0.1);
      return;
    }

    // Shield: low energy hum with a metallic ring.
    this.tone(dest, t, 140, 220, 0.08, 0.45, "sine");
    this.tone(dest, t + 0.04, 320, 280, 0.22, 0.5, "triangle");
    this.tone(dest, t + 0.06, 880, 620, 0.18, 0.28, "sine");
    this.noiseBurst(dest, t + 0.02, 0.05, 0.2, 2600, 0.14);
  }

  private noiseBurst(
    dest: AudioNode,
    start: number,
    duration: number,
    gain: number,
    filterHz: number,
    decay: number,
  ): void {
    if (!this.ctx) return;

    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterHz;
    filter.Q.value = 0.9;

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + decay);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(dest);
    source.start(start);
    source.stop(start + decay + 0.02);
  }

  private tone(
    dest: AudioNode,
    start: number,
    fromHz: number,
    toHz: number,
    duration: number,
    gain: number,
    type: OscillatorType,
  ): void {
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), start + duration);

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(envelope);
    envelope.connect(dest);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}
