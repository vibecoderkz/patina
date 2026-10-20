import { applyDilation, bakeSurface, dilationMap, rasterizeUvs, type BakedMaps, type TexelMaps } from "./bake.js";
import { StrokeRasterizer, type DepthView } from "./brush.js";
import { Bvh, surfaceAt } from "./bvh.js";
import { evalGenerator, isConstant, needsBake, SourceBuffer } from "./generators.js";
import { clamp, hexToRgb, type Vec3 } from "./math.js";
import type { Mesh } from "./mesh.js";
import { depthView, type MaterialTextures } from "./render.js";
import { CHANNELS, channelSize, type BlendMode, type ChannelId, type Generator, type Layer, type Mask, type MaskEffect, type PaintLayer, type PatinaDocument, type Stroke } from "./types.js";

type ChannelRaster = { val: Float32Array; a: Float32Array };
interface PaintRaster {
  strokes: Stroke[];
  channels: Partial<Record<ChannelId | "mask", ChannelRaster>>;
}

export interface EngineOutputs {
  baseColor: Float32Array;
  metallic: Float32Array;
  roughness: Float32Array;
  height: Float32Array;
  emissive: Float32Array;
  /** Tangent-space normal from height, -1..1. */
  normal: Float32Array;
}

export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SyncResult {
  changed: boolean;
  /** Texel rectangle (inclusive) whose output changed, already grown by the display padding. */
  rect: DirtyRect | null;
  full: boolean;
  ms: number;
}

const DISPLAY_PAD = 8;

function blendOp(mode: BlendMode, d: number, s: number): number {
  switch (mode) {
    case "multiply":
      return d * s;
    case "add":
      return d + s;
    case "subtract":
      return d - s;
    case "screen":
      return 1 - (1 - d) * (1 - s);
    case "overlay":
      return d < 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s);
    case "max":
      return d > s ? d : s;
    case "min":
      return d < s ? d : s;
    case "difference":
      return Math.abs(d - s);
    default:
      return s;
  }
}

const isAppend = (a: Stroke[], b: Stroke[]) => {
  if (b.length <= a.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
};

type AppendTarget = { kind: "layer"; layer: PaintLayer } | { kind: "mask"; layerId: string; oldMask: Mask; newMask: Mask; effect: Extract<MaskEffect, { type: "paint" }> };

/**
 * Turns a document's layer stack into texture data for one mesh at one resolution. Caches every
 * layer's intermediate buffers by object identity, so painting a stroke recomputes only the texels
 * the stroke touched, and undo just swaps documents.
 */
export class TextureEngine {
  readonly bvh: Bvh;
  readonly maps: TexelMaps;
  readonly N: number;
  readonly out: EngineOutputs;
  baked: BakedMaps | null = null;
  /** Bumped on every output change. */
  version = 0;
  private bakeKey = "";
  private doc: PatinaDocument | null = null;
  private display: Int32Array;
  private srcCache = new WeakMap<object, SourceBuffer>();
  private genCache = new WeakMap<Generator, Float32Array>();
  private maskCache = new WeakMap<Mask, Float32Array>();
  private rasters = new Map<string, PaintRaster>();
  private depthCache = new Map<string, DepthView>();
  private stamp: Uint32Array;
  private stampId = 1;
  private live: LiveStroke | null = null;
  private pendingCommit: { key: string; points: number; first: number; last: number } | null = null;

  constructor(
    readonly mesh: Mesh,
    readonly res: number,
  ) {
    this.bvh = new Bvh(mesh);
    this.maps = rasterizeUvs(mesh, res);
    this.N = res * res;
    const N = this.N;
    this.out = { baseColor: new Float32Array(N * 3), metallic: new Float32Array(N), roughness: new Float32Array(N), height: new Float32Array(N), emissive: new Float32Array(N * 3), normal: new Float32Array(N * 3) };
    this.display = dilationMap(res, this.maps.covered, DISPLAY_PAD);
    this.stamp = new Uint32Array(N);
  }

  get document() {
    return this.doc;
  }

  /** Bake curvature + AO if the settings changed. Returns true when it baked. */
  ensureBaked(doc: PatinaDocument): boolean {
    const key = JSON.stringify(doc.bake);
    if (this.baked && key === this.bakeKey) return false;
    this.baked = bakeSurface(this.mesh, this.bvh, this.maps, doc.bake);
    this.bakeKey = key;
    this.genCache = new WeakMap();
    this.maskCache = new WeakMap();
    return true;
  }

  /** Bring the outputs up to date with `doc`. */
  sync(doc: PatinaDocument): SyncResult {
    const t0 = performance.now();
    const old = this.doc;
    if (old === doc) return { changed: false, rect: null, full: false, ms: 0 };
    this.doc = doc;
    const rebaked = this.usesBake(doc.layers) || this.baked ? this.ensureBaked(doc) : false;
    let full = !old || rebaked || JSON.stringify(old.base) !== JSON.stringify(doc.base) || old.normalStrength !== doc.normalStrength;
    let appends: AppendTarget[] | null = null;
    if (!full && old!.layers !== doc.layers) {
      const d = this.diff(old!.layers, doc.layers);
      if (d === "full") full = true;
      else if (d.length) appends = d;
    }
    if (full) {
      this.compositeTexels(doc, this.maps.texels);
      this.normals(doc, this.maps.texels);
      applyAllDilation(this.out, this.display);
      this.version++;
      return { changed: true, rect: { x0: 0, y0: 0, x1: this.res - 1, y1: this.res - 1 }, full: true, ms: performance.now() - t0 };
    }
    if (!appends) return { changed: false, rect: null, full: false, ms: performance.now() - t0 };
    const touched = new Set<number>();
    for (const a of appends) {
      if (a.kind === "layer") for (const i of this.paintRaster(a.layer.id, a.layer.strokes, false).touched) touched.add(i);
      else {
        const r = this.paintRaster(`${a.layerId}/${a.effect.id}`, a.effect.strokes, true);
        const buf = this.maskCache.get(a.oldMask);
        this.maskCache.delete(a.oldMask);
        if (buf) {
          const idx = Int32Array.from(r.touched);
          this.evalMask(a.newMask, a.layerId, idx, buf);
          this.maskCache.set(a.newMask, buf);
        }
        for (const i of r.touched) touched.add(i);
      }
    }
    const rect = this.updateTexels(doc, Int32Array.from(touched));
    return { changed: true, rect, full: false, ms: performance.now() - t0 };
  }

  private usesBake(layers: Layer[]): boolean {
    for (const l of layers) {
      if (l.mask?.effects.some((e) => e.type === "generator" && needsBake(e.generator))) return true;
      if (l.type === "folder" && this.usesBake(l.children)) return true;
    }
    return false;
  }

  /** Recomposite a texel set, its normals and padding; returns the dirty rect. */
  private updateTexels(doc: PatinaDocument, idx: Int32Array): DirtyRect | null {
    if (!idx.length) return null;
    this.compositeTexels(doc, idx);
    const grown = this.grow(idx);
    this.normals(doc, grown);
    applyAllDilation(this.out, this.display);
    this.version++;
    let x0 = this.res, y0 = this.res, x1 = -1, y1 = -1;
    for (let k = 0; k < idx.length; k++) {
      const x = idx[k] % this.res, y = (idx[k] / this.res) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const p = DISPLAY_PAD + 2;
    return { x0: Math.max(0, x0 - p), y0: Math.max(0, y0 - p), x1: Math.min(this.res - 1, x1 + p), y1: Math.min(this.res - 1, y1 + p) };
  }

  /** Texels plus their covered 8-neighbours (normals read neighbouring heights). */
  private grow(idx: Int32Array): Int32Array {
    const s = this.nextStamp();
    const out: number[] = [];
    const res = this.res, cov = this.maps.covered;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], x = i % res, y = (i / res) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue;
          const j = yy * res + xx;
          if (!cov[j] || this.stamp[j] === s) continue;
          this.stamp[j] = s;
          out.push(j);
        }
    }
    return Int32Array.from(out);
  }

  private nextStamp() {
    this.stampId++;
    if (this.stampId > 0xfffffff0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  // ---------------------------------------------------------------- diff

  private diff(a: Layer[], b: Layer[]): AppendTarget[] | "full" {
    if (a === b) return [];
    if (a.length !== b.length) return "full";
    const out: AppendTarget[] = [];
    for (let k = 0; k < a.length; k++) {
      const x = a[k], y = b[k];
      if (x === y) continue;
      if (x.id !== y.id || x.type !== y.type || x.visible !== y.visible || x.opacity !== y.opacity || x.blend !== y.blend || x.channelBlend !== y.channelBlend) return "full";
      if (x.mask !== y.mask) {
        const m = this.diffMask(x.id, x.mask, y.mask);
        if (m === "full") return "full";
        if (m) out.push(m);
      }
      if (x.type === "fill") {
        if (x.material !== (y as typeof x).material) return "full";
      } else if (x.type === "paint") {
        const ys = (y as PaintLayer).strokes;
        if (x.strokes !== ys) {
          if (!isAppend(x.strokes, ys)) return "full";
          out.push({ kind: "layer", layer: y as PaintLayer });
        }
      } else {
        const c = this.diff(x.children, (y as typeof x).children);
        if (c === "full") return "full";
        out.push(...c);
      }
    }
    return out;
  }

  private diffMask(layerId: string, a: Mask | undefined, b: Mask | undefined): AppendTarget | null | "full" {
    if (!a || !b || a.enabled !== b.enabled || a.base !== b.base || a.invert !== b.invert || a.effects.length !== b.effects.length) return "full";
    let found: AppendTarget | null = null;
    for (let k = 0; k < a.effects.length; k++) {
      const x = a.effects[k], y = b.effects[k];
      if (x === y) continue;
      if (x.type !== "paint" || y.type !== "paint" || x.id !== y.id || x.visible !== y.visible || x.blend !== y.blend || x.opacity !== y.opacity) return "full";
      if (!isAppend(x.strokes, y.strokes) || found) return "full";
      found = { kind: "mask", layerId, oldMask: a, newMask: b, effect: y };
    }
    return found;
  }

  // ---------------------------------------------------------------- compositing

  private compositeTexels(doc: PatinaDocument, idx: Int32Array) {
    const o = this.out;
    const bc = hexToRgb(doc.base.baseColor), em = hexToRgb(doc.base.emissive);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      o.baseColor[i * 3] = bc[0];
      o.baseColor[i * 3 + 1] = bc[1];
      o.baseColor[i * 3 + 2] = bc[2];
      o.emissive[i * 3] = em[0];
      o.emissive[i * 3 + 1] = em[1];
      o.emissive[i * 3 + 2] = em[2];
      o.metallic[i] = doc.base.metallic;
      o.roughness[i] = doc.base.roughness;
      o.height[i] = doc.base.height;
    }
    this.runLayers(doc.layers, idx);
  }

  private runLayers(layers: Layer[], idx: Int32Array) {
    for (const L of layers) {
      if (!L.visible || L.opacity <= 0) continue;
      const mask = L.mask && L.mask.enabled ? this.mask(L.mask, L.id) : null;
      if (L.type === "folder") {
        const saved = CHANNELS.map((ch) => {
          const size = channelSize(ch), src = this.out[ch], buf = new Float32Array(idx.length * size);
          for (let k = 0; k < idx.length; k++) for (let c = 0; c < size; c++) buf[k * size + c] = src[idx[k] * size + c];
          return buf;
        });
        this.runLayers(L.children, idx);
        CHANNELS.forEach((ch, n) => {
          const size = channelSize(ch), acc = this.out[ch], s = saved[n];
          for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            const a = L.opacity * (mask ? mask[i] : 1);
            if (a >= 1) continue;
            for (let c = 0; c < size; c++) acc[i * size + c] = s[k * size + c] + (acc[i * size + c] - s[k * size + c]) * a;
          }
        });
        continue;
      }
      if (L.type === "fill") {
        for (const ch of CHANNELS) {
          const src = L.material[ch];
          if (src === undefined) continue;
          const mode = L.channelBlend?.[ch] ?? L.blend;
          if (mode === "off") continue;
          if (isConstant(src)) {
            const cst = typeof src === "string" ? hexToRgb(src) : [src];
            this.blend(ch, idx, null, cst, null, L.opacity, mask, mode);
          } else {
            let sb = this.srcCache.get(src);
            if (!sb) {
              sb = new SourceBuffer(src, this.maps);
              this.srcCache.set(src, sb);
            }
            for (let k = 0; k < idx.length; k++) {
              const i = idx[k];
              if (!mask || mask[i] > 0) sb.ensure(i);
            }
            this.blend(ch, idx, sb.buf, null, null, L.opacity, mask, mode);
          }
        }
      } else {
        const r = this.paintRaster(L.id, L.strokes, false).raster;
        for (const ch of CHANNELS) {
          const cr = r.channels[ch];
          if (!cr) continue;
          const mode = L.channelBlend?.[ch] ?? L.blend;
          if (mode === "off") continue;
          this.blend(ch, idx, cr.val, null, cr.a, L.opacity, mask, mode);
        }
      }
    }
  }

  private blend(ch: ChannelId, idx: Int32Array, buf: Float32Array | null, cst: number[] | null, alpha: Float32Array | null, opacity: number, mask: Float32Array | null, mode: BlendMode) {
    const size = channelSize(ch), acc = this.out[ch];
    const lo = ch === "height" ? -1 : 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      let a = opacity;
      if (mask) a *= mask[i];
      if (alpha) a *= alpha[i];
      if (a <= 0) continue;
      for (let c = 0; c < size; c++) {
        const d = acc[i * size + c];
        const s = buf ? buf[i * size + c] : cst![c];
        const r = mode === "normal" ? s : blendOp(mode, d, s);
        const v = d + (r - d) * a;
        acc[i * size + c] = v < lo ? lo : v > 1 ? 1 : v;
      }
    }
  }

  // ---------------------------------------------------------------- masks

  private mask(mask: Mask, layerId: string): Float32Array {
    let buf = this.maskCache.get(mask);
    if (buf) return buf;
    buf = new Float32Array(this.N);
    this.evalMask(mask, layerId, this.maps.texels, buf);
    this.maskCache.set(mask, buf);
    return buf;
  }

  private evalMask(mask: Mask, layerId: string, idx: Int32Array, buf: Float32Array) {
    for (let k = 0; k < idx.length; k++) buf[idx[k]] = mask.base;
    for (const e of mask.effects) {
      if (!e.visible) continue;
      if (e.type === "levels") {
        const span = Math.max(1e-4, e.high - e.low), g = 1 / Math.max(0.01, e.gamma);
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          buf[i] = Math.pow(clamp((buf[i] - e.low) / span), g);
        }
        continue;
      }
      let val: Float32Array, alpha: Float32Array | null = null;
      if (e.type === "generator") {
        let g = this.genCache.get(e.generator);
        if (!g) {
          if (needsBake(e.generator) && this.doc) this.ensureBaked(this.doc);
          g = evalGenerator(e.generator, this.maps, this.baked);
          this.genCache.set(e.generator, g);
        }
        val = g;
      } else {
        const r = this.paintRaster(`${layerId}/${e.id}`, e.strokes, true).raster.channels.mask;
        if (!r) continue;
        val = r.val;
        alpha = r.a;
      }
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const a = e.opacity * (alpha ? alpha[i] : 1);
        if (a <= 0) continue;
        const d = buf[i];
        buf[i] = clamp(d + (blendOp(e.blend, d, val[i]) - d) * a);
      }
    }
    if (mask.invert) for (let k = 0; k < idx.length; k++) buf[idx[k]] = 1 - buf[idx[k]];
  }

  // ---------------------------------------------------------------- paint

  /** Cached raster of a paint layer (layer != null) or a mask paint effect; applies appended strokes. */
  private paintRaster(key: string, strokes: Stroke[], isMask: boolean): { raster: PaintRaster; touched: number[] } {
    let r = this.rasters.get(key);
    if (r && r.strokes === strokes) return { raster: r, touched: [] };
    const touched: number[] = [];
    let from = 0, appending = false;
    if (r && isAppend(r.strokes, strokes)) {
      from = r.strokes.length;
      appending = true;
    } else {
      r = { strokes, channels: {} };
      this.rasters.set(key, r);
    }
    for (let k = from; k < strokes.length; k++) {
      const s = strokes[k];
      const pc = this.pendingCommit;
      if (pc && pc.key === key && k === strokes.length - 1 && s.points.length === pc.points && Math.abs(s.points[0] - pc.first) < 1e-4 && Math.abs(s.points[s.points.length - 1] - pc.last) < 1e-4 && appending) {
        // the live stroke already painted this into the raster
        this.pendingCommit = null;
        continue;
      }
      const ap = new StrokeApplier(this, r, s, isMask);
      for (const i of ap.extend(s.points, s.pressure)) touched.push(i);
    }
    r.strokes = strokes;
    return { raster: r, touched };
  }

  /** @internal used by StrokeApplier */
  depthFor(stroke: Stroke): DepthView | null {
    if (stroke.brush.projection !== "view" || !stroke.camera) return null;
    const key = JSON.stringify(stroke.camera);
    let d = this.depthCache.get(key);
    if (!d) {
      d = depthView(this.mesh, stroke.camera, 512, 512);
      this.depthCache.set(key, d);
      if (this.depthCache.size > 8) this.depthCache.delete(this.depthCache.keys().next().value!);
    }
    return d;
  }

  // ---------------------------------------------------------------- live painting (desktop)

  /**
   * Start painting interactively into a paint layer (or a mask paint effect when `effectId` is set).
   * The engine's current document must already contain the target.
   */
  beginLive(layerId: string, stroke: Stroke, effectId?: string) {
    if (!this.doc) throw new Error("Engine has no document");
    this.cancelLive();
    const key = effectId ? `${layerId}/${effectId}` : layerId;
    let strokes: Stroke[] | null = null;
    const find = (ls: Layer[]): void => {
      for (const l of ls) {
        if (l.id === layerId) {
          if (effectId) {
            const e = l.mask?.effects.find((x) => x.id === effectId);
            if (e?.type === "paint") strokes = e.strokes;
          } else if (l.type === "paint") strokes = l.strokes;
        }
        if (l.type === "folder") find(l.children);
      }
    };
    find(this.doc.layers);
    if (!strokes) throw new Error(`Paint target ${key} not found`);
    const r = this.paintRaster(key, strokes, !!effectId).raster;
    const live: LiveStroke = { key, layerId, effectId, stroke: { ...stroke, points: [], pressure: stroke.pressure ? [] : undefined }, applier: new StrokeApplier(this, r, stroke, !!effectId) };
    this.live = live;
  }

  /** Add points to the live stroke; recomposites the touched texels. */
  extendLive(points: number[], pressure?: number[]): SyncResult {
    const t0 = performance.now();
    const live = this.live;
    if (!live || !this.doc) return { changed: false, rect: null, full: false, ms: 0 };
    live.stroke.points.push(...points);
    if (pressure && live.stroke.pressure) live.stroke.pressure.push(...pressure);
    const changed = live.applier.extend(points, pressure);
    if (!changed.length) return { changed: false, rect: null, full: false, ms: performance.now() - t0 };
    const idx = Int32Array.from(new Set(changed));
    if (live.effectId) {
      const layer = findLayer(this.doc.layers, live.layerId);
      if (layer?.mask) {
        const buf = this.mask(layer.mask, layer.id);
        this.evalMask(layer.mask, layer.id, idx, buf);
      }
    }
    const rect = this.updateTexels(this.doc, idx);
    return { changed: true, rect, full: false, ms: performance.now() - t0 };
  }

  /** Finish the live stroke. Returns it for the paint command; the next sync will not paint it twice. */
  endLive(): { key: string; layerId: string; effectId?: string; stroke: Stroke } | null {
    const live = this.live;
    this.live = null;
    if (!live) return null;
    if (!live.stroke.points.length) return null;
    const p = live.stroke.points;
    this.pendingCommit = { key: live.key, points: p.length, first: p[0], last: p[p.length - 1] };
    // the raster now holds this stroke; record it as "known" so an exact append is recognized
    return { key: live.key, layerId: live.layerId, effectId: live.effectId, stroke: live.stroke };
  }

  /** Abort the live stroke and restore the texels it changed. */
  cancelLive(): SyncResult | null {
    const live = this.live;
    this.live = null;
    if (!live || !this.doc) return null;
    const idx = live.applier.restore();
    if (live.effectId) {
      const layer = findLayer(this.doc.layers, live.layerId);
      if (layer?.mask) this.evalMask(layer.mask, layer.id, idx, this.mask(layer.mask, layer.id));
    }
    const rect = this.updateTexels(this.doc, idx);
    return { changed: true, rect, full: false, ms: 0 };
  }

  // ---------------------------------------------------------------- normals, outputs, queries

  private normals(doc: PatinaDocument, idx: Int32Array) {
    const { res } = this;
    const h = this.out.height, n = this.out.normal, cov = this.maps.covered;
    const k = doc.normalStrength * res * 0.02;
    for (let q = 0; q < idx.length; q++) {
      const i = idx[q], x = i % res, y = (i / res) | 0;
      const l = x > 0 && cov[i - 1] ? h[i - 1] : NaN, r = x < res - 1 && cov[i + 1] ? h[i + 1] : NaN;
      const u = y > 0 && cov[i - res] ? h[i - res] : NaN, d = y < res - 1 && cov[i + res] ? h[i + res] : NaN;
      const hc = h[i];
      const dx = !isNaN(l) && !isNaN(r) ? (r - l) / 2 : !isNaN(r) ? r - hc : !isNaN(l) ? hc - l : 0;
      const dy = !isNaN(u) && !isNaN(d) ? (d - u) / 2 : !isNaN(d) ? d - hc : !isNaN(u) ? hc - u : 0;
      const nx = -dx * k, ny = dy * k;
      const len = Math.hypot(nx, ny, 1);
      n[i * 3] = nx / len;
      n[i * 3 + 1] = ny / len;
      n[i * 3 + 2] = 1 / len;
    }
  }

  /** Textures for the renderers (live views of the engine buffers, do not mutate). */
  textures(): MaterialTextures {
    return { res: this.res, ...this.out, ao: this.baked?.ao, curvature: this.baked?.curvature };
  }

  /** Composited values at a texel (for colour pickers and agent checks). */
  sampleTexel(i: number) {
    const o = this.out;
    const hex = (b: Float32Array, k: number) => "#" + [0, 1, 2].map((c) => Math.round(clamp(b[k * 3 + c]) * 255).toString(16).padStart(2, "0")).join("");
    return {
      baseColor: hex(o.baseColor, i),
      metallic: round3(o.metallic[i]),
      roughness: round3(o.roughness[i]),
      height: round3(o.height[i]),
      emissive: hex(o.emissive, i),
      ao: this.baked ? round3(this.baked.ao[i]) : null,
      curvature: this.baked ? round3(this.baked.curvature[i]) : null,
    };
  }

  /** Texel nearest to an object-space point (or -1). */
  texelNear(p: Vec3, radius = this.maps.bounds.size * 0.02): number {
    let best = -1, bd = radius * radius;
    const pos = this.maps.pos;
    this.maps.grid.forEachNear(p[0], p[1], p[2], radius, (i) => {
      const d = (pos[i * 3] - p[0]) ** 2 + (pos[i * 3 + 1] - p[1]) ** 2 + (pos[i * 3 + 2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  raycast(origin: Vec3, dir: Vec3) {
    const hit = this.bvh.intersect(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2]);
    if (!hit) return null;
    const s = surfaceAt(this.mesh, hit.tri, hit.u, hit.v);
    return { ...s, distance: hit.t, triangle: hit.tri };
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function applyAllDilation(o: EngineOutputs, map: Int32Array) {
  applyDilation(o.baseColor, 3, map);
  applyDilation(o.emissive, 3, map);
  applyDilation(o.normal, 3, map);
  applyDilation(o.metallic, 1, map);
  applyDilation(o.roughness, 1, map);
  applyDilation(o.height, 1, map);
}

function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "folder") {
      const f = findLayer(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

interface LiveStroke {
  key: string;
  layerId: string;
  effectId?: string;
  stroke: Stroke;
  applier: StrokeApplier;
}

/**
 * Applies one stroke to a paint raster. Keeps the pre-stroke values of every touched texel, so the
 * stroke can grow (live painting) or be undone without replaying the layer.
 */
class StrokeApplier {
  private rz: StrokeRasterizer;
  private chans: { key: ChannelId | "mask"; size: number; value: number[] }[];
  private backupAt: Map<number, number> = new Map();
  private backup: number[] = [];

  constructor(
    engine: TextureEngine,
    private raster: PaintRaster,
    private stroke: Stroke,
    mask: boolean,
  ) {
    this.rz = new StrokeRasterizer(stroke, engine.maps, engine.depthFor(stroke));
    const N = engine.N;
    if (mask) this.chans = [{ key: "mask", size: 1, value: [stroke.value ?? 1] }];
    else if (stroke.erase && !stroke.material) this.chans = (Object.keys(raster.channels) as ChannelId[]).map((k) => ({ key: k, size: channelSize(k), value: [] }));
    else
      this.chans = CHANNELS.filter((c) => stroke.material?.[c] !== undefined).map((c) => {
        const v = stroke.material![c]!;
        return { key: c, size: channelSize(c), value: typeof v === "string" ? hexToRgb(v) : [v] };
      });
    for (const c of this.chans) if (!raster.channels[c.key]) raster.channels[c.key] = { val: new Float32Array(N * c.size), a: new Float32Array(N) };
  }

  extend(points: ArrayLike<number>, pressure?: ArrayLike<number>): number[] {
    const changed = this.rz.addPoints(points, pressure);
    const op = this.stroke.brush.opacity;
    const erase = !!this.stroke.erase;
    const out: number[] = [];
    for (const i of changed) {
      let at = this.backupAt.get(i);
      if (at === undefined) {
        at = this.backup.length;
        this.backupAt.set(i, at);
        for (const c of this.chans) {
          const r = this.raster.channels[c.key]!;
          this.backup.push(r.a[i]);
          for (let k = 0; k < c.size; k++) this.backup.push(r.val[i * c.size + k]);
        }
        out.push(i);
      }
      const s = Math.min(1, this.rz.cov[i]) * op;
      let o = at;
      for (const c of this.chans) {
        const r = this.raster.channels[c.key]!;
        const a0 = this.backup[o];
        if (erase) {
          r.a[i] = a0 * (1 - s);
          for (let k = 0; k < c.size; k++) r.val[i * c.size + k] = this.backup[o + 1 + k];
        } else {
          const a1 = a0 + s * (1 - a0);
          r.a[i] = a1;
          for (let k = 0; k < c.size; k++) {
            const v0 = this.backup[o + 1 + k];
            r.val[i * c.size + k] = a1 > 0 ? (v0 * a0 * (1 - s) + c.value[k] * s) / a1 : c.value[k];
          }
        }
        o += 1 + c.size;
      }
    }
    void out;
    return Array.from(new Set(changed));
  }

  /** Put back pre-stroke values; returns the texels restored. */
  restore(): Int32Array {
    const idx: number[] = [];
    for (const [i, at] of this.backupAt) {
      let o = at;
      for (const c of this.chans) {
        const r = this.raster.channels[c.key]!;
        r.a[i] = this.backup[o];
        for (let k = 0; k < c.size; k++) r.val[i * c.size + k] = this.backup[o + 1 + k];
        o += 1 + c.size;
      }
      idx.push(i);
    }
    return Int32Array.from(idx);
  }
}
