import type { Camera, Stroke } from "@patina/core";
import { editor, emitSync, findLayer, getUi, run, session, setUi, strokeMaterial, toast } from "../store";

interface Active {
  layerId: string;
  effectId?: string;
  stroke: Stroke;
  pending: number[];
  pendingPressure: number[] | null;
  raf: number;
}

let active: Active | null = null;

export const isPainting = () => active !== null;

/**
 * Work out where a stroke goes, creating what is missing: a paint layer when the selection cannot
 * take paint, or a paint effect in the selected mask.
 */
function resolveTarget(): { layerId: string; effectId?: string } | null {
  const ui = getUi();
  let layer = findLayer(editor.state.selection);
  if (ui.target === "mask") {
    if (!layer) {
      toast("Select a layer to paint its mask", true);
      return null;
    }
    const effects = layer.mask?.effects ?? [];
    let eff = effects.find((e) => e.id === ui.effect && e.type === "paint") ?? [...effects].reverse().find((e) => e.type === "paint");
    if (!eff) {
      const r = run<{ ids: string[] }>("mask.effect.add", { layer: layer.id, type: "paint", name: "Painted mask" });
      if (!r) return null;
      layer = findLayer(layer.id)!;
      eff = layer.mask!.effects.find((e) => e.id === r.ids[0]);
      setUi({ effect: r.ids[0] });
    }
    return { layerId: layer.id, effectId: eff!.id };
  }
  if (layer?.type === "paint") return { layerId: layer.id };
  if (getUi().tool === "erase") {
    toast(layer ? `"${layer.name}" is a ${layer.type} layer. Erase on a paint layer, or paint its mask black` : "Select a paint layer to erase", true);
    return null;
  }
  const r = run<{ id: string }>("layer.add", { type: "paint", name: "Paint" });
  if (!r) return null;
  toast("Added a paint layer");
  return { layerId: r.id };
}

export function beginPaint(point: [number, number, number], camera: Camera | null, pressure?: number): boolean {
  cancelPaint();
  const target = resolveTarget();
  if (!target) return false;
  const ui = getUi();
  // the engine must know about a layer/effect we just created
  emitSync(session.sync());
  const projection = camera ? ui.brush.projection : "sphere";
  const stroke: Stroke = {
    brush: { ...ui.brush, projection },
    points: [],
    ...(projection === "view" && camera ? { camera } : {}),
    ...(ui.tool === "erase" ? { erase: true } : {}),
    // an eraser without material clears every channel, live and when the stroke is replayed
    ...(target.effectId ? { value: ui.maskValue } : ui.tool === "erase" ? {} : { material: strokeMaterial() }),
  };
  if (!target.effectId && ui.tool !== "erase" && !Object.keys(stroke.material ?? {}).length) {
    toast("Turn on at least one brush channel (Properties > Brush material)", true);
    return false;
  }
  try {
    session.engine().beginLive(target.layerId, { ...stroke, ...(pressure !== undefined ? { pressure: [] } : {}) }, target.effectId);
  } catch (e) {
    toast((e as Error).message, true);
    return false;
  }
  active = { ...target, stroke, pending: [], pendingPressure: pressure !== undefined ? [] : null, raf: 0 };
  extendPaint(point, pressure);
  flush();
  return true;
}

export function extendPaint(p: [number, number, number], pressure?: number) {
  if (!active) return;
  active.pending.push(p[0], p[1], p[2]);
  if (active.pendingPressure) active.pendingPressure.push(pressure ?? 1);
  if (!active.raf) active.raf = requestAnimationFrame(flush);
}

function flush() {
  if (!active) return;
  active.raf = 0;
  if (!active.pending.length) return;
  const pts = active.pending.splice(0);
  const pr = active.pendingPressure ? active.pendingPressure.splice(0) : undefined;
  emitSync(session.engine().extendLive(pts, pr));
}

export function endPaint() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  flush();
  const a = active;
  active = null;
  const live = session.engine().endLive();
  if (!live) return;
  const pts = live.stroke.points;
  const triples: number[][] = [];
  for (let i = 0; i < pts.length; i += 3) triples.push([pts[i], pts[i + 1], pts[i + 2]]);
  run("paint.stroke", {
    layer: a.layerId,
    ...(a.effectId ? { effect: a.effectId, value: a.stroke.value } : a.stroke.material && !a.stroke.erase ? { material: a.stroke.material } : {}),
    ...(a.stroke.erase ? { erase: true } : {}),
    brush: a.stroke.brush,
    points: triples,
    ...(live.stroke.pressure?.length ? { pressure: live.stroke.pressure } : {}),
    ...(a.stroke.camera ? { view: a.stroke.camera } : {}),
  });
}

export function cancelPaint() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  active = null;
  const r = session.engine().cancelLive();
  if (r) emitSync(r);
}
