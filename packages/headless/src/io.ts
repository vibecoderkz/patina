import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import {
  encodePng,
  exportGlb,
  exportTextures,
  normalizeDocument,
  parseMeshFile,
  renderPreview,
  renderSheet as renderSheetImage,
  rgbaToPixels,
  Session,
  TextureEngine,
  type Mesh,
  type PatinaDocument,
  type PreviewRequest,
  type SheetRequest,
} from "@patina/core";

export const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d, { level: 6 }));

export function loadMesh(path: string): Mesh {
  const abs = resolve(path);
  return parseMeshFile(abs, new Uint8Array(readFileSync(abs)), (rel) => new Uint8Array(readFileSync(join(dirname(abs), decodeURIComponent(rel)))));
}

/** Read a .patina file and register its mesh file (paths in the document are relative to it). */
export function openDocument(session: Session, path: string): PatinaDocument {
  const abs = resolve(path);
  const doc = normalizeDocument(JSON.parse(readFileSync(abs, "utf8")));
  if (doc.mesh.source === "file") {
    const meshPath = isAbsolute(doc.mesh.path) ? doc.mesh.path : join(dirname(abs), doc.mesh.path);
    session.registerMesh(doc.mesh.path, loadMesh(meshPath));
  }
  session.editor.load(doc);
  return doc;
}

export function saveDocument(doc: PatinaDocument, path: string) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(doc) + "\n");
}

export type RenderRequest = PreviewRequest;

export async function renderPng(session: Session, r: PreviewRequest = {}): Promise<Uint8Array> {
  return encodePng(rgbaToPixels(renderPreview(session, r)), deflate);
}

export async function renderSheet(session: Session, opts: SheetRequest = {}): Promise<Uint8Array> {
  return encodePng(rgbaToPixels(renderSheetImage(session, opts)), deflate);
}

/** Write a texture set; `size` re-renders every layer at another resolution (strokes are resolution independent). */
export async function writeTextures(session: Session, dir: string, opts: { preset?: string; size?: number; name?: string } = {}) {
  session.sync();
  const doc = session.doc;
  let eng = session.engine();
  if (opts.size && opts.size !== doc.resolution) {
    eng = new TextureEngine(eng.mesh, opts.size);
    eng.sync(doc);
  }
  if (!eng.baked) eng.ensureBaked(doc);
  const files = await exportTextures(eng, opts.preset ?? "gltf", opts.name ?? doc.name, deflate);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f.file), f.bytes);
  return { dir: resolve(dir), resolution: eng.res, files: files.map((f) => f.file) };
}

export async function writeGlb(session: Session, path: string) {
  session.sync();
  const eng = session.engine();
  if (!eng.baked) eng.ensureBaked(session.doc);
  const bytes = await exportGlb(eng, session.doc.name, deflate);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, bytes);
  return { path: resolve(path), bytes: bytes.length };
}
