import type { Mesh } from "./mesh.js";

export interface RayHit {
  t: number;
  tri: number;
  /** Barycentrics of vertices 1 and 2 (vertex 0 weight = 1 - u - v). */
  u: number;
  v: number;
}

/**
 * Bounding volume hierarchy over a mesh's triangles (binned SAH-lite: median split on the longest
 * axis). Flat typed arrays, iterative traversal; used for picking, AO and view-projected painting.
 */
export class Bvh {
  private nodeMin: Float32Array;
  private nodeMax: Float32Array;
  /** Internal: left child index (right = left + 1). Leaf: -(first tri index + 1). */
  private nodeLeft: Int32Array;
  private nodeCount: Int32Array;
  private tris: Uint32Array;
  private nodes = 0;
  private v0: Float32Array;
  private e1: Float32Array;
  private e2: Float32Array;

  constructor(readonly mesh: Mesh) {
    const { positions: p, indices } = mesh;
    const n = indices.length / 3;
    this.v0 = new Float32Array(n * 3);
    this.e1 = new Float32Array(n * 3);
    this.e2 = new Float32Array(n * 3);
    const cen = new Float32Array(n * 3);
    const tmin = new Float32Array(n * 3), tmax = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
      for (let k = 0; k < 3; k++) {
        this.v0[t * 3 + k] = p[a + k];
        this.e1[t * 3 + k] = p[b + k] - p[a + k];
        this.e2[t * 3 + k] = p[c + k] - p[a + k];
        tmin[t * 3 + k] = Math.min(p[a + k], p[b + k], p[c + k]);
        tmax[t * 3 + k] = Math.max(p[a + k], p[b + k], p[c + k]);
        cen[t * 3 + k] = (tmin[t * 3 + k] + tmax[t * 3 + k]) / 2;
      }
    }
    const maxNodes = Math.max(1, 2 * n);
    this.nodeMin = new Float32Array(maxNodes * 3);
    this.nodeMax = new Float32Array(maxNodes * 3);
    this.nodeLeft = new Int32Array(maxNodes);
    this.nodeCount = new Int32Array(maxNodes);
    this.tris = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.tris[i] = i;

    const stack: [number, number, number][] = [[this.alloc(), 0, n]];
    while (stack.length) {
      const [node, start, end] = stack.pop()!;
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity;
      for (let i = start; i < end; i++) {
        const t = this.tris[i] * 3;
        if (tmin[t] < mnx) mnx = tmin[t];
        if (tmin[t + 1] < mny) mny = tmin[t + 1];
        if (tmin[t + 2] < mnz) mnz = tmin[t + 2];
        if (tmax[t] > mxx) mxx = tmax[t];
        if (tmax[t + 1] > mxy) mxy = tmax[t + 1];
        if (tmax[t + 2] > mxz) mxz = tmax[t + 2];
        if (cen[t] < cmnx) cmnx = cen[t];
        if (cen[t + 1] < cmny) cmny = cen[t + 1];
        if (cen[t + 2] < cmnz) cmnz = cen[t + 2];
        if (cen[t] > cmxx) cmxx = cen[t];
        if (cen[t + 1] > cmxy) cmxy = cen[t + 1];
        if (cen[t + 2] > cmxz) cmxz = cen[t + 2];
      }
      this.nodeMin.set([mnx, mny, mnz], node * 3);
      this.nodeMax.set([mxx, mxy, mxz], node * 3);
      const count = end - start;
      const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz;
      if (count <= 4 || Math.max(ex, ey, ez) < 1e-12) {
        this.nodeLeft[node] = -(start + 1);
        this.nodeCount[node] = count;
        continue;
      }
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = axis === 0 ? (cmnx + cmxx) / 2 : axis === 1 ? (cmny + cmxy) / 2 : (cmnz + cmxz) / 2;
      // partition
      let i = start, j = end - 1;
      while (i <= j) {
        if (cen[this.tris[i] * 3 + axis] < mid) i++;
        else {
          const tmp = this.tris[i];
          this.tris[i] = this.tris[j];
          this.tris[j] = tmp;
          j--;
        }
      }
      let split = i;
      if (split === start || split === end) split = (start + end) >> 1;
      const left = this.alloc();
      this.alloc();
      this.nodeLeft[node] = left;
      this.nodeCount[node] = 0;
      stack.push([left, start, split], [left + 1, split, end]);
    }
  }

  private alloc() {
    return this.nodes++;
  }

  /** Closest hit along the ray within [tMin, tMax], or null. Directions need not be normalized. */
  intersect(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin = 1e-6, tMax = Infinity, anyHit = false): RayHit | null {
    const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let best: RayHit | null = null;
    let bestT = tMax;
    const { nodeMin: bmin, nodeMax: bmax, nodeLeft, nodeCount, tris, v0, e1, e2 } = this;
    while (sp > 0) {
      const node = stack[--sp];
      const b = node * 3;
      // slab test
      let t0 = (bmin[b] - ox) * idx, t1 = (bmax[b] - ox) * idx;
      let lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      t0 = (bmin[b + 1] - oy) * idy;
      t1 = (bmax[b + 1] - oy) * idy;
      lo = Math.max(lo, t0 < t1 ? t0 : t1);
      hi = Math.min(hi, t0 < t1 ? t1 : t0);
      t0 = (bmin[b + 2] - oz) * idz;
      t1 = (bmax[b + 2] - oz) * idz;
      lo = Math.max(lo, t0 < t1 ? t0 : t1);
      hi = Math.min(hi, t0 < t1 ? t1 : t0);
      if (hi < lo || hi < tMin || lo > bestT) continue;
      const left = nodeLeft[node];
      if (left >= 0) {
        stack[sp++] = left;
        stack[sp++] = left + 1;
        continue;
      }
      const first = -left - 1, count = nodeCount[node];
      for (let k = first; k < first + count; k++) {
        const t = tris[k], o = t * 3;
        // Moller-Trumbore
        const ax = e1[o], ay = e1[o + 1], az = e1[o + 2];
        const bx = e2[o], by = e2[o + 1], bz = e2[o + 2];
        const px = dy * bz - dz * by, py = dz * bx - dx * bz, pz = dx * by - dy * bx;
        const det = ax * px + ay * py + az * pz;
        if (det > -1e-14 && det < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - v0[o], sy = oy - v0[o + 1], sz = oz - v0[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * az - sz * ay, qy = sz * ax - sx * az, qz = sx * ay - sy * ax;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (bx * qx + by * qy + bz * qz) * inv;
        if (tt < tMin || tt > bestT) continue;
        bestT = tt;
        best = { t: tt, tri: t, u, v };
        if (anyHit) return best;
      }
    }
    return best;
  }

  occluded(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number, tMax: number): boolean {
    return this.intersect(ox, oy, oz, dx, dy, dz, tMin, tMax, true) !== null;
  }

  private stack = new Int32Array(2048);
}

/** Interpolated surface data at a hit. */
export function surfaceAt(mesh: Mesh, tri: number, u: number, v: number) {
  const { positions: p, normals: n, uvs, indices } = mesh;
  const a = indices[tri * 3], b = indices[tri * 3 + 1], c = indices[tri * 3 + 2];
  const w = 1 - u - v;
  const P = [0, 1, 2].map((k) => p[a * 3 + k] * w + p[b * 3 + k] * u + p[c * 3 + k] * v) as [number, number, number];
  const N = [0, 1, 2].map((k) => n[a * 3 + k] * w + n[b * 3 + k] * u + n[c * 3 + k] * v);
  const l = Math.hypot(N[0], N[1], N[2]) || 1;
  const UV = [uvs[a * 2] * w + uvs[b * 2] * u + uvs[c * 2] * v, uvs[a * 2 + 1] * w + uvs[b * 2 + 1] * u + uvs[c * 2 + 1] * v] as [number, number];
  return { position: P, normal: [N[0] / l, N[1] / l, N[2] / l] as [number, number, number], uv: UV };
}
