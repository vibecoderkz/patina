import { mat4FromTRS, mat4Identity, mat4Multiply, normalMatrixApply, transformPoint, type Mat4 } from "./math.js";
import { prepareMesh, type Mesh } from "./mesh.js";

/** Wavefront OBJ (v, vt, vn, f; polygons are fan-triangulated; o/g become parts). V is flipped to glTF convention. */
export function parseObj(text: string, name = "mesh"): Mesh {
  const v: number[] = [], vt: number[] = [], vn: number[] = [];
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const map = new Map<string, number>();
  const parts: { name: string; start: number; count: number }[] = [];
  let part = { name: "default", start: 0, count: 0 };
  let hasNormals = true;
  const lines = text.split(/\r?\n/);
  const idx = (s: string, len: number) => {
    const n = parseInt(s, 10);
    return n < 0 ? len + n : n - 1;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const t = line.split(/\s+/);
    switch (t[0]) {
      case "v":
        v.push(+t[1], +t[2], +t[3]);
        break;
      case "vt":
        vt.push(+t[1], 1 - +(t[2] ?? 0));
        break;
      case "vn":
        vn.push(+t[1], +t[2], +t[3]);
        break;
      case "o":
      case "g":
        if (part.count) parts.push(part);
        part = { name: t.slice(1).join(" ") || "part", start: indices.length / 3, count: 0 };
        break;
      case "f": {
        const corners = t.slice(1).map((c) => {
          let k = map.get(c);
          if (k !== undefined) return k;
          const [pi, ti, ni] = c.split("/");
          const p = idx(pi, v.length / 3);
          positions.push(v[p * 3], v[p * 3 + 1], v[p * 3 + 2]);
          if (ti) {
            const q = idx(ti, vt.length / 2);
            uvs.push(vt[q * 2], vt[q * 2 + 1]);
          } else uvs.push(NaN, NaN);
          if (ni) {
            const q = idx(ni, vn.length / 3);
            normals.push(vn[q * 3], vn[q * 3 + 1], vn[q * 3 + 2]);
          } else {
            normals.push(0, 0, 0);
            hasNormals = false;
          }
          k = positions.length / 3 - 1;
          map.set(c, k);
          return k;
        });
        for (let i = 1; i + 1 < corners.length; i++) {
          indices.push(corners[0], corners[i], corners[i + 1]);
          part.count++;
        }
        break;
      }
    }
  }
  if (part.count) parts.push(part);
  if (uvs.some((x) => Number.isNaN(x))) throw new Error(`${name}: some faces have no UVs. Unwrap the mesh (Blender: UV > Smart UV Project) and export again.`);
  return prepareMesh({
    name,
    positions: Float32Array.from(positions),
    normals: hasNormals ? Float32Array.from(normals) : new Float32Array(0),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    parts: parts.length > 1 ? parts : undefined,
  });
}

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; name?: string }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  extensionsRequired?: string[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf: GltfJson, buffers: Uint8Array[], index: number): Float64Array {
  const acc = gltf.accessors![index];
  const n = COMPONENTS[acc.type];
  const out = new Float64Array(acc.count * n);
  if (acc.bufferView === undefined) return out;
  const bv = gltf.bufferViews![acc.bufferView];
  const buf = buffers[bv.buffer];
  const dv = new DataView(buf.buffer, buf.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0));
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]!;
  const stride = bv.byteStride || size * n;
  for (let i = 0; i < acc.count; i++)
    for (let c = 0; c < n; c++) {
      const o = i * stride + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); if (acc.normalized) v /= 65535; break;
        case 5122: v = dv.getInt16(o, true); if (acc.normalized) v = Math.max(v / 32767, -1); break;
        case 5121: v = dv.getUint8(o); if (acc.normalized) v /= 255; break;
        default: v = dv.getInt8(o); if (acc.normalized) v = Math.max(v / 127, -1);
      }
      out[i * n + c] = v;
    }
  return out;
}

function decodeDataUri(uri: string): Uint8Array {
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** glTF 2.0 (JSON + buffers). `resolve` loads external buffer URIs (relative to the .gltf). */
export function parseGltf(gltf: GltfJson, binChunk: Uint8Array | null, resolve: (uri: string) => Uint8Array, name = "mesh"): Mesh {
  const unsupported = (gltf.extensionsRequired ?? []).filter((e) => e !== "KHR_mesh_quantization" && e !== "KHR_materials_variants" && !e.startsWith("KHR_texture") && !e.startsWith("KHR_materials"));
  if (unsupported.length) throw new Error(`${name}: compressed geometry is not supported (${unsupported.join(", ")}). Re-export without Draco/meshopt compression.`);
  const buffers = (gltf.buffers ?? []).map((b, i) => (b.uri === undefined ? (i === 0 && binChunk ? binChunk : new Uint8Array(b.byteLength)) : b.uri.startsWith("data:") ? decodeDataUri(b.uri) : resolve(b.uri)));
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const parts: { name: string; start: number; count: number }[] = [];
  let missingUv = false, missingNormals = false;
  const visit = (ni: number, parent: Mat4) => {
    const node = gltf.nodes![ni];
    const local = node.matrix ? Float64Array.from(node.matrix) : mat4FromTRS(node.translation, node.rotation, node.scale);
    const world = mat4Multiply(parent, local);
    if (node.mesh !== undefined) {
      const m = gltf.meshes![node.mesh];
      m.primitives.forEach((prim, pi) => {
        if ((prim.mode ?? 4) !== 4) return;
        const base = positions.length / 3;
        const P = readAccessor(gltf, buffers, prim.attributes.POSITION);
        const count = P.length / 3;
        for (let i = 0; i < count; i++) positions.push(...transformPoint(world, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        if (prim.attributes.NORMAL !== undefined) {
          const Nn = readAccessor(gltf, buffers, prim.attributes.NORMAL);
          for (let i = 0; i < count; i++) normals.push(...normalMatrixApply(world, Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]));
        } else {
          missingNormals = true;
          for (let i = 0; i < count; i++) normals.push(0, 0, 0);
        }
        if (prim.attributes.TEXCOORD_0 !== undefined) uvs.push(...readAccessor(gltf, buffers, prim.attributes.TEXCOORD_0));
        else {
          missingUv = true;
          for (let i = 0; i < count; i++) uvs.push(0, 0);
        }
        const start = indices.length / 3;
        if (prim.indices !== undefined) for (const i of readAccessor(gltf, buffers, prim.indices)) indices.push(base + i);
        else for (let i = 0; i < count; i++) indices.push(base + i);
        // mirrored transforms flip winding
        const det = world[0] * (world[5] * world[10] - world[6] * world[9]) - world[4] * (world[1] * world[10] - world[2] * world[9]) + world[8] * (world[1] * world[6] - world[2] * world[5]);
        if (det < 0) for (let t = start * 3; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
        parts.push({ name: node.name ?? m.name ?? `mesh ${node.mesh}.${pi}`, start, count: indices.length / 3 - start });
      });
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? (gltf.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, mat4Identity());
  if (!indices.length) throw new Error(`${name}: no triangle meshes found`);
  if (missingUv) throw new Error(`${name}: some meshes have no UVs (TEXCOORD_0). Unwrap them first (Blender: UV > Smart UV Project).`);
  return prepareMesh({
    name,
    positions: Float32Array.from(positions),
    normals: missingNormals ? new Float32Array(0) : Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    parts: parts.length > 1 ? parts : undefined,
  });
}

export function parseGlb(bytes: Uint8Array, name = "mesh"): Mesh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${name}: not a .glb file`);
  let o = 12;
  let json: GltfJson | null = null, bin: Uint8Array | null = null;
  while (o + 8 <= bytes.length) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    const chunk = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json) throw new Error(`${name}: .glb has no JSON chunk`);
  return parseGltf(json, bin, () => {
    throw new Error(`${name}: external buffers inside a .glb are not supported`);
  }, name);
}

/** Pick a parser by file extension. `readSibling` loads files next to a .gltf. */
export function parseMeshFile(fileName: string, bytes: Uint8Array, readSibling: (rel: string) => Uint8Array = () => {
  throw new Error("External .gltf buffers need file access");
}): Mesh {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "obj") return parseObj(new TextDecoder().decode(bytes), base);
  if (ext === "glb") return parseGlb(bytes, base);
  if (ext === "gltf") return parseGltf(JSON.parse(new TextDecoder().decode(bytes)), null, readSibling, base);
  throw new Error(`Unsupported mesh format ".${ext}". Use .glb, .gltf or .obj (FBX: convert with Blender, File > Export > glTF).`);
}
