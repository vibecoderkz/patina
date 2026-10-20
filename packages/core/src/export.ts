import { applyDilation, dilationMap } from "./bake.js";
import type { TextureEngine } from "./engine.js";
import { encodePng, type Deflate, type PixelBuffer } from "./image.js";
import { clamp } from "./math.js";
import type { Mesh } from "./mesh.js";
import { PATINA_VERSION, PRODUCT_NAME } from "./version.js";

/** Where a packed texture channel comes from. */
export type ChannelSource =
  | "baseColor.r" | "baseColor.g" | "baseColor.b"
  | "emissive.r" | "emissive.g" | "emissive.b"
  | "normal.r" | "normal.g" | "normal.b" | "normalDX.g"
  | "metallic" | "roughness" | "smoothness" | "ao" | "height" | "curvature"
  | "one" | "zero";

export interface ExportMap {
  /** File name suffix: <name>_<suffix>.png */
  suffix: string;
  channels: ChannelSource[];
  bits: 8 | 16;
}

export interface ExportPreset {
  id: string;
  title: string;
  description: string;
  maps: ExportMap[];
}

const RGB = (c: "baseColor" | "emissive" | "normal"): ChannelSource[] => [`${c}.r`, `${c}.g`, `${c}.b`] as ChannelSource[];

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "gltf",
    title: "glTF PBR Metal/Roughness",
    description: "glTF 2.0, three.js, Babylon, Blender glTF importer, model-viewer. ORM packs occlusion, roughness, metallic. OpenGL normal.",
    maps: [
      { suffix: "BaseColor", channels: RGB("baseColor"), bits: 8 },
      { suffix: "OcclusionRoughnessMetallic", channels: ["ao", "roughness", "metallic"], bits: 8 },
      { suffix: "Normal", channels: RGB("normal"), bits: 8 },
      { suffix: "Emissive", channels: RGB("emissive"), bits: 8 },
    ],
  },
  {
    id: "unreal",
    title: "Unreal Engine (packed)",
    description: "BaseColor, OcclusionRoughnessMetallic (R=AO, G=roughness, B=metallic, import as linear / Masks), DirectX normal.",
    maps: [
      { suffix: "BaseColor", channels: RGB("baseColor"), bits: 8 },
      { suffix: "OcclusionRoughnessMetallic", channels: ["ao", "roughness", "metallic"], bits: 8 },
      { suffix: "Normal", channels: ["normal.r", "normalDX.g", "normal.b"], bits: 8 },
      { suffix: "Emissive", channels: RGB("emissive"), bits: 8 },
    ],
  },
  {
    id: "unityHdrp",
    title: "Unity HDRP",
    description: "BaseMap, MaskMap (R=metallic, G=AO, B=detail mask, A=smoothness), OpenGL normal, Emissive.",
    maps: [
      { suffix: "BaseMap", channels: [...RGB("baseColor"), "one"], bits: 8 },
      { suffix: "MaskMap", channels: ["metallic", "ao", "one", "smoothness"], bits: 8 },
      { suffix: "Normal", channels: RGB("normal"), bits: 8 },
      { suffix: "Emissive", channels: RGB("emissive"), bits: 8 },
    ],
  },
  {
    id: "unityUrp",
    title: "Unity URP / Built-in (metallic)",
    description: "Albedo, MetallicSmoothness (R=metallic, A=smoothness), OpenGL normal, Occlusion, Emission.",
    maps: [
      { suffix: "Albedo", channels: RGB("baseColor"), bits: 8 },
      { suffix: "MetallicSmoothness", channels: ["metallic", "zero", "zero", "smoothness"], bits: 8 },
      { suffix: "Normal", channels: RGB("normal"), bits: 8 },
      { suffix: "Occlusion", channels: ["ao"], bits: 8 },
      { suffix: "Emission", channels: RGB("emissive"), bits: 8 },
    ],
  },
  {
    id: "separate",
    title: "Separate maps (Blender, Cycles, generic)",
    description: "One file per channel. Height is 16-bit (0.5 = flat). OpenGL normal.",
    maps: [
      { suffix: "BaseColor", channels: RGB("baseColor"), bits: 8 },
      { suffix: "Metallic", channels: ["metallic"], bits: 8 },
      { suffix: "Roughness", channels: ["roughness"], bits: 8 },
      { suffix: "Normal", channels: RGB("normal"), bits: 8 },
      { suffix: "Height", channels: ["height"], bits: 16 },
      { suffix: "AO", channels: ["ao"], bits: 8 },
      { suffix: "Emissive", channels: RGB("emissive"), bits: 8 },
    ],
  },
];

export function exportPreset(id: string): ExportPreset {
  const p = EXPORT_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown export preset "${id}". Available: ${EXPORT_PRESETS.map((x) => x.id).join(", ")}`);
  return p;
}

/** Float views of every source, padded across the whole texture (no black seams in mipmaps). */
function paddedSources(engine: TextureEngine, padding: number) {
  const N = engine.N;
  const o = engine.out;
  const map = dilationMap(engine.res, engine.maps.covered, padding);
  const copy = (b: Float32Array | undefined, stride: number, fill: number) => {
    const c = b ? b.slice() : new Float32Array(N * stride).fill(fill);
    applyDilation(c, stride, map);
    return c;
  };
  return {
    baseColor: copy(o.baseColor, 3, 0),
    emissive: copy(o.emissive, 3, 0),
    normal: copy(o.normal, 3, 0),
    metallic: copy(o.metallic, 1, 0),
    roughness: copy(o.roughness, 1, 0.5),
    height: copy(o.height, 1, 0),
    ao: copy(engine.baked?.ao, 1, 1),
    curvature: copy(engine.baked?.curvature, 1, 0),
  };
}

/** Build the pixel buffers of a preset (pass `padding` 0 to dilate to the whole texture). */
export function buildExportMaps(engine: TextureEngine, preset: ExportPreset, padding = 0): { suffix: string; pixels: PixelBuffer }[] {
  const s = paddedSources(engine, padding);
  const N = engine.N, res = engine.res;
  // empty texels never touched by padding: give the normal map a flat value
  for (let i = 0; i < N; i++) if (s.normal[i * 3 + 2] === 0 && s.normal[i * 3] === 0 && s.normal[i * 3 + 1] === 0) s.normal[i * 3 + 2] = 1;
  const read = (src: ChannelSource, i: number): number => {
    switch (src) {
      case "baseColor.r": return s.baseColor[i * 3];
      case "baseColor.g": return s.baseColor[i * 3 + 1];
      case "baseColor.b": return s.baseColor[i * 3 + 2];
      case "emissive.r": return s.emissive[i * 3];
      case "emissive.g": return s.emissive[i * 3 + 1];
      case "emissive.b": return s.emissive[i * 3 + 2];
      case "normal.r": return s.normal[i * 3] * 0.5 + 0.5;
      case "normal.g": return s.normal[i * 3 + 1] * 0.5 + 0.5;
      case "normalDX.g": return -s.normal[i * 3 + 1] * 0.5 + 0.5;
      case "normal.b": return s.normal[i * 3 + 2] * 0.5 + 0.5;
      case "metallic": return s.metallic[i];
      case "roughness": return s.roughness[i];
      case "smoothness": return 1 - s.roughness[i];
      case "ao": return s.ao[i];
      case "height": return s.height[i] * 0.5 + 0.5;
      case "curvature": return s.curvature[i] * 0.5 + 0.5;
      case "one": return 1;
      default: return 0;
    }
  };
  return preset.maps.map((m) => {
    const ch = m.channels.length as 1 | 3 | 4;
    const max = m.bits === 16 ? 65535 : 255;
    const data = m.bits === 16 ? new Uint16Array(N * ch) : new Uint8Array(N * ch);
    for (let i = 0; i < N; i++) for (let c = 0; c < ch; c++) data[i * ch + c] = Math.round(clamp(read(m.channels[c], i)) * max);
    return { suffix: m.suffix, pixels: { width: res, height: res, channels: ch, bits: m.bits, data } };
  });
}

export async function exportTextures(engine: TextureEngine, presetId: string, name: string, deflate: Deflate, padding = 0): Promise<{ file: string; bytes: Uint8Array }[]> {
  const preset = exportPreset(presetId);
  const maps = buildExportMaps(engine, preset, padding);
  const out: { file: string; bytes: Uint8Array }[] = [];
  for (const m of maps) out.push({ file: `${safeName(name)}_${m.suffix}.png`, bytes: await encodePng(m.pixels, deflate) });
  return out;
}

export const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "patina";

/** A self-contained .glb: the mesh with its textures (glTF preset maps) embedded. */
export async function exportGlb(engine: TextureEngine, name: string, deflate: Deflate): Promise<Uint8Array> {
  const mesh = engine.mesh;
  const maps = buildExportMaps(engine, exportPreset("gltf"), 0);
  const pngs = await Promise.all(maps.map((m) => encodePng(m.pixels, deflate)));
  const hasEmissive = engine.out.emissive.some((v) => v > 0.002);
  return writeGlb(mesh, name, { baseColor: pngs[0], orm: pngs[1], normal: pngs[2], emissive: hasEmissive ? pngs[3] : null });
}

export function writeGlb(mesh: Mesh, name: string, tex: { baseColor: Uint8Array; orm: Uint8Array; normal: Uint8Array; emissive: Uint8Array | null }): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const views: Record<string, unknown>[] = [];
  const add = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    offset += bytes.byteLength;
    return views.length - 1;
  };
  const f32 = (a: Float32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const vc = mesh.positions.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vc; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i * 3 + k]);
      max[k] = Math.max(max[k], mesh.positions[i * 3 + k]);
    }
  min = min.map((v) => Math.fround(v));
  max = max.map((v) => Math.fround(v));
  const vPos = add(f32(mesh.positions), 34962), vNrm = add(f32(mesh.normals), 34962), vUv = add(f32(mesh.uvs), 34962);
  const vTan = mesh.tangents ? add(f32(mesh.tangents), 34962) : -1;
  const vIdx = add(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), 34963);
  const imgViews = [tex.baseColor, tex.orm, tex.normal, ...(tex.emissive ? [tex.emissive] : [])].map((b) => add(b));
  const accessors: Record<string, unknown>[] = [
    { bufferView: vPos, componentType: 5126, count: vc, type: "VEC3", min, max },
    { bufferView: vNrm, componentType: 5126, count: vc, type: "VEC3" },
    { bufferView: vUv, componentType: 5126, count: vc, type: "VEC2" },
    { bufferView: vIdx, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
  ];
  const attributes: Record<string, number> = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 };
  if (vTan >= 0) {
    accessors.push({ bufferView: vTan, componentType: 5126, count: vc, type: "VEC4" });
    attributes.TANGENT = 4;
  }
  const images = imgViews.map((bv) => ({ bufferView: bv, mimeType: "image/png" }));
  const json = {
    asset: { version: "2.0", generator: `${PRODUCT_NAME} ${PATINA_VERSION} (https://dias.now)` },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes, indices: 3, material: 0, mode: 4 }] }],
    materials: [
      {
        name,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 }, metallicFactor: 1, roughnessFactor: 1 },
        occlusionTexture: { index: 1 },
        normalTexture: { index: 2 },
        ...(tex.emissive ? { emissiveTexture: { index: 3 }, emissiveFactor: [1, 1, 1] } : {}),
      },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images,
    textures: images.map((_, i) => ({ source: i, sampler: 0 })),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: 0 }],
  };
  const binLen = offset + ((4 - (offset % 4)) % 4);
  json.buffers[0].byteLength = binLen;
  const bin = new Uint8Array(binLen);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const p = new Uint8Array(jsonBytes.length + jpad);
    p.set(jsonBytes);
    p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.length, bin.length, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.length);
  return out;
}
