import { useSyncExternalStore } from "react";
import {
  CHANNELS,
  createDocument,
  DEFAULT_BRUSH,
  normalizeDocument,
  Session,
  type Brush,
  type ChannelId,
  type Layer,
  type PaintMaterial,
  type PatinaDocument,
  type SyncResult,
  type ViewChannel,
} from "@patina/core";

export type Tool = "paint" | "erase" | "picker";
export type Layout = "3d" | "split" | "uv";

export interface UiState {
  tool: Tool;
  /** What strokes go into: the selected layer's content or its mask. */
  target: "layer" | "mask";
  /** Selected mask effect (paint effects receive mask strokes). */
  effect: string | null;
  channel: ViewChannel;
  layout: Layout;
  darkStage: boolean;
  brush: Brush;
  /** Values a paint stroke deposits; `channels` says which are on. */
  paint: Required<PaintMaterial>;
  channels: Record<ChannelId, boolean>;
  /** Grey level for mask strokes. */
  maskValue: number;
  filePath: string | null;
  meshPath: string | null;
  toast: { text: string; error?: boolean; id: number } | null;
  busy: string | null;
  agent: { connected: boolean; busy: boolean; last: string | null };
  modal: null | "new" | "export" | "about";
  shelfTab: "smart" | "materials" | "masks";
  collapsed: Record<string, boolean>;
  stats: { ms: number; full: boolean };
}

const AUTOSAVE = "patina.autosave.v1";

function initialDoc(): PatinaDocument {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    if (raw) {
      const d = normalizeDocument(JSON.parse(raw));
      if (d.mesh.source === "primitive") return d;
    }
  } catch {
    /* ignore a broken autosave */
  }
  return createDocument({ name: "Untitled", resolution: 1024 });
}

export const session = new Session(initialDoc());
export const editor = session.editor;

let ui: UiState = {
  tool: "paint",
  target: "layer",
  effect: null,
  channel: "material",
  layout: "3d",
  darkStage: false,
  brush: { ...DEFAULT_BRUSH, projection: "view", size: 0.025, hardness: 0.55, flow: 0.8 },
  paint: { baseColor: "#ff3b2e", metallic: 0, roughness: 0.4, height: 0, emissive: "#000000" },
  channels: { baseColor: true, metallic: true, roughness: true, height: false, emissive: false },
  maskValue: 1,
  filePath: null,
  meshPath: null,
  toast: null,
  busy: null,
  agent: { connected: false, busy: false, last: null },
  modal: null,
  shelfTab: "smart",
  collapsed: {},
  stats: { ms: 0, full: false },
};

const listeners = new Set<() => void>();
const bump = () => {
  for (const l of listeners) l();
};
export const getUi = () => ui;
export function setUi(p: Partial<UiState>) {
  ui = { ...ui, ...p };
  bump();
}
export function useUi<T>(sel: (u: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(ui),
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, error = false) {
  clearTimeout(toastTimer);
  setUi({ toast: { text, error, id: Date.now() } });
  toastTimer = setTimeout(() => setUi({ toast: null }), error ? 4200 : 2400);
}

/** Run a command and show its error as a toast instead of throwing. */
export function run<R = unknown>(id: string, params: unknown = {}, historyKey?: string): R | undefined {
  try {
    return editor.execute<R>(id, params, historyKey ? { historyKey } : {});
  } catch (e) {
    toast((e as Error).message, true);
    return undefined;
  }
}

// ---------------------------------------------------------------- editor state for React

let editorVersion = 0;
editor.subscribe(() => {
  editorVersion++;
  bump();
  scheduleSync();
  scheduleAutosave();
});

export function useDoc(): PatinaDocument {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => editor.doc,
  );
}

export function useSelection(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => editor.state.selection,
  );
}

export const useEditorVersion = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => editorVersion,
  );

export function findLayer(id: string | null, layers: Layer[] = editor.doc.layers): Layer | null {
  if (!id) return null;
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "folder") {
      const f = findLayer(id, l.children);
      if (f) return f;
    }
  }
  return null;
}

// ---------------------------------------------------------------- texture sync

type SyncListener = (r: SyncResult) => void;
const syncListeners = new Set<SyncListener>();
export function onSync(fn: SyncListener) {
  syncListeners.add(fn);
  return () => void syncListeners.delete(fn);
}
export function emitSync(r: SyncResult) {
  if (!r.changed) return;
  setUi({ stats: { ms: r.ms, full: r.full } });
  for (const l of syncListeners) l(r);
}

let syncQueued = false;
/**
 * Bring textures up to date once per frame. Work that may take a while (first bake, smart
 * materials) shows a busy pill first so the window never just freezes silently.
 */
export function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    const eng = session.engine();
    const heavy = !eng.document || eng.document.layers !== editor.doc.layers || eng.document.bake !== editor.doc.bake;
    const willBake = !eng.baked && JSON.stringify(editor.doc.layers).includes('"generator"');
    if (heavy && (willBake || !eng.document)) {
      setUi({ busy: willBake ? "Baking curvature and occlusion" : "Building textures" });
      setTimeout(() => requestAnimationFrame(doSync), 30);
    } else doSync();
  });
}

function doSync() {
  syncQueued = false;
  try {
    emitSync(session.sync());
  } catch (e) {
    toast((e as Error).message, true);
  }
  if (ui.busy) setUi({ busy: null });
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE, JSON.stringify(editor.doc));
    } catch {
      /* quota: strokes can get large; autosave is best effort */
    }
  }, 1500);
}
export const clearAutosave = () => {
  try {
    localStorage.removeItem(AUTOSAVE);
  } catch {
    /* ignore */
  }
};

/** Enabled brush channels as the paint material a stroke deposits. */
export function strokeMaterial(): PaintMaterial {
  const m: PaintMaterial = {};
  for (const c of CHANNELS) if (ui.channels[c]) (m as Record<string, unknown>)[c] = ui.paint[c];
  return m;
}
