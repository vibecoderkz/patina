import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";
import { ATTRIBUTION, createDocument, Editor, createCommands, PATINA_VERSION, PRODUCT_NAME, Session, type PrimitiveName, type ViewChannel, type ViewName } from "@patina/core";
import { BridgeBackend, LocalBackend } from "./backend.js";
import { GUIDE } from "./guide.js";
import { runStdio } from "./mcp.js";

const HELP = `${PRODUCT_NAME} ${PATINA_VERSION}: 3D PBR texture painting for humans and AI agents

Usage: patina <command> [args]

  new <file.patina> [--primitive orb] [--resolution 1024] [--name N]
  inspect <file.patina>
  run <file.patina> <command> ['{json params}']     run one command and save
  batch <file.patina> <steps.json | ->               [{command, params}, ...] atomically, save
  import-mesh <file.patina> <mesh.glb|.gltf|.obj>    paint on your own mesh (needs UVs)
  render <file.patina> <out.png> [--view iso] [--size 768] [--channel material] [--zoom 1]
  sheet <file.patina> <out.png> [--views front,iso,back,top] [--channels roughness,height] [--cell 300] [--uv]
  export <file.patina> <dir> [--preset gltf|unreal|unityHdrp|unityUrp|separate] [--size 2048]
  glb <file.patina> <out.glb>
  commands [filter]                                  every command with its description
  guide                                              the agent guide
  mcp [--live] [--root DIR ...]                      MCP server on stdio (--live drives the open window)
  --version

${ATTRIBUTION}`;

function flags(args: string[]) {
  const pos: string[] = [];
  const f: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        f[k] = f[k] && typeof f[k] === "string" ? `${f[k]},${next}` : next;
        i++;
      } else f[k] = true;
    } else pos.push(a);
  }
  return { pos, f };
}

const need = (v: string | undefined, what: string) => {
  if (!v) throw new Error(`Missing ${what}. Run patina --help`);
  return v;
};

async function withDoc(path: string) {
  if (!existsSync(path)) throw new Error(`${path} not found. Create it with: patina new ${path}`);
  const b = new LocalBackend(new Session());
  await b.open(path);
  return b;
}

export async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { pos, f } = flags(rest);
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "--version":
    case "-v":
    case "version":
      console.log(`${PRODUCT_NAME} ${PATINA_VERSION}\n${ATTRIBUTION}`);
      return;
    case "guide":
      console.log(GUIDE);
      return;
    case "commands": {
      const ed = new Editor(createCommands());
      for (const c of ed.commands(pos[0])) console.log(`${c.id.padEnd(20)} ${c.description}`);
      if (pos[0]) for (const c of ed.commands(pos[0])) console.log(`\n${c.id} params:\n${JSON.stringify(z.toJSONSchema(c.params, { io: "input", unrepresentable: "any" }), null, 1)}`);
      return;
    }
    case "new": {
      const file = need(pos[0], "file.patina");
      const doc = createDocument({ name: (f.name as string) ?? file.replace(/^.*[\\/]/, "").replace(/\.patina$/, ""), resolution: f.resolution ? +f.resolution : 1024, mesh: { source: "primitive", primitive: ((f.primitive as string) ?? "orb") as PrimitiveName } });
      const b = new LocalBackend(new Session(doc));
      b.session.engine();
      await b.save(file);
      console.log(`Created ${file}`);
      return;
    }
    case "inspect": {
      const b = await withDoc(need(pos[0], "file.patina"));
      console.log(JSON.stringify(await b.execute("doc.inspect"), null, 1));
      return;
    }
    case "run": {
      const file = need(pos[0], "file.patina");
      const b = await withDoc(file);
      const r = await b.execute(need(pos[1], "command"), pos[2] ? JSON.parse(pos[2]) : {});
      await b.save(file);
      console.log(JSON.stringify(r ?? { ok: true }, null, 1));
      return;
    }
    case "batch": {
      const file = need(pos[0], "file.patina");
      const src = need(pos[1], "steps.json or -");
      const steps = JSON.parse(src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8"));
      const b = await withDoc(file);
      const r = await b.batch(steps);
      await b.save(file);
      console.log(JSON.stringify(r, null, 1));
      return;
    }
    case "import-mesh": {
      const file = need(pos[0], "file.patina");
      const b = await withDoc(file);
      console.log(JSON.stringify(await b.importMesh(need(pos[1], "mesh file")), null, 1));
      await b.save(file);
      return;
    }
    case "render": {
      const b = await withDoc(need(pos[0], "file.patina"));
      const png = await b.render({ view: ((f.view as string) ?? "iso") as never, size: f.size ? +f.size : 768, channel: ((f.channel as string) ?? "material") as never, zoom: f.zoom ? +f.zoom : 1 });
      writeFileSync(need(pos[1], "out.png"), png);
      console.log(`Wrote ${pos[1]}`);
      return;
    }
    case "sheet": {
      const b = await withDoc(need(pos[0], "file.patina"));
      const list = <T,>(v: unknown) => (typeof v === "string" ? (v.split(",").filter(Boolean) as T[]) : undefined);
      const png = await b.sheet({ views: list<ViewName>(f.views), channels: list<ViewChannel>(f.channels), cell: f.cell ? +f.cell : 300, uv: !!f.uv });
      writeFileSync(need(pos[1], "out.png"), png);
      console.log(`Wrote ${pos[1]}`);
      return;
    }
    case "export": {
      const b = await withDoc(need(pos[0], "file.patina"));
      console.log(JSON.stringify(await b.exportTextures(need(pos[1], "output dir"), { preset: (f.preset as string) ?? "gltf", size: f.size ? +f.size : undefined }), null, 1));
      return;
    }
    case "glb": {
      const b = await withDoc(need(pos[0], "file.patina"));
      console.log(JSON.stringify(await b.exportGlb(need(pos[1], "out.glb")), null, 1));
      return;
    }
    case "mcp": {
      const roots = typeof f.root === "string" ? f.root.split(",") : [homedir()];
      await runStdio({ backend: f.live ? new BridgeBackend() : new LocalBackend(), roots });
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run patina --help`);
  }
}
