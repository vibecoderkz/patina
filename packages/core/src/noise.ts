import { clamp } from "./math.js";
import type { NoiseSpec } from "./types.js";

export const DEFAULT_NOISE: NoiseSpec = { type: "fbm", scale: 0.15, octaves: 4, seed: 1, contrast: 1, bias: 0, stretch: [1, 1, 1], invert: false };

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const permCache = new Map<number, Uint8Array>();

/** Seeded permutation table (512 entries, the classic Perlin layout). */
function perm(seed: number): Uint8Array {
  let p = permCache.get(seed);
  if (p) return p;
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let a = (seed * 2654435761) >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    const j = a % (i + 1);
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  p = new Uint8Array(512);
  p.set(base);
  p.set(base, 256);
  permCache.set(seed, p);
  if (permCache.size > 256) permCache.delete(permCache.keys().next().value!);
  return p;
}

function grad(h: number, x: number, y: number, z: number) {
  const k = h & 15;
  const u = k < 8 ? x : y;
  const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

/** Improved Perlin noise, roughly -1..1. */
export const perlin3 = (x: number, y: number, z: number, seed: number) => perlinP(perm(seed), x, y, z);

function perlinP(p: Uint8Array, x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx;
  y -= fy;
  z -= fz;
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  const l1 = grad(p[AA], x, y, z) + u * (grad(p[BA], x1, y, z) - grad(p[AA], x, y, z));
  const l2 = grad(p[AB], x, y1, z) + u * (grad(p[BB], x1, y1, z) - grad(p[AB], x, y1, z));
  const l3 = grad(p[AA + 1], x, y, z1) + u * (grad(p[BA + 1], x1, y, z1) - grad(p[AA + 1], x, y, z1));
  const l4 = grad(p[AB + 1], x, y1, z1) + u * (grad(p[BB + 1], x1, y1, z1) - grad(p[AB + 1], x, y1, z1));
  const m1 = l1 + v * (l2 - l1), m2 = l3 + v * (l4 - l3);
  return (m1 + w * (m2 - m1)) * 0.97;
}

/** Distance to the nearest feature point (Worley F1), 0..~1. */
export const cellular3 = (x: number, y: number, z: number, seed: number) => cellularP(perm(seed), x, y, z);

function cellularP(p: Uint8Array, x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const h = p[p[p[cx & 255] + (cy & 255)] + (cz & 255)];
        const ox = cx + p[h] / 255 - x, oy = cy + p[h + 1] / 255 - y, oz = cz + p[h + 2] / 255 - z;
        const d = ox * ox + oy * oy + oz * oz;
        if (d < best) best = d;
      }
  return Math.sqrt(best);
}

/** Hash-based white noise 0..1 at a lattice cell (used for spray brushes). */
export const white3 = (x: number, y: number, z: number, seed: number) => hash3(Math.floor(x), Math.floor(y), Math.floor(z), seed) / 4294967296;

/**
 * Evaluate a NoiseSpec at an object-space point, 0..1. `meshSize` converts the relative scale into
 * object units so the same spec looks the same on any mesh. Prefer compileNoise in loops.
 */
export function evalNoise(spec: NoiseSpec, x: number, y: number, z: number, meshSize: number): number {
  return compileNoise(spec, meshSize)(x, y, z);
}

/** Resolve a NoiseSpec once (permutation tables, frequencies) into a fast (x, y, z) => 0..1 function. */
export function compileNoise(spec: NoiseSpec, meshSize: number): (x: number, y: number, z: number) => number {
  const f = 1 / Math.max(1e-4, spec.scale * meshSize);
  const sx = f / spec.stretch[0], sy = f / spec.stretch[1], sz = f / spec.stretch[2];
  const seed = spec.seed | 0;
  const oct = Math.max(1, Math.min(8, spec.octaves | 0));
  const P = Array.from({ length: 8 }, (_, o) => perm(seed + o));
  const contrast = spec.contrast, bias = spec.bias, invert = spec.invert;
  const post = (v: number) => {
    v = (v - 0.5 + bias) * contrast + 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return invert ? 1 - v : v;
  };
  const fbm = (px: number, py: number, pz: number, gain: number, lac: number) => {
    let a = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += perlinP(P[o], px, py, pz) * a;
      norm += a;
      a *= gain;
      px *= lac;
      py *= lac;
      pz *= lac;
    }
    return s / norm;
  };
  switch (spec.type) {
    case "perlin":
      return (x, y, z) => post(perlinP(P[0], x * sx, y * sy, z * sz) * 0.5 + 0.5);
    case "ridged":
      return (x, y, z) => {
        let px = x * sx, py = y * sy, pz = z * sz, a = 1, s = 0, norm = 0;
        for (let o = 0; o < oct; o++) {
          s += (1 - Math.abs(perlinP(P[o], px, py, pz))) * a;
          norm += a;
          a *= 0.5;
          px *= 2.03;
          py *= 2.03;
          pz *= 2.03;
        }
        const r = s / norm;
        return post(r * r);
      };
    case "cellular":
      return (x, y, z) => post(clamp(cellularP(P[0], x * sx, y * sy, z * sz)));
    case "spots": {
      const pw = perm(seed + 7);
      return (x, y, z) => {
        const px = x * sx, py = y * sy, pz = z * sz;
        const c = cellularP(P[0], px, py, pz) + perlinP(pw, px * 2.7, py * 2.7, pz * 2.7) * 0.15;
        return post(1 - clamp((c - 0.18) / 0.22));
      };
    }
    case "scratches": {
      // short straight scratches: a thin disc (slab) in some 3D cells; where it cuts the surface you
      // get a line. Every cell parameter depends only on the cell hash, so they are tabulated.
      const n = Math.min(oct, 2);
      const tabs = [perm(seed), perm(seed + 13)].slice(0, n).map((p) => {
        const t = new Float32Array(256 * 8);
        for (let h = 0; h < 256; h++) {
          const th = (p[h + 4] / 255) * Math.PI * 2, ph = Math.acos(2 * (p[h + 5] / 255) - 1);
          t.set([p[h] / 255, p[h + 1] / 255, p[h + 2] / 255, Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph), 0.35 + (p[h + 6] / 255) * 0.45, p[h + 3] > 150 ? 0 : 0.01 + (p[h + 7] / 255) * 0.016], h * 8);
        }
        return { p, t };
      });
      return (x, y, z) => {
        let best = 0;
        for (let o = 0; o < n; o++) {
          const k = o === 0 ? 1 : 2.3;
          const { p, t } = tabs[o];
          const px = x * sx * k, py = y * sy * k, pz = z * sz * k;
          const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const cx = xi + dx, cy = yi + dy, cz = zi + dz;
                const b = p[p[p[cx & 255] + (cy & 255)] + (cz & 255)] * 8;
                const w = t[b + 7];
                if (w === 0) continue; // ~40% of cells hold a scratch
                const qx = px - cx - t[b], qy = py - cy - t[b + 1], qz = pz - cz - t[b + 2];
                const along = qx * t[b + 3] + qy * t[b + 4] + qz * t[b + 5];
                const d = along < 0 ? -along : along;
                if (d >= w) continue;
                const half = t[b + 6];
                const r2 = qx * qx + qy * qy + qz * qz - along * along;
                if (r2 >= half * half) continue;
                const fade = 1 - Math.sqrt(r2 > 0 ? r2 : 0) / half;
                const v = (1 - d / w) * Math.min(1, fade * 2.5) * (o === 0 ? 1 : 0.7);
                if (v > best) best = v;
              }
        }
        return post(best);
      };
    }
    case "grunge": {
      const pc = perm(seed + 31);
      return (x, y, z) => {
        const fb = fbm(x * sx, y * sy, z * sz, 0.55, 2.1);
        const c = cellularP(pc, x * f * 2.3, y * f * 2.3, z * f * 2.3);
        return post(clamp(0.5 + fb * 1.4 - (0.35 - c) * 0.6));
      };
    }
    case "wood": {
      const pg = perm(seed + 9);
      return (x, y, z) => {
        const px = x * sx, py = y * sy, pz = z * sz;
        const r = Math.hypot(px, pz) * 3 + perlinP(P[0], px * 0.6, py * 0.6, pz * 0.6) * 1.2;
        const ring = r - Math.floor(r);
        return post(clamp(Math.pow(ring, 2.2) + perlinP(pg, px * 6, py * 0.4, pz * 6) * 0.15 + 0.1));
      };
    }
    case "fbm":
    default:
      return (x, y, z) => post(fbm(x * sx, y * sy, z * sz, 0.5, 2.01) * 0.85 + 0.5);
  }
}
