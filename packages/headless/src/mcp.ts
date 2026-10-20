import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cameraInput, Editor, createCommands, PATINA_VERSION, VIEW_NAMES } from "@patina/core";
import type { Backend } from "./backend.js";
import { GUIDE } from "./guide.js";

export interface McpOptions {
  backend: Backend;
  /** File access is limited to these directories (default: home). */
  roots?: string[];
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const text = (v: unknown): { content: Content[] } => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const image = (png: Uint8Array): { content: Content[] } => ({ content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }] });

const CHANNELS = ["material", "baseColor", "metallic", "roughness", "height", "normal", "emissive", "ao", "curvature", "uv"] as const;
const viewInput = z.union([z.enum(VIEW_NAMES), cameraInput]);

export function buildServer({ backend, roots = [homedir()] }: McpOptions): McpServer {
  const server = new McpServer({ name: "patina", version: PATINA_VERSION });
  // the registry is the same in every backend, so a bare editor answers schema questions
  const registry = new Editor(createCommands());

  const safePath = (p: string) => {
    const abs = resolve(p);
    if (!roots.some((r) => abs === resolve(r) || abs.startsWith(resolve(r) + sep))) throw new Error(`Path ${abs} is outside the allowed roots: ${roots.join(", ")}`);
    return abs;
  };

  const guard =
    <A>(fn: (a: A) => Promise<{ content: Content[] }>) =>
    async (a: A) => {
      try {
        return await fn(a);
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    };

  server.registerTool("patina_guide", { title: "How to use Patina", description: "Read first: document model, channels, masks, relative sizes and the recommended workflow.", inputSchema: {} }, async () =>
    text(`${GUIDE}\n\nMode: ${backend.kind === "live" ? "live (driving the open Patina window; the user sees every step)" : "headless (in-memory document)"}`),
  );

  server.registerTool(
    "command_list",
    {
      title: "List commands",
      description: "Commands with descriptions and JSON Schema of their params. filter matches id, title or description (e.g. 'mask', 'paint').",
      inputSchema: { filter: z.string().optional(), schemas: z.boolean().default(true).describe("Include param JSON Schemas") },
    },
    guard(async ({ filter, schemas }) =>
      text(registry.commands(filter).map((c) => ({ id: c.id, description: c.description, ...(schemas ? { params: z.toJSONSchema(c.params, { io: "input", unrepresentable: "any" }) } : {}) }))),
    ),
  );

  server.registerTool(
    "command_run",
    {
      title: "Run command",
      description: "Run one editor command, e.g. {command:'smart.apply', params:{preset:'rustyIron'}} or {command:'paint.stroke', params:{material:{baseColor:'#ff3b2e'}, screen:[[0.4,0.5],[0.6,0.5]], view:'front'}}.",
      inputSchema: { command: z.string(), params: z.record(z.string(), z.unknown()).default({}) },
    },
    guard(async ({ command, params }) => text((await backend.execute(command, params)) ?? { ok: true })),
  );

  server.registerTool(
    "command_batch",
    {
      title: "Run commands",
      description: "Run several commands in order as one undo step. Atomic: if one fails, nothing is applied. Returns each result.",
      inputSchema: { steps: z.array(z.object({ command: z.string(), params: z.record(z.string(), z.unknown()).default({}) })).min(1) },
    },
    guard(async ({ steps }) => text(await backend.batch(steps))),
  );

  server.registerTool("doc_inspect", { title: "Inspect document", description: "Mesh (bounds, parts), texture set, layer stack top first with ids, masks and materials.", inputSchema: {} }, guard(async () => text(await backend.execute("doc.inspect"))));

  server.registerTool(
    "doc_open",
    { title: "Open project", description: "Open a .patina project (absolute path). Its mesh file is loaded relative to it.", inputSchema: { path: z.string() } },
    guard(async ({ path }) => text(await backend.open(safePath(path)))),
  );

  server.registerTool(
    "doc_save",
    { title: "Save project", description: "Save the document as .patina (JSON; mesh path stored relative to the project file).", inputSchema: { path: z.string() } },
    guard(async ({ path }) => {
      if (!path.endsWith(".patina")) throw new Error("Use a .patina file name");
      return text(await backend.save(safePath(path)));
    }),
  );

  server.registerTool(
    "mesh_import",
    { title: "Import mesh", description: "Load a .glb, .gltf or .obj (must have UVs) and paint on it. Layers stay; strokes are stored in object space.", inputSchema: { path: z.string() } },
    guard(async ({ path }) => text(await backend.importMesh(safePath(path)))),
  );

  server.registerTool(
    "render_preview",
    {
      title: "Look at the model",
      description: "PNG render of the textured mesh (PBR, image-based lighting). view: front|back|left|right|top|bottom|iso|isoBack or a camera {eye,target,up,fov}. channel shows one map (roughness, height, normal, ao, curvature, ...). Use it after every few edits.",
      inputSchema: {
        view: viewInput.default("iso"),
        size: z.number().int().min(64).max(2048).default(640),
        channel: z.enum(CHANNELS).default("material"),
        zoom: z.number().min(0.2).max(10).default(1),
        environment: z.enum(["studio", "sunset", "overcast", "night"]).optional(),
      },
    },
    guard(async (a) => image(await backend.render(a as never))),
  );

  server.registerTool(
    "render_sheet",
    {
      title: "Look from all sides",
      description: "One PNG grid: several views plus optional channel views and the flat UV base colour. The fastest way to check a whole object.",
      inputSchema: {
        views: z.array(z.enum(VIEW_NAMES)).default(["front", "iso", "back", "top"]),
        channels: z.array(z.enum(CHANNELS)).default([]),
        cell: z.number().int().min(96).max(640).default(300),
        uv: z.boolean().default(false),
      },
    },
    guard(async (a) => image(await backend.sheet(a))),
  );

  server.registerTool(
    "export_textures",
    {
      title: "Export textures",
      description: "Write the texture set as PNGs. preset: gltf | unreal | unityHdrp | unityUrp | separate (see export.presets). size re-renders at another resolution (strokes are resolution independent).",
      inputSchema: { dir: z.string(), preset: z.string().default("gltf"), size: z.union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]).optional(), name: z.string().optional() },
    },
    guard(async ({ dir, ...opts }) => text(await backend.exportTextures(safePath(dir), opts))),
  );

  server.registerTool(
    "export_glb",
    { title: "Export GLB", description: "Write a self-contained .glb (mesh + glTF PBR textures) for three.js, model-viewer, Blender, game engines.", inputSchema: { path: z.string() } },
    guard(async ({ path }) => {
      if (!path.toLowerCase().endsWith(".glb")) throw new Error("Use a .glb file name");
      return text(await backend.exportGlb(safePath(path)));
    }),
  );

  return server;
}

export async function runStdio(opts: McpOptions): Promise<void> {
  const server = buildServer(opts);
  await server.connect(new StdioServerTransport());
}
