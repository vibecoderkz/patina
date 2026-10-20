import { useState } from "react";
import { CHANNELS, ENVIRONMENTS, type ChannelId, type ColorSource, type FillLayer, type Generator, type Layer, type MaskEffect, type NoiseSpec, type ScalarSource } from "@patina/core";
import { Icon } from "../icons";
import { getUi, run, session, setUi, useDoc, useSelection, useUi } from "../store";
import { BLEND_OPTIONS, ColorField, Ctl, Select, Slider, Toggle } from "./controls";

const CH_LABEL: Record<ChannelId, string> = { baseColor: "Base color", metallic: "Metallic", roughness: "Roughness", height: "Height", emissive: "Emissive" };
const COLOR: Record<ChannelId, boolean> = { baseColor: true, emissive: true, metallic: false, roughness: false, height: false };
const NOISE_TYPES = ["fbm", "perlin", "ridged", "cellular", "spots", "scratches", "grunge", "wood"] as const;
const DEFAULTS: Record<ChannelId, string | number> = { baseColor: "#9a9a96", metallic: 0, roughness: 0.5, height: 0, emissive: "#ff3b2e" };

const pct = (v: number) => `${Math.round(v * 100)}%`;

function NoiseEditor({ spec, onChange }: { spec: NoiseSpec; onChange: (p: Partial<NoiseSpec>, key: string) => void }) {
  return (
    <>
      <Ctl label="Pattern">
        <Select value={spec.type} options={NOISE_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} onChange={(type) => onChange({ type }, `noise-type-${Date.now()}`)} />
      </Ctl>
      <Ctl label="Scale">
        <Slider name="" value={spec.scale} min={0.002} max={0.5} step={0.001} onChange={(scale, k) => onChange({ scale }, k)} />
      </Ctl>
      <Ctl label="Contrast">
        <Slider name="" value={spec.contrast} min={0} max={6} step={0.05} onChange={(contrast, k) => onChange({ contrast }, k)} />
      </Ctl>
      <Ctl label="Balance">
        <Slider name="" value={spec.bias} min={-1} max={1} step={0.01} onChange={(bias, k) => onChange({ bias }, k)} />
      </Ctl>
      <Ctl label="Seed">
        <Slider name="" value={spec.seed} min={0} max={999} step={1} onChange={(seed, k) => onChange({ seed }, k)} />
      </Ctl>
    </>
  );
}

function ChannelRow({ layer, ch }: { layer: FillLayer; ch: ChannelId }) {
  const src = layer.material[ch] as ScalarSource | ColorSource | undefined;
  const on = src !== undefined;
  const isColor = COLOR[ch];
  const procedural = on && typeof src === "object";
  const set = (v: unknown, key?: string) => run("layer.update", { id: layer.id, material: { [ch]: v } }, key);
  const range = ch === "height" ? { min: -1, max: 1 } : { min: 0, max: 1 };
  return (
    <div className="ch-row">
      <div className="ch-head">
        <Toggle on={on} title={on ? "This layer writes the channel" : "Channel off: layers below show through"} onChange={(v) => set(v ? DEFAULTS[ch] : null)} />
        <b style={on ? undefined : { color: "var(--faint)" }}>{CH_LABEL[ch]}</b>
        {on && (
          <button
            className={`chip ${procedural ? "on" : ""}`}
            title="Drive this channel with a procedural pattern"
            onClick={() => {
              if (procedural) set((src as { from: unknown }).from);
              else set({ noise: { type: "fbm", scale: 0.05 }, from: src, to: isColor ? "#2a2a2a" : typeof src === "number" ? Math.min(range.max, (src as number) + 0.3) : 0.8 });
            }}
          >
            Pattern
          </button>
        )}
      </div>
      {on && !procedural && (isColor ? <ColorField value={src as string} onChange={(v, k) => set(v, k)} /> : <Slider name="" value={src as number} {...range} onChange={(v, k) => set(v, k)} />)}
      {on && procedural && (() => {
        const s = src as { noise: NoiseSpec; from: string | number; to: string | number };
        return (
          <>
            <div className="grad" style={{ background: isColor ? `linear-gradient(90deg, ${s.from}, ${s.to})` : `linear-gradient(90deg, hsl(0 0% ${((Number(s.from) - range.min) / (range.max - range.min)) * 100}%), hsl(0 0% ${((Number(s.to) - range.min) / (range.max - range.min)) * 100}%))` }} />
            {isColor ? (
              <>
                <Ctl label="From"><ColorField value={s.from as string} onChange={(v, k) => set({ ...s, from: v }, k)} /></Ctl>
                <Ctl label="To"><ColorField value={s.to as string} onChange={(v, k) => set({ ...s, to: v }, k)} /></Ctl>
              </>
            ) : (
              <>
                <Ctl label="From"><Slider name="" value={s.from as number} {...range} onChange={(v, k) => set({ ...s, from: v }, k)} /></Ctl>
                <Ctl label="To"><Slider name="" value={s.to as number} {...range} onChange={(v, k) => set({ ...s, to: v }, k)} /></Ctl>
              </>
            )}
            <NoiseEditor spec={s.noise} onChange={(p, k) => set({ ...s, noise: { ...s.noise, ...p } }, k)} />
          </>
        );
      })()}
    </div>
  );
}

const GEN_TYPES: { value: Generator["type"]; label: string }[] = [
  { value: "edgeWear", label: "Edge wear" },
  { value: "dirt", label: "Dirt (cavities)" },
  { value: "curvature", label: "Curvature" },
  { value: "ao", label: "Ambient occlusion" },
  { value: "facing", label: "Facing direction" },
  { value: "gradient", label: "Position gradient" },
  { value: "noise", label: "Noise" },
  { value: "uniform", label: "Uniform" },
];

function EffectCard({ layer, e }: { layer: Layer; e: MaskEffect }) {
  const effect = useUi((u) => u.effect);
  const upd = (p: Record<string, unknown>, key?: string) => run("mask.effect.update", { layer: layer.id, id: e.id, ...p }, key);
  const gen = (p: Partial<Generator>, key?: string) => upd({ generator: p }, key);
  return (
    <div className={`effect ${effect === e.id ? "sel" : ""}`} onClick={() => setUi({ effect: e.id, target: "mask" })}>
      <div className="effect-head">
        <Icon name={e.type === "paint" ? "brush" : e.type === "levels" ? "adjust" : "sparkles"} size={14} />
        <b>{e.name}</b>
        <button className="iconbtn" title={e.visible ? "Hide effect" : "Show effect"} onClick={(ev) => {
          ev.stopPropagation();
          upd({ visible: !e.visible });
        }}>
          <Icon name={e.visible ? "eye" : "eyeOff"} size={14} />
        </button>
        <button className="iconbtn" title="Remove effect" onClick={(ev) => {
          ev.stopPropagation();
          run("mask.effect.remove", { layer: layer.id, id: e.id });
        }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {e.type !== "levels" && (
        <>
          <Ctl label="Blend"><Select value={e.blend} options={[...BLEND_OPTIONS]} onChange={(blend) => upd({ blend })} /></Ctl>
          <Ctl label="Opacity"><Slider name="" value={e.opacity} format={pct} onChange={(opacity, k) => upd({ opacity }, k)} /></Ctl>
        </>
      )}
      {e.type === "paint" && (
        <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
          {e.strokes.length} stroke{e.strokes.length === 1 ? "" : "s"}. Paint white to show the layer, black to hide it.
        </p>
      )}
      {e.type === "levels" && (
        <>
          <Ctl label="Low"><Slider name="" value={e.low} onChange={(low, k) => upd({ low }, k)} /></Ctl>
          <Ctl label="High"><Slider name="" value={e.high} onChange={(high, k) => upd({ high }, k)} /></Ctl>
          <Ctl label="Gamma"><Slider name="" value={e.gamma} min={0.1} max={4} onChange={(gamma, k) => upd({ gamma }, k)} /></Ctl>
        </>
      )}
      {e.type === "generator" && (() => {
        const g = e.generator;
        const thresholded = ["edgeWear", "dirt", "curvature", "ao", "facing"].includes(g.type);
        return (
          <>
            <Ctl label="Generator"><Select value={g.type} options={GEN_TYPES} onChange={(type) => gen({ type })} /></Ctl>
            {thresholded && (
              <>
                <Ctl label="Amount"><Slider name="" value={g.amount} format={pct} onChange={(amount, k) => gen({ amount }, k)} /></Ctl>
                <Ctl label="Softness"><Slider name="" value={g.softness} format={pct} onChange={(softness, k) => gen({ softness }, k)} /></Ctl>
              </>
            )}
            {g.type === "curvature" && <Ctl label="Side"><Select value={g.mode} options={[{ value: "convex", label: "Convex (edges)" }, { value: "concave", label: "Concave (creases)" }]} onChange={(mode) => gen({ mode })} /></Ctl>}
            {g.type === "facing" && (
              <Ctl label="Facing">
                <Select
                  value={JSON.stringify(g.direction)}
                  options={[
                    { value: "[0,1,0]", label: "Up" },
                    { value: "[0,-1,0]", label: "Down" },
                    { value: "[0,0,1]", label: "Front" },
                    { value: "[1,0,0]", label: "Right" },
                    { value: "[-1,0,0]", label: "Left" },
                  ]}
                  onChange={(v) => gen({ direction: JSON.parse(v) })}
                />
              </Ctl>
            )}
            {g.type === "gradient" && (
              <>
                <Ctl label="Axis"><Select value={g.axis} options={[{ value: "y", label: "Y (height)" }, { value: "x", label: "X" }, { value: "z", label: "Z" }]} onChange={(axis) => gen({ axis })} /></Ctl>
                <Ctl label="From"><Slider name="" value={g.from} min={0} max={1} onChange={(from, k) => gen({ from }, k)} /></Ctl>
                <Ctl label="To"><Slider name="" value={g.to} min={0} max={1} onChange={(to, k) => gen({ to }, k)} /></Ctl>
              </>
            )}
            {g.type === "uniform" && <Ctl label="Value"><Slider name="" value={g.value} onChange={(value, k) => gen({ value }, k)} /></Ctl>}
            {g.type === "noise" && <NoiseEditor spec={g.noise} onChange={(p, k) => gen({ noise: p } as Partial<Generator>, k)} />}
            {g.type !== "noise" && g.type !== "uniform" && (
              <>
                <Ctl label="Breakup"><Slider name="" value={g.breakupStrength} min={0} max={2} onChange={(breakupStrength, k) => gen({ breakupStrength }, k)} /></Ctl>
                <Ctl label="Breakup size"><Slider name="" value={g.breakup.scale} min={0.005} max={0.4} step={0.001} onChange={(scale, k) => gen({ breakup: { scale } } as Partial<Generator>, k)} /></Ctl>
              </>
            )}
            <Ctl label="Invert"><Toggle on={g.invert} onChange={(invert) => gen({ invert })} /></Ctl>
          </>
        );
      })()}
    </div>
  );
}

function MaskSection({ layer }: { layer: Layer }) {
  const target = useUi((u) => u.target);
  const [adding, setAdding] = useState(false);
  const m = layer.mask;
  if (!m)
    return (
      <div className="sec">
        <div className="sec-title"><Icon name="mask" size={15} />Mask</div>
        <div className="chips">
          <button className="chip" onClick={() => run("mask.add", { layer: layer.id, preset: "white" })}>White</button>
          <button className="chip" onClick={() => run("mask.add", { layer: layer.id, preset: "black" })}>Black</button>
          <button className="chip" onClick={() => run("mask.add", { layer: layer.id, preset: "edgeWear" })}>Edge wear</button>
          <button className="chip" onClick={() => run("mask.add", { layer: layer.id, preset: "dirt" })}>Dirt</button>
          <button className="chip" onClick={() => run("mask.add", { layer: layer.id, preset: "dustTop" })}>Dust on top</button>
        </div>
      </div>
    );
  return (
    <div className="sec">
      <div className="sec-title">
        <Icon name="mask" size={15} />
        Mask
        <small>
          <button className={`chip ${target === "mask" ? "on" : ""}`} onClick={() => setUi({ target: target === "mask" ? "layer" : "mask" })}>
            {target === "mask" ? "Painting the mask" : "Paint the mask"}
          </button>
        </small>
      </div>
      <Ctl label="Enabled"><Toggle on={m.enabled} onChange={(enabled) => run("mask.update", { layer: layer.id, enabled })} /></Ctl>
      <Ctl label="Starts">
        <div className="seg" style={{ justifySelf: "start" }}>
          <button className={m.base < 0.5 ? "on" : ""} onClick={() => run("mask.update", { layer: layer.id, base: 0 })}>Black</button>
          <button className={m.base >= 0.5 ? "on" : ""} onClick={() => run("mask.update", { layer: layer.id, base: 1 })}>White</button>
        </div>
      </Ctl>
      <Ctl label="Invert"><Toggle on={m.invert} onChange={(invert) => run("mask.update", { layer: layer.id, invert })} /></Ctl>
      {[...m.effects].reverse().map((e) => <EffectCard key={e.id} layer={layer} e={e} />)}
      <div className="row" style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <span className="menu-wrap">
          <button className="pill sm" onClick={() => setAdding(!adding)}><Icon name="plus" size={14} />Effect</button>
          {adding && (
            <div className="menu" style={{ top: "auto", bottom: 36 }} onMouseLeave={() => setAdding(false)}>
              {GEN_TYPES.map((g) => (
                <button key={g.value} onClick={() => {
                  run("mask.effect.add", { layer: layer.id, type: "generator", name: g.label, generator: { type: g.value } });
                  setAdding(false);
                }}>{g.label}</button>
              ))}
              <hr />
              <button onClick={() => {
                const r = run<{ ids: string[] }>("mask.effect.add", { layer: layer.id, type: "paint", name: "Painted mask" });
                if (r) setUi({ effect: r.ids[0], target: "mask" });
                setAdding(false);
              }}>Paint effect</button>
              <button onClick={() => {
                run("mask.effect.add", { layer: layer.id, type: "levels" });
                setAdding(false);
              }}>Levels</button>
            </div>
          )}
        </span>
        <button className="pill sm ghost" onClick={() => run("mask.remove", { layer: layer.id })}>Remove mask</button>
      </div>
    </div>
  );
}

function BrushSection({ mask }: { mask: boolean }) {
  const ui = useUi((u) => u);
  const b = ui.brush;
  const setB = (p: Partial<typeof b>) => setUi({ brush: { ...getUi().brush, ...p } });
  return (
    <>
      {mask ? (
        <div className="sec">
          <div className="sec-title"><Icon name="brush" size={15} />Mask brush</div>
          <Ctl label="Paint">
            <div className="seg" style={{ justifySelf: "start" }}>
              <button className={ui.maskValue >= 0.5 ? "on" : ""} onClick={() => setUi({ maskValue: 1 })}>White</button>
              <button className={ui.maskValue < 0.5 ? "on" : ""} onClick={() => setUi({ maskValue: 0 })}>Black</button>
            </div>
          </Ctl>
          <Ctl label="Grey level"><Slider name="" value={ui.maskValue} format={pct} onChange={(maskValue) => setUi({ maskValue })} /></Ctl>
        </div>
      ) : (
        <div className="sec">
          <div className="sec-title"><Icon name="brush" size={15} />Brush material<small>what a stroke deposits</small></div>
          {CHANNELS.map((ch) => (
            <div className="ch-row" key={ch}>
              <div className="ch-head">
                <Toggle on={ui.channels[ch]} onChange={(v) => setUi({ channels: { ...getUi().channels, [ch]: v } })} />
                <b style={ui.channels[ch] ? undefined : { color: "var(--faint)" }}>{CH_LABEL[ch]}</b>
              </div>
              {ui.channels[ch] &&
                (COLOR[ch] ? (
                  <ColorField value={ui.paint[ch] as string} onChange={(v) => setUi({ paint: { ...getUi().paint, [ch]: v } })} />
                ) : (
                  <Slider name="" value={ui.paint[ch] as number} min={ch === "height" ? -1 : 0} max={1} onChange={(v) => setUi({ paint: { ...getUi().paint, [ch]: v } })} />
                ))}
            </div>
          ))}
        </div>
      )}
      <div className="sec">
        <div className="sec-title"><Icon name="adjust" size={15} />Brush<small>[ ] size, Shift+[ ] hardness</small></div>
        <Ctl label="Size"><Slider name="" value={b.size} min={0.002} max={0.3} step={0.001} onChange={(size) => setB({ size })} /></Ctl>
        <Ctl label="Hardness"><Slider name="" value={b.hardness} format={pct} onChange={(hardness) => setB({ hardness })} /></Ctl>
        <Ctl label="Flow"><Slider name="" value={b.flow} format={pct} onChange={(flow) => setB({ flow })} /></Ctl>
        <Ctl label="Opacity"><Slider name="" value={b.opacity} format={pct} onChange={(opacity) => setB({ opacity })} /></Ctl>
        <Ctl label="Spacing"><Slider name="" value={b.spacing} min={0.05} max={2} onChange={(spacing) => setB({ spacing })} /></Ctl>
        <Ctl label="Alpha">
          <Select value={b.alpha} options={[{ value: "round", label: "Round" }, { value: "spray", label: "Spray" }, { value: "grunge", label: "Grunge" }, { value: "speckle", label: "Speckle" }]} onChange={(alpha) => setB({ alpha })} />
        </Ctl>
        <Ctl label="Projection">
          <Select value={b.projection} options={[{ value: "view", label: "From the camera" }, { value: "sphere", label: "3D sphere" }]} onChange={(projection) => setB({ projection })} />
        </Ctl>
        <Ctl label="Symmetry">
          <Select value={b.symmetry} options={[{ value: "none", label: "Off" }, { value: "x", label: "Mirror X" }, { value: "y", label: "Mirror Y" }, { value: "z", label: "Mirror Z" }]} onChange={(symmetry) => setB({ symmetry })} />
        </Ctl>
      </div>
    </>
  );
}

function LayerHeader({ layer }: { layer: Layer }) {
  return (
    <div className="sec">
      <div className="sec-title">
        <Icon name={layer.type === "fill" ? "fill" : layer.type === "paint" ? "brush" : "folder"} size={15} />
        {layer.name}
        <small>{layer.id}</small>
      </div>
      <Ctl label="Blend"><Select value={layer.blend} options={[...BLEND_OPTIONS]} onChange={(blend) => run("layer.update", { id: layer.id, blend })} /></Ctl>
      <Ctl label="Opacity"><Slider name="" value={layer.opacity} format={pct} onChange={(opacity, k) => run("layer.update", { id: layer.id, opacity }, k)} /></Ctl>
      {layer.type !== "folder" && (
        <Ctl label="Height blend">
          <Select
            value={layer.channelBlend?.height ?? "inherit"}
            options={[{ value: "inherit", label: "Same as layer" }, { value: "add", label: "Add (stack bumps)" }, { value: "normal", label: "Normal" }, { value: "max", label: "Max" }, { value: "off", label: "Off" }]}
            onChange={(v) => run("layer.update", { id: layer.id, channelBlend: { height: v === "inherit" ? null : v } })}
          />
        </Ctl>
      )}
      {layer.type === "paint" && layer.strokes.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ color: "var(--muted)" }}>{layer.strokes.length} stroke{layer.strokes.length === 1 ? "" : "s"}</span>
          <button className="pill sm ghost" onClick={() => run("layer.clear", { id: layer.id })}>Clear paint</button>
        </div>
      )}
    </div>
  );
}

function DocumentSection() {
  const doc = useDoc();
  const [baking, setBaking] = useState(false);
  const eng = session.engine();
  return (
    <>
      <div className="sec">
        <div className="sec-title"><Icon name="cube" size={15} />Texture set<small>{eng.mesh.name}</small></div>
        <Ctl label="Resolution">
          <Select value={String(doc.resolution)} options={["512", "1024", "2048", "4096"].map((r) => ({ value: r, label: `${r} px` }))} onChange={(r) => run("doc.set", { resolution: Number(r) })} />
        </Ctl>
        <Ctl label="Normal strength"><Slider name="" value={doc.normalStrength} min={0} max={4} onChange={(normalStrength, k) => run("doc.set", { normalStrength }, k)} /></Ctl>
        <Ctl label="Base color"><ColorField value={doc.base.baseColor} onChange={(baseColor, k) => run("doc.set", { base: { baseColor } }, k)} /></Ctl>
        <Ctl label="Base rough"><Slider name="" value={doc.base.roughness} onChange={(roughness, k) => run("doc.set", { base: { roughness } }, k)} /></Ctl>
        <Ctl label="Base metal"><Slider name="" value={doc.base.metallic} onChange={(metallic, k) => run("doc.set", { base: { metallic } }, k)} /></Ctl>
      </div>
      <div className="sec">
        <div className="sec-title"><Icon name="bolt" size={15} />Mesh maps<small>{eng.baked ? "baked" : "not baked yet"}</small></div>
        <Ctl label="Curvature r"><Slider name="" value={doc.bake.curvatureRadius} min={0.005} max={0.2} step={0.001} onChange={(curvatureRadius, k) => run("bake.set", { curvatureRadius }, k)} /></Ctl>
        <Ctl label="AO distance"><Slider name="" value={doc.bake.aoDistance} min={0.02} max={1} onChange={(aoDistance, k) => run("bake.set", { aoDistance }, k)} /></Ctl>
        <Ctl label="AO samples"><Slider name="" value={doc.bake.aoSamples} min={8} max={128} step={1} onChange={(aoSamples, k) => run("bake.set", { aoSamples }, k)} /></Ctl>
        <button className="pill sm" style={{ marginTop: 8 }} disabled={baking} onClick={() => {
          setBaking(true);
          setUi({ busy: "Baking curvature and occlusion" });
          setTimeout(() => {
            const r = run<{ ms: number }>("bake.run");
            setUi({ busy: null });
            setBaking(false);
            if (r) setUi({ toast: { text: `Baked in ${(r.ms / 1000).toFixed(1)} s`, id: Date.now() } });
          }, 40);
        }}>
          <Icon name="bolt" size={14} />Bake now
        </button>
      </div>
      <div className="sec">
        <div className="sec-title"><Icon name="sun" size={15} />Lighting</div>
        <Ctl label="Environment"><Select value={doc.view.environment} options={ENVIRONMENTS.map((e) => ({ value: e.name, label: e.title }))} onChange={(environment) => run("view.set", { environment })} /></Ctl>
        <Ctl label="Exposure"><Slider name="" value={doc.view.exposure} min={-3} max={3} onChange={(exposure, k) => run("view.set", { exposure }, k)} /></Ctl>
        <Ctl label="Rotation"><Slider name="" value={doc.view.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(rotation, k) => run("view.set", { rotation }, k)} /></Ctl>
      </div>
    </>
  );
}

export function Properties() {
  const doc = useDoc();
  const selection = useSelection();
  const target = useUi((u) => u.target);
  let layer: Layer | null = null;
  const find = (ls: Layer[]) => {
    for (const l of ls) {
      if (l.id === selection) layer = l;
      if (l.type === "folder") find(l.children);
    }
  };
  find(doc.layers);
  const l = layer as Layer | null;
  return (
    <>
      <div className="h"><span>{l ? (target === "mask" ? "Mask" : "Properties") : "Document"}</span></div>
      <div className="props">
        {!l && <BrushSection mask={false} />}
        {!l && <DocumentSection />}
        {l && <LayerHeader layer={l} />}
        {l && target === "layer" && l.type === "fill" && (
          <div className="sec">
            <div className="sec-title"><Icon name="fill" size={15} />Material</div>
            {CHANNELS.map((ch) => <ChannelRow key={ch} layer={l as FillLayer} ch={ch} />)}
          </div>
        )}
        {l && (target === "mask" || l.type !== "paint") && <MaskSection layer={l} />}
        {l && (l.type === "paint" || target === "mask") && <BrushSection mask={target === "mask"} />}
        {l && l.type === "paint" && target === "layer" && <MaskSection layer={l} />}
      </div>
    </>
  );
}
