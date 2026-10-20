import { useEffect, useRef } from "react";
import { uvToObject, type ViewChannel } from "@patina/core";
import { editor, getUi, session, useUi } from "../store";
import { currentGpu, onTextures } from "./gpu";
import { beginPaint, endPaint, extendPaint, isPainting } from "./paint";

/** Which RGBA8 buffer and how to read a channel from it. */
function channelPixels(ch: ViewChannel): { key: "baseColor" | "orm" | "normal" | "emissive" | "aux"; pick: number | null } {
  switch (ch) {
    case "metallic": return { key: "orm", pick: 2 };
    case "roughness": return { key: "orm", pick: 1 };
    case "ao": return { key: "aux", pick: 2 };
    case "height": return { key: "aux", pick: 0 };
    case "curvature": return { key: "aux", pick: 1 };
    case "normal": return { key: "normal", pick: null };
    case "emissive": return { key: "emissive", pick: null };
    default: return { key: "baseColor", pick: null };
  }
}

/** Flat texture view with the UV layout on top. Painting here uses the sphere brush in object space. */
export function UvView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const channel = useUi((u) => u.channel);
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const tex = document.createElement("canvas");
    const tctx = tex.getContext("2d")!;
    let wire: Path2D | null = null;
    let wireMesh: unknown = null;
    let raf = 0;

    const layoutRect = () => {
      const w = canvas.width, h = canvas.height;
      const s = Math.min(w, h) * 0.92 * view.current.zoom;
      return { x: (w - s) / 2 + view.current.x * devicePixelRatio, y: (h - s) / 2 + view.current.y * devicePixelRatio, s };
    };

    const draw = () => {
      raf = 0;
      const { gpu, engine } = currentGpu();
      const res = gpu.res;
      if (tex.width !== res) {
        tex.width = tex.height = res;
      }
      const { key, pick } = channelPixels(getUi().channel);
      const src = gpu.data[key];
      const img = tctx.createImageData(res, res);
      const alpha = gpu.data.aux;
      if (pick === null) for (let i = 0; i < res * res; i++) {
        img.data[i * 4] = src[i * 4];
        img.data[i * 4 + 1] = src[i * 4 + 1];
        img.data[i * 4 + 2] = src[i * 4 + 2];
        img.data[i * 4 + 3] = alpha[i * 4 + 3] ? 255 : 60;
      }
      else for (let i = 0; i < res * res; i++) {
        const v = src[i * 4 + pick];
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = alpha[i * 4 + 3] ? 255 : 60;
      }
      tctx.putImageData(img, 0, 0);
      const r = layoutRect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = r.s < res;
      ctx.drawImage(tex, r.x, r.y, r.s, r.s);
      ctx.strokeStyle = "#0a0a0b14";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s, r.s);
      // UV wireframe (built once per mesh, in unit space)
      if (wireMesh !== engine.mesh) {
        wireMesh = engine.mesh;
        const m = engine.mesh;
        wire = new Path2D();
        const tris = m.indices.length / 3;
        const step = tris > 60000 ? Math.ceil(tris / 60000) : 1;
        for (let t = 0; t < tris; t += step) {
          const a = m.indices[t * 3], b = m.indices[t * 3 + 1], c = m.indices[t * 3 + 2];
          wire.moveTo(m.uvs[a * 2], m.uvs[a * 2 + 1]);
          wire.lineTo(m.uvs[b * 2], m.uvs[b * 2 + 1]);
          wire.lineTo(m.uvs[c * 2], m.uvs[c * 2 + 1]);
          wire.closePath();
        }
      }
      if (wire) {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.scale(r.s, r.s);
        ctx.lineWidth = 0.6 / r.s;
        ctx.strokeStyle = "#0a0a0b38";
        ctx.stroke(wire);
        ctx.restore();
      }
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    drawRef.current = request;

    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      request();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const offTex = onTextures(request);
    const offEd = editor.subscribe(request);

    const toUv = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const r = layoutRect();
      const px = (e.clientX - b.left) * devicePixelRatio, py = (e.clientY - b.top) * devicePixelRatio;
      return [(px - r.x) / r.s, (py - r.y) / r.s] as const;
    };
    let drag: { mode: "pan" | "paint"; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2 || e.altKey) drag = { mode: "pan", x: e.clientX, y: e.clientY };
      else {
        const [u, v] = toUv(e);
        const p = uvToObject(session.engine().maps, u, v);
        if (!p || getUi().tool === "picker") return;
        if (!beginPaint(p, null, e.pointerType === "pen" ? e.pressure : undefined)) return;
        drag = { mode: "paint", x: e.clientX, y: e.clientY };
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      if (drag.mode === "pan") {
        view.current.x += e.clientX - drag.x;
        view.current.y += e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        request();
        return;
      }
      const [u, v] = toUv(e);
      const p = uvToObject(session.engine().maps, u, v);
      if (p) extendPaint(p, e.pointerType === "pen" ? e.pressure : undefined);
    };
    const up = () => {
      if (drag?.mode === "paint" && isPainting()) endPaint();
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = Math.max(0.3, Math.min(12, view.current.zoom * Math.pow(1.0015, -e.deltaY)));
      request();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => {
      ro.disconnect();
      offTex();
      offEd();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => drawRef.current(), [channel]);

  return (
    <div className="pane uv">
      <canvas ref={ref} />
    </div>
  );
}
