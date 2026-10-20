# Patina

Patina (repo `vibecoderkz/patina`, MIT): desktop 3D PBR texture painting app (clean-room alternative to Substance 3D Painter) that AI agents can drive.
Research log: [RESEARCH.md](RESEARCH.md). Recon of Substance 3D Painter: [replica/recon.md](replica/recon.md), [replica/features.csv](replica/features.csv) (clone column = what Patina has).

## Architecture
- `packages/core` (TS, no DOM):
  - `types.ts` document model (immutable JSON; layers bottom to top; ids `L1`, `E1`), `doc.ts` path-copying helpers.
  - `editor.ts` command registry + undo (undo step = previous document reference; `historyKey` coalesces drags; `batch` is atomic), `commands.ts` every command (zod `strictObject`, they are the API for UI, CLI, MCP and bridge), `schema.ts`.
  - `bake.ts` UV rasterization into texels with 3D position/normal, `TexelGrid` spatial hash, curvature (neighbour normals in 3D), AO (BVH rays), dilation. `bvh.ts`.
  - `engine.ts` `TextureEngine`: composites the stack per texel, caches by object identity (WeakMap), incremental recomposite of stroke-touched texels, live strokes (`beginLive/extendLive/endLive`), height -> normal.
  - `brush.ts` dab rasterizer (sphere or camera projection with a depth view), `noise.ts` (`compileNoise`), `generators.ts` (mask generators with threshold early-out, lazy `SourceBuffer`), `materials.ts` presets.
  - `render.ts` CPU deferred PBR renderer + `env.ts` procedural environments (shared with the viewport), `preview.ts`, `export.ts` (presets, PNG, GLB), `meshio.ts` (OBJ, glTF, GLB), `primitives.ts`.
  - `session.ts` editor + mesh registry + engine for the current mesh/resolution.
- `packages/headless`: `cli.ts`, `mcp.ts`, `backend.ts` (LocalBackend in-process, BridgeBackend -> desktop window), `io.ts`. Build: `node build.mjs` -> `dist/patina.js` (committed).
- `apps/desktop`: React UI. `src/store.ts` hub (session, UI state, once-per-frame `scheduleSync`), `viewport/Viewport.tsx` (three.js, orbit, picking via core BVH, live painting), `viewport/paint.ts` (stroke target resolution, live stroke -> `paint.stroke` commit), `viewport/textures.ts` (float buffers -> RGBA8 DataTextures, row `updateRanges`), `viewport/UvView.tsx`, `panels/*`, `thumbs.ts` (shelf thumbnails rendered by the core), `platform.ts` (Tauri IO + bridge). Rust `src-tauri/src/main.rs`: files, bridge HTTP on 127.0.0.1:47910.

## Rules
- Clean-room: learn Substance 3D Painter from public docs only. Never download, run or decompile Adobe binaries; never copy Adobe text or assets.
- New features = new commands in `core/commands.ts` first, UI second. Agents must be able to do everything the UI does.
- Documents stay immutable: build new objects, never mutate layers in place (engine caches key on identity).
- Everything procedural is evaluated in object space (no UV-space effects that would show seams).
- Look at renders, not just tests: `npx tsx examples/smart-sheet.mts out.png` renders every smart material; `patina sheet` for a document.
- Error messages are part of the agent UX: name the field and the fix.
- Logo and icons: `brand/` (built by `~/projects/design/patina-logo/build.py`; never hand-edit the SVG masters, rebuild them). App mark in `apps/desktop/src/icons.tsx` `Mark`.
- Brand (UI): dialektai style (SF Pro, `#FF3B2E`, ink `#0a0a0b`, `#f6f6f4`), heroicons outline, no emoji, no em-dash in UI copy.
- Attribution "Developed by Dias Zhumagaliyev: https://dias.now · hello@dias.now": About dialog, `patina --version`, `Patina --version`, README footer. LICENSE is MIT.
- SF Pro font files are gitignored (Apple license forbids redistribution); never commit them.
- Before done: `npm run build` clean (tests + typecheck + bundles).
