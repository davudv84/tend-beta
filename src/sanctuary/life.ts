// Ambient life: water, koi, bamboo, steam, leaves, fireflies and time-of-day light.
// All of it is decoration driven by a local clock — none of it reflects agent data.
import { bayer, blend, H, hash, mix, put, ramp, rgb, sx, sy, W, type Target } from "./engine.ts";
import { bamboo, PAL, type StaticScene } from "./scene.ts";

export type LightMode = "dawn" | "day" | "dusk" | "night";

/** Ambient multiplier per channel, and how strongly lanterns and windows contribute. */
const AMBIENT: Record<LightMode, [number, number, number, number]> = {
  dawn: [0.98, 0.9, 0.88, 0.3],
  day: [1, 1, 1, 0],
  dusk: [0.82, 0.66, 0.62, 0.7],
  night: [0.34, 0.4, 0.58, 1],
};

export function lightForHour(h: number): LightMode {
  if (h >= 5 && h < 7.5) return "dawn";
  if (h >= 7.5 && h < 17.5) return "day";
  if (h >= 17.5 && h < 20) return "dusk";
  return "night";
}

interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; kind: "steam" | "leaf" | "fly"; floor?: number; seed: number }
interface Ripple { x: number; y: number; age: number }

const KOI = [
  { c: [rgb(0xe07a3a), rgb(0xf1ebde), rgb(0xe07a3a), rgb(0xb85a2a)], speed: 0.16, phase: 0, ax: 2.5, ay: 1.6 },
  { c: [rgb(0xf1ebde), rgb(0xf1ebde), rgb(0xd9643a), rgb(0xb9b2a6)], speed: 0.12, phase: 2.2, ax: 2.1, ay: 1.9 },
  { c: [rgb(0x2b2624), rgb(0xd98a3e), rgb(0x2b2624), rgb(0x1e1b19)], speed: 0.14, phase: 4.1, ax: 2.8, ay: 1.3 },
];
const FIREFLY = rgb(0xdfe8a0);
const STEAM = rgb(0xf1ece0);
const FOAM = rgb(0xe2ece4);

export class Life {
  pond: Int32Array;
  pool: Int32Array;
  lightMap: Float32Array;
  particles: Particle[] = [];
  ripples: Ripple[] = [];
  private spawn = { steam: 0, leaf: 0, ripple: 0, fall: 0 };
  private scene: StaticScene;
  private outdoor: boolean;

  constructor(scene: StaticScene, outdoor = true) {
    this.scene = scene;
    this.outdoor = outdoor;
    const pond: number[] = [], pool: number[] = [];
    scene.water.forEach((v, i) => (v === 1 ? pond.push(i) : v === 2 ? pool.push(i) : 0));
    this.pond = Int32Array.from(pond);
    this.pool = Int32Array.from(pool);
    // Warm light from lanterns and windows, banded with ordered dithering like hand-placed pixels.
    const lm = new Float32Array(W * H);
    for (const l of scene.lights)
      for (let y = Math.max(0, Math.floor(l.y - l.r)); y < Math.min(H, l.y + l.r); y++)
        for (let x = Math.max(0, Math.floor(l.x - l.r)); x < Math.min(W, l.x + l.r); x++) {
          const d = Math.hypot(x - l.x, (y - l.y) * 1.6) / l.r;
          if (d < 1) lm[y * W + x] += l.k * (1 - d) * (1 - d);
        }
    for (let i = 0; i < lm.length; i++) {
      const x = i % W, y = (i / W) | 0;
      lm[i] = Math.min(1, Math.floor((lm[i] + bayer(x, y) * 0.22) * 5) / 5);
    }
    this.lightMap = lm;
    if (outdoor) for (let i = 0; i < 12; i++) this.particles.push(this.firefly(i));
  }

  private firefly(i: number): Particle {
    const near = i % 2 ? [9.6, 15.6] : [21.5, 6];
    const x = sx(near[0], near[1]) + (hash(i, 1, 71) - 0.5) * 70, y = sy(near[0], near[1]) - 6 + (hash(i, 2, 72) - 0.5) * 30;
    return { x, y, vx: 0, vy: 0, age: hash(i, 3, 73) * 10, life: Infinity, kind: "fly", seed: i };
  }

  ripple(x: number, y: number) {
    if (this.ripples.length < 6) this.ripples.push({ x, y, age: 0 });
  }

  isWater(x: number, y: number) {
    return this.scene.water[(y | 0) * W + (x | 0)] === 1;
  }

  update(dt: number, particles: boolean) {
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 1.8);
    if (!particles) {
      this.particles = this.particles.filter((p) => p.kind === "fly");
      return;
    }
    for (const k of this.scene.steam ?? [])
      if (Math.random() < dt * 2.2) this.particles.push({ x: k.x, y: k.y, vx: 0.8 + Math.random(), vy: -4 - Math.random() * 2, age: 0, life: 1.6 + Math.random(), kind: "steam", seed: Math.random() * 9 });
    this.spawn.steam += dt;
    while (this.spawn.steam > 0.12 && this.pool.length) {
      this.spawn.steam -= 0.12;
      const i = this.pool[Math.floor(Math.random() * this.pool.length)];
      this.particles.push({ x: i % W, y: (i / W) | 0, vx: (Math.random() - 0.5) * 2, vy: -5 - Math.random() * 4, age: 0, life: 2 + Math.random() * 1.8, kind: "steam", seed: Math.random() * 9 });
    }
    this.spawn.leaf += dt;
    if (this.spawn.leaf > 2.2 && this.scene.maples.length) {
      this.spawn.leaf = Math.random() * 0.8;
      const m = this.scene.maples[Math.floor(Math.random() * this.scene.maples.length)];
      const x = m.x + (Math.random() - 0.5) * 14, y = m.y + (Math.random() - 0.5) * 8;
      this.particles.push({ x, y, vx: 1.5, vy: 5, age: 0, life: 9, kind: "leaf", floor: y + 16 + Math.random() * 12, seed: Math.random() * 9 });
    }
    this.spawn.fall += dt;
    if (this.spawn.fall > 1.3 && this.scene.falls?.length) {
      this.spawn.fall = Math.random() * 0.4;
      for (const f of this.scene.falls) this.ripple(f.x + 1, f.y1 + 1);
    }
    this.spawn.ripple += dt;
    if (this.spawn.ripple > 4.5 && this.pond.length) {
      this.spawn.ripple = Math.random();
      const i = this.pond[Math.floor(Math.random() * this.pond.length)];
      this.ripple(i % W, (i / W) | 0);
    }
    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === "steam") {
        p.x += (p.vx + Math.sin(p.age * 2 + p.seed) * 2) * dt;
        p.y += p.vy * dt;
      } else if (p.kind === "leaf") {
        if (p.y < p.floor!) {
          p.x += (p.vx + Math.sin(p.age * 2.4 + p.seed) * 6) * dt;
          p.y += p.vy * dt;
        }
      } else {
        p.x += Math.sin(p.age * 0.7 + p.seed) * 4 * dt;
        p.y += Math.cos(p.age * 0.5 + p.seed * 2) * 2.5 * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  /** Drawn before agents: water, koi, ripples, bamboo. */
  drawWorld(f: Target, t: number, animate: boolean) {
    const water = PAL.water, pool = PAL.onsen;
    if (animate) {
      for (const i of this.pond) {
        const x = i % W, y = (i / W) | 0;
        const v = Math.sin(x * 0.42 + t * 1.1 + Math.sin(y * 0.55 + t * 0.5) * 1.8) + Math.sin(y * 1.25 - t * 0.8 + x * 0.1);
        if (v > 1.62) f.c[i] = water[5];
        else if (v > 1.45 && (x + y) & 1) f.c[i] = water[4];
      }
      for (const i of this.pool) {
        const x = i % W, y = (i / W) | 0;
        const v = Math.sin(x * 0.6 + t * 0.7) + Math.sin(y * 1.1 + x * 0.2 - t * 0.6);
        if (v > 1.5) f.c[i] = pool[5];
        else if (v > 1.2) f.c[i] = pool[4];
      }
    }
    if (!this.outdoor) return;
    // Falling water: light streaks run down the column; foam churns where it lands.
    if (animate)
      for (const fl of this.scene.falls ?? []) {
        for (let y = fl.y0 + 1; y < fl.y1; y++)
          for (let dx = 0; dx < 3; dx++) if ((((y * 3 - t * 42 + dx * 5) % 9) + 9) % 9 < 2) put(f, fl.x + dx, y, FOAM, 20.7);
        const k = Math.floor(t * 9);
        for (let dx = -2; dx <= 4; dx++) for (let dy = 0; dy < 2; dy++) if (hash(dx + 9, k + dy * 31, 79) < 0.45) blend(f, fl.x + dx, fl.y1 + dy, FOAM, 0.85);
      }
    // Koi glide on slow Lissajous paths; only drawn where the surface is open water.
    for (const k of KOI) {
      const a = t * k.speed * 6.28 + k.phase;
      const tx = 9.6 + Math.cos(a) * k.ax, ty = 15.6 + Math.sin(a * 1.3) * k.ay;
      const dx = -Math.sin(a) * k.ax, dy = Math.cos(a * 1.3) * k.ay * 1.3;
      const X = sx(tx, ty), Y = sy(tx, ty);
      const vx = (dx - dy) * 8, vy = (dx + dy) * 4, len = Math.hypot(vx, vy) || 1;
      for (let s = 0; s < 4; s++) {
        const px = Math.round(X - (vx / len) * s), py = Math.round(Y - (vy / len) * s);
        if (this.isWater(px, py)) blend(f, px, py, k.c[s], 0.85);
      }
    }
    for (const r of this.ripples) {
      const rad = 1 + r.age * 5, a = 0.5 * (1 - r.age / 1.8);
      for (let s = 0; s < 24; s++) {
        const th = (s / 24) * Math.PI * 2;
        const px = Math.round(r.x + Math.cos(th) * rad), py = Math.round(r.y + Math.sin(th) * rad * 0.5);
        if (this.isWater(px, py)) blend(f, px, py, water[6], a);
      }
    }
    // Bamboo stalks sway a pixel or two at the tips.
    for (const b of bamboo) {
      const X = sx(b.x, b.y), Y = sy(b.x, b.y), d = b.x + b.y;
      const sway = animate ? Math.sin(t * 0.9 + b.phase) * 1.6 + Math.sin(t * 2.3 + b.phase * 2) * 0.4 : 0;
      for (let j = 0; j < b.h; j++) {
        const off = Math.round(sway * Math.pow(j / b.h, 1.6));
        const node = j % 7 === 6;
        const c = node ? PAL.bamboo[0] : ramp(PAL.bamboo, 0.45 + (j / b.h) * 0.35, X, Y - j);
        put(f, X + off, Y - j, c, d, true);
        if (b.w === 2) put(f, X + off + 1, Y - j, node ? PAL.bamboo[0] : PAL.bamboo[1], d, true);
        if (j > b.h * 0.55 && j % 5 === 0) {
          const dir = (j / 5) & 1 ? 1 : -1;
          for (let s = 1; s <= 3; s++) put(f, X + off + dir * (s + (b.w === 2 && dir > 0 ? 1 : 0)), Y - j + Math.floor(s / 2), PAL.bamboo[3 + (s === 1 ? 1 : 0)], d, true);
        }
      }
    }
  }

  /** Drawn after agents, before lighting: steam and falling leaves. */
  drawAir(f: Target) {
    for (const p of this.particles) {
      if (p.kind === "steam") {
        const k = p.age / p.life;
        blend(f, p.x, p.y, STEAM, 0.32 * Math.sin(Math.PI * k));
        if (p.seed > 6) blend(f, p.x + 1, p.y, STEAM, 0.18 * Math.sin(Math.PI * k));
      } else if (p.kind === "leaf") {
        const fade = p.y >= p.floor! ? Math.max(0, 1 - (p.age - 6) / 3) : 1;
        if (fade <= 0) continue;
        const c = Math.sin(p.age * 6 + p.seed) > 0 ? PAL.maple[4] : PAL.maple[3];
        blend(f, p.x, p.y, c, fade);
      }
    }
  }

  /** Final pass: ambient colour by time of day, warm pools of light, glowing windows. */
  light(f: Target, mode: LightMode, t = 0) {
    const [r, g, b, L0] = AMBIENT[mode];
    if (mode === "day") return;
    // Flames breathe a little; the whole pool of lamplight brightens and dims with them.
    const L = L0 * (1 + Math.sin(t * 7.3) * 0.035 + Math.sin(t * 17.1) * 0.02);
    const glow = this.scene.glow, lm = this.lightMap, c = f.c;
    const lit = rgb(0xf3d49a);
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      if (!v) continue;
      if (glow[i] === 2) continue;
      if (glow[i] === 1) {
        c[i] = mix(scaleRGB(v, r, g, b), lit, L * 0.8);
        continue;
      }
      const k = lm[i] * L;
      c[i] = scaleRGB(v, r + k * 1.05, g + k * 0.8, b + k * 0.45);
    }
  }

  /** After lighting: fireflies at dusk and night. */
  drawGlow(f: Target, t: number, mode: LightMode) {
    if (mode !== "night" && mode !== "dusk") return;
    for (const p of this.particles) {
      if (p.kind !== "fly") continue;
      const a = Math.max(0, Math.sin(t * 1.3 + p.seed * 1.7)) * (mode === "night" ? 1 : 0.6);
      if (a < 0.05) continue;
      blend(f, p.x, p.y, FIREFLY, a);
      blend(f, p.x + 1, p.y, FIREFLY, a * 0.3);
      blend(f, p.x, p.y + 1, FIREFLY, a * 0.3);
    }
  }
}

function scaleRGB(c: number, r: number, g: number, b: number) {
  const R = Math.min(255, (c & 255) * r), G = Math.min(255, ((c >>> 8) & 255) * g), B = Math.min(255, ((c >>> 16) & 255) * b);
  return (0xff000000 | (B << 16) | (G << 8) | R) >>> 0;
}
