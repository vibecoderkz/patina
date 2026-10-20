import { clamp, hexToRgb, smoothstep } from "./math.js";
import { compileNoise, DEFAULT_NOISE } from "./noise.js";
import type { BakedMaps, TexelMaps } from "./bake.js";
import type { ColorSource, Generator, NoiseSpec, ScalarSource } from "./types.js";

export const DEFAULT_GENERATOR: Generator = {
  type: "edgeWear",
  amount: 0.5,
  softness: 0.3,
  breakup: { ...DEFAULT_NOISE, type: "grunge", scale: 0.06, octaves: 4 },
  breakupStrength: 0.5,
  axis: "y",
  direction: [0, 1, 0],
  from: 0,
  to: 1,
  mode: "convex",
  noise: { ...DEFAULT_NOISE },
  value: 1,
  invert: false,
};

export const needsBake = (g: Generator) => g.type === "edgeWear" || g.type === "dirt" || g.type === "curvature" || g.type === "ao";

/** Evaluate a mask generator for every covered texel. Output 0..1 per texel (full texture size). */
export function evalGenerator(g: Generator, maps: TexelMaps, baked: BakedMaps | null): Float32Array {
  const { texels, pos, nrm, bounds } = maps;
  const out = new Float32Array(maps.res * maps.res);
  const size = bounds.size;
  const soft = 0.02 + clamp(g.softness) * 0.35;
  const bs = g.breakupStrength;
  const bn = compileNoise(g.breakup, size);
  const gn = g.type === "noise" ? compileNoise(g.noise, size) : null;
  const t = 1 - clamp(g.amount), t0 = t - soft, t1 = t + soft;
  const curv = baked?.curvature, ao = baked?.ao;
  if (needsBake(g) && !baked) throw new Error(`Generator "${g.type}" needs baked curvature/AO. Run bake.run first.`);
  const axis = g.axis === "x" ? 0 : g.axis === "y" ? 1 : 2;
  const lo = bounds.min[axis], span = bounds.max[axis] - bounds.min[axis] || 1;
  const dl = Math.hypot(...g.direction) || 1;
  const dir = [g.direction[0] / dl, g.direction[1] / dl, g.direction[2] / dl];
  const gLo = Math.min(g.from, g.to), gHi = Math.max(g.from, g.to);
  /**
   * Thresholded generators: value = smoothstep(t0, t1, base + breakup * weight). The noise is only
   * evaluated where its range can still cross the threshold, which skips most of the surface.
   */
  const thresh = (i: number, base: number, weight: number) => {
    const r = 0.5 * bs * weight;
    if (base + r <= t0) return 0;
    if (base - r >= t1) return 1;
    const b = r > 0 ? (bn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) - 0.5) * bs * weight : 0;
    return smoothstep(t0, t1, base + b);
  };
  for (let k = 0; k < texels.length; k++) {
    const i = texels[k];
    let v: number;
    switch (g.type) {
      case "edgeWear": {
        // convex curvature, scaled so amount 0.5 catches clear edges; breakup fades out on flat areas
        const c = Math.max(0, curv![i]) * 1.25;
        v = thresh(i, c, 0.25 + 0.75 * Math.min(1, c * 2.5));
        break;
      }
      case "dirt":
        v = thresh(i, (1 - ao![i]) * 1.6 + Math.max(0, -curv![i]) * 1.1, 1);
        break;
      case "curvature":
        v = thresh(i, (g.mode === "convex" ? curv![i] : -curv![i]) * 1.25, 1);
        break;
      case "ao":
        v = thresh(i, (1 - ao![i]) * 1.6, 1);
        break;
      case "facing": {
        const d = nrm[i * 3] * dir[0] + nrm[i * 3 + 1] * dir[1] + nrm[i * 3 + 2] * dir[2];
        // d: 1 facing the direction, 0 perpendicular, -1 away
        v = thresh(i, d, 1);
        break;
      }
      case "gradient": {
        let p = (pos[i * 3 + axis] - lo) / span;
        const r = 0.25 * bs;
        if (g.from === g.to) {
          if (bs > 0) p += (bn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) - 0.5) * bs * 0.5;
          v = p >= g.from ? 1 : 0;
        } else if (p + r <= gLo || p - r >= gHi) v = clamp((p - g.from) / (g.to - g.from));
        else {
          if (bs > 0) p += (bn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) - 0.5) * bs * 0.5;
          v = clamp((p - g.from) / (g.to - g.from));
        }
        break;
      }
      case "noise":
        v = gn!(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        break;
      case "uniform":
      default:
        v = clamp(g.value);
    }
    out[i] = g.invert ? 1 - v : v;
  }
  return out;
}

export const isConstant = (s: ScalarSource | ColorSource): s is number | string => typeof s === "number" || typeof s === "string";

/** A noise-driven channel source, evaluated lazily: only texels a layer actually shows get computed. */
export class SourceBuffer {
  readonly stride: number;
  readonly buf: Float32Array;
  private done: Uint8Array;
  private fn: (x: number, y: number, z: number) => number;
  private a: number[];
  private b: number[];

  constructor(
    src: Exclude<ScalarSource | ColorSource, number | string>,
    private maps: TexelMaps,
  ) {
    const color = typeof src.from === "string";
    this.stride = color ? 3 : 1;
    const N = maps.res * maps.res;
    this.buf = new Float32Array(N * this.stride);
    this.done = new Uint8Array(N);
    this.a = color ? hexToRgb(src.from as string) : [src.from as number];
    this.b = color ? hexToRgb(src.to as string) : [src.to as number];
    this.fn = compileNoise(src.noise, maps.bounds.size);
  }

  /** Make sure texel i is computed. */
  ensure(i: number) {
    if (this.done[i]) return;
    this.done[i] = 1;
    const p = this.maps.pos, s = this.stride;
    const t = this.fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    for (let c = 0; c < s; c++) this.buf[i * s + c] = this.a[c] + (this.b[c] - this.a[c]) * t;
  }
}

/** Fully evaluated source buffer (tests and tools). */
export function evalSource(src: Exclude<ScalarSource | ColorSource, number | string>, maps: TexelMaps): Float32Array {
  const sb = new SourceBuffer(src, maps);
  for (let k = 0; k < maps.texels.length; k++) sb.ensure(maps.texels[k]);
  return sb.buf;
}
