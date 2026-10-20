import { mergeParts, type Mesh, type MeshPart } from "./mesh.js";
import type { PrimitiveName } from "./types.js";

/** Atlas rectangle [u0, v0, u1, v1] in glTF UV space (v down). */
type Rect = [number, number, number, number];

const PAD = 0.012;
const inset = (r: Rect, p = PAD): Rect => [r[0] + p, r[1] + p, r[2] - p, r[3] - p];

/** Equal-arc-length samples of the rounded-square profile; returns cube coordinates in [-1, 1]. */
function profileSamples(round: number, n: number): number[] {
  const fine = 2048;
  const xs: number[] = [], acc: number[] = [0];
  const prof = (x: number): [number, number] => {
    const lim = 1 - round;
    const ix = Math.max(-lim, Math.min(lim, x));
    const dx = x - ix, dy = 1 - lim;
    const l = Math.hypot(dx, dy) || 1;
    return [ix + (round * dx) / l, lim + (round * dy) / l];
  };
  let prev = prof(-1);
  for (let i = 0; i <= fine; i++) {
    const x = -1 + (2 * i) / fine;
    xs.push(x);
    if (i) {
      const p = prof(x);
      acc.push(acc[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
      prev = p;
    }
  }
  const total = acc[fine];
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (total * k) / n;
    while (j < fine - 1 && acc[j + 1] < target) j++;
    const t = (target - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push(xs[j] + (xs[j + 1] - xs[j]) * t);
  }
  return out;
}

/**
 * Box with rounded edges (round = fillet radius relative to the smallest half extent; 1 with equal
 * extents gives a sphere). Six faces, each its own UV island laid out 3x2 inside `rect`.
 */
function roundedBox(name: string, half: [number, number, number], round: number, n: number, rect: Rect): MeshPart {
  const part: MeshPart = { name, positions: [], normals: [], uvs: [], indices: [] };
  const s = profileSamples(round, n);
  // face: axis index, sign, u axis, v axis (v axis points "down" in the image)
  const faces: [number, number, number, number, number, number][] = [
    [0, 1, 2, -1, 1, -1], // +X: u along -z, v along -y
    [0, -1, 2, 1, 1, -1], // -X
    [1, 1, 0, 1, 2, 1], // +Y: u along +x, v along +z
    [1, -1, 0, 1, 2, -1], // -Y
    [2, 1, 0, 1, 1, -1], // +Z
    [2, -1, 0, -1, 1, -1], // -Z
  ];
  const cw = (rect[2] - rect[0]) / 3, ch = (rect[3] - rect[1]) / 2;
  const minHalf = Math.min(...half);
  const r = round * minHalf;
  faces.forEach(([ax, sg, ua, us, va, vs], f) => {
    const cell = inset([rect[0] + (f % 3) * cw, rect[1] + Math.floor(f / 3) * ch, rect[0] + (f % 3 + 1) * cw, rect[1] + (Math.floor(f / 3) + 1) * ch]);
    const base = part.positions.length / 3;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const q = [0, 0, 0];
        q[ax] = sg;
        q[ua] = s[i] * us;
        q[va] = s[j] * vs;
        // point on the box surface, then pull corners onto the fillet
        const box = [q[0] * half[0], q[1] * half[1], q[2] * half[2]];
        const inner = box.map((v, k) => Math.max(-(half[k] - r), Math.min(half[k] - r, v)));
        const d = [box[0] - inner[0], box[1] - inner[1], box[2] - inner[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        const nrm = l > 1e-9 ? d.map((v) => v / l) : [0, 0, 0].map((_, k) => (k === ax ? sg : 0));
        const pos = l > 1e-9 ? inner.map((v, k) => v + nrm[k] * r) : box;
        part.positions.push(pos[0], pos[1], pos[2]);
        part.normals.push(nrm[0], nrm[1], nrm[2]);
        part.uvs.push(cell[0] + ((cell[2] - cell[0]) * i) / n, cell[1] + ((cell[3] - cell[1]) * j) / n);
      }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        // winding: make the triangle normal agree with the face normal
        part.indices.push(a, c, b, b, c, d);
      }
    fixWinding(part, base);
  });
  return part;
}

/** Flip triangles (from vertex `fromVertex` on) whose geometric normal disagrees with the vertex normals. */
function fixWinding(part: MeshPart, fromVertex: number) {
  const P = part.positions, N = part.normals, I = part.indices;
  for (let t = 0; t < I.length; t += 3) {
    if (I[t] < fromVertex) continue;
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nn = [N[a * 3] + N[b * 3] + N[c * 3], N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]];
    if (g[0] * nn[0] + g[1] * nn[1] + g[2] * nn[2] < 0) {
      I[t + 1] = c;
      I[t + 2] = b;
    }
  }
}

interface ProfilePoint {
  r: number;
  y: number;
}

/**
 * Surface of revolution around +Y. `profile` runs from one end to the other; normals come from the
 * profile tangent. u = angle, v = arc length along the profile, both inside `rect`.
 */
function revolve(name: string, profile: ProfilePoint[], segments: number, rect: Rect, smoothAngle = 50): MeshPart {
  const part: MeshPart = { name, positions: [], normals: [], uvs: [], indices: [] };
  const len: number[] = [0];
  for (let i = 1; i < profile.length; i++) len.push(len[i - 1] + Math.hypot(profile[i].r - profile[i - 1].r, profile[i].y - profile[i - 1].y));
  const total = len[len.length - 1] || 1;
  // 2D normals per profile vertex (split at sharp corners by duplicating rows)
  const rows: { r: number; y: number; nr: number; ny: number; v: number }[] = [];
  const segN = (i: number) => {
    const a = profile[i], b = profile[i + 1];
    const dr = b.r - a.r, dy = b.y - a.y;
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  };
  for (let i = 0; i < profile.length; i++) {
    const prev = i > 0 ? segN(i - 1) : null;
    const next = i < profile.length - 1 ? segN(i) : null;
    const v = len[i] / total;
    if (prev && next) {
      const cos = prev[0] * next[0] + prev[1] * next[1];
      if (cos < Math.cos((smoothAngle * Math.PI) / 180)) {
        rows.push({ ...profile[i], nr: prev[0], ny: prev[1], v });
        rows.push({ ...profile[i], nr: next[0], ny: next[1], v });
        continue;
      }
      const nr = prev[0] + next[0], ny = prev[1] + next[1], l = Math.hypot(nr, ny) || 1;
      rows.push({ ...profile[i], nr: nr / l, ny: ny / l, v });
    } else {
      const s = (prev ?? next)!;
      rows.push({ ...profile[i], nr: s[0], ny: s[1], v });
    }
  }
  const cell = inset(rect);
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const row = rows[j];
      part.positions.push(row.r * c, row.y, row.r * s);
      part.normals.push(row.nr * c, row.ny, row.nr * s);
      part.uvs.push(cell[0] + ((cell[2] - cell[0]) * i) / segments, cell[1] + (cell[3] - cell[1]) * row.v);
    }
  for (let j = 0; j < rows.length - 1; j++) {
    if (rows[j].r === rows[j + 1].r && rows[j].y === rows[j + 1].y) continue; // split row, no faces between
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      part.indices.push(a, b, c, b, d, c);
    }
  }
  fixWinding(part, 0);
  return part;
}

/** Flat disc cap (planar UVs inside rect). */
function disc(name: string, radius: number, y: number, up: boolean, segments: number, rect: Rect): MeshPart {
  const part: MeshPart = { name, positions: [0, y, 0], normals: [0, up ? 1 : -1, 0], uvs: [], indices: [] };
  const cell = inset(rect);
  const cu = (cell[0] + cell[2]) / 2, cv = (cell[1] + cell[3]) / 2, hu = (cell[2] - cell[0]) / 2, hv = (cell[3] - cell[1]) / 2;
  part.uvs.push(cu, cv);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    part.positions.push(radius * Math.cos(a), y, radius * Math.sin(a));
    part.normals.push(0, up ? 1 : -1, 0);
    part.uvs.push(cu + Math.cos(a) * hu, cv + Math.sin(a) * hv * (up ? 1 : -1));
  }
  for (let i = 1; i <= segments; i++) part.indices.push(0, i, i + 1);
  fixWinding(part, 0);
  return part;
}

function arc(cr: number, cy: number, rad: number, a0: number, a1: number, steps: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ r: cr + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  return out;
}

/** Cylinder side with rounded rims (profile runs bottom cap edge -> top cap edge). */
function bevelCylinderProfile(radius: number, y0: number, y1: number, bevel: number, steps = 6): ProfilePoint[] {
  return [
    ...arc(radius - bevel, y0 + bevel, bevel, -Math.PI / 2, 0, steps),
    ...arc(radius - bevel, y1 - bevel, bevel, 0, Math.PI / 2, steps),
  ];
}

function torus(name: string, R: number, r: number, seg: number, tube: number, rect: Rect, tiltDeg = 0): MeshPart {
  const part: MeshPart = { name, positions: [], normals: [], uvs: [], indices: [] };
  const cell = inset(rect);
  const t = (tiltDeg * Math.PI) / 180, ct = Math.cos(t), st = Math.sin(t);
  const rot = (x: number, y: number, z: number): [number, number, number] => [x, y * ct - z * st, y * st + z * ct];
  for (let j = 0; j <= tube; j++)
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * Math.PI * 2, v = (j / tube) * Math.PI * 2;
      const nx = Math.cos(v) * Math.cos(u), ny = Math.sin(v), nz = Math.cos(v) * Math.sin(u);
      const p = rot((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
      const n = rot(nx, ny, nz);
      part.positions.push(...p);
      part.normals.push(...n);
      part.uvs.push(cell[0] + ((cell[2] - cell[0]) * i) / seg, cell[1] + ((cell[3] - cell[1]) * j) / tube);
    }
  for (let j = 0; j < tube; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      part.indices.push(a, c, b, b, c, d);
    }
  fixWinding(part, 0);
  return part;
}

function plane(name: string, size: number, n: number, rect: Rect): MeshPart {
  const part: MeshPart = { name, positions: [], normals: [], uvs: [], indices: [] };
  const cell = inset(rect);
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      part.positions.push((i / n - 0.5) * size, 0, (j / n - 0.5) * size);
      part.normals.push(0, 1, 0);
      part.uvs.push(cell[0] + ((cell[2] - cell[0]) * i) / n, cell[1] + ((cell[3] - cell[1]) * j) / n);
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      part.indices.push(a, c, b, b, c, d);
    }
  fixWinding(part, 0);
  return part;
}

function translate(part: MeshPart, dx: number, dy: number, dz: number): MeshPart {
  for (let i = 0; i < part.positions.length; i += 3) {
    part.positions[i] += dx;
    part.positions[i + 1] += dy;
    part.positions[i + 2] += dz;
  }
  return part;
}

export const PRIMITIVES: { name: PrimitiveName; title: string; description: string }[] = [
  { name: "orb", title: "Material orb", description: "Sphere on a bevelled pedestal with a tilted ring: shows edges, cavities and curvature at once" },
  { name: "roundedCube", title: "Rounded cube", description: "Cube with soft fillets, the classic edge-wear test" },
  { name: "sphere", title: "Sphere", description: "Cube-mapped sphere, even texel density" },
  { name: "cylinder", title: "Cylinder", description: "Cylinder with bevelled rims" },
  { name: "torus", title: "Torus", description: "Donut" },
  { name: "capsule", title: "Capsule", description: "Pill shape" },
  { name: "plane", title: "Plane", description: "Flat square, good for tiling material tests" },
];

/** Built-in meshes with clean UVs. `segments` scales tessellation (default 32). */
export function createPrimitive(name: PrimitiveName, segments = 32): Mesh {
  const n = Math.max(8, Math.min(128, Math.round(segments)));
  switch (name) {
    case "roundedCube":
      return mergeParts("Rounded cube", [roundedBox("cube", [0.8, 0.8, 0.8], 0.16, n, [0, 0, 1, 1])]);
    case "sphere":
      return mergeParts("Sphere", [roundedBox("sphere", [0.9, 0.9, 0.9], 1, n, [0, 0, 1, 1])]);
    case "cylinder": {
      const prof = bevelCylinderProfile(0.6, -0.8, 0.8, 0.08);
      return mergeParts("Cylinder", [
        revolve("side", prof, n * 2, [0, 0, 1, 0.6]),
        disc("top", 0.52, 0.8, true, n * 2, [0, 0.6, 0.5, 1]),
        disc("bottom", 0.52, -0.8, false, n * 2, [0.5, 0.6, 1, 1]),
      ]);
    }
    case "torus":
      return mergeParts("Torus", [torus("torus", 0.7, 0.28, n * 2, n, [0, 0, 1, 1])]);
    case "capsule": {
      const prof = [...arc(0, -0.45, 0.45, -Math.PI / 2, 0, Math.round(n / 2)), ...arc(0, 0.45, 0.45, 0, Math.PI / 2, Math.round(n / 2))];
      return mergeParts("Capsule", [revolve("capsule", prof, n * 2, [0, 0, 1, 1], 80)]);
    }
    case "plane":
      return mergeParts("Plane", [plane("plane", 2, n, [0, 0, 1, 1])]);
    case "orb":
    default: {
      const ped = bevelCylinderProfile(0.62, -1.0, -0.72, 0.06);
      return mergeParts("Material orb", [
        translate(roundedBox("orb", [0.62, 0.62, 0.62], 1, n, [0, 0, 1, 0.62]), 0, -0.1, 0),
        revolve("pedestal", ped, n * 2, [0, 0.62, 0.62, 0.8]),
        disc("pedestal top", 0.56, -0.72, true, n * 2, [0.62, 0.62, 0.81, 0.8]),
        disc("pedestal base", 0.56, -1.0, false, n * 2, [0.81, 0.62, 1, 0.8]),
        translate(torus("ring", 0.8, 0.05, n * 3, Math.max(8, Math.round(n / 3)), [0, 0.8, 1, 1], 18), 0, -0.1, 0),
      ]);
    }
  }
}
