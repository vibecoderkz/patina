import {
  createDocument,
  createPrimitive,
  instantiate,
  instantiateMask,
  maskPreset,
  materialPreset,
  meshBounds,
  namedCamera,
  renderView,
  smartMaterial,
  TextureEngine,
  PATINA_VERSION,
  type Layer,
  type Mesh,
  type PatinaDocument,
  type PrimitiveName,
} from "@patina/core";

/**
 * Shelf thumbnails are rendered by Patina itself (same engine and CPU renderer as the CLI), one at
 * a time in idle moments, and cached in localStorage.
 */
export type ThumbKind = "material" | "smart" | "mask" | "primitive";

const CACHE = `patina.thumb.${PATINA_VERSION}.v3`;
const meshes = new Map<string, Mesh>();
const mesh = (p: PrimitiveName) => {
  let m = meshes.get(p);
  if (!m) meshes.set(p, (m = createPrimitive(p, 24)));
  return m;
};

function docFor(kind: ThumbKind, id: string): { doc: PatinaDocument; mesh: Mesh } {
  let n = 1;
  const alloc = (p: "L" | "E") => `${p}${n++}`;
  const base = createDocument({ resolution: 256 });
  base.bake = { ...base.bake, resolution: 256, aoSamples: 16 };
  let layers: Layer[] = [];
  let m = mesh("roundedCube");
  if (kind === "material") {
    m = mesh("sphere");
    layers = instantiate([{ type: "fill", name: id, material: materialPreset(id).material }], alloc);
  } else if (kind === "smart") layers = instantiate(smartMaterial(id).layers, alloc);
  else if (kind === "mask") {
    const p = maskPreset(id);
    base.base = { ...base.base, baseColor: "#1b1b1e", roughness: 0.6 };
    layers = instantiate([{ type: "fill", name: "mask", material: { baseColor: "#ff3b2e", roughness: 0.45 } }], alloc);
    layers[0].mask = instantiateMask({ base: p.base, effects: p.effects }, alloc);
  } else {
    m = mesh(id as PrimitiveName);
    base.base = { ...base.base, baseColor: "#c9c8c3", roughness: 0.45 };
  }
  return { doc: { ...base, layers, nextId: n }, mesh: m };
}

function render(kind: ThumbKind, id: string, w: number, h: number): string {
  const { doc, mesh: m } = docFor(kind, id);
  const eng = new TextureEngine(m, 256);
  eng.sync(doc);
  const cam = namedCamera("iso", meshBounds(m), 30, kind === "material" ? 1.1 : 1.05);
  const img = renderView(m, eng.textures(), cam, { width: w, height: h, environment: "studio", exposure: 0, rotation: 0, background: null, ssaa: 2 });
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c.toDataURL("image/png");
}

let cache: Record<string, string> = {};
try {
  cache = JSON.parse(localStorage.getItem(CACHE) ?? "{}");
} catch {
  cache = {};
}

const queue: { key: string; kind: ThumbKind; id: string }[] = [];
const listeners = new Set<() => void>();
let running = false;

export function thumb(kind: ThumbKind, id: string): string | null {
  const key = `${kind}:${id}`;
  if (cache[key]) return cache[key];
  if (!queue.some((q) => q.key === key)) queue.push({ key, kind, id });
  pump();
  return null;
}

export function onThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function pump() {
  if (running || !queue.length) return;
  running = true;
  const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 400 }) : setTimeout(cb, 30));
  idle(() => {
    const job = queue.shift()!;
    try {
      cache[job.key] = render(job.kind, job.id, 184, 156);
      try {
        localStorage.setItem(CACHE, JSON.stringify(cache));
      } catch {
        /* cache is best effort */
      }
    } catch (e) {
      console.warn("thumbnail", job.key, e);
    }
    running = false;
    for (const l of listeners) l();
    pump();
  });
}
