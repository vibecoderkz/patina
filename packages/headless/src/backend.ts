import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Session, triangleCount, type PatinaDocument, type SheetRequest } from "@patina/core";
import { loadMesh, openDocument, renderPng, renderSheet, saveDocument, writeGlb, writeTextures, type RenderRequest } from "./io.js";


/**
 * Where commands run: an in-process session (headless) or the open desktop window (live bridge).
 * Both speak the same command registry, so agents use one vocabulary everywhere.
 */
export interface Backend {
  readonly kind: "headless" | "live";
  execute(command: string, params?: unknown): Promise<unknown>;
  batch(steps: { command: string; params?: unknown }[]): Promise<unknown[]>;
  open(path: string): Promise<unknown>;
  save(path: string): Promise<unknown>;
  importMesh(path: string): Promise<unknown>;
  render(r: RenderRequest): Promise<Uint8Array>;
  sheet(r: SheetRequest): Promise<Uint8Array>;
  exportTextures(dir: string, opts: { preset?: string; size?: number; name?: string }): Promise<unknown>;
  exportGlb(path: string): Promise<unknown>;
}

export class LocalBackend implements Backend {
  readonly kind = "headless" as const;
  constructor(readonly session: Session = new Session()) {}
  async execute(command: string, params: unknown = {}) {
    return this.session.editor.execute(command, params);
  }
  async batch(steps: { command: string; params?: unknown }[]) {
    return this.session.editor.batch(steps);
  }
  async open(path: string) {
    openDocument(this.session, path);
    return this.session.editor.execute("doc.inspect");
  }
  async save(path: string) {
    const doc = withRelativeMesh(this.session.doc, path);
    saveDocument(doc, path);
    this.session.editor.dirty = false;
    return { path: resolve(path) };
  }
  async importMesh(path: string) {
    const abs = resolve(path);
    const mesh = loadMesh(abs);
    this.session.registerMesh(abs, mesh);
    this.session.editor.execute("mesh.set", { path: abs });
    return { path: abs, name: mesh.name, triangles: triangleCount(mesh), parts: mesh.parts?.map((p) => p.name) ?? [] };
  }
  render(r: RenderRequest) {
    return renderPng(this.session, r);
  }
  sheet(r: SheetRequest) {
    return renderSheet(this.session, r);
  }
  exportTextures(dir: string, opts: { preset?: string; size?: number; name?: string }) {
    return writeTextures(this.session, dir, opts);
  }
  exportGlb(path: string) {
    return writeGlb(this.session, path);
  }
}

/** Store the mesh path relative to the document so projects can move as a folder. */
export function withRelativeMesh(doc: PatinaDocument, docPath: string): PatinaDocument {
  if (doc.mesh.source !== "file") return doc;
  const rel = relative(dirname(resolve(docPath)), resolve(doc.mesh.path));
  return { ...doc, mesh: { source: "file", path: rel || basename(doc.mesh.path) } };
}

export const DEFAULT_BRIDGE_PORT = 47910;
export const DEFAULT_TOKEN_FILE = join(homedir(), ".config", "patina", "bridge.token");

/** Talks to the desktop app's local control channel (127.0.0.1 only, bearer token). */
export class BridgeBackend implements Backend {
  readonly kind = "live" as const;
  private token: string;
  constructor(
    private url = `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`,
    tokenFile = DEFAULT_TOKEN_FILE,
  ) {
    try {
      this.token = readFileSync(tokenFile, "utf8").trim();
    } catch {
      throw new Error(`Bridge token not found at ${tokenFile}. Start the Patina desktop app first (it writes the token on launch).`);
    }
  }

  private async rpc(method: string, params: unknown = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ method, params }),
      });
    } catch {
      throw new Error(`Cannot reach the Patina window at ${this.url}. Is the desktop app open?`);
    }
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
    if (!body.ok) throw new Error(body.error ?? `Bridge error ${res.status}`);
    return body.result;
  }

  execute(command: string, params: unknown = {}) {
    return this.rpc("execute", { command, params });
  }
  async batch(steps: { command: string; params?: unknown }[]) {
    return (await this.rpc("batch", { steps })) as unknown[];
  }
  open(path: string) {
    return this.rpc("open", { path: resolve(path) });
  }
  save(path: string) {
    return this.rpc("save", { path: resolve(path) });
  }
  importMesh(path: string) {
    return this.rpc("importMesh", { path: resolve(path) });
  }
  async render(r: RenderRequest) {
    const b64 = (await this.rpc("render", r)) as string;
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  async sheet(r: SheetRequest) {
    const b64 = (await this.rpc("sheet", r)) as string;
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  exportTextures(dir: string, opts: { preset?: string; size?: number; name?: string }) {
    return this.rpc("exportTextures", { dir: resolve(dir), ...opts });
  }
  exportGlb(path: string) {
    return this.rpc("exportGlb", { path: resolve(path) });
  }
}
