import { rng, type Vec3 } from "./math.js";
import type { EnvironmentName } from "./types.js";

/**
 * Procedural lighting environments (no HDRI files to ship or license). The same equirect radiance
 * feeds the CPU renderer and the desktop viewport (three.js PMREM), so both light materials alike.
 */
export interface EnvMap {
  width: number;
  height: number;
  /** Linear RGB radiance, 3 floats per pixel, row 0 = straight up. */
  data: Float32Array;
}

export const ENVIRONMENTS: { name: EnvironmentName; title: string }[] = [
  { name: "studio", title: "Studio softboxes" },
  { name: "sunset", title: "Sunset sky" },
  { name: "overcast", title: "Overcast" },
  { name: "night", title: "Night neon" },
];

interface AreaLight {
  az: number;
  el: number;
  w: number;
  h: number;
  color: Vec3;
  soft: number;
}

function dirFromEquirect(u: number, v: number): Vec3 {
  const phi = (u - 0.5) * Math.PI * 2, theta = v * Math.PI;
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

const deg = Math.PI / 180;

function radiance(name: EnvironmentName, d: Vec3): Vec3 {
  const el = Math.asin(Math.max(-1, Math.min(1, d[1])));
  const az = Math.atan2(d[0], -d[2]);
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const area = (L: AreaLight[], base: Vec3): Vec3 => {
    const out: Vec3 = [...base];
    for (const l of L) {
      let da = az - l.az * deg;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const dx = Math.abs(da * Math.cos(el)) / (l.w * deg * 0.5), dy = Math.abs(el - l.el * deg) / (l.h * deg * 0.5);
      const m = Math.max(dx, dy);
      const k = m < 1 - l.soft ? 1 : m > 1 ? 0 : (1 - m) / l.soft;
      for (let c = 0; c < 3; c++) out[c] += l.color[c] * k * k * (3 - 2 * k);
    }
    return out;
  };
  const t = d[1];
  switch (name) {
    case "sunset": {
      const sky = t > 0 ? mix([1.6, 0.75, 0.38], [0.25, 0.38, 0.75], Math.pow(t, 0.45)) : mix([0.35, 0.22, 0.16], [0.08, 0.07, 0.06], Math.min(1, -t * 3));
      const sunDir: Vec3 = [Math.sin(-30 * deg) * Math.cos(6 * deg), Math.sin(6 * deg), -Math.cos(-30 * deg) * Math.cos(6 * deg)];
      const c = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
      const sun = c > 0.9994 ? 60 : c > 0.99 ? (Math.pow((c - 0.99) / 0.0094, 3) * 8) : 0;
      const glow = Math.pow(Math.max(0, c), 24) * 1.2;
      return [sky[0] + sun * 1.0 + glow * 1.4, sky[1] + sun * 0.75 + glow * 0.7, sky[2] + sun * 0.5 + glow * 0.3];
    }
    case "overcast": {
      const sky = t > 0 ? mix([0.85, 0.87, 0.9], [1.25, 1.27, 1.3], Math.pow(t, 0.6)) : mix([0.42, 0.41, 0.4], [0.18, 0.18, 0.18], Math.min(1, -t * 2));
      return sky;
    }
    case "night": {
      const base: Vec3 = t > 0 ? mix([0.05, 0.06, 0.1], [0.012, 0.015, 0.03], t) : [0.02, 0.02, 0.025];
      return area(
        [
          { az: -55, el: 20, w: 10, h: 50, color: [0.2, 2.2, 2.6], soft: 0.25 },
          { az: 70, el: 15, w: 12, h: 40, color: [2.8, 0.25, 1.6], soft: 0.25 },
          { az: 175, el: 35, w: 30, h: 12, color: [1.2, 1.2, 1.5], soft: 0.5 },
        ],
        base,
      );
    }
    case "studio":
    default: {
      const base: Vec3 = t > 0 ? mix([0.42, 0.42, 0.41], [0.62, 0.62, 0.61], t) : mix([0.3, 0.3, 0.29], [0.16, 0.16, 0.16], Math.min(1, -t * 2.5));
      return area(
        [
          { az: -42, el: 32, w: 34, h: 44, color: [5.2, 5.1, 4.9], soft: 0.3 },
          { az: 62, el: 12, w: 40, h: 34, color: [1.5, 1.55, 1.6], soft: 0.45 },
          { az: 165, el: 38, w: 22, h: 30, color: [3.4, 3.4, 3.5], soft: 0.3 },
          { az: 0, el: 82, w: 70, h: 14, color: [1.6, 1.6, 1.6], soft: 0.6 },
        ],
        base,
      );
    }
  }
}

export function createEnvMap(name: EnvironmentName, width = 256): EnvMap {
  const height = width / 2;
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const r = radiance(name, dirFromEquirect((x + 0.5) / width, (y + 0.5) / height));
      data.set(r, (y * width + x) * 3);
    }
  return { width, height, data };
}

/** Bilinear lookup by direction. `rotation` (radians) spins the environment around +Y. */
export function sampleEnv(env: EnvMap, x: number, y: number, z: number, rotation = 0, out: Vec3 = [0, 0, 0]): Vec3 {
  let u = Math.atan2(x, -z) / (Math.PI * 2) + 0.5 - rotation / (Math.PI * 2);
  u -= Math.floor(u);
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  const fx = u * env.width - 0.5, fy = Math.max(0, Math.min(env.height - 1, v * env.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const xa = ((x0 % env.width) + env.width) % env.width, xb = (xa + 1) % env.width;
  const ya = y0, yb = Math.min(env.height - 1, y0 + 1);
  const d = env.data, w = env.width;
  for (let c = 0; c < 3; c++) {
    const a = d[(ya * w + xa) * 3 + c] * (1 - tx) + d[(ya * w + xb) * 3 + c] * tx;
    const b = d[(yb * w + xa) * 3 + c] * (1 - tx) + d[(yb * w + xb) * 3 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

export interface PrefilteredEnv {
  name: EnvironmentName;
  base: EnvMap;
  /** Blurred copies for roughness levels ROUGHNESS_LEVELS. */
  levels: EnvMap[];
  /** 9 SH coefficients x RGB for diffuse irradiance (already divided by pi: returns radiance-like). */
  sh: Float32Array;
}

export const ROUGHNESS_LEVELS = [0, 0.12, 0.25, 0.4, 0.6, 0.8, 1];

function prefilter(src: EnvMap, roughness: number, width: number, samples: number): EnvMap {
  if (roughness === 0) return src;
  const height = width / 2;
  const data = new Float32Array(width * height * 3);
  const a = roughness * roughness;
  const rand = rng(7);
  const tmp: Vec3 = [0, 0, 0];
  const dirs: { h: Vec3 }[] = [];
  for (let s = 0; s < samples; s++) {
    const u1 = (s + rand()) / samples, u2 = rand();
    const phi = 2 * Math.PI * u2;
    const cosT = Math.sqrt((1 - u1) / (1 + (a * a - 1) * u1));
    const sinT = Math.sqrt(1 - cosT * cosT);
    dirs.push({ h: [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT] });
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const n = dirFromEquirect((x + 0.5) / width, (y + 0.5) / height);
      const up: Vec3 = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
      let tx = up[1] * n[2] - up[2] * n[1], ty = up[2] * n[0] - up[0] * n[2], tz = up[0] * n[1] - up[1] * n[0];
      const tl = Math.hypot(tx, ty, tz);
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;
      let r = 0, g = 0, b = 0, w = 0;
      for (const { h } of dirs) {
        const hx = tx * h[0] + bx * h[1] + n[0] * h[2], hy = ty * h[0] + by * h[1] + n[1] * h[2], hz = tz * h[0] + bz * h[1] + n[2] * h[2];
        // reflect V=N about H
        const d = 2 * (n[0] * hx + n[1] * hy + n[2] * hz);
        const lx = d * hx - n[0], ly = d * hy - n[1], lz = d * hz - n[2];
        const nl = n[0] * lx + n[1] * ly + n[2] * lz;
        if (nl <= 0) continue;
        sampleEnv(src, lx, ly, lz, 0, tmp);
        r += tmp[0] * nl;
        g += tmp[1] * nl;
        b += tmp[2] * nl;
        w += nl;
      }
      data[(y * width + x) * 3] = r / (w || 1);
      data[(y * width + x) * 3 + 1] = g / (w || 1);
      data[(y * width + x) * 3 + 2] = b / (w || 1);
    }
  return { width, height, data };
}

function computeSh(env: EnvMap): Float32Array {
  const sh = new Float32Array(27);
  const { width: W, height: H, data } = env;
  let total = 0;
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;
    const dw = (2 * Math.PI * Math.PI * Math.sin(theta)) / (W * H);
    for (let x = 0; x < W; x++) {
      const [dx, dy, dz] = dirFromEquirect((x + 0.5) / W, (y + 0.5) / H);
      const basis = [0.282095, 0.488603 * dy, 0.488603 * dz, 0.488603 * dx, 1.092548 * dx * dy, 1.092548 * dy * dz, 0.315392 * (3 * dz * dz - 1), 1.092548 * dx * dz, 0.546274 * (dx * dx - dy * dy)];
      for (let k = 0; k < 9; k++)
        for (let c = 0; c < 3; c++) sh[k * 3 + c] += data[(y * W + x) * 3 + c] * basis[k] * dw;
      total += dw;
    }
  }
  void total;
  return sh;
}

/** Diffuse irradiance / pi for a normal, from SH (so albedo * result = outgoing radiance). */
export function irradianceSh(sh: Float32Array, x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  for (let c = 0; c < 3; c++) {
    const L = (k: number) => sh[k * 3 + c];
    const e =
      c1 * L(8) * (x * x - y * y) + c3 * L(6) * z * z + c4 * L(0) - c5 * L(6) + 2 * c1 * (L(4) * x * y + L(7) * x * z + L(5) * y * z) + 2 * c2 * (L(3) * x + L(1) * y + L(2) * z);
    out[c] = Math.max(0, e) / Math.PI;
  }
  return out;
}

const cache = new Map<EnvironmentName, PrefilteredEnv>();

export function prefilteredEnv(name: EnvironmentName): PrefilteredEnv {
  let e = cache.get(name);
  if (e) return e;
  const base = createEnvMap(name, 256);
  const small = createEnvMap(name, 128);
  const levels = ROUGHNESS_LEVELS.map((r, i) => (i === 0 ? base : prefilter(r < 0.3 ? base : small, r, r < 0.3 ? 128 : 64, r < 0.3 ? 96 : 160)));
  e = { name, base, levels, sh: computeSh(small) };
  cache.set(name, e);
  return e;
}

/** Specular radiance for a reflection direction at a roughness (blends the two nearest levels). */
export function sampleSpecular(env: PrefilteredEnv, x: number, y: number, z: number, roughness: number, rotation: number, out: Vec3): Vec3 {
  const L = ROUGHNESS_LEVELS;
  let i = 0;
  while (i < L.length - 2 && roughness > L[i + 1]) i++;
  const t = Math.max(0, Math.min(1, (roughness - L[i]) / (L[i + 1] - L[i])));
  const a = sampleEnv(env.levels[i], x, y, z, rotation, [0, 0, 0]);
  const b = sampleEnv(env.levels[i + 1], x, y, z, rotation, [0, 0, 0]);
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
