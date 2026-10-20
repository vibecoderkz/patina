// App icon, drawn by Patina itself: the material orb with the "Painted steel, worn" smart material,
// rendered by the CPU path and composited onto a rounded tile. Run: npx tsx examples/icon.mts
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { encodePng, renderPreview, rgbaToPixels, Session, type RgbaImage } from "../packages/core/src/index.ts";

const S = 1024;
const s = new Session();
s.editor.execute("doc.new", { primitive: "orb", resolution: 2048, segments: 64 });
s.editor.execute("smart.apply", { preset: "paintedSteelWorn" });
s.editor.execute("view.set", { environment: "studio", exposure: 0.15, rotation: 20 });
const cam = s.camera("iso", 1.32);
const orb = renderPreview(s, { view: { ...cam, target: [cam.target[0], cam.target[1] + 0.02, cam.target[2]] }, size: 860, background: null });

// rounded tile with a soft paper gradient, then the orb on top with a contact shadow
const out: RgbaImage = { width: S, height: S, data: new Uint8ClampedArray(S * S * 4) };
const r = 220, m = 40;
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const dx = Math.max(m + r - x, 0, x - (S - m - r)), dy = Math.max(m + r - y, 0, y - (S - m - r));
    const d = Math.hypot(dx, dy) - r;
    const a = Math.max(0, Math.min(1, 0.5 - d));
    const g = Math.hypot((x - S * 0.5) / S, (y - S * 0.36) / S);
    const v = 250 - g * 70;
    const o = (y * S + x) * 4;
    out.data.set([v, v - 1, v - 4, a * 255], o);
  }
// shadow ellipse
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const e = ((x - S / 2) / 300) ** 2 + ((y - 848) / 44) ** 2;
    if (e < 1) {
      const o = (y * S + x) * 4;
      const k = (1 - e) * 0.28;
      for (let c = 0; c < 3; c++) out.data[o + c] *= 1 - k;
    }
  }
const ox = (S - orb.width) / 2, oy = 96;
for (let y = 0; y < orb.height; y++)
  for (let x = 0; x < orb.width; x++) {
    const s4 = (y * orb.width + x) * 4, d4 = ((y + oy) * S + x + ox) * 4;
    const a = orb.data[s4 + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[d4 + c] = orb.data[s4 + c] * a + out.data[d4 + c] * (1 - a);
  }
writeFileSync(new URL("../brand/icon.png", import.meta.url), await encodePng(rgbaToPixels(out), (d) => deflateSync(d)));
console.log("brand/icon.png");
