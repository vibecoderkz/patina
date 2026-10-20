import { Bvh } from "./bvh.js";
import { rng } from "./math.js";
import { meshBounds, type Bounds, type Mesh } from "./mesh.js";

/**
 * Everything Patina knows about the surface, per texel of the texture set. Painting, generators
 * and noises run on these texels in object space, which is why nothing shows UV seams.
 */
export interface TexelMaps {
  res: number;
  /** Triangle per texel, -1 = outside every UV island. */
  tri: Int32Array;
  /** Indices of covered texels, row order. */
  texels: Int32Array;
  covered: Uint8Array;
  /** Object-space position and smooth normal per texel (3 floats each). */
  pos: Float32Array;
  nrm: Float32Array;
  /** Part index per texel (Mesh.parts order), 0 when the mesh has no parts. */
  part: Uint16Array;
  bounds: Bounds;
  grid: TexelGrid;
}

/** Rasterize the mesh's UV layout. Texel centres inside a triangle are covered, plus a 1-texel conservative rim. */
export function rasterizeUvs(mesh: Mesh, res: number): TexelMaps {
  const N = res * res;
  const tri = new Int32Array(N).fill(-1);
  const bary = new Float32Array(N * 2);
  const dist = new Float32Array(N).fill(Infinity);
  const { uvs, indices } = mesh;
  const T = indices.length / 3;
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < T; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      const ax = uvs[a * 2] * res - 0.5, ay = uvs[a * 2 + 1] * res - 0.5;
      const bx = uvs[b * 2] * res - 0.5, by = uvs[b * 2 + 1] * res - 0.5;
      const cx = uvs[c * 2] * res - 0.5, cy = uvs[c * 2 + 1] * res - 0.5;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const grow = pass === 0 ? 0 : 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - grow), x1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx)) + grow);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - grow), y1 = Math.min(res - 1, Math.ceil(Math.max(ay, by, cy)) + grow);
      const inv = 1 / area;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * res + x;
          // barycentrics of b (u) and c (v)
          const u = ((x - ax) * (cy - ay) - (y - ay) * (cx - ax)) * inv;
          const v = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * inv;
          const inside = u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
          if (pass === 0) {
            if (inside) {
              tri[i] = t;
              bary[i * 2] = u;
              bary[i * 2 + 1] = v;
              dist[i] = 0;
            }
            continue;
          }
          if (inside || dist[i] === 0) continue;
          // closest point on the triangle (clamp barycentrics through the nearest edge)
          const cand = closestOnTriangle(x, y, ax, ay, bx, by, cx, cy);
          if (cand.d < 0.75 && cand.d < dist[i]) {
            dist[i] = cand.d;
            tri[i] = t;
            bary[i * 2] = cand.u;
            bary[i * 2 + 1] = cand.v;
          }
        }
    }
  }
  const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3);
  const covered = new Uint8Array(N);
  const part = new Uint16Array(N);
  const list: number[] = [];
  const partOf = new Uint16Array(T);
  mesh.parts?.forEach((p, k) => partOf.fill(k, p.start, p.start + p.count));
  const P = mesh.positions, Nn = mesh.normals;
  for (let i = 0; i < N; i++) {
    const t = tri[i];
    if (t < 0) continue;
    covered[i] = 1;
    list.push(i);
    part[i] = partOf[t];
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const u = bary[i * 2], v = bary[i * 2 + 1], w = 1 - u - v;
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = P[a * 3 + k] * w + P[b * 3 + k] * u + P[c * 3 + k] * v;
    nx = Nn[a * 3] * w + Nn[b * 3] * u + Nn[c * 3] * v;
    ny = Nn[a * 3 + 1] * w + Nn[b * 3 + 1] * u + Nn[c * 3 + 1] * v;
    nz = Nn[a * 3 + 2] * w + Nn[b * 3 + 2] * u + Nn[c * 3 + 2] * v;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / l;
    nrm[i * 3 + 1] = ny / l;
    nrm[i * 3 + 2] = nz / l;
  }
  const texels = Int32Array.from(list);
  const bounds = meshBounds(mesh);
  return { res, tri, texels, covered, pos, nrm, part, bounds, grid: new TexelGrid(pos, texels, bounds) };
}

function closestOnTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  // test the three edges, return barycentrics (of b, c) at the closest point
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
    return { t, d: Math.hypot(x0 + dx * t - px, y0 + dy * t - py) };
  };
  const ab = seg(ax, ay, bx, by), bc = seg(bx, by, cx, cy), ca = seg(cx, cy, ax, ay);
  if (ab.d <= bc.d && ab.d <= ca.d) return { d: ab.d, u: ab.t, v: 0 };
  if (bc.d <= ca.d) return { d: bc.d, u: 1 - bc.t, v: bc.t };
  return { d: ca.d, u: 0, v: 1 - ca.t };
}

/** Uniform grid over covered texels in object space, for "which texels are within r of p" queries. */
export class TexelGrid {
  readonly h: number;
  readonly dims: [number, number, number];
  readonly origin: [number, number, number];
  readonly start: Int32Array;
  readonly items: Int32Array;

  constructor(pos: Float32Array, texels: Int32Array, bounds: Bounds, cellSize = bounds.size / 80) {
    const ext = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
    let h = cellSize;
    const cells = () => ext.reduce((m, e) => m * Math.max(1, Math.ceil(e / h) + 1), 1);
    while (cells() > 2_000_000) h *= 1.25;
    this.h = h;
    this.origin = [bounds.min[0] - h * 0.5, bounds.min[1] - h * 0.5, bounds.min[2] - h * 0.5];
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil(ext[k] / h) + 1)) as [number, number, number];
    const [gx, gy, gz] = this.dims;
    const count = new Int32Array(gx * gy * gz + 1);
    const cellOf = new Int32Array(texels.length);
    for (let k = 0; k < texels.length; k++) {
      const i = texels[k];
      const c = this.cell(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      cellOf[k] = c;
      count[c + 1]++;
    }
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    this.start = count;
    this.items = new Int32Array(texels.length);
    const fill = count.slice();
    for (let k = 0; k < texels.length; k++) this.items[fill[cellOf[k]]++] = texels[k];
  }

  private cell(x: number, y: number, z: number) {
    const [gx, gy, gz] = this.dims;
    const cx = Math.min(gx - 1, Math.max(0, Math.floor((x - this.origin[0]) / this.h)));
    const cy = Math.min(gy - 1, Math.max(0, Math.floor((y - this.origin[1]) / this.h)));
    const cz = Math.min(gz - 1, Math.max(0, Math.floor((z - this.origin[2]) / this.h)));
    return (cz * gy + cy) * gx + cx;
  }

  /**
   * Calls fn(texelIndex) for every texel in cells overlapping the sphere (caller tests the distance).
   * maxPerCell > 0 subsamples crowded cells evenly (for statistics such as curvature).
   */
  forEachNear(x: number, y: number, z: number, r: number, fn: (texel: number) => void, maxPerCell = 0) {
    const [gx, gy, gz] = this.dims;
    const x0 = Math.max(0, Math.floor((x - r - this.origin[0]) / this.h)), x1 = Math.min(gx - 1, Math.floor((x + r - this.origin[0]) / this.h));
    const y0 = Math.max(0, Math.floor((y - r - this.origin[1]) / this.h)), y1 = Math.min(gy - 1, Math.floor((y + r - this.origin[1]) / this.h));
    const z0 = Math.max(0, Math.floor((z - r - this.origin[2]) / this.h)), z1 = Math.min(gz - 1, Math.floor((z + r - this.origin[2]) / this.h));
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++) {
        const row = (cz * gy + cy) * gx;
        for (let cx = x0; cx <= x1; cx++) {
          const c = row + cx;
          const b = this.start[c], e = this.start[c + 1];
          const stride = maxPerCell > 0 ? Math.max(1, Math.floor((e - b) / maxPerCell)) : 1;
          for (let k = b; k < e; k += stride) fn(this.items[k]);
        }
      }
  }
}

/**
 * Dilation map: for empty texels within `maxDist` steps of an island, the covered texel to copy.
 * maxDist <= 0 fills the whole texture. Returned as flat [dst, src, dst, src, ...].
 */
export function dilationMap(res: number, covered: Uint8Array, maxDist: number): Int32Array {
  const N = res * res;
  const src = new Int32Array(N).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (covered[i]) {
    src[i] = i;
    frontier.push(i);
  }
  const out: number[] = [];
  const limit = maxDist > 0 ? maxDist : res * 2;
  for (let step = 0; step < limit && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % res, y = (i / res) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
        const j = ny * res + nx;
        if (src[j] >= 0) continue;
        src[j] = src[i];
        out.push(j, src[i]);
        next.push(j);
      }
    }
    frontier = next;
  }
  return Int32Array.from(out);
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Copy values of `stride` floats per texel along a dilation map. */
export function applyDilation(buf: Float32Array | Uint8Array, stride: number, map: Int32Array) {
  for (let k = 0; k < map.length; k += 2) {
    const d = map[k] * stride, s = map[k + 1] * stride;
    for (let c = 0; c < stride; c++) buf[d + c] = buf[s + c];
  }
}

/**
 * Signed curvature per texel, -1 (concave) .. 1 (convex), measured in object space from the normals of
 * neighbouring texels within `radius`. Seamless across UV islands and works on hard edges.
 */
export function bakeCurvature(maps: TexelMaps, radius: number): Float32Array {
  const { pos, nrm, texels } = maps;
  const out = new Float32Array(maps.res * maps.res);
  const R = radius, R2 = R * R, minD2 = (R * 0.04) ** 2;
  const grid = new TexelGrid(pos, texels, maps.bounds, R);
  for (let k = 0; k < texels.length; k++) {
    const i = texels[k];
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    let acc = 0, wsum = 0;
    grid.forEachNear(
      px, py, pz, R,
      (j) => {
        const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2 || d2 < minD2) return;
        const d = Math.sqrt(d2);
        const w = 1 - d / R;
        acc += (w * ((nrm[j * 3] - nx) * dx + (nrm[j * 3 + 1] - ny) * dy + (nrm[j * 3 + 2] - nz) * dz)) / d2;
        wsum += w;
      },
      12,
    );
    out[i] = wsum > 0 ? Math.tanh((acc / wsum) * R) : 0;
  }
  return out;
}

/** Ambient occlusion per texel, 1 = open, 0 = fully occluded, by ray casting against the mesh. */
export function bakeAo(maps: TexelMaps, bvh: Bvh, samples: number, distance: number): Float32Array {
  const { pos, nrm, texels, tri } = maps;
  const mesh = bvh.mesh;
  const out = new Float32Array(maps.res * maps.res).fill(1);
  const rand = rng(1234);
  const S = Math.max(4, samples | 0);
  const eps = maps.bounds.size * 1e-4;
  const P = mesh.positions, I = mesh.indices;
  for (let k = 0; k < texels.length; k++) {
    const i = texels[k];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    // geometric normal, for the ray origin offset and the horizon
    const t = tri[i];
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    let gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl;
    gy /= gl;
    gz /= gl;
    if (gx * nx + gy * ny + gz * nz < 0) {
      gx = -gx;
      gy = -gy;
      gz = -gz;
    }
    const ox = pos[i * 3] + gx * eps * 4, oy = pos[i * 3 + 1] + gy * eps * 4, oz = pos[i * 3 + 2] + gz * eps * 4;
    // tangent frame around the smooth normal
    const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
    let tx = ay * nz, ty = -ax * nz, tz = ax * ny - ay * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const rot = rand() * Math.PI * 2;
    let hits = 0, used = 0;
    for (let s = 0; s < S; s++) {
      // stratified cosine-weighted direction
      const r1 = (s + rand()) / S, r2 = ((s * 0.618034 + rand() * 0.25) % 1);
      const phi = r2 * Math.PI * 2 + rot, sr = Math.sqrt(r1);
      const lx = Math.cos(phi) * sr, ly = Math.sin(phi) * sr, lz = Math.sqrt(1 - r1);
      const dx = tx * lx + bx * ly + nx * lz, dy = ty * lx + by * ly + ny * lz, dz = tz * lx + bz * ly + nz * lz;
      if (dx * gx + dy * gy + dz * gz <= 0) continue;
      used++;
      if (bvh.occluded(ox, oy, oz, dx, dy, dz, eps, distance)) hits++;
    }
    out[i] = used ? 1 - hits / used : 1;
  }
  return out;
}

/** Box blur inside UV islands only (empty texels are ignored), `iterations` passes of 3x3. */
export function blurIslands(buf: Float32Array, maps: TexelMaps, iterations: number) {
  const { res, covered, texels } = maps;
  let src = buf;
  for (let it = 0; it < iterations; it++) {
    const dst = new Float32Array(src.length);
    for (let k = 0; k < texels.length; k++) {
      const i = texels[k];
      const x = i % res, y = (i / res) | 0;
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue;
          const j = yy * res + xx;
          if (!covered[j]) continue;
          s += src[j];
          w++;
        }
      dst[i] = s / w;
    }
    src = dst;
  }
  buf.set(src);
}

/** Resample a low-res baked scalar map onto a higher-res texel set (bilinear in UV, islands dilated first). */
export function upsampleScalar(low: Float32Array, lowMaps: TexelMaps, hi: TexelMaps): Float32Array {
  const lr = lowMaps.res;
  const src = low.slice();
  applyDilation(src, 1, dilationMap(lr, lowMaps.covered, 0));
  if (lr === hi.res) return src;
  const out = new Float32Array(hi.res * hi.res);
  const s = lr / hi.res;
  for (let k = 0; k < hi.texels.length; k++) {
    const i = hi.texels[k];
    const x = ((i % hi.res) + 0.5) * s - 0.5, y = (((i / hi.res) | 0) + 0.5) * s - 0.5;
    const x0 = Math.max(0, Math.min(lr - 1, Math.floor(x))), y0 = Math.max(0, Math.min(lr - 1, Math.floor(y)));
    const x1 = Math.min(lr - 1, x0 + 1), y1 = Math.min(lr - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    out[i] = (src[y0 * lr + x0] * (1 - fx) + src[y0 * lr + x1] * fx) * (1 - fy) + (src[y1 * lr + x0] * (1 - fx) + src[y1 * lr + x1] * fx) * fy;
  }
  return out;
}

export interface BakedMaps {
  curvature: Float32Array;
  ao: Float32Array;
}

/** Curvature + AO at `bakeRes`, then resampled to the working texel set. */
export function bakeSurface(mesh: Mesh, bvh: Bvh, maps: TexelMaps, opts: { resolution: number; curvatureRadius: number; aoSamples: number; aoDistance: number }): BakedMaps {
  const lowRes = Math.min(maps.res, opts.resolution);
  const low = lowRes === maps.res ? maps : rasterizeUvs(mesh, lowRes);
  // AO is low frequency: half the curvature resolution is plenty
  const aoRes = Math.max(128, lowRes / 2);
  const aoMaps = aoRes === low.res ? low : rasterizeUvs(mesh, aoRes);
  const size = maps.bounds.size;
  const curvLow = bakeCurvature(low, opts.curvatureRadius * size);
  blurIslands(curvLow, low, 1);
  const aoLow = bakeAo(aoMaps, bvh, opts.aoSamples, opts.aoDistance * size);
  blurIslands(aoLow, aoMaps, 1);
  return { curvature: upsampleScalar(curvLow, low, maps), ao: upsampleScalar(aoLow, aoMaps, maps) };
}
