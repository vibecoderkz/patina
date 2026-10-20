import type { ViewName } from "./camera.js";
import { composeGrid } from "./image.js";
import { renderView, textureImage, type RgbaImage, type ViewChannel } from "./render.js";
import type { Session } from "./session.js";
import type { Camera, EnvironmentName } from "./types.js";

export interface PreviewRequest {
  view?: ViewName | Camera;
  size?: number;
  channel?: ViewChannel;
  environment?: EnvironmentName;
  zoom?: number;
  background?: string | null;
}

export interface SheetRequest {
  views?: ViewName[];
  channels?: ViewChannel[];
  cell?: number;
  uv?: boolean;
}

/** Render the session's textured mesh (syncs textures first). Same pixels in the CLI, MCP and the window. */
export function renderPreview(session: Session, r: PreviewRequest = {}): RgbaImage {
  session.sync();
  const eng = session.engine();
  const doc = session.doc;
  const size = r.size ?? 768;
  const cam = typeof r.view === "object" ? r.view : session.camera(r.view ?? "iso", r.zoom ?? 1);
  return renderView(eng.mesh, eng.textures(), cam, {
    width: size,
    height: size,
    environment: r.environment ?? doc.view.environment,
    exposure: doc.view.exposure,
    rotation: doc.view.rotation,
    background: r.background === undefined ? doc.view.background : r.background,
    ssaa: size <= 1024 ? 2 : 1,
    channel: r.channel ?? "material",
  });
}

/** Several views, channel views and the flat UV texture in one captioned grid. */
export function renderSheet(session: Session, opts: SheetRequest = {}): RgbaImage {
  session.sync();
  const eng = session.engine();
  const doc = session.doc;
  const cell = opts.cell ?? 300;
  const views = opts.views ?? ["front", "iso", "back", "top"];
  const channels = opts.channels ?? [];
  const base = { width: cell, height: cell, environment: doc.view.environment, exposure: doc.view.exposure, rotation: doc.view.rotation, background: doc.view.background, ssaa: 2 } as const;
  const cells = [
    ...views.map((v) => ({ image: renderView(eng.mesh, eng.textures(), session.camera(v), base), caption: v })),
    ...channels.map((c) => ({ image: renderView(eng.mesh, eng.textures(), session.camera("iso"), { ...base, channel: c, ssaa: 1 }), caption: c })),
    ...(opts.uv ? [{ image: textureImage(eng.textures(), "baseColor", cell), caption: "uv basecolor" }] : []),
  ];
  return composeGrid(cells, Math.min(4, cells.length), 10, [246, 246, 244]);
}
