// Every smart material on the orb in one captioned sheet: the quickest way to judge the presets.
// Run: npx tsx examples/smart-sheet.mts [out.png] [primitive]
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { composeGrid, encodePng, renderPreview, rgbaToPixels, Session, SMART_MATERIALS, type PrimitiveName } from "../packages/core/src/index.ts";

const out = process.argv[2] ?? "smart-sheet.png";
const prim = (process.argv[3] ?? "orb") as PrimitiveName;
const s = new Session();
const cells = [];
for (const sm of SMART_MATERIALS) {
  s.editor.execute("doc.new", { primitive: prim, resolution: 1024 });
  s.editor.execute("smart.apply", { preset: sm.id });
  const t = performance.now();
  cells.push({ image: renderPreview(s, { view: "iso", size: 360, zoom: 1.15 }), caption: sm.id });
  console.log(sm.id, Math.round(performance.now() - t), "ms");
}
writeFileSync(out, await encodePng(rgbaToPixels(composeGrid(cells, 4, 10, [246, 246, 244])), (d) => deflateSync(d)));
console.log(out);
