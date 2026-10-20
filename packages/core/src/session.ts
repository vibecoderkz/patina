import { namedCamera, screenRay, VIEW_NAMES, type ViewName } from "./camera.js";
import { createCommands } from "./commands.js";
import { createDocument } from "./doc.js";
import { Editor } from "./editor.js";
import { TextureEngine, type SyncResult } from "./engine.js";
import { meshBounds, type Mesh } from "./mesh.js";
import { createPrimitive } from "./primitives.js";
import type { Camera, MeshRef, PatinaDocument } from "./types.js";

const meshKey = (ref: MeshRef) => (ref.source === "primitive" ? `primitive:${ref.primitive}:${ref.segments ?? 32}` : `file:${ref.path}`);

/**
 * An editor plus the mesh and texture engine for its document. Headless (CLI/MCP) and the desktop
 * app each own one. File meshes are parsed by the host and registered here before use.
 */
export class Session {
  readonly editor: Editor;
  private meshes = new Map<string, Mesh>();
  private _engine: TextureEngine | null = null;
  private engineKey = "";

  constructor(doc: PatinaDocument = createDocument()) {
    this.editor = new Editor(createCommands(), doc);
    this.editor.session = this;
  }

  get doc() {
    return this.editor.doc;
  }

  registerMesh(path: string, mesh: Mesh) {
    this.meshes.set(`file:${path}`, mesh);
    if (this.engineKey.startsWith(`file:${path}@`)) this.engineKey = "";
  }

  hasMesh(ref: MeshRef): boolean {
    return ref.source === "primitive" || this.meshes.has(meshKey(ref));
  }

  mesh(ref: MeshRef = this.doc.mesh): Mesh {
    const key = meshKey(ref);
    let m = this.meshes.get(key);
    if (m) return m;
    if (ref.source === "file") throw new Error(`Mesh file ${ref.path} is not loaded. Import it with the mesh_import tool (or the desktop File > Import mesh).`);
    m = createPrimitive(ref.primitive, ref.segments);
    this.meshes.set(key, m);
    return m;
  }

  /** The engine for the current document's mesh and resolution (rebuilt when either changes). */
  engine(): TextureEngine {
    const doc = this.doc;
    const key = `${meshKey(doc.mesh)}@${doc.resolution}`;
    if (!this._engine || key !== this.engineKey) {
      this._engine = new TextureEngine(this.mesh(doc.mesh), doc.resolution);
      this.engineKey = key;
    }
    return this._engine;
  }

  /** Update textures to the current document. */
  sync(): SyncResult {
    return this.engine().sync(this.doc);
  }

  camera(view: ViewName | Camera = "front", zoom = 1): Camera {
    if (typeof view !== "string") return view;
    if (!VIEW_NAMES.includes(view)) throw new Error(`Unknown view "${view}". Use one of: ${VIEW_NAMES.join(", ")}, or pass a camera {eye, target, up, fov}`);
    return namedCamera(view, meshBounds(this.mesh()), 30, zoom);
  }

  /** Surface point under a screen position (x, y in 0..1 from the top-left) for a square image. */
  pick(view: ViewName | Camera, x: number, y: number, aspect = 1) {
    const cam = this.camera(view);
    const ray = screenRay(cam, x, y, aspect);
    return this.engine().raycast(ray.origin, ray.dir);
  }
}
