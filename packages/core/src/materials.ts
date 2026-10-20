import { DEFAULT_GENERATOR } from "./generators.js";
import { DEFAULT_NOISE } from "./noise.js";
import type { BlendMode, ChannelId, Generator, Layer, Mask, MaskEffect, Material, NoiseSpec } from "./types.js";

const noise = (p: Partial<NoiseSpec>): NoiseSpec => ({ ...DEFAULT_NOISE, ...p });
const gen = (p: Partial<Generator>): Generator => ({ ...DEFAULT_GENERATOR, ...p, breakup: { ...DEFAULT_GENERATOR.breakup, ...p.breakup } });

export interface MaterialPreset {
  id: string;
  title: string;
  group: "metal" | "paint" | "organic" | "stone" | "plastic" | "fx";
  material: Material;
}

/** Physically plausible base materials (sRGB albedo / F0 from published measurement tables, rounded). */
export const MATERIALS: MaterialPreset[] = [
  { id: "steel", title: "Steel", group: "metal", material: { baseColor: "#c4c6c8", metallic: 1, roughness: { noise: noise({ scale: 0.05, seed: 3 }), from: 0.28, to: 0.42 }, height: 0 } },
  { id: "aluminium", title: "Aluminium", group: "metal", material: { baseColor: "#dfe1e4", metallic: 1, roughness: { noise: noise({ type: "scratches", scale: 0.2, seed: 5 }), from: 0.32, to: 0.18 } } },
  { id: "chrome", title: "Chrome", group: "metal", material: { baseColor: "#d4d6d8", metallic: 1, roughness: 0.06 } },
  { id: "iron", title: "Raw iron", group: "metal", material: { baseColor: { noise: noise({ scale: 0.04, seed: 9 }), from: "#5e6062", to: "#7c7e80" }, metallic: 1, roughness: { noise: noise({ type: "grunge", scale: 0.06, seed: 9 }), from: 0.45, to: 0.7 } } },
  { id: "gold", title: "Gold", group: "metal", material: { baseColor: "#f2cc80", metallic: 1, roughness: 0.22 } },
  { id: "copper", title: "Copper", group: "metal", material: { baseColor: "#efb79c", metallic: 1, roughness: 0.28 } },
  { id: "brass", title: "Brass", group: "metal", material: { baseColor: "#e3c886", metallic: 1, roughness: 0.3 } },
  { id: "rust", title: "Rust", group: "metal", material: { baseColor: { noise: noise({ type: "grunge", scale: 0.04, seed: 21, contrast: 1.4 }), from: "#4a200e", to: "#a2522a" }, metallic: 0, roughness: { noise: noise({ scale: 0.03, seed: 22 }), from: 0.75, to: 0.95 }, height: { noise: noise({ type: "grunge", scale: 0.025, seed: 23 }), from: -0.15, to: 0.25 } } },
  { id: "paintRed", title: "Gloss paint, red", group: "paint", material: { baseColor: "#d4342a", metallic: 0, roughness: 0.32 } },
  { id: "paintInk", title: "Satin paint, ink", group: "paint", material: { baseColor: "#1b1b1e", metallic: 0, roughness: 0.45 } },
  { id: "paintOlive", title: "Matte paint, olive", group: "paint", material: { baseColor: "#4d5426", metallic: 0, roughness: { noise: noise({ scale: 0.05, seed: 31 }), from: 0.55, to: 0.72 } } },
  { id: "paintCream", title: "Enamel, cream", group: "paint", material: { baseColor: "#ece4cf", metallic: 0, roughness: 0.25 } },
  { id: "plasticWhite", title: "Plastic, white", group: "plastic", material: { baseColor: "#e6e4df", metallic: 0, roughness: 0.4 } },
  { id: "rubber", title: "Rubber", group: "plastic", material: { baseColor: "#1e1e20", metallic: 0, roughness: { noise: noise({ scale: 0.02, seed: 41 }), from: 0.78, to: 0.9 } } },
  { id: "ceramic", title: "Glazed ceramic", group: "plastic", material: { baseColor: "#f1efe9", metallic: 0, roughness: 0.12 } },
  { id: "leather", title: "Leather", group: "organic", material: { baseColor: { noise: noise({ type: "cellular", scale: 0.012, seed: 51, contrast: 1.2 }), from: "#5a321e", to: "#3d2013" }, metallic: 0, roughness: { noise: noise({ type: "cellular", scale: 0.012, seed: 51 }), from: 0.45, to: 0.7 }, height: { noise: noise({ type: "cellular", scale: 0.012, seed: 51 }), from: 0.08, to: -0.08 } } },
  { id: "wood", title: "Varnished wood", group: "organic", material: { baseColor: { noise: noise({ type: "wood", scale: 0.25, seed: 61 }), from: "#a8743e", to: "#5c3519" }, metallic: 0, roughness: { noise: noise({ type: "wood", scale: 0.25, seed: 61 }), from: 0.35, to: 0.55 }, height: { noise: noise({ type: "wood", scale: 0.25, seed: 61 }), from: 0, to: -0.05 } } },
  { id: "concrete", title: "Concrete", group: "stone", material: { baseColor: { noise: noise({ type: "grunge", scale: 0.05, seed: 71 }), from: "#9c9a94", to: "#7d7b76" }, metallic: 0, roughness: 0.92, height: { noise: noise({ type: "fbm", scale: 0.01, seed: 72, octaves: 3 }), from: -0.1, to: 0.1 } } },
  { id: "neon", title: "Emissive red", group: "fx", material: { baseColor: "#2a0a08", metallic: 0, roughness: 0.3, emissive: "#ff3b2e" } },
];

export function materialPreset(id: string): MaterialPreset {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown material "${id}". Available: ${MATERIALS.map((x) => x.id).join(", ")}`);
  return m;
}

// ------------------------------------------------------------------ masks

type EffectDraft = { type: "generator"; name: string; blend: BlendMode; opacity?: number; generator: Generator } | { type: "levels"; name: string; low: number; high: number; gamma: number };

export interface MaskPreset {
  id: string;
  title: string;
  description: string;
  base: number;
  effects: EffectDraft[];
}

export const MASKS: MaskPreset[] = [
  { id: "edgeWear", title: "Edge wear", description: "Convex edges, broken up by grunge", base: 0, effects: [{ type: "generator", name: "Edge wear", blend: "max", generator: gen({ type: "edgeWear", amount: 0.45, softness: 0.25 }) }] },
  { id: "dirt", title: "Dirt in cavities", description: "Occluded and concave areas", base: 0, effects: [{ type: "generator", name: "Dirt", blend: "max", generator: gen({ type: "dirt", amount: 0.55, softness: 0.45, breakupStrength: 0.6 }) }] },
  { id: "dustTop", title: "Dust on top", description: "Upward-facing surfaces", base: 0, effects: [{ type: "generator", name: "Top dust", blend: "max", generator: gen({ type: "facing", direction: [0, 1, 0], amount: 0.45, softness: 0.35, breakupStrength: 0.8, breakup: noise({ type: "fbm", scale: 0.03, seed: 13, contrast: 1.6 }) }) }] },
  { id: "grimeBottom", title: "Grime from the ground", description: "Gradient rising from the bottom", base: 0, effects: [{ type: "generator", name: "Ground grime", blend: "max", generator: gen({ type: "gradient", axis: "y", from: 0.35, to: 0, breakupStrength: 0.6 }) }] },
  { id: "patches", title: "Noise patches", description: "Large irregular patches", base: 0, effects: [{ type: "generator", name: "Patches", blend: "max", generator: gen({ type: "noise", noise: noise({ type: "grunge", scale: 0.12, seed: 17, contrast: 3, bias: -0.1 }) }) }] },
  { id: "scratches", title: "Scratches", description: "Thin random scratches", base: 0, effects: [{ type: "generator", name: "Scratches", blend: "max", generator: gen({ type: "noise", noise: noise({ type: "scratches", scale: 0.07, seed: 19, octaves: 2, contrast: 1.4 }) }) }] },
];

export function maskPreset(id: string): MaskPreset {
  const m = MASKS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mask preset "${id}". Available: ${MASKS.map((x) => x.id).join(", ")}`);
  return m;
}

// ------------------------------------------------------------------ smart materials

/** Layer drafts without ids; `instantiate` assigns them. */
export interface LayerDraft {
  type: "fill" | "folder";
  name: string;
  material?: Material;
  blend?: BlendMode;
  channelBlend?: Partial<Record<ChannelId, BlendMode | "off">>;
  opacity?: number;
  mask?: { base: number; effects: EffectDraft[]; invert?: boolean };
  children?: LayerDraft[];
}

export interface SmartMaterial {
  id: string;
  title: string;
  description: string;
  layers: LayerDraft[];
}

const m = (id: string) => materialPreset(id).material;
const mask = (...ids: string[]): LayerDraft["mask"] => ({ base: 0, effects: ids.flatMap((i) => maskPreset(i).effects) });

export const SMART_MATERIALS: SmartMaterial[] = [
  {
    id: "paintedSteelWorn",
    title: "Painted steel, worn",
    description: "Red gloss paint over steel, chipped on the edges, dirt in the cavities",
    layers: [
      { type: "fill", name: "Steel", material: m("steel") },
      {
        type: "fill",
        name: "Paint",
        material: m("paintRed"),
        mask: { base: 1, effects: [{ type: "generator", name: "Chipped edges", blend: "subtract", generator: gen({ type: "edgeWear", amount: 0.5, softness: 0.12, breakupStrength: 0.8 }) }] },
      },
      { type: "fill", name: "Scratches", material: { baseColor: "#9a9da0", metallic: 1, roughness: 0.35 }, opacity: 0.85, mask: mask("scratches") },
      { type: "fill", name: "Dirt", material: { baseColor: "#3a3228", roughness: 0.9, metallic: 0 }, opacity: 0.85, mask: mask("dirt") },
    ],
  },
  {
    id: "rustyIron",
    title: "Rusty iron",
    description: "Raw iron eaten by rust in cavities and patches",
    layers: [
      { type: "fill", name: "Iron", material: m("iron") },
      {
        type: "fill",
        name: "Rust",
        material: m("rust"),
        mask: {
          base: 0,
          effects: [
            { type: "generator", name: "Patches", blend: "max", generator: gen({ type: "noise", noise: noise({ type: "grunge", scale: 0.09, seed: 27, contrast: 2.6, bias: -0.05 }) }) },
            { type: "generator", name: "Cavities", blend: "max", generator: gen({ type: "dirt", amount: 0.6, softness: 0.5, breakupStrength: 0.8 }) },
          ],
        },
      },
      { type: "fill", name: "Polished edges", material: { baseColor: "#8a8c8e", metallic: 1, roughness: 0.3 }, opacity: 0.8, mask: mask("edgeWear") },
    ],
  },
  {
    id: "agedGold",
    title: "Aged gold",
    description: "Gold with dark tarnish in the cavities and bright polished edges",
    layers: [
      { type: "fill", name: "Gold", material: { ...m("gold"), roughness: 0.32 } },
      { type: "fill", name: "Tarnish", material: { baseColor: "#4a3517", metallic: 0.6, roughness: 0.7 }, opacity: 0.9, mask: mask("dirt") },
      { type: "fill", name: "Polish", material: { roughness: 0.1, baseColor: "#ffe2a6" }, mask: mask("edgeWear") },
    ],
  },
  {
    id: "copperPatina",
    title: "Copper patina",
    description: "Copper with green verdigris collecting in cavities and patches",
    layers: [
      { type: "fill", name: "Copper", material: m("copper") },
      {
        type: "fill",
        name: "Verdigris",
        material: { baseColor: { noise: noise({ type: "grunge", scale: 0.03, seed: 81 }), from: "#3f8f7c", to: "#86c4ad" }, metallic: 0, roughness: 0.8, height: 0.05 },
        mask: {
          base: 0,
          effects: [
            { type: "generator", name: "Cavities", blend: "max", generator: gen({ type: "dirt", amount: 0.7, softness: 0.5, breakupStrength: 0.9 }) },
            { type: "generator", name: "Patches", blend: "max", generator: gen({ type: "noise", noise: noise({ type: "grunge", scale: 0.08, seed: 83, contrast: 2.6, bias: -0.32 }) }) },
          ],
        },
      },
      { type: "fill", name: "Polished edges", material: { baseColor: "#f5c4a8", metallic: 1, roughness: 0.18 }, mask: mask("edgeWear") },
    ],
  },
  {
    id: "militaryPaint",
    title: "Military paint",
    description: "Olive matte paint, worn to bare metal on edges, dust settling on top",
    layers: [
      { type: "fill", name: "Bare metal", material: m("steel") },
      {
        type: "fill",
        name: "Olive paint",
        material: m("paintOlive"),
        mask: { base: 1, effects: [{ type: "generator", name: "Worn edges", blend: "subtract", generator: gen({ type: "edgeWear", amount: 0.42, softness: 0.1, breakupStrength: 0.9 }) }] },
      },
      { type: "fill", name: "Dust", material: { baseColor: "#a69d88", roughness: 0.95, metallic: 0 }, opacity: 0.6, mask: mask("dustTop") },
      { type: "fill", name: "Grime", material: { baseColor: "#2e2a22", roughness: 0.9, metallic: 0 }, opacity: 0.8, mask: mask("dirt") },
    ],
  },
  {
    id: "scuffedPlastic",
    title: "Scuffed plastic",
    description: "White plastic with matte scuffs and grime",
    layers: [
      { type: "fill", name: "Plastic", material: m("plasticWhite") },
      { type: "fill", name: "Scuffs", material: { roughness: 0.75 }, mask: mask("scratches", "patches") },
      { type: "fill", name: "Grime", material: { baseColor: "#55504a", roughness: 0.85 }, opacity: 0.6, mask: mask("dirt") },
    ],
  },
  {
    id: "glazedCeramic",
    title: "Glazed ceramic",
    description: "Glossy glaze with a darker clay showing at the edges and dust in the cavities",
    layers: [
      { type: "fill", name: "Clay", material: { baseColor: "#a0603e", roughness: 0.8, metallic: 0 } },
      { type: "fill", name: "Glaze", material: { baseColor: "#2f5d7c", roughness: 0.08, metallic: 0 }, mask: { base: 1, effects: [{ type: "generator", name: "Thin on edges", blend: "subtract", generator: gen({ type: "edgeWear", amount: 0.35, softness: 0.5 }) }] } },
      { type: "fill", name: "Dust", material: { baseColor: "#bdb3a2", roughness: 0.95 }, opacity: 0.6, mask: mask("dirt") },
    ],
  },
];

export function smartMaterial(id: string): SmartMaterial {
  const s = SMART_MATERIALS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown smart material "${id}". Available: ${SMART_MATERIALS.map((x) => x.id).join(", ")}`);
  return s;
}

/** Turn drafts into layers with fresh ids from `alloc`. */
export function instantiate(drafts: LayerDraft[], alloc: (p: "L" | "E") => string): Layer[] {
  return drafts.map((d) => {
    const base = {
      id: alloc("L"),
      name: d.name,
      visible: true,
      opacity: d.opacity ?? 1,
      blend: d.blend ?? ("normal" as BlendMode),
      ...(d.channelBlend ? { channelBlend: d.channelBlend } : {}),
      ...(d.mask ? { mask: instantiateMask(d.mask, alloc) } : {}),
    };
    if (d.type === "folder") return { ...base, type: "folder", children: instantiate(d.children ?? [], alloc) };
    return { ...base, type: "fill", material: structuredClone(d.material ?? {}) };
  });
}

export function instantiateMask(d: NonNullable<LayerDraft["mask"]>, alloc: (p: "L" | "E") => string): Mask {
  return {
    enabled: true,
    base: d.base,
    invert: d.invert ?? false,
    effects: d.effects.map((e): MaskEffect => (e.type === "levels" ? { ...e, id: alloc("E"), visible: true } : { ...structuredClone(e), id: alloc("E"), visible: true, opacity: e.opacity ?? 1 })),
  };
}
