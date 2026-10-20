import { z } from "zod";
import { uvToObject } from "./brush.js";
import { VIEW_NAMES, type ViewName } from "./camera.js";
import { createDocument, findLayer, insertLayer, normalizeDocument, removeLayer, requireLayer, RESOLUTIONS, updateLayer, walk } from "./doc.js";
import { defineCommand, type CommandContext, type CommandDef } from "./editor.js";
import { EXPORT_PRESETS } from "./export.js";
import { DEFAULT_GENERATOR } from "./generators.js";
import { instantiate, instantiateMask, MASKS, maskPreset, MATERIALS, materialPreset, SMART_MATERIALS, smartMaterial } from "./materials.js";
import { meshBounds, triangleCount } from "./mesh.js";
import { PRIMITIVES } from "./primitives.js";
import { blendMode, brushInput, cameraInput, generatorInput, generatorPatch, hex, materialInput, materialPatch, paintMaterial, unit, vec3 } from "./schema.js";
import { CHANNELS, type ChannelId, type Layer, type Mask, type MaskEffect, type Material, type PatinaDocument, type Stroke } from "./types.js";
import { ENVIRONMENTS } from "./env.js";

const viewInput = z.union([z.enum(VIEW_NAMES), cameraInput]);
const primitiveName = z.enum(["orb", "roundedCube", "sphere", "cylinder", "torus", "plane", "capsule"]);
const layerType = z.enum(["fill", "paint", "folder"]);

function allocator(doc: PatinaDocument) {
  let n = doc.nextId;
  return { alloc: (p: "L" | "E") => `${p}${n++}`, done: (d: PatinaDocument): PatinaDocument => ({ ...d, nextId: n }) };
}

function session(ctx: CommandContext) {
  if (!ctx.session) throw new Error("This command needs a mesh session (CLI, MCP or desktop), not a bare editor");
  return ctx.session;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

function layerSummary(l: Layer): Record<string, unknown> {
  const base: Record<string, unknown> = { id: l.id, type: l.type, name: l.name };
  if (!l.visible) base.visible = false;
  if (l.opacity !== 1) base.opacity = l.opacity;
  if (l.blend !== "normal") base.blend = l.blend;
  if (l.channelBlend) base.channelBlend = l.channelBlend;
  if (l.type === "fill") base.material = l.material;
  if (l.type === "paint") {
    base.strokes = l.strokes.length;
    const ch = new Set<string>();
    for (const s of l.strokes) for (const k of Object.keys(s.material ?? {})) ch.add(k);
    base.channels = [...ch];
  }
  if (l.mask)
    base.mask = {
      ...(l.mask.enabled ? {} : { enabled: false }),
      base: l.mask.base,
      ...(l.mask.invert ? { invert: true } : {}),
      effects: [...l.mask.effects].reverse().map((e) =>
        e.type === "generator"
          ? { id: e.id, type: e.type, name: e.name, blend: e.blend, opacity: e.opacity, generator: e.generator.type, amount: e.generator.amount, ...(e.visible ? {} : { visible: false }) }
          : e.type === "paint"
            ? { id: e.id, type: e.type, name: e.name, blend: e.blend, strokes: e.strokes.length }
            : { id: e.id, type: e.type, name: e.name, low: e.low, high: e.high, gamma: e.gamma },
      ),
    };
  if (l.type === "folder") base.children = [...l.children].reverse().map(layerSummary);
  return base;
}

function targetLayer(ctx: CommandContext, id: string | undefined, fallback?: (l: Layer) => boolean): Layer {
  let lid = id ?? ctx.editor.state.selection;
  if (!lid && fallback) {
    // topmost matching layer
    const all: Layer[] = [];
    walk(ctx.doc.layers, (l) => all.push(l));
    lid = [...all].reverse().find(fallback)?.id ?? null;
  }
  if (!lid) throw new Error("No layer given and nothing selected. Pass layer:'L1' (see doc.inspect) or select one with layer.select");
  return requireLayer(ctx.doc, lid);
}

function setMask(layers: Layer[], id: string, fn: (m: Mask | undefined) => Mask | undefined): Layer[] {
  return updateLayer(layers, id, (l) => {
    const m = fn(l.mask);
    const { mask: _drop, ...rest } = l;
    void _drop;
    return (m ? { ...rest, mask: m } : rest) as Layer;
  });
}

function requireMask(l: Layer): Mask {
  if (!l.mask) throw new Error(`Layer ${l.id} (${l.name}) has no mask. Add one with mask.add {layer:'${l.id}'}`);
  return l.mask;
}

function requireEffect(l: Layer, id: string): MaskEffect {
  const e = requireMask(l).effects.find((x) => x.id === id);
  if (!e) throw new Error(`Mask of ${l.id} has no effect "${id}". Effects: ${requireMask(l).effects.map((x) => `${x.id} (${x.name})`).join(", ") || "none"}`);
  return e;
}

function maskFromPreset(preset: string, alloc: (p: "L" | "E") => string): Mask {
  if (preset === "white") return { enabled: true, base: 1, invert: false, effects: [] };
  if (preset === "black") return { enabled: true, base: 0, invert: false, effects: [] };
  const p = maskPreset(preset);
  return instantiateMask({ base: p.base, effects: p.effects }, alloc);
}

function newLayer(type: "fill" | "paint" | "folder", id: string, name: string | undefined, material: Material | undefined): Layer {
  const base = { id, visible: true, opacity: 1, blend: "normal" as const };
  if (type === "fill") return { ...base, type, name: name ?? "Fill layer", material: material ?? { baseColor: "#808080" } };
  if (type === "paint") return { ...base, type, name: name ?? "Paint layer", strokes: [] };
  return { ...base, type, name: name ?? "Folder", children: [] };
}

/** Where to insert: explicit parent/index, or above another layer, or above the selection. */
function placement(ctx: CommandContext, p: { parent?: string | null; index?: number; above?: string }): { parent: string | null; index?: number } {
  if (p.above) {
    const f = findLayer(ctx.doc.layers, p.above);
    if (!f) throw new Error(`above: no layer "${p.above}"`);
    return { parent: f.parent?.id ?? null, index: f.index + 1 };
  }
  if (p.parent !== undefined || p.index !== undefined) return { parent: p.parent ?? null, index: p.index };
  const sel = ctx.editor.state.selection;
  const f = sel ? findLayer(ctx.doc.layers, sel) : null;
  if (f) return f.layer.type === "folder" ? { parent: f.layer.id } : { parent: f.parent?.id ?? null, index: f.index + 1 };
  return { parent: null };
}

function cloneWithIds(l: Layer, alloc: (p: "L" | "E") => string): Layer {
  const c = structuredClone(l);
  const re = (x: Layer): Layer => {
    x.id = alloc("L");
    if (x.mask) x.mask.effects = x.mask.effects.map((e) => ({ ...e, id: alloc("E") }));
    if (x.type === "folder") x.children = x.children.map(re);
    return x;
  };
  return re(c);
}

export function createCommands(): CommandDef[] {
  const cmds: CommandDef[] = [
    // ---------------------------------------------------------------- document
    defineCommand({
      id: "doc.inspect",
      title: "Inspect document",
      description: "Mesh, texture set, layer stack (top first) with ids, masks and materials, bake and view settings. Start here.",
      params: z.strictObject({}),
      mutates: false,
      run: (ctx) => {
        const d = ctx.doc;
        const out: Record<string, unknown> = { name: d.name, resolution: d.resolution, normalStrength: d.normalStrength, base: d.base };
        if (ctx.session) {
          const m = ctx.session.mesh(d.mesh);
          const b = meshBounds(m);
          out.mesh = { ...d.mesh, name: m.name, triangles: triangleCount(m), vertices: m.positions.length / 3, parts: m.parts?.map((p) => p.name), bounds: { min: b.min.map(round), max: b.max.map(round), center: b.center.map(round), size: round(b.size) } };
        } else out.mesh = d.mesh;
        out.layers = [...d.layers].reverse().map(layerSummary);
        out.selection = ctx.editor.state.selection;
        out.bake = { ...d.bake, baked: !!ctx.session?.engine().baked };
        out.view = d.view;
        out.history = { undo: ctx.editor.history().undo.length, redo: ctx.editor.history().redo.length };
        out.notes =
          "Layers are listed top first (the top layer covers the ones below). Positions are object space; brush and noise sizes are relative to the mesh bounding-box diagonal (mesh.bounds.size). Use render_preview to look at the result.";
        return out;
      },
    }),
    defineCommand({ id: "doc.json", title: "Document JSON", description: "The whole document as JSON (what .patina files contain).", params: z.strictObject({}), mutates: false, run: (ctx) => ctx.doc }),
    defineCommand({
      id: "doc.new",
      title: "New document",
      description: "Start over with an empty layer stack on a mesh (built-in primitive by default: orb, roundedCube, sphere, cylinder, torus, capsule, plane).",
      params: z.strictObject({ name: z.string().min(1).max(120).optional(), primitive: primitiveName.optional(), segments: z.number().int().min(8).max(128).optional(), resolution: z.union(RESOLUTIONS.map((r) => z.literal(r)) as [z.ZodLiteral<256>, ...z.ZodLiteral<number>[]]).optional() }),
      mutates: true,
      run: (ctx, p) => {
        ctx.set(createDocument({ name: p.name, resolution: p.resolution, mesh: { source: "primitive", primitive: p.primitive ?? "orb", ...(p.segments ? { segments: p.segments } : {}) } }));
        ctx.editor.select(null);
        return { ok: true };
      },
    }),
    defineCommand({
      id: "doc.load",
      title: "Load document",
      description: "Replace the document with a given Patina document object (undoable).",
      params: z.strictObject({ document: z.record(z.string(), z.unknown()) }),
      mutates: true,
      run: (ctx, p) => {
        ctx.set(normalizeDocument(p.document));
        return { ok: true };
      },
    }),
    defineCommand({
      id: "doc.set",
      title: "Document settings",
      description: "Name, texture resolution (256..4096), normal strength (height to normal), and the base material under all layers.",
      params: z.strictObject({
        name: z.string().min(1).max(120).optional(),
        resolution: z.union(RESOLUTIONS.map((r) => z.literal(r)) as [z.ZodLiteral<256>, ...z.ZodLiteral<number>[]]).optional(),
        normalStrength: z.number().min(0).max(10).optional(),
        base: paintMaterial.optional(),
      }),
      mutates: true,
      run: (ctx, p) => {
        const d = ctx.doc;
        ctx.set({ ...d, ...(p.name ? { name: p.name } : {}), ...(p.resolution ? { resolution: p.resolution } : {}), ...(p.normalStrength !== undefined ? { normalStrength: p.normalStrength } : {}), ...(p.base ? { base: { ...d.base, ...p.base } } : {}) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "mesh.set",
      title: "Set mesh",
      description: "Use a built-in primitive (primitive: orb | roundedCube | sphere | cylinder | torus | capsule | plane) or an imported mesh file (path, after mesh_import). Layers stay; painted strokes are kept in object space.",
      params: z.strictObject({ primitive: primitiveName.optional(), segments: z.number().int().min(8).max(128).optional(), path: z.string().optional() }),
      mutates: true,
      run: (ctx, p) => {
        if (!!p.primitive === !!p.path) throw new Error("Pass exactly one of primitive or path");
        const mesh = p.path ? ({ source: "file", path: p.path } as const) : ({ source: "primitive", primitive: p.primitive!, ...(p.segments ? { segments: p.segments } : {}) } as const);
        if (ctx.session && !ctx.session.hasMesh(mesh)) throw new Error(`Mesh ${p.path} is not loaded; import it first (mesh_import tool or File > Import mesh)`);
        ctx.set({ ...ctx.doc, mesh });
        return { ok: true };
      },
    }),
    defineCommand({ id: "primitive.list", title: "List primitives", description: "Built-in meshes.", params: z.strictObject({}), mutates: false, run: () => PRIMITIVES }),

    // ---------------------------------------------------------------- layers
    defineCommand({
      id: "layer.add",
      title: "Add layer",
      description:
        "Add a fill layer (material over the whole surface, usually shaped by a mask), a paint layer (brush strokes) or a folder. Goes above the selected layer unless parent/index/above is given. Fill: pass material {baseColor, metallic, roughness, height, emissive} or preset (see material.list). mask: 'white' | 'black' | a mask preset (see mask.presets).",
      params: z.strictObject({
        type: layerType,
        name: z.string().max(120).optional(),
        material: materialInput.optional(),
        preset: z.string().optional().describe("Material preset id for fill layers"),
        mask: z.string().optional(),
        opacity: unit.optional(),
        blend: blendMode.optional(),
        parent: z.string().nullable().optional(),
        index: z.number().int().min(0).optional(),
        above: z.string().optional(),
        select: z.boolean().default(true),
      }),
      mutates: true,
      run: (ctx, p) => {
        const { alloc, done } = allocator(ctx.doc);
        if (p.type !== "fill" && (p.material || p.preset)) throw new Error(`material/preset only apply to fill layers; ${p.type} layers get their material from strokes`);
        const preset = p.preset ? materialPreset(p.preset) : null;
        const material = p.material ?? (preset ? structuredClone(preset.material) : undefined);
        let layer = newLayer(p.type, alloc("L"), p.name ?? preset?.title, material as Material);
        if (p.opacity !== undefined) layer = { ...layer, opacity: p.opacity };
        if (p.blend) layer = { ...layer, blend: p.blend };
        if (p.mask) layer = { ...layer, mask: maskFromPreset(p.mask, alloc) };
        const at = placement(ctx, p);
        ctx.set(done({ ...ctx.doc, layers: insertLayer(ctx.doc.layers, at.parent, at.index, layer) }));
        if (p.select) ctx.editor.select(layer.id);
        return { id: layer.id };
      },
    }),
    defineCommand({
      id: "layer.update",
      title: "Update layer",
      description: "Change name, visibility, opacity, blend mode, per-channel blend (channelBlend {height:'add', roughness:'off', ...}; null resets), or fill material channels (merged; null removes a channel).",
      params: z.strictObject({
        id: z.string(),
        name: z.string().max(120).optional(),
        visible: z.boolean().optional(),
        opacity: unit.optional(),
        blend: blendMode.optional(),
        channelBlend: z.record(z.enum(CHANNELS as [ChannelId, ...ChannelId[]]), z.union([blendMode, z.literal("off"), z.null()])).optional(),
        material: materialPatch.optional(),
        collapsed: z.boolean().optional(),
      }),
      mutates: true,
      run: (ctx, p) => {
        const l = requireLayer(ctx.doc, p.id);
        if (p.material && l.type !== "fill") throw new Error(`Layer ${l.id} is a ${l.type} layer; material applies to fill layers`);
        if (p.collapsed !== undefined && l.type !== "folder") throw new Error("collapsed applies to folders");
        ctx.set({
          ...ctx.doc,
          layers: updateLayer(ctx.doc.layers, p.id, (x) => {
            const n: Layer = { ...x };
            if (p.name !== undefined) n.name = p.name;
            if (p.visible !== undefined) n.visible = p.visible;
            if (p.opacity !== undefined) n.opacity = p.opacity;
            if (p.blend) n.blend = p.blend;
            if (p.channelBlend) {
              const cb: Record<string, unknown> = { ...(x.channelBlend ?? {}) };
              for (const [k, v] of Object.entries(p.channelBlend)) if (v === null) delete cb[k];
              else cb[k] = v;
              if (Object.keys(cb).length) n.channelBlend = cb as Layer["channelBlend"];
              else delete n.channelBlend;
            }
            if (p.material && n.type === "fill") {
              const mat: Record<string, unknown> = { ...n.material };
              for (const [k, v] of Object.entries(p.material)) if (v === null) delete mat[k];
              else if (v !== undefined) mat[k] = v;
              n.material = mat as Material;
            }
            if (p.collapsed !== undefined && n.type === "folder") n.collapsed = p.collapsed;
            return n;
          }),
        });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "layer.remove",
      title: "Delete layer",
      description: "Remove a layer (and a folder's children).",
      params: z.strictObject({ id: z.string() }),
      mutates: true,
      run: (ctx, p) => {
        requireLayer(ctx.doc, p.id);
        ctx.set({ ...ctx.doc, layers: removeLayer(ctx.doc.layers, p.id).layers });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "layer.move",
      title: "Move layer",
      description: "Reorder: above/below another layer, or into a folder (parent, null = root) at index (0 = bottom).",
      params: z.strictObject({ id: z.string(), above: z.string().optional(), below: z.string().optional(), parent: z.string().nullable().optional(), index: z.number().int().min(0).optional() }),
      mutates: true,
      run: (ctx, p) => {
        const moving = requireLayer(ctx.doc, p.id);
        const banned = new Set<string>();
        walk([moving], (l) => banned.add(l.id));
        const ref = p.above ?? p.below;
        if (ref && banned.has(ref)) throw new Error("Cannot move a layer relative to itself or its children");
        if (p.parent && banned.has(p.parent)) throw new Error("Cannot move a folder into itself");
        const { layers } = removeLayer(ctx.doc.layers, p.id);
        let parent: string | null = p.parent ?? null, index = p.index;
        if (ref) {
          const f = findLayer(layers, ref);
          if (!f) throw new Error(`No layer "${ref}"`);
          parent = f.parent?.id ?? null;
          index = p.above ? f.index + 1 : f.index;
        }
        ctx.set({ ...ctx.doc, layers: insertLayer(layers, parent, index, moving) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "layer.duplicate",
      title: "Duplicate layer",
      description: "Copy a layer (with mask, strokes and children) above itself.",
      params: z.strictObject({ id: z.string() }),
      mutates: true,
      run: (ctx, p) => {
        const f = findLayer(ctx.doc.layers, p.id);
        if (!f) throw new Error(`No layer "${p.id}"`);
        const { alloc, done } = allocator(ctx.doc);
        const copy = cloneWithIds(f.layer, alloc);
        copy.name = `${f.layer.name} copy`;
        ctx.set(done({ ...ctx.doc, layers: insertLayer(ctx.doc.layers, f.parent?.id ?? null, f.index + 1, copy) }));
        ctx.editor.select(copy.id);
        return { id: copy.id };
      },
    }),
    defineCommand({
      id: "layer.clear",
      title: "Clear paint",
      description: "Remove every stroke from a paint layer.",
      params: z.strictObject({ id: z.string() }),
      mutates: true,
      run: (ctx, p) => {
        const l = requireLayer(ctx.doc, p.id);
        if (l.type !== "paint") throw new Error(`Layer ${l.id} is a ${l.type} layer`);
        ctx.set({ ...ctx.doc, layers: updateLayer(ctx.doc.layers, p.id, (x) => ({ ...x, strokes: [] }) as Layer) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "layer.select",
      title: "Select layer",
      description: "Select a layer (commands that take an optional layer use the selection).",
      params: z.strictObject({ id: z.string().nullable() }),
      mutates: false,
      run: (ctx, p) => {
        if (p.id) requireLayer(ctx.doc, p.id);
        ctx.editor.select(p.id);
        return { selection: p.id };
      },
    }),

    // ---------------------------------------------------------------- masks
    defineCommand({
      id: "mask.presets",
      title: "Mask presets",
      description: "Smart masks: generators driven by baked curvature/AO, position, facing and noise.",
      params: z.strictObject({}),
      mutates: false,
      run: () => [{ id: "white", title: "White mask (show all)" }, { id: "black", title: "Black mask (hide all)" }, ...MASKS.map(({ id, title, description }) => ({ id, title, description }))],
    }),
    defineCommand({
      id: "mask.add",
      title: "Add mask",
      description: "Give a layer a mask (replaces an existing one): 'white', 'black' or a mask preset id (edgeWear, dirt, dustTop, grimeBottom, patches, scratches).",
      params: z.strictObject({ layer: z.string(), preset: z.string().default("white"), invert: z.boolean().optional() }),
      mutates: true,
      run: (ctx, p) => {
        requireLayer(ctx.doc, p.layer);
        const { alloc, done } = allocator(ctx.doc);
        const m = maskFromPreset(p.preset, alloc);
        if (p.invert) m.invert = true;
        ctx.set(done({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, () => m) }));
        return { ok: true, effects: m.effects.map((e) => e.id) };
      },
    }),
    defineCommand({
      id: "mask.update",
      title: "Update mask",
      description: "Enable/disable, invert, or change the starting grey level (base 0 = black, 1 = white).",
      params: z.strictObject({ layer: z.string(), enabled: z.boolean().optional(), invert: z.boolean().optional(), base: unit.optional() }),
      mutates: true,
      run: (ctx, p) => {
        requireMask(requireLayer(ctx.doc, p.layer));
        ctx.set({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, (m) => ({ ...m!, ...(p.enabled !== undefined ? { enabled: p.enabled } : {}), ...(p.invert !== undefined ? { invert: p.invert } : {}), ...(p.base !== undefined ? { base: p.base } : {}) })) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "mask.remove",
      title: "Remove mask",
      description: "Delete a layer's mask.",
      params: z.strictObject({ layer: z.string() }),
      mutates: true,
      run: (ctx, p) => {
        requireMask(requireLayer(ctx.doc, p.layer));
        ctx.set({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, () => undefined) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "mask.effect.add",
      title: "Add mask effect",
      description:
        "Add to a layer's mask stack (creates a black mask if missing): type 'generator' (generator {type: edgeWear|dirt|gradient|noise|facing|curvature|ao|uniform, amount, softness, breakup, ...}), 'paint' (paint into it with paint.stroke effect:id) or 'levels' (low, high, gamma). preset adds the effects of a mask preset.",
      params: z.strictObject({
        layer: z.string(),
        type: z.enum(["generator", "paint", "levels"]).optional(),
        preset: z.string().optional(),
        generator: generatorInput.optional(),
        name: z.string().max(80).optional(),
        blend: blendMode.optional(),
        opacity: unit.optional(),
        low: unit.optional(),
        high: unit.optional(),
        gamma: z.number().min(0.05).max(10).optional(),
      }),
      mutates: true,
      run: (ctx, p) => {
        requireLayer(ctx.doc, p.layer);
        const { alloc, done } = allocator(ctx.doc);
        let added: MaskEffect[];
        if (p.preset) {
          const pr = maskPreset(p.preset);
          added = instantiateMask({ base: 0, effects: pr.effects }, alloc).effects;
        } else {
          const type = p.type ?? (p.generator ? "generator" : undefined);
          if (!type) throw new Error("Pass type ('generator' | 'paint' | 'levels') or preset");
          const id = alloc("E");
          if (type === "generator") added = [{ id, type, name: p.name ?? p.generator?.type ?? "Generator", visible: true, blend: p.blend ?? "max", opacity: p.opacity ?? 1, generator: p.generator ?? { ...DEFAULT_GENERATOR } }];
          else if (type === "paint") added = [{ id, type, name: p.name ?? "Paint", visible: true, blend: p.blend ?? "normal", opacity: p.opacity ?? 1, strokes: [] }];
          else added = [{ id, type, name: p.name ?? "Levels", visible: true, low: p.low ?? 0, high: p.high ?? 1, gamma: p.gamma ?? 1 }];
        }
        ctx.set(done({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, (m) => ({ ...(m ?? { enabled: true, base: 0, invert: false, effects: [] }), effects: [...(m?.effects ?? []), ...added] })) }));
        return { ids: added.map((e) => e.id) };
      },
    }),
    defineCommand({
      id: "mask.effect.update",
      title: "Update mask effect",
      description: "Change a mask effect: name, visible, blend, opacity, generator fields (merged, nested breakup/noise merge too), levels low/high/gamma.",
      params: z.strictObject({
        layer: z.string(),
        id: z.string(),
        name: z.string().max(80).optional(),
        visible: z.boolean().optional(),
        blend: blendMode.optional(),
        opacity: unit.optional(),
        generator: generatorPatch.optional(),
        low: unit.optional(),
        high: unit.optional(),
        gamma: z.number().min(0.05).max(10).optional(),
      }),
      mutates: true,
      run: (ctx, p) => {
        const e = requireEffect(requireLayer(ctx.doc, p.layer), p.id);
        if (p.generator && e.type !== "generator") throw new Error(`Effect ${p.id} is a ${e.type} effect`);
        const next: MaskEffect = { ...e } as MaskEffect;
        if (p.name !== undefined) next.name = p.name;
        if (p.visible !== undefined) next.visible = p.visible;
        if (next.type !== "levels") {
          if (p.blend) next.blend = p.blend;
          if (p.opacity !== undefined) next.opacity = p.opacity;
        } else {
          if (p.low !== undefined) next.low = p.low;
          if (p.high !== undefined) next.high = p.high;
          if (p.gamma !== undefined) next.gamma = p.gamma;
        }
        if (p.generator && next.type === "generator") {
          const g = next.generator;
          next.generator = { ...g, ...p.generator, breakup: { ...g.breakup, ...p.generator.breakup }, noise: { ...g.noise, ...p.generator.noise } } as typeof g;
        }
        ctx.set({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, (m) => ({ ...m!, effects: m!.effects.map((x) => (x.id === p.id ? next : x)) })) });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "mask.effect.remove",
      title: "Remove mask effect",
      description: "Delete one effect from a mask stack.",
      params: z.strictObject({ layer: z.string(), id: z.string() }),
      mutates: true,
      run: (ctx, p) => {
        requireEffect(requireLayer(ctx.doc, p.layer), p.id);
        ctx.set({ ...ctx.doc, layers: setMask(ctx.doc.layers, p.layer, (m) => ({ ...m!, effects: m!.effects.filter((x) => x.id !== p.id) })) });
        return { ok: true };
      },
    }),

    // ---------------------------------------------------------------- painting
    defineCommand({
      id: "paint.stroke",
      title: "Paint stroke",
      description:
        "Paint one brush stroke. Target: a paint layer (material {baseColor, roughness, metallic, height, emissive}), or a layer's mask (mask:true or effect:'E3', value 0..1). Path: points [[x,y,z],...] in object space, uv [[u,v],...] (0..1, v down), or screen [[x,y],...] (0..1 from top-left) seen from view ('front','iso',... or a camera). Brush: size (relative to mesh size, 0.03 default), hardness, flow, opacity, spacing, alpha (round|spray|grunge|speckle), projection (sphere|view), symmetry (none|x|y|z). erase:true removes paint.",
      params: z.strictObject({
        layer: z.string().optional(),
        mask: z.boolean().optional(),
        effect: z.string().optional(),
        brush: brushInput.optional(),
        material: paintMaterial.optional(),
        value: unit.optional(),
        erase: z.boolean().optional(),
        points: z.array(vec3).min(1).optional(),
        uv: z.array(z.tuple([z.number(), z.number()])).min(1).optional(),
        screen: z.array(z.tuple([z.number(), z.number()])).min(1).optional(),
        view: viewInput.optional(),
        pressure: z.array(unit).optional(),
      }),
      mutates: true,
      run: (ctx, p) => {
        const layer = targetLayer(ctx, p.layer, (l) => (p.mask || p.effect ? !!l.mask : l.type === "paint"));
        const sources = [p.points, p.uv, p.screen].filter(Boolean).length;
        if (sources !== 1) throw new Error("Pass exactly one path: points (object space), uv, or screen (+ view)");
        const toMask = p.mask || !!p.effect;
        if (!toMask && layer.type !== "paint")
          throw new Error(`Layer ${layer.id} is a ${layer.type} layer. Paint into its mask with mask:true, or add a paint layer (layer.add {type:'paint'})`);
        if (!toMask && !p.erase && !p.material) throw new Error("Paint layers need material, e.g. {baseColor:'#ff3b2e', roughness:0.4}");
        if (toMask && p.material) throw new Error("Mask painting uses value (0 black .. 1 white), not material");
        const brush = p.brush ?? brushInput.parse({});
        const s = ctx.session;
        let pts: number[] = [];
        let camera: Stroke["camera"];
        if (p.points) pts = p.points.flat();
        else if (p.uv) {
          const eng = session(ctx).engine();
          for (const [u, v] of p.uv) {
            const q = uvToObject(eng.maps, u, v);
            if (q) pts.push(...q);
          }
          if (!pts.length) throw new Error("None of the uv points fall on a UV island");
        } else {
          const sess = session(ctx);
          const cam = sess.camera((p.view ?? "front") as ViewName);
          for (const [x, y] of p.screen!) {
            const hit = sess.pick(cam, x, y, 1);
            if (hit) pts.push(...hit.position);
          }
          if (!pts.length) throw new Error(`No screen point hits the mesh from this view. Render it (render_preview view:${JSON.stringify(p.view ?? "front")}) to see where the object is.`);
          if (brush.projection === "view") camera = cam;
        }
        if (brush.projection === "view" && !camera) {
          if (!s) throw new Error('projection "view" needs a session');
          camera = s.camera((p.view ?? "front") as ViewName);
        }
        const stroke: Stroke = { brush, points: pts.map(round), ...(p.pressure ? { pressure: p.pressure } : {}), ...(camera ? { camera } : {}), ...(p.erase ? { erase: true } : {}) };
        if (toMask) stroke.value = p.value ?? 1;
        else if (p.material) stroke.material = p.material;
        let effectId = p.effect;
        const { alloc, done } = allocator(ctx.doc);
        let layers = ctx.doc.layers;
        if (toMask) {
          if (effectId) requireEffect(layer, effectId);
          else {
            const existing = [...(layer.mask?.effects ?? [])].reverse().find((e) => e.type === "paint");
            if (existing) effectId = existing.id;
            else {
              effectId = alloc("E");
              const eff: MaskEffect = { id: effectId, type: "paint", name: "Paint", visible: true, blend: "normal", opacity: 1, strokes: [] };
              layers = setMask(layers, layer.id, (m) => ({ ...(m ?? { enabled: true, base: 0, invert: false, effects: [] }), effects: [...(m?.effects ?? []), eff] }));
            }
          }
          const eid = effectId;
          layers = setMask(layers, layer.id, (m) => ({ ...m!, effects: m!.effects.map((e) => (e.id === eid && e.type === "paint" ? { ...e, strokes: [...e.strokes, stroke] } : e)) }));
        } else layers = updateLayer(layers, layer.id, (l) => ({ ...l, strokes: [...(l as { strokes: Stroke[] }).strokes, stroke] }) as Layer);
        ctx.set(done({ ...ctx.doc, layers }));
        return { layer: layer.id, ...(toMask ? { effect: effectId } : {}), points: pts.length / 3 };
      },
    }),

    // ---------------------------------------------------------------- materials
    defineCommand({ id: "material.list", title: "List materials", description: "Base material presets (fill layers).", params: z.strictObject({}), mutates: false, run: () => MATERIALS.map(({ id, title, group }) => ({ id, title, group })) }),
    defineCommand({
      id: "material.apply",
      title: "Apply material",
      description: "Add a fill layer with a material preset, optionally shaped by a mask preset (e.g. preset:'rust', mask:'dirt').",
      params: z.strictObject({ preset: z.string(), name: z.string().optional(), mask: z.string().optional(), parent: z.string().nullable().optional(), index: z.number().int().min(0).optional(), above: z.string().optional() }),
      mutates: true,
      run: (ctx, p) => {
        const pr = materialPreset(p.preset);
        const { alloc, done } = allocator(ctx.doc);
        let layer = newLayer("fill", alloc("L"), p.name ?? pr.title, structuredClone(pr.material));
        if (p.mask) layer = { ...layer, mask: maskFromPreset(p.mask, alloc) };
        const at = placement(ctx, p);
        ctx.set(done({ ...ctx.doc, layers: insertLayer(ctx.doc.layers, at.parent, at.index, layer) }));
        ctx.editor.select(layer.id);
        return { id: layer.id };
      },
    }),
    defineCommand({ id: "smart.list", title: "List smart materials", description: "Layered materials with procedural wear (folders of fill layers + generator masks).", params: z.strictObject({}), mutates: false, run: () => SMART_MATERIALS.map(({ id, title, description }) => ({ id, title, description })) }),
    defineCommand({
      id: "smart.apply",
      title: "Apply smart material",
      description: "Add a smart material as a folder of layers (bakes curvature/AO on first use). Tweak its layers afterwards with layer.update / mask.effect.update.",
      params: z.strictObject({ preset: z.string(), name: z.string().optional(), parent: z.string().nullable().optional(), index: z.number().int().min(0).optional(), above: z.string().optional() }),
      mutates: true,
      run: (ctx, p) => {
        const sm = smartMaterial(p.preset);
        const { alloc, done } = allocator(ctx.doc);
        const folder: Layer = { id: alloc("L"), type: "folder", name: p.name ?? sm.title, visible: true, opacity: 1, blend: "normal", children: instantiate(sm.layers, alloc) };
        const at = placement(ctx, p);
        ctx.set(done({ ...ctx.doc, layers: insertLayer(ctx.doc.layers, at.parent, at.index, folder) }));
        ctx.editor.select(folder.id);
        return { id: folder.id, children: (folder as { children: Layer[] }).children.map((c) => ({ id: c.id, name: c.name })) };
      },
    }),

    // ---------------------------------------------------------------- bake, view
    defineCommand({
      id: "bake.set",
      title: "Bake settings",
      description: "Curvature radius and AO distance (relative to mesh size), AO samples, bake resolution. Generators re-bake on the next update.",
      params: z.strictObject({ curvatureRadius: z.number().min(0.002).max(0.5).optional(), aoSamples: z.number().int().min(4).max(256).optional(), aoDistance: z.number().min(0.01).max(2).optional(), resolution: z.union([z.literal(128), z.literal(256), z.literal(512), z.literal(1024), z.literal(2048)]).optional() }),
      mutates: true,
      run: (ctx, p) => {
        ctx.set({ ...ctx.doc, bake: { ...ctx.doc.bake, ...p } });
        return { ok: true };
      },
    }),
    defineCommand({
      id: "bake.run",
      title: "Bake mesh maps",
      description: "Bake curvature and ambient occlusion now (otherwise done on first need).",
      params: z.strictObject({}),
      mutates: false,
      run: (ctx) => {
        const t = performance.now();
        const baked = session(ctx).engine().ensureBaked(ctx.doc);
        return { baked, ms: Math.round(performance.now() - t) };
      },
    }),
    defineCommand({
      id: "view.set",
      title: "View settings",
      description: `Lighting environment (${ENVIRONMENTS.map((e) => e.name).join(", ")}), exposure (stops), rotation (degrees), background colour.`,
      params: z.strictObject({ environment: z.enum(["studio", "sunset", "overcast", "night"]).optional(), exposure: z.number().min(-6).max(6).optional(), rotation: z.number().min(-360).max(360).optional(), background: hex.optional() }),
      mutates: true,
      run: (ctx, p) => {
        ctx.set({ ...ctx.doc, view: { ...ctx.doc.view, ...p } });
        return { ok: true };
      },
    }),

    // ---------------------------------------------------------------- queries
    defineCommand({
      id: "views",
      title: "Named views",
      description: "Cameras for the named views (front, back, left, right, top, bottom, iso, isoBack) of the current mesh.",
      params: z.strictObject({}),
      mutates: false,
      run: (ctx) => Object.fromEntries(VIEW_NAMES.map((v) => [v, session(ctx).camera(v)])),
    }),
    defineCommand({
      id: "pick",
      title: "Pick surface",
      description: "Object-space point, normal and UV under a screen position (0..1 from top-left) of a view. Use it to aim strokes.",
      params: z.strictObject({ screen: z.tuple([z.number(), z.number()]), view: viewInput.default("front") }),
      mutates: false,
      run: (ctx, p) => {
        const hit = session(ctx).pick(p.view as ViewName, p.screen[0], p.screen[1], 1);
        return hit ? { position: hit.position.map(round), normal: hit.normal.map(round), uv: hit.uv.map(round) } : null;
      },
    }),
    defineCommand({
      id: "sample",
      title: "Sample material",
      description: "Composited channel values (plus baked AO/curvature) at an object-space point, a uv, or a screen position of a view.",
      params: z.strictObject({ point: vec3.optional(), uv: z.tuple([z.number(), z.number()]).optional(), screen: z.tuple([z.number(), z.number()]).optional(), view: viewInput.default("front") }),
      mutates: false,
      run: (ctx, p) => {
        const s = session(ctx);
        s.sync();
        const eng = s.engine();
        let pt = p.point ?? null;
        if (p.uv) pt = uvToObject(eng.maps, p.uv[0], p.uv[1]);
        if (p.screen) pt = s.pick(p.view as ViewName, p.screen[0], p.screen[1], 1)?.position ?? null;
        if (!pt) throw new Error("Point not on the surface");
        const i = eng.texelNear(pt);
        if (i < 0) throw new Error("No texel near that point");
        return { point: pt.map(round), ...eng.sampleTexel(i) };
      },
    }),
    defineCommand({ id: "export.presets", title: "Export presets", description: "Texture export presets and the maps (with channel packing) each writes.", params: z.strictObject({}), mutates: false, run: () => EXPORT_PRESETS }),
    defineCommand({ id: "history.undo", title: "Undo", description: "Undo the last change.", params: z.strictObject({}), mutates: false, run: (ctx) => ctx.editor.undo() }),
    defineCommand({ id: "history.redo", title: "Redo", description: "Redo.", params: z.strictObject({}), mutates: false, run: (ctx) => ctx.editor.redo() }),
    defineCommand({ id: "history.list", title: "History", description: "Undo and redo stack labels.", params: z.strictObject({}), mutates: false, run: (ctx) => ctx.editor.history() }),
  ];
  return cmds as CommandDef[];
}
