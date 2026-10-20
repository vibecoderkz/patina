import type { TextureEngine } from "@patina/core";
import { onSync, session } from "../store";
import { GpuTextures } from "./textures";

let state: { engine: TextureEngine; gpu: GpuTextures } | null = null;
const listeners = new Set<(full: boolean) => void>();

/** GPU-side textures for the session's current engine (recreated when mesh or resolution change). */
export function currentGpu() {
  const engine = session.engine();
  if (!state || state.engine !== engine) {
    state?.gpu.dispose();
    state = { engine, gpu: new GpuTextures(engine.res) };
    if (engine.document) state.gpu.update(engine, null);
    for (const l of listeners) l(true);
  }
  return state;
}

export function onTextures(fn: (full: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

onSync((r) => {
  const s = currentGpu();
  s.gpu.update(s.engine, r.full ? null : r.rect);
  for (const l of listeners) l(r.full);
});
