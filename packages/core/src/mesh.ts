import type { Vec3 } from "./math.js";

/**
 * Indexed triangle mesh. UVs follow the glTF convention: (0,0) is the top-left of the texture,
 * v grows downwards, so texel row 0 is v = 0. One UV set, one texture set.
 */
export interface Mesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Per-vertex tangent (xyz) + handedness (w), see computeTangents. */
  tangents?: Float32Array;
  /** Named parts as triangle ranges (from file meshes or primitive pieces). */
  parts?: { name: string; start: number; count: number }[];
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  /** Bounding-box diagonal. All relative sizes (brush, noise, AO distance) multiply this. */
  size: number;
}

export function meshBounds(m: Mesh): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: 1 };
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  return { min, max, center, size };
}

export const triangleCount = (m: Mesh) => m.indices.length / 3;

/** Smooth normals weighted by face area (used when a file has none). */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * Per-vertex tangents for tangent-space normal maps. Tangent points along +u. The bitangent,
 * cross(N, T) * w, points "up" in the texture image (towards smaller v), which is the OpenGL
 * normal map convention glTF uses. Same frame the viewport (three.js) and the CPU renderer use.
 */
export function computeTangents(m: Mesh): Float32Array {
  const { positions: p, uvs, indices, normals } = m;
  const vc = p.length / 3;
  const tan = new Float64Array(vc * 3);
  const bit = new Float64Array(vc * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x1 = p[i1 * 3] - p[i0 * 3], y1 = p[i1 * 3 + 1] - p[i0 * 3 + 1], z1 = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const x2 = p[i2 * 3] - p[i0 * 3], y2 = p[i2 * 3 + 1] - p[i0 * 3 + 1], z2 = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const s1 = uvs[i1 * 2] - uvs[i0 * 2], t1 = uvs[i1 * 2 + 1] - uvs[i0 * 2 + 1];
    const s2 = uvs[i2 * 2] - uvs[i0 * 2], t2 = uvs[i2 * 2 + 1] - uvs[i0 * 2 + 1];
    const det = s1 * t2 - s2 * t1;
    if (Math.abs(det) < 1e-20) continue;
    const r = 1 / det;
    // dP/du and dP/dv
    const tx = (t2 * x1 - t1 * x2) * r, ty = (t2 * y1 - t1 * y2) * r, tz = (t2 * z1 - t1 * z2) * r;
    const bx = (s1 * x2 - s2 * x1) * r, by = (s1 * y2 - s2 * y1) * r, bz = (s1 * z2 - s2 * z1) * r;
    for (const v of [i0, i1, i2]) {
      tan[v * 3] += tx;
      tan[v * 3 + 1] += ty;
      tan[v * 3 + 2] += tz;
      bit[v * 3] += bx;
      bit[v * 3 + 1] += by;
      bit[v * 3 + 2] += bz;
    }
  }
  const out = new Float32Array(vc * 4);
  for (let v = 0; v < vc; v++) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let tx = tan[v * 3], ty = tan[v * 3 + 1], tz = tan[v * 3 + 2];
    // Gram-Schmidt
    const d = nx * tx + ny * ty + nz * tz;
    tx -= nx * d;
    ty -= ny * d;
    tz -= nz * d;
    let l = Math.hypot(tx, ty, tz);
    if (l < 1e-12) {
      // degenerate UVs: any perpendicular
      const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
      tx = ay * nz - 0 * ny;
      ty = 0 * nx - ax * nz;
      tz = ax * ny - ay * nx;
      l = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= l;
    ty /= l;
    tz /= l;
    // bitangent we want = -dP/dv (image up); handedness relative to cross(N, T)
    const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
    const w = cx * -bit[v * 3] + cy * -bit[v * 3 + 1] + cz * -bit[v * 3 + 2] < 0 ? -1 : 1;
    out.set([tx, ty, tz, w], v * 4);
  }
  return out;
}

/** Fill in missing normals/tangents and sanity-check a mesh before use. */
export function prepareMesh(m: Mesh): Mesh {
  if (m.indices.length === 0 || m.indices.length % 3) throw new Error(`Mesh "${m.name}" has no triangles`);
  if (!m.uvs || m.uvs.length / 2 !== m.positions.length / 3)
    throw new Error(`Mesh "${m.name}" has no UVs. Unwrap it first (Blender: UV > Smart UV Project), then import again.`);
  const normals = m.normals && m.normals.length === m.positions.length ? m.normals : computeNormals(m.positions, m.indices);
  const out: Mesh = { ...m, normals };
  out.tangents = m.tangents && m.tangents.length === (m.positions.length / 3) * 4 ? m.tangents : computeTangents(out);
  return out;
}

export interface MeshPart {
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Concatenate parts into one mesh, keeping their triangle ranges as named parts. */
export function mergeParts(name: string, parts: MeshPart[]): Mesh {
  let vc = 0, ic = 0;
  for (const p of parts) {
    vc += p.positions.length / 3;
    ic += p.indices.length;
  }
  const positions = new Float32Array(vc * 3), normals = new Float32Array(vc * 3), uvs = new Float32Array(vc * 2), indices = new Uint32Array(ic);
  const ranges: Mesh["parts"] = [];
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo * 3);
    normals.set(p.normals, vo * 3);
    uvs.set(p.uvs, vo * 2);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo;
    ranges.push({ name: p.name, start: io / 3, count: p.indices.length / 3 });
    vo += p.positions.length / 3;
    io += p.indices.length;
  }
  return prepareMesh({ name, positions, normals, uvs, indices, parts: ranges });
}
