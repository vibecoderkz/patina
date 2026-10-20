import { z } from "zod";
import { DEFAULT_BRUSH } from "./brush.js";
import { DEFAULT_GENERATOR } from "./generators.js";
import { DEFAULT_NOISE } from "./noise.js";
import { BLEND_MODES, type Brush, type Generator, type NoiseSpec } from "./types.js";

export const hex = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a colour like "#ff3b2e"')
  .transform((s) => {
    let h = s.replace(/^#/, "").toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return `#${h}`;
  });

export const unit = z.number().min(0).max(1);
export const vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const blendMode = z.enum(BLEND_MODES as [string, ...string[]]) as z.ZodType<(typeof BLEND_MODES)[number]>;

const noiseShape = z.strictObject({
    type: z.enum(["fbm", "perlin", "ridged", "cellular", "spots", "scratches", "grunge", "wood"]),
    scale: z.number().positive().max(10).describe("Feature size relative to the mesh size (bounding-box diagonal = 1)"),
    octaves: z.number().int().min(1).max(8),
    seed: z.number().int(),
    contrast: z.number().min(0).max(20),
    bias: z.number().min(-1).max(1),
    stretch: vec3,
    invert: z.boolean(),
});
export const noisePatch = noiseShape.partial();
export const noiseInput = noisePatch.transform((v): NoiseSpec => ({ ...DEFAULT_NOISE, ...v }));

export const colorSource = z.union([hex, z.strictObject({ noise: noiseInput, from: hex, to: hex })]);
export const scalarSource = (lo = 0, hi = 1) => z.union([z.number().min(lo).max(hi), z.strictObject({ noise: noiseInput, from: z.number().min(lo).max(hi), to: z.number().min(lo).max(hi) })]);

export const materialInput = z.strictObject({
  baseColor: colorSource.optional(),
  metallic: scalarSource().optional(),
  roughness: scalarSource().optional(),
  height: scalarSource(-1, 1).optional().describe("-1..1, 0 = flat"),
  emissive: colorSource.optional(),
});

/** Partial material patch for layer.update: null removes a channel from the layer. */
export const materialPatch = z.strictObject({
  baseColor: colorSource.nullable().optional(),
  metallic: scalarSource().nullable().optional(),
  roughness: scalarSource().nullable().optional(),
  height: scalarSource(-1, 1).nullable().optional(),
  emissive: colorSource.nullable().optional(),
});

export const paintMaterial = z.strictObject({
  baseColor: hex.optional(),
  metallic: unit.optional(),
  roughness: unit.optional(),
  height: z.number().min(-1).max(1).optional(),
  emissive: hex.optional(),
});

const brushShape = z.strictObject({
  size: z.number().positive().max(2).describe("Radius relative to mesh size; 0.02 small, 0.08 large"),
  hardness: unit,
  flow: unit,
  opacity: unit,
  spacing: z.number().min(0.02).max(4),
  alpha: z.enum(["round", "spray", "grunge", "speckle"]),
  projection: z.enum(["sphere", "view"]),
  symmetry: z.enum(["none", "x", "y", "z"]),
  seed: z.number().int(),
});
export const brushInput = brushShape.partial().transform((v): Brush => ({ ...DEFAULT_BRUSH, ...v }));
export const brushPatch = brushShape.partial();

export const generatorShape = z.strictObject({
  type: z.enum(["edgeWear", "dirt", "gradient", "noise", "facing", "curvature", "ao", "uniform"]),
  amount: unit.describe("Coverage 0..1"),
  softness: unit,
  breakup: noiseInput,
  breakupStrength: z.number().min(0).max(2),
  axis: z.enum(["x", "y", "z"]),
  direction: vec3,
  from: z.number().min(-1).max(2),
  to: z.number().min(-1).max(2),
  mode: z.enum(["convex", "concave"]),
  noise: noiseInput,
  value: unit,
  invert: z.boolean(),
});
/** For updates: nested noises merge field by field with the existing ones. */
export const generatorPatch = generatorShape.extend({ breakup: noisePatch, noise: noisePatch }).partial();
export const generatorInput = generatorPatch.transform(
  (v): Generator => ({ ...DEFAULT_GENERATOR, ...v, breakup: { ...DEFAULT_GENERATOR.breakup, ...v.breakup }, noise: { ...DEFAULT_GENERATOR.noise, ...v.noise } }),
);

export const cameraInput = z.strictObject({
  eye: vec3,
  target: vec3,
  up: vec3.default([0, 1, 0]),
  fov: z.number().min(5).max(120).default(30),
});
