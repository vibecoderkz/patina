import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createPrimitive,
  encodePng,
  exportGlb,
  parseGlb,
  parseObj,
  rasterizeUvs,
  Session,
  TextureEngine,
  PRIMITIVES,
  type PatinaDocument,
} from "../src/index.js";

const RES = 256;

function newSession(primitive = "roundedCube") {
  const s = new Session();
  s.editor.execute("doc.new", { primitive, resolution: RES });
  return s;
}

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe("meshes", () => {
  it("every primitive has UVs inside 0..1 and unit tangents", () => {
    for (const p of PRIMITIVES) {
      const m = createPrimitive(p.name, 16);
      expect(m.indices.length % 3).toBe(0);
      for (const v of m.uvs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      const t = m.tangents!;
      for (let i = 0; i < t.length; i += 4) expect(Math.abs(Math.hypot(t[i], t[i + 1], t[i + 2]) - 1)).toBeLessThan(1e-3);
    }
  });

  it("UV rasterization covers the islands and puts texels on the surface", () => {
    const m = createPrimitive("sphere", 24);
    const maps = rasterizeUvs(m, 128);
    expect(maps.texels.length / (128 * 128)).toBeGreaterThan(0.5);
    // sphere radius 0.9: every texel position lies close to it
    for (let k = 0; k < maps.texels.length; k += 97) {
      const i = maps.texels[k];
      const r = Math.hypot(maps.pos[i * 3], maps.pos[i * 3 + 1], maps.pos[i * 3 + 2]);
      expect(Math.abs(r - 0.9)).toBeLessThan(0.02);
    }
  });

  it("parses OBJ (fan triangulation, v flipped to glTF convention)", () => {
    const m = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n", "quad");
    expect(m.indices.length).toBe(6);
    expect(m.uvs[1]).toBe(1); // vt 0 0 -> v = 1
    expect(m.normals[2]).toBeCloseTo(1);
  });

  it("refuses meshes without UVs with a fix in the message", () => {
    expect(() => parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")).toThrow(/Smart UV Project/);
  });
});

describe("editor", () => {
  it("adds, updates, undoes and redoes layers", () => {
    const s = newSession();
    const { id } = s.editor.execute<{ id: string }>("layer.add", { type: "fill", preset: "gold" });
    s.editor.execute("layer.update", { id, opacity: 0.5, material: { roughness: 0.9 } });
    let l = s.doc.layers[0] as Extract<PatinaDocument["layers"][number], { type: "fill" }>;
    expect(l.opacity).toBe(0.5);
    expect(l.material.roughness).toBe(0.9);
    s.editor.undo();
    l = s.doc.layers[0] as typeof l;
    expect(l.opacity).toBe(1);
    s.editor.redo();
    expect((s.doc.layers[0] as typeof l).opacity).toBe(0.5);
  });

  it("batch is atomic and one undo step", () => {
    const s = newSession();
    const before = s.doc;
    expect(() =>
      s.editor.batch([
        { command: "layer.add", params: { type: "fill", preset: "steel" } },
        { command: "layer.update", params: { id: "nope", opacity: 0.2 } },
      ]),
    ).toThrow(/step 2/);
    expect(s.doc).toBe(before);
    s.editor.batch([
      { command: "layer.add", params: { type: "fill", preset: "steel" } },
      { command: "layer.add", params: { type: "paint" } },
    ]);
    expect(s.doc.layers.length).toBe(2);
    s.editor.undo();
    expect(s.doc.layers.length).toBe(0);
  });

  it("rejects typos with the field name", () => {
    const s = newSession();
    expect(() => s.editor.execute("layer.add", { type: "fill", opacty: 1 })).toThrow(/opacty/);
  });
});

describe("texture engine", () => {
  it("composites a fill layer", () => {
    const s = newSession();
    s.editor.execute("layer.add", { type: "fill", material: { baseColor: "#ff0000", roughness: 0.2, metallic: 1 } });
    s.sync();
    const e = s.engine();
    const i = e.maps.texels[100];
    expect(e.sampleTexel(i)).toMatchObject({ baseColor: "#ff0000", roughness: 0.2, metallic: 1 });
  });

  it("incremental stroke updates equal a full recompute", () => {
    const s = newSession();
    s.editor.execute("smart.apply", { preset: "paintedSteelWorn" });
    const { id } = s.editor.execute<{ id: string }>("layer.add", { type: "paint", parent: null });
    s.sync();
    const t = s.engine().version;
    s.editor.execute("paint.stroke", { layer: id, material: { baseColor: "#00ff00", height: 0.5 }, points: [[-0.8, 0.2, 0.3], [-0.8, 0.4, -0.3]], brush: { size: 0.06 } });
    const r = s.sync();
    expect(r.full).toBe(false);
    expect(s.engine().version).toBe(t + 1);
    const fresh = new TextureEngine(s.engine().mesh, RES);
    fresh.sync(s.doc);
    const inc = s.engine().out;
    expect(maxDiff(inc.baseColor, fresh.out.baseColor)).toBeLessThan(1e-5);
    expect(maxDiff(inc.height, fresh.out.height)).toBeLessThan(1e-5);
    expect(maxDiff(inc.normal, fresh.out.normal)).toBeLessThan(1e-4);
  });

  it("undo after a stroke restores the previous textures", () => {
    const s = newSession();
    const { id } = s.editor.execute<{ id: string }>("layer.add", { type: "paint" });
    s.sync();
    const before = s.engine().out.baseColor.slice();
    s.editor.execute("paint.stroke", { layer: id, material: { baseColor: "#0000ff" }, points: [[0, 0.8, 0]], brush: { size: 0.1 } });
    s.sync();
    expect(maxDiff(before, s.engine().out.baseColor)).toBeGreaterThan(0.25); // one dab at flow 0.6
    s.editor.undo();
    s.sync();
    expect(maxDiff(before, s.engine().out.baseColor)).toBeLessThan(1e-6);
  });

  it("a live stroke and the same stroke as a command give the same pixels", () => {
    const a = newSession(), b = newSession();
    for (const s of [a, b]) {
      s.editor.execute("layer.add", { type: "paint" });
      s.sync();
    }
    const brush = { size: 0.05, flow: 0.5, hardness: 0.3, opacity: 1, spacing: 0.25, alpha: "round", projection: "sphere", symmetry: "x", seed: 1 } as const;
    const pts = [0.5, 0.8, -0.2, 0.3, 0.8, 0.1, 0.1, 0.8, 0.3];
    // live: feed points in pieces, then commit the returned stroke through the command
    const eng = a.engine();
    eng.beginLive("L1", { brush, material: { baseColor: "#ff3b2e" }, points: [] });
    eng.extendLive(pts.slice(0, 3));
    eng.extendLive(pts.slice(3));
    const live = eng.endLive()!;
    a.editor.execute("paint.stroke", { layer: "L1", brush, material: { baseColor: "#ff3b2e" }, points: [pts.slice(0, 3), pts.slice(3, 6), pts.slice(6)] });
    expect(live.stroke.points).toEqual(pts);
    a.sync();
    b.editor.execute("paint.stroke", { layer: "L1", brush, material: { baseColor: "#ff3b2e" }, points: [pts.slice(0, 3), pts.slice(3, 6), pts.slice(6)] });
    b.sync();
    expect(maxDiff(a.engine().out.baseColor, b.engine().out.baseColor)).toBeLessThan(1e-5);
  });

  it("mask painting reveals a fill layer only where painted", () => {
    const s = newSession();
    const { id } = s.editor.execute<{ id: string }>("layer.add", { type: "fill", material: { baseColor: "#ffffff" }, mask: "black" });
    s.sync();
    const e = s.engine();
    const near = e.texelNear([0, 0.8, 0]);
    expect(e.sampleTexel(near).baseColor).toBe("#8c8c8c");
    s.editor.execute("paint.stroke", { layer: id, mask: true, points: [[0, 0.8, 0]], brush: { size: 0.08, hardness: 1, flow: 1 } });
    s.sync();
    expect(e.sampleTexel(near).baseColor).toBe("#ffffff");
  });

  it("screen strokes hit the mesh from a named view", () => {
    const s = newSession("sphere");
    s.editor.execute("layer.add", { type: "paint" });
    const r = s.editor.execute<{ points: number }>("paint.stroke", { material: { baseColor: "#000000" }, screen: [[0.5, 0.5], [0.55, 0.5], [0.99, 0.01]], view: "front" });
    expect(r.points).toBe(2); // the corner misses the sphere
  });
});

describe("export", () => {
  it("writes a GLB that parses back with the same triangle count", async () => {
    const s = newSession("torus");
    s.editor.execute("material.apply", { preset: "copper" });
    s.sync();
    const glb = await exportGlb(s.engine(), "test", (d) => deflateSync(d));
    const m = parseGlb(glb);
    expect(m.indices.length).toBe(s.engine().mesh.indices.length);
  });

  it("encodes PNG with a valid signature", async () => {
    const png = await encodePng({ width: 2, height: 2, channels: 1, bits: 16, data: new Uint16Array([0, 65535, 1000, 2]) }, (d) => deflateSync(d));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
