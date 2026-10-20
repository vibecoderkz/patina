import { useEffect } from "react";
import type { ViewChannel } from "@patina/core";
import { Icon } from "./icons";
import { Layers } from "./panels/Layers";
import { Modals } from "./panels/Modals";
import { Properties } from "./panels/Properties";
import { Shelf } from "./panels/Shelf";
import { ToolRail } from "./panels/ToolRail";
import { TopBar } from "./panels/TopBar";
import { openProject, saveProject, startBridge } from "./platform";
import { editor, findLayer, getUi, run, scheduleSync, session, setUi, useDoc, useSelection, useUi } from "./store";
import { UvView } from "./viewport/UvView";
import { Viewport, viewportApi } from "./viewport/Viewport";

const CHANNELS: { id: ViewChannel; label: string }[] = [
  { id: "material", label: "Material" },
  { id: "baseColor", label: "Base" },
  { id: "roughness", label: "Rough" },
  { id: "metallic", label: "Metal" },
  { id: "height", label: "Height" },
  { id: "normal", label: "Normal" },
  { id: "ao", label: "AO" },
  { id: "curvature", label: "Curv" },
];

function StageHud() {
  const channel = useUi((u) => u.channel);
  const brush = useUi((u) => u.brush);
  const paint = useUi((u) => u.paint);
  const tool = useUi((u) => u.tool);
  const target = useUi((u) => u.target);
  const stats = useUi((u) => u.stats);
  const busy = useUi((u) => u.busy);
  const t = useUi((u) => u.toast);
  const maskValue = useUi((u) => u.maskValue);
  const doc = useDoc();
  const sel = findLayer(useSelection());
  const eng = session.engine();
  return (
    <>
      <div className="hud tl">
        <div className="seg glass">
          {CHANNELS.map((c) => (
            <button key={c.id} className={channel === c.id ? "on" : ""} onClick={() => setUi({ channel: c.id })}>{c.label}</button>
          ))}
        </div>
      </div>
      <div className="hud tr">
        {target === "mask" && sel && <div className="target-badge">Painting mask of {sel.name}</div>}
      </div>
      <div className="hud bl">
        <div className="glass brushhud">
          <span className="sw" style={{ background: target === "mask" ? `hsl(0 0% ${maskValue * 100}%)` : tool === "erase" ? "repeating-linear-gradient(45deg,#fff 0 3px,#e2e2df 3px 6px)" : paint.baseColor }} />
          <span>{tool === "erase" ? "Eraser" : tool === "picker" ? "Picker" : "Brush"}</span>
          <span>size <b>{(brush.size * 100).toFixed(1)}</b></span>
          <span>hard <b>{Math.round(brush.hardness * 100)}</b></span>
          <span>flow <b>{Math.round(brush.flow * 100)}</b></span>
          {brush.symmetry !== "none" && <span>sym <b>{brush.symmetry.toUpperCase()}</b></span>}
        </div>
      </div>
      <div className="hud br">
        <div className="glass stat">
          {doc.resolution}px · {eng.maps.texels.length.toLocaleString()} texels · {Math.round(stats.ms)} ms
        </div>
      </div>
      {doc.layers.length === 0 && !busy && (
        <div className="stage-empty">
          <p>
            <b>Paint on the orb, or pick a smart material below</b>
            Left drag paints, right drag orbits, middle drag pans, wheel zooms. Ctrl + wheel sizes the brush.
          </p>
          <button className="pill ink" onClick={() => run("smart.apply", { preset: "paintedSteelWorn" })}>
            <Icon name="sparkles" size={15} />Try one
          </button>
        </div>
      )}
      {busy && (
        <div className="busy">
          <i />
          {busy}
        </div>
      )}
      {t && <div key={t.id} className={`toast ${t.error ? "err" : ""}`}>{t.text}</div>}
    </>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = getUi();
      const k = e.key.toLowerCase();
      if (mod) {
        if (k === "z" && !e.shiftKey) editor.undo();
        else if ((k === "z" && e.shiftKey) || k === "y") editor.redo();
        else if (k === "s") void saveProject(e.shiftKey);
        else if (k === "o") void openProject();
        else if (k === "n") setUi({ modal: "new" });
        else if (k === "e") setUi({ modal: "export" });
        else if (k === "d" && editor.state.selection) run("layer.duplicate", { id: editor.state.selection });
        else return;
        e.preventDefault();
        return;
      }
      const b = ui.brush;
      switch (e.key) {
        case "[":
          setUi({ brush: e.shiftKey ? { ...b, hardness: Math.max(0, b.hardness - 0.1) } : { ...b, size: Math.max(0.002, b.size / 1.18) } });
          break;
        case "]":
          setUi({ brush: e.shiftKey ? { ...b, hardness: Math.min(1, b.hardness + 0.1) } : { ...b, size: Math.min(0.5, b.size * 1.18) } });
          break;
        case "{":
          setUi({ brush: { ...b, hardness: Math.max(0, b.hardness - 0.1) } });
          break;
        case "}":
          setUi({ brush: { ...b, hardness: Math.min(1, b.hardness + 0.1) } });
          break;
        case "Tab":
          setUi({ layout: ui.layout === "split" ? "3d" : "split" });
          break;
        case "Delete":
        case "Backspace":
          if (editor.state.selection) run("layer.remove", { id: editor.state.selection });
          break;
        case "Escape":
          viewportApi.current?.cancel();
          setUi({ modal: null });
          break;
        default:
          if (k === "b") setUi({ tool: "paint" });
          else if (k === "e") setUi({ tool: "erase" });
          else if (k === "i") setUi({ tool: "picker" });
          else if (k === "x") setUi({ brush: { ...b, symmetry: b.symmetry === "none" ? "x" : "none" } });
          else if (k === "p") setUi({ brush: { ...b, projection: b.projection === "view" ? "sphere" : "view" } });
          else if (k === "f") viewportApi.current?.frame();
          else if (k === "m") setUi({ channel: "material" });
          else if (k === "c") {
            const i = CHANNELS.findIndex((c) => c.id === ui.channel);
            setUi({ channel: CHANNELS[(i + 1) % CHANNELS.length].id });
          } else if (k >= "1" && k <= "6") viewportApi.current?.setView((["front", "back", "left", "right", "top", "iso"] as const)[+k - 1]);
          else return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  const layout = useUi((u) => u.layout);
  const dark = useUi((u) => u.darkStage);
  useShortcuts();
  useEffect(() => {
    scheduleSync();
    void startBridge();
    const warn = (e: BeforeUnloadEvent) => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return (
    <div className="app">
      <TopBar />
      <ToolRail />
      <div className={`stage ${dark ? "dark" : ""}`}>
        {layout !== "uv" && <Viewport />}
        {layout !== "3d" && <UvView />}
        <StageHud />
      </div>
      <div className="right">
        <Layers />
        <Properties />
      </div>
      <Shelf />
      <Modals />
    </div>
  );
}
