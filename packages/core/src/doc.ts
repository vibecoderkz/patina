import { DEFAULT_BRUSH } from "./brush.js";
import { DEFAULT_GENERATOR } from "./generators.js";
import type { BakeSettings, FolderLayer, Layer, MeshRef, PaintMaterial, PatinaDocument, ViewSettings } from "./types.js";

export const DEFAULT_BASE: Required<PaintMaterial> = { baseColor: "#8c8c8c", metallic: 0, roughness: 0.5, height: 0, emissive: "#000000" };
export const DEFAULT_BAKE: BakeSettings = { curvatureRadius: 0.035, aoSamples: 24, aoDistance: 0.25, resolution: 512 };
export const DEFAULT_VIEW: ViewSettings = { environment: "studio", exposure: 0, rotation: 0, background: "#e9e8e4" };
export const RESOLUTIONS = [256, 512, 1024, 2048, 4096] as const;

export function createDocument(opts: { name?: string; mesh?: MeshRef; resolution?: number } = {}): PatinaDocument {
  return {
    format: "patina",
    version: 1,
    name: opts.name ?? "Untitled",
    mesh: opts.mesh ?? { source: "primitive", primitive: "orb" },
    resolution: opts.resolution ?? 1024,
    normalStrength: 1,
    base: { ...DEFAULT_BASE },
    layers: [],
    bake: { ...DEFAULT_BAKE },
    view: { ...DEFAULT_VIEW },
    nextId: 1,
  };
}

/** Fill defaults for documents written by older or hand-made files, and validate the basics. */
export function normalizeDocument(raw: unknown): PatinaDocument {
  const d = raw as Partial<PatinaDocument>;
  if (!d || typeof d !== "object" || d.format !== "patina") throw new Error('Not a Patina document (expected "format": "patina")');
  const base = createDocument();
  return {
    ...base,
    ...d,
    base: { ...base.base, ...d.base },
    bake: { ...base.bake, ...d.bake },
    view: { ...base.view, ...d.view },
    layers: d.layers ?? [],
    nextId: d.nextId ?? maxId(d.layers ?? []) + 1,
  } as PatinaDocument;
}

function maxId(layers: Layer[]): number {
  let m = 0;
  walk(layers, (l) => {
    m = Math.max(m, parseInt(l.id.replace(/\D/g, ""), 10) || 0);
    for (const e of l.mask?.effects ?? []) m = Math.max(m, parseInt(e.id.replace(/\D/g, ""), 10) || 0);
  });
  return m;
}

export function walk(layers: Layer[], fn: (l: Layer, parent: FolderLayer | null, depth: number) => void, parent: FolderLayer | null = null, depth = 0) {
  for (const l of layers) {
    fn(l, parent, depth);
    if (l.type === "folder") walk(l.children, fn, l, depth + 1);
  }
}

export function findLayer(layers: Layer[], id: string): { layer: Layer; parent: FolderLayer | null; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { layer: l, parent: null, index: i };
    if (l.type === "folder") {
      const f = findLayer(l.children, id);
      if (f) return { ...f, parent: f.parent ?? l };
    }
  }
  return null;
}

export function requireLayer(doc: PatinaDocument, id: string): Layer {
  const f = findLayer(doc.layers, id);
  if (!f) {
    const ids: string[] = [];
    walk(doc.layers, (l) => ids.push(`${l.id} (${l.name})`));
    throw new Error(`No layer "${id}". Layers: ${ids.join(", ") || "none, add one with layer.add"}`);
  }
  return f.layer;
}

/** Replace one layer (path-copying its folders); everything else keeps its identity. */
export function updateLayer(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  let hit = false;
  const rec = (ls: Layer[]): Layer[] => {
    let changed = false;
    const out = ls.map((l) => {
      if (l.id === id) {
        hit = changed = true;
        return fn(l);
      }
      if (l.type === "folder") {
        const c = rec(l.children);
        if (c !== l.children) {
          changed = true;
          return { ...l, children: c };
        }
      }
      return l;
    });
    return changed ? out : ls;
  };
  const r = rec(layers);
  if (!hit) throw new Error(`No layer "${id}"`);
  return r;
}

export function removeLayer(layers: Layer[], id: string): { layers: Layer[]; removed: Layer } {
  let removed: Layer | null = null;
  const rec = (ls: Layer[]): Layer[] => {
    const i = ls.findIndex((l) => l.id === id);
    if (i >= 0) {
      removed = ls[i];
      return [...ls.slice(0, i), ...ls.slice(i + 1)];
    }
    let changed = false;
    const out = ls.map((l) => {
      if (l.type !== "folder") return l;
      const c = rec(l.children);
      if (c === l.children) return l;
      changed = true;
      return { ...l, children: c };
    });
    return changed ? out : ls;
  };
  const r = rec(layers);
  if (!removed) throw new Error(`No layer "${id}"`);
  return { layers: r, removed };
}

/** Insert into a folder (or the root when parent is null). index counts bottom to top; default = top. */
export function insertLayer(layers: Layer[], parent: string | null, index: number | undefined, layer: Layer): Layer[] {
  const put = (ls: Layer[]) => {
    const i = index === undefined ? ls.length : Math.max(0, Math.min(ls.length, index));
    return [...ls.slice(0, i), layer, ...ls.slice(i)];
  };
  if (!parent) return put(layers);
  return updateLayer(layers, parent, (f) => {
    if (f.type !== "folder") throw new Error(`Layer "${parent}" is a ${f.type} layer, not a folder`);
    return { ...f, children: put(f.children) };
  });
}

export function nextId(doc: PatinaDocument, prefix: "L" | "E"): { id: string; doc: PatinaDocument } {
  return { id: `${prefix}${doc.nextId}`, doc: { ...doc, nextId: doc.nextId + 1 } };
}

export const defaults = { brush: DEFAULT_BRUSH, generator: DEFAULT_GENERATOR };
