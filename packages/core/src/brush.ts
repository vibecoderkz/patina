import { projectPoint } from "./camera.js";
import { compileNoise, white3 } from "./noise.js";
import type { TexelMaps } from "./bake.js";
import type { Brush, Camera, Stroke } from "./types.js";
import type { Vec3 } from "./math.js";

export const DEFAULT_BRUSH: Brush = {
  size: 0.03,
  hardness: 0.6,
  flow: 0.6,
  opacity: 1,
  spacing: 0.25,
  alpha: "round",
  projection: "sphere",
  symmetry: "none",
  seed: 1,
};

/** Depth buffer used to keep view-projected strokes on surfaces visible from their camera. */
export interface DepthView {
  camera: Camera;
  width: number;
  height: number;
  depth: Float32Array;
}

/**
 * Turns a growing list of stroke points into dabs and accumulates per-texel coverage (0..1).
 * Works incrementally so the desktop can paint live while the pointer moves; a command replays the
 * same stroke in one go and gets identical coverage.
 */
export class StrokeRasterizer {
  /** Coverage per texel before `opacity`. */
  readonly cov: Float32Array;
  /** Texels with coverage > 0, in first-touched order. */
  readonly touched: number[] = [];
  private last: Vec3 | null = null;
  private lastPressure = 1;
  private carry = 0;
  private dabIndex = 0;
  private radius: number;
  private mirror: number;
  private center: Vec3;
  private grunge: ((x: number, y: number, z: number) => number) | null = null;

  constructor(
    readonly stroke: Pick<Stroke, "brush" | "camera">,
    readonly maps: TexelMaps,
    private depth: DepthView | null,
  ) {
    this.cov = new Float32Array(maps.res * maps.res);
    this.radius = Math.max(1e-6, stroke.brush.size * maps.bounds.size);
    this.center = maps.bounds.center;
    this.mirror = { none: -1, x: 0, y: 1, z: 2 }[stroke.brush.symmetry];
    if (stroke.brush.projection === "view" && !stroke.camera) throw new Error('Brush projection "view" needs a camera on the stroke');
    if (stroke.brush.alpha === "grunge")
      this.grunge = compileNoise({ type: "grunge", scale: (this.radius * 0.8) / maps.bounds.size, octaves: 4, seed: stroke.brush.seed & 255, contrast: 2.2, bias: -0.05, stretch: [1, 1, 1], invert: false }, maps.bounds.size);
  }

  /** Feed more points (flat xyz) and optional pressures; returns the texels whose coverage changed. */
  addPoints(points: ArrayLike<number>, pressure?: ArrayLike<number>): number[] {
    const changed: number[] = [];
    const step = Math.max(this.radius * this.stroke.brush.spacing, this.radius * 0.02);
    for (let k = 0; k + 2 < points.length; k += 3) {
      const p: Vec3 = [points[k], points[k + 1], points[k + 2]];
      const pr = pressure ? (pressure[k / 3] ?? 1) : 1;
      if (!this.last) {
        this.dab(p, pr, changed);
        this.last = p;
        this.lastPressure = pr;
        this.carry = 0;
        continue;
      }
      const d = Math.hypot(p[0] - this.last[0], p[1] - this.last[1], p[2] - this.last[2]);
      let t = step - this.carry;
      while (t <= d) {
        const f = t / d;
        this.dab(
          [this.last[0] + (p[0] - this.last[0]) * f, this.last[1] + (p[1] - this.last[1]) * f, this.last[2] + (p[2] - this.last[2]) * f],
          this.lastPressure + (pr - this.lastPressure) * f,
          changed,
        );
        t += step;
      }
      this.carry = d - (t - step);
      this.last = p;
      this.lastPressure = pr;
    }
    return changed;
  }

  private dab(p: Vec3, pressure: number, changed: number[]) {
    this.dabAt(p, pressure, this.stroke.camera ?? null, changed);
    if (this.mirror >= 0) {
      const m: Vec3 = [...p];
      m[this.mirror] = 2 * this.center[this.mirror] - p[this.mirror];
      let cam = this.stroke.camera ?? null;
      if (cam) {
        const eye: Vec3 = [...cam.eye], target: Vec3 = [...cam.target], up: Vec3 = [...cam.up];
        eye[this.mirror] = 2 * this.center[this.mirror] - eye[this.mirror];
        target[this.mirror] = 2 * this.center[this.mirror] - target[this.mirror];
        up[this.mirror] = -up[this.mirror];
        cam = { ...cam, eye, target, up };
      }
      this.dabAt(m, pressure, cam, changed, true);
    }
    this.dabIndex++;
  }

  private dabAt(p: Vec3, pressure: number, cam: Camera | null, changed: number[], mirrored = false) {
    const b = this.stroke.brush;
    const r = this.radius * (0.25 + 0.75 * pressure);
    const flow = b.flow * pressure;
    const { pos, nrm, grid, bounds } = this.maps;
    const hard = Math.min(0.999, Math.max(0, b.hardness));
    const view = b.projection === "view" && cam;
    let dir: Vec3 = [0, 0, 0];
    if (view) {
      const dx = p[0] - cam.eye[0], dy = p[1] - cam.eye[1], dz = p[2] - cam.eye[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      dir = [dx / l, dy / l, dz / l];
    }
    const depth = view && !mirrored ? this.depth : null;
    const aspect = depth ? depth.width / depth.height : 1;
    const seed = b.seed + this.dabIndex * 7919;
    const search = view ? r * 2.5 : r;
    const r2 = r * r;
    grid.forEachNear(p[0], p[1], p[2], search, (i) => {
      const qx = pos[i * 3] - p[0], qy = pos[i * 3 + 1] - p[1], qz = pos[i * 3 + 2] - p[2];
      let d2: number;
      if (view) {
        const along = qx * dir[0] + qy * dir[1] + qz * dir[2];
        d2 = qx * qx + qy * qy + qz * qz - along * along;
        if (d2 >= r2) return;
        // facing the camera
        if (nrm[i * 3] * dir[0] + nrm[i * 3 + 1] * dir[1] + nrm[i * 3 + 2] * dir[2] > -0.02) return;
        if (depth) {
          const s = projectPoint(depth.camera, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], aspect);
          const x = Math.floor(s.x * depth.width), y = Math.floor(s.y * depth.height);
          if (x >= 0 && y >= 0 && x < depth.width && y < depth.height) {
            const zd = depth.depth[y * depth.width + x];
            if (s.depth > zd + bounds.size * 0.004 + r * 0.05) return;
          }
        } else if (along > r) return;
      } else {
        d2 = qx * qx + qy * qy + qz * qz;
        if (d2 >= r2) return;
      }
      const d = Math.sqrt(d2) / r;
      let w = d <= hard ? 1 : 1 - (d - hard) / (1 - hard);
      w = w * w * (3 - 2 * w);
      if (this.grunge) w *= Math.max(0, Math.min(1, (this.grunge(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) - 0.35) * 2));
      else if (b.alpha !== "round") w *= alphaMask(b.alpha, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], r, seed);
      if (w <= 0) return;
      const a = flow * w;
      const before = this.cov[i];
      if (before === 0) this.touched.push(i);
      this.cov[i] = before + (1 - before) * a;
      changed.push(i);
    });
  }
}

function alphaMask(kind: Brush["alpha"], x: number, y: number, z: number, r: number, seed: number): number {
  switch (kind) {
    case "spray": {
      const cell = r * 0.09;
      return white3(x / cell, y / cell, z / cell, seed) > 0.72 ? 1 : 0;
    }
    case "speckle": {
      const cell = r * 0.045;
      return white3(x / cell, y / cell, z / cell, seed) > 0.9 ? 1 : 0;
    }
    default:
      return 1;
  }
}

/** Map stroke points given in UV (0..1, glTF v-down) to object space using the texel maps. */
export function uvToObject(maps: TexelMaps, u: number, v: number): Vec3 | null {
  const { res, covered, pos } = maps;
  const x = Math.min(res - 1, Math.max(0, Math.floor(u * res))), y = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
  // nearest covered texel within a small window
  for (let r = 0; r < 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue;
        const i = yy * res + xx;
        if (covered[i]) return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      }
  return null;
}
