import type { Vec3 } from "./math.js";

/**
 * Material channels a layer can write. Colours are authored as sRGB "#rrggbb"; scalars are 0..1,
 * except height which is -1..1 (0 = untouched surface).
 */
export type ChannelId = "baseColor" | "metallic" | "roughness" | "height" | "emissive";
export const CHANNELS: ChannelId[] = ["baseColor", "metallic", "roughness", "height", "emissive"];
export const COLOR_CHANNELS: ChannelId[] = ["baseColor", "emissive"];
export const channelSize = (c: ChannelId) => (c === "baseColor" || c === "emissive" ? 3 : 1);

export type BlendMode = "normal" | "multiply" | "add" | "subtract" | "screen" | "overlay" | "max" | "min" | "difference";
export const BLEND_MODES: BlendMode[] = ["normal", "multiply", "add", "subtract", "screen", "overlay", "max", "min", "difference"];

export type NoiseType = "fbm" | "perlin" | "ridged" | "cellular" | "spots" | "scratches" | "grunge" | "wood";

/** Procedural noise evaluated on the surface in 3D (object space), so it never shows UV seams. */
export interface NoiseSpec {
  type: NoiseType;
  /** Feature size relative to the mesh size (bounding-box diagonal = 1). Smaller = finer. */
  scale: number;
  octaves: number;
  seed: number;
  /** Levels after the noise: contrast 1 = as is, higher = harder edges. */
  contrast: number;
  /** Shifts the noise up (+) or down (-) before contrast. */
  bias: number;
  /** Stretch along x, y, z (1 = none). [1, 8, 1] gives vertical streaks. */
  stretch: Vec3;
  invert: boolean;
}

/** A channel value: a constant, or a gradient between two values driven by noise. */
export type ScalarSource = number | { noise: NoiseSpec; from: number; to: number };
export type ColorSource = string | { noise: NoiseSpec; from: string; to: string };
export type ChannelSource = ScalarSource | ColorSource;

export interface Material {
  baseColor?: ColorSource;
  metallic?: ScalarSource;
  roughness?: ScalarSource;
  height?: ScalarSource;
  emissive?: ColorSource;
}

/** Values a brush deposits (constants only). */
export interface PaintMaterial {
  baseColor?: string;
  metallic?: number;
  roughness?: number;
  height?: number;
  emissive?: string;
}

export type BrushAlpha = "round" | "spray" | "grunge" | "speckle";

export interface Brush {
  /** Radius relative to the mesh size (bounding-box diagonal = 1). 0.02 is a small brush. */
  size: number;
  /** 0 = soft falloff from the centre, 1 = hard edge. */
  hardness: number;
  /** Paint deposited per dab, 0..1. Overlapping dabs build up to `opacity`. */
  flow: number;
  /** Maximum coverage of one stroke, 0..1. */
  opacity: number;
  /** Distance between dabs as a fraction of the radius. */
  spacing: number;
  alpha: BrushAlpha;
  /**
   * sphere: dabs paint everything within the radius in 3D (needs no camera, good for agents).
   * view: dabs are projected from the stroke's camera and only touch surfaces visible from it.
   */
  projection: "sphere" | "view";
  /** Mirror dabs across the object's own centre on this axis. */
  symmetry: "none" | "x" | "y" | "z";
  /** Seed for spray/grunge alphas. */
  seed: number;
}

export interface Camera {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface Stroke {
  brush: Brush;
  /** For paint layers: the material the stroke deposits. Missing channels are untouched. */
  material?: PaintMaterial;
  /** For mask paint: the grey level deposited (1 white = show, 0 black = hide). */
  value?: number;
  /** Remove paint instead of adding it. */
  erase?: boolean;
  /** Dab path in object space, flat [x,y,z, x,y,z, ...]. Resampled by `brush.spacing`. */
  points: number[];
  /** Pen pressure per point (0..1), optional; scales size and flow. */
  pressure?: number[];
  /** The camera used for `projection: "view"`. */
  camera?: Camera;
}

export type GeneratorType = "edgeWear" | "dirt" | "gradient" | "noise" | "facing" | "curvature" | "ao" | "uniform";

export interface Generator {
  type: GeneratorType;
  /** How much of the surface it covers, 0..1 (edgeWear/dirt/curvature/ao/facing). */
  amount: number;
  /** Edge softness, 0 = hard threshold, 1 = very soft. */
  softness: number;
  /** Noise that breaks the result up; strength 0 disables it. */
  breakup: NoiseSpec;
  breakupStrength: number;
  /** gradient: object-space axis; facing: direction the surface must face. */
  axis: "x" | "y" | "z";
  direction: Vec3;
  /** gradient: start and end along the axis, 0..1 of the bounding box. */
  from: number;
  to: number;
  /** curvature: which side. */
  mode: "convex" | "concave";
  /** noise generator spec. */
  noise: NoiseSpec;
  /** uniform: the value. */
  value: number;
  invert: boolean;
}

export type MaskEffect =
  | { id: string; type: "generator"; name: string; visible: boolean; blend: BlendMode; opacity: number; generator: Generator }
  | { id: string; type: "paint"; name: string; visible: boolean; blend: BlendMode; opacity: number; strokes: Stroke[] }
  | { id: string; type: "levels"; name: string; visible: boolean; low: number; high: number; gamma: number };

export interface Mask {
  enabled: boolean;
  /** Starting grey level before the effects: 0 = black mask (hide all), 1 = white (show all). */
  base: number;
  /** Effects applied bottom to top. */
  effects: MaskEffect[];
  invert: boolean;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  /** Per-channel blend override, or "off" to stop this layer from touching the channel. */
  channelBlend?: Partial<Record<ChannelId, BlendMode | "off">>;
  mask?: Mask;
}

export interface FillLayer extends LayerBase {
  type: "fill";
  material: Material;
}

export interface PaintLayer extends LayerBase {
  type: "paint";
  strokes: Stroke[];
}

export interface FolderLayer extends LayerBase {
  type: "folder";
  /** Bottom to top. */
  children: Layer[];
  collapsed?: boolean;
}

export type Layer = FillLayer | PaintLayer | FolderLayer;
export type LayerType = Layer["type"];

export type PrimitiveName = "orb" | "roundedCube" | "sphere" | "cylinder" | "torus" | "plane" | "capsule";

export type MeshRef = { source: "primitive"; primitive: PrimitiveName; segments?: number } | { source: "file"; path: string };

export type EnvironmentName = "studio" | "sunset" | "overcast" | "night";

export interface ViewSettings {
  environment: EnvironmentName;
  /** Exposure in stops. */
  exposure: number;
  /** Environment rotation, degrees. */
  rotation: number;
  background: string;
}

export interface BakeSettings {
  /** World-space radius for curvature, relative to mesh size. */
  curvatureRadius: number;
  aoSamples: number;
  /** Max occlusion distance, relative to mesh size. */
  aoDistance: number;
  /** Resolution used for AO and curvature (upsampled to the texture). */
  resolution: number;
}

export interface PatinaDocument {
  format: "patina";
  version: 1;
  name: string;
  mesh: MeshRef;
  /** Texture set resolution (square). */
  resolution: number;
  /** Height-to-normal strength. */
  normalStrength: number;
  /** Values under every layer. */
  base: Required<PaintMaterial>;
  /** Bottom to top. */
  layers: Layer[];
  bake: BakeSettings;
  view: ViewSettings;
  nextId: number;
}
