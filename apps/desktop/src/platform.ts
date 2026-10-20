import {
  encodePng,
  exportGlb,
  exportTextures,
  normalizeDocument,
  parseGlb,
  parseGltf,
  parseObj,
  renderPreview,
  renderSheet,
  rgbaToPixels,
  safeName,
  TextureEngine,
  triangleCount,
  type Mesh,
  type PatinaDocument,
  type PreviewRequest,
  type SheetRequest,
} from "@patina/core";
import { clearAutosave, editor, emitSync, getUi, run, session, setUi, toast } from "./store";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauri() {
  const [{ invoke }, dialog, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/plugin-dialog"), import("@tauri-apps/api/event")]);
  return { invoke, dialog, listen };
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const w = cs.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

const baseName = (p: string) => p.replace(/^.*[\\/]/, "");
const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const join = (a: string, b: string) => (b.startsWith("/") || /^[A-Za-z]:[\\/]/.test(b) ? b : `${a.replace(/[\\/]$/, "")}/${b}`);

/** Relative path from a directory to a file (POSIX-style; falls back to absolute across drives). */
function relativePath(fromDir: string, to: string): string {
  const a = fromDir.split(/[\\/]/).filter(Boolean), b = to.split(/[\\/]/).filter(Boolean);
  if (a[0] !== b[0]) return to;
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || baseName(to);
}

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function readBinary(path: string): Promise<Uint8Array> {
  const { invoke } = await tauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_binary_file", { path }));
}

async function writeBinary(path: string, bytes: Uint8Array) {
  const { invoke } = await tauri();
  await invoke("write_binary_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

/** Parse a mesh file; .gltf external buffers are read next to it. */
async function parseMeshAt(path: string, bytes: Uint8Array): Promise<Mesh> {
  const name = baseName(path).replace(/\.[^.]+$/, "");
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "glb") return parseGlb(bytes, name);
  if (ext === "obj") return parseObj(new TextDecoder().decode(bytes), name);
  if (ext === "gltf") {
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const files = new Map<string, Uint8Array>();
    for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith("data:")) files.set(b.uri, await readBinary(join(dirName(path), decodeURIComponent(b.uri))));
    return parseGltf(json, null, (uri) => files.get(uri)!, name);
  }
  throw new Error(`Unsupported mesh ".${ext}". Use .glb, .gltf or .obj (convert FBX in Blender: File > Export > glTF).`);
}

function adoptMesh(path: string, mesh: Mesh) {
  session.registerMesh(path, mesh);
  run("mesh.set", { path });
  setUi({ meshPath: path });
  toast(`Imported ${mesh.name}: ${triangleCount(mesh).toLocaleString()} triangles${mesh.parts ? `, ${mesh.parts.length} parts` : ""}`);
}

export async function importMesh() {
  if (isDesktop) {
    const { dialog } = await tauri();
    const path = await dialog.open({ filters: [{ name: "Mesh", extensions: ["glb", "gltf", "obj"] }] });
    if (typeof path !== "string") return;
    return importMeshPath(path);
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,.obj";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      adoptMesh(f.name, await parseMeshAt(f.name, new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  input.click();
}

export async function importMeshPath(path: string) {
  setUi({ busy: "Loading mesh" });
  try {
    const mesh = await parseMeshAt(path, await readBinary(path));
    adoptMesh(path, mesh);
    return { path, name: mesh.name, triangles: triangleCount(mesh), parts: mesh.parts?.map((p) => p.name) ?? [] };
  } catch (e) {
    toast((e as Error).message, true);
    throw e;
  } finally {
    setUi({ busy: null });
  }
}

async function loadDoc(doc: PatinaDocument, path: string | null) {
  if (doc.mesh.source === "file") {
    if (!isDesktop || !path) throw new Error("This project uses a mesh file; open it in the desktop app");
    const meshPath = join(dirName(path), doc.mesh.path);
    session.registerMesh(doc.mesh.path, await parseMeshAt(meshPath, await readBinary(meshPath)));
    setUi({ meshPath });
  }
  editor.load(doc);
  setUi({ filePath: path, target: "layer", effect: null });
}

export async function openProject(path?: string) {
  if (editor.dirty && !path && !confirm("Discard unsaved changes?")) return;
  try {
    if (isDesktop) {
      const { invoke, dialog } = await tauri();
      const p = path ?? (await dialog.open({ filters: [{ name: "Patina", extensions: ["patina"] }] }));
      if (typeof p !== "string") return;
      setUi({ busy: "Opening project" });
      await loadDoc(normalizeDocument(JSON.parse(await invoke<string>("read_text_file", { path: p }))), p);
      toast(`Opened ${baseName(p)}`);
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".patina,application/json";
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          await loadDoc(normalizeDocument(JSON.parse(await f.text())), null);
          toast(`Opened ${f.name}`);
        } catch (e) {
          toast((e as Error).message, true);
        }
      };
      input.click();
    }
  } catch (e) {
    toast(`Could not open: ${(e as Error).message}`, true);
  } finally {
    setUi({ busy: null });
  }
}

export async function saveProject(saveAs = false, explicit?: string) {
  let path = explicit ?? getUi().filePath;
  const doc = editor.doc;
  if (isDesktop) {
    const { invoke, dialog } = await tauri();
    if (!path || saveAs) {
      const p = await dialog.save({ defaultPath: `${safeName(doc.name)}.patina`, filters: [{ name: "Patina", extensions: ["patina"] }] });
      if (!p) return;
      path = p;
    }
    const out = doc.mesh.source === "file" ? { ...doc, mesh: { source: "file" as const, path: relativePath(dirName(path), getUi().meshPath ?? doc.mesh.path) } } : doc;
    await invoke("write_text_file", { path, contents: JSON.stringify(out) + "\n" });
  } else {
    path = `${safeName(doc.name)}.patina`;
    download(path, JSON.stringify(doc) + "\n", "application/json");
  }
  editor.dirty = false;
  clearAutosave();
  setUi({ filePath: path });
  toast(`Saved ${baseName(path)}`);
  return { path };
}

/** Texture set at the document resolution, or re-rendered at `size` (strokes are resolution independent). */
function engineAt(size?: number) {
  session.sync();
  const doc = session.doc;
  let eng = session.engine();
  if (size && size !== doc.resolution) {
    eng = new TextureEngine(eng.mesh, size);
    eng.sync(doc);
  }
  if (!eng.baked) eng.ensureBaked(doc);
  return eng;
}

export async function exportTexturesTo(opts: { preset: string; size?: number; dir?: string; name?: string }) {
  let dir = opts.dir ?? null;
  if (isDesktop && !dir) {
    const { dialog } = await tauri();
    const d = await dialog.open({ directory: true, title: "Export textures to folder" });
    if (typeof d !== "string") return;
    dir = d;
  }
  setUi({ busy: `Exporting ${opts.size ?? session.doc.resolution} px textures` });
  await new Promise((r) => setTimeout(r, 40));
  try {
    const files = await exportTextures(engineAt(opts.size), opts.preset, opts.name ?? session.doc.name, deflate);
    if (isDesktop && dir) for (const f of files) await writeBinary(join(dir, f.file), f.bytes);
    else for (const f of files) download(f.file, f.bytes as Uint8Array<ArrayBuffer>, "image/png");
    toast(`Exported ${files.length} textures${dir ? ` to ${baseName(dir)}` : ""}`);
    return { dir, files: files.map((f) => f.file) };
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, true);
    throw e;
  } finally {
    setUi({ busy: null });
  }
}

export async function exportGlbTo(explicit?: string) {
  let path = explicit ?? null;
  if (isDesktop && !path) {
    const { dialog } = await tauri();
    path = await dialog.save({ defaultPath: `${safeName(session.doc.name)}.glb`, filters: [{ name: "glTF binary", extensions: ["glb"] }] });
    if (!path) return;
  }
  setUi({ busy: "Writing GLB" });
  await new Promise((r) => setTimeout(r, 40));
  try {
    const bytes = await exportGlb(engineAt(), session.doc.name, deflate);
    if (isDesktop && path) await writeBinary(path, bytes);
    else download(`${safeName(session.doc.name)}.glb`, bytes as Uint8Array<ArrayBuffer>, "model/gltf-binary");
    toast(`Exported ${path ? baseName(path) : "GLB"}`);
    return { path, bytes: bytes.length };
  } finally {
    setUi({ busy: null });
  }
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Live bridge: the Rust side listens on 127.0.0.1 and forwards agent requests here; they run on the
 * same session the person is looking at, so every agent step is visible and undoable.
 */
export async function startBridge() {
  if (!isDesktop) return;
  const { invoke, listen } = await tauri();
  let idle: ReturnType<typeof setTimeout> | undefined;
  await listen<{ id: string; method: string; params: Record<string, unknown> }>("bridge-request", async (ev) => {
    const { id, method, params } = ev.payload;
    let reply: { ok: boolean; result?: unknown; error?: string };
    try {
      const label = method === "batch" ? `batch x${(params.steps as unknown[] | undefined)?.length ?? 0}` : method === "execute" ? String(params.command) : method;
      setUi({ agent: { connected: true, busy: true, last: label } });
      let result: unknown;
      switch (method) {
        case "execute":
          result = editor.execute(String(params.command), params.params ?? {});
          break;
        case "batch":
          result = editor.batch((params.steps as { command: string; params?: unknown }[]) ?? []);
          break;
        case "open":
          await openProject(String(params.path));
          result = editor.execute("doc.inspect");
          break;
        case "save":
          result = await saveProject(false, String(params.path));
          break;
        case "importMesh":
          result = await importMeshPath(String(params.path));
          break;
        case "render":
          result = b64(await encodePng(rgbaToPixels(renderPreview(session, params as PreviewRequest)), deflate));
          break;
        case "sheet":
          result = b64(await encodePng(rgbaToPixels(renderSheet(session, params as SheetRequest)), deflate));
          break;
        case "exportTextures":
          result = await exportTexturesTo({ preset: String(params.preset ?? "gltf"), size: params.size as number | undefined, dir: String(params.dir), name: params.name as string | undefined });
          break;
        case "exportGlb":
          result = await exportGlbTo(String(params.path));
          break;
        case "ping":
          result = { app: "patina" };
          break;
        default:
          throw new Error(`Unknown bridge method "${method}"`);
      }
      // the agent may have changed the document: show it now
      emitSync(session.sync());
      reply = { ok: true, result: result ?? null };
    } catch (e) {
      reply = { ok: false, error: (e as Error).message };
    }
    await invoke("bridge_reply", { id, reply: JSON.stringify(reply) });
    clearTimeout(idle);
    idle = setTimeout(() => setUi({ agent: { ...getUi().agent, busy: false } }), 600);
  });
  try {
    await invoke<{ port: number }>("bridge_info");
    setUi({ agent: { connected: true, busy: false, last: null } });
  } catch {
    setUi({ agent: { connected: false, busy: false, last: null } });
  }
}

export function newProject(primitive: string, resolution: number) {
  if (editor.dirty && !confirm("Discard unsaved changes?")) return;
  run("doc.new", { primitive, resolution, name: "Untitled" });
  clearAutosave();
  setUi({ filePath: null, meshPath: null, target: "layer", effect: null, modal: null });
}
