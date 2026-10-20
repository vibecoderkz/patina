import { useState } from "react";
import type { ColorSource, Layer } from "@patina/core";
import { Icon } from "../icons";
import { editor, getUi, run, setUi, useDoc, useSelection, useUi } from "../store";

const colorOf = (c: ColorSource | undefined): string | null => (c === undefined ? null : typeof c === "string" ? c : `linear-gradient(135deg, ${c.from}, ${c.to})`);

function layerSwatch(l: Layer): { bg: string | null; icon: "brush" | "folder" | "fill" | null } {
  if (l.type === "folder") return { bg: null, icon: "folder" };
  if (l.type === "paint") {
    const last = [...l.strokes].reverse().find((s) => s.material?.baseColor);
    return { bg: last?.material?.baseColor ?? null, icon: last ? null : "brush" };
  }
  const bg = colorOf(l.material.baseColor);
  return { bg, icon: bg ? null : "fill" };
}

function maskClass(l: Layer) {
  const m = l.mask!;
  if (!m.effects.length) return (m.base > 0.5) !== m.invert ? "white" : "black";
  return "";
}

type Drop = { id: string; where: "above" | "below" | "in" } | null;

function Row({ layer, depth, drop, setDrop }: { layer: Layer; depth: number; drop: Drop; setDrop: (d: Drop) => void }) {
  const sel = useSelection() === layer.id;
  const target = useUi((u) => u.target);
  const collapsed = useUi((u) => !!u.collapsed[layer.id]);
  const [renaming, setRenaming] = useState(false);
  const sw = layerSwatch(layer);
  const sub = layer.type === "paint" ? `${layer.strokes.length} stroke${layer.strokes.length === 1 ? "" : "s"}` : layer.type === "folder" ? `${layer.children.length} layers` : layer.mask ? "Fill, masked" : "Fill";
  const dropCls = drop?.id === layer.id ? `drop-${drop.where}` : "";
  const select = (t: "layer" | "mask") => {
    editor.select(layer.id);
    setUi({ target: t, effect: null });
  };
  return (
    <>
      <div
        className={`layer ${sel ? "sel" : ""} ${layer.visible ? "" : "hidden"} ${dropCls}`}
        style={{ paddingLeft: 4 + depth * 16 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/patina-layer", layer.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/patina-layer")) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const f = (e.clientY - r.top) / r.height;
          setDrop({ id: layer.id, where: layer.type === "folder" && f > 0.3 && f < 0.7 ? "in" : f < 0.5 ? "above" : "below" });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/patina-layer");
          const d = drop;
          setDrop(null);
          if (!id || !d || id === layer.id) return;
          if (d.where === "in") run("layer.move", { id, parent: layer.id });
          // the list is drawn top first: "above" on screen = above in the stack
          else run("layer.move", { id, [d.where]: layer.id });
        }}
        onClick={() => select("layer")}
      >
        {layer.type === "folder" ? (
          <button className={`twisty ${collapsed ? "" : "open"}`} onClick={(e) => {
            e.stopPropagation();
            setUi({ collapsed: { ...getUi().collapsed, [layer.id]: !collapsed } });
          }}>
            <Icon name="chevronRight" size={12} />
          </button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <button className="eye" title={layer.visible ? "Hide" : "Show"} onClick={(e) => {
          e.stopPropagation();
          run("layer.update", { id: layer.id, visible: !layer.visible });
        }}>
          <Icon name={layer.visible ? "eye" : "eyeOff"} size={15} />
        </button>
        <div className={`thumb ${sel && target === "layer" ? "sel" : ""}`} style={sw.bg ? { background: sw.bg } : undefined} onClick={(e) => {
          e.stopPropagation();
          select("layer");
        }}>
          {sw.icon && <Icon name={sw.icon} size={14} />}
        </div>
        {layer.mask && (
          <div
            className={`thumb mask ${maskClass(layer)} ${sel && target === "mask" ? "sel" : ""}`}
            style={layer.mask.enabled ? undefined : { opacity: 0.35 }}
            title="Mask: click to edit and paint it"
            onClick={(e) => {
              e.stopPropagation();
              select("mask");
            }}
          />
        )}
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={layer.name}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== layer.name) run("layer.update", { id: layer.id, name: v });
              setRenaming(false);
            }}
          />
        ) : (
          <div className="lname" onDoubleClick={() => setRenaming(true)}>
            {layer.name}
            <small>{sub}</small>
          </div>
        )}
        {layer.opacity < 1 && <span className="op">{Math.round(layer.opacity * 100)}%</span>}
      </div>
      {layer.type === "folder" && !collapsed && [...layer.children].reverse().map((c) => <Row key={c.id} layer={c} depth={depth + 1} drop={drop} setDrop={setDrop} />)}
    </>
  );
}

export function Layers() {
  const doc = useDoc();
  const selection = useSelection();
  const [drop, setDrop] = useState<Drop>(null);
  const [maskMenu, setMaskMenu] = useState(false);
  const sel = selection ? selection : null;
  return (
    <>
      <div className="h">
        <span>Layers</span>
        <div className="acts">
          <button title="Add fill layer" onClick={() => run("layer.add", { type: "fill", material: { baseColor: "#bdbdb8", roughness: 0.5, metallic: 0 } })}>
            <Icon name="fill" />
          </button>
          <button title="Add paint layer" onClick={() => run("layer.add", { type: "paint" })}>
            <Icon name="brush" />
          </button>
          <button title="Add folder" onClick={() => run("layer.add", { type: "folder" })}>
            <Icon name="folder" />
          </button>
          <span className="menu-wrap">
            <button title="Add mask to the selected layer" disabled={!sel} onClick={() => setMaskMenu(!maskMenu)}>
              <Icon name="mask" />
            </button>
            {maskMenu && sel && (
              <div className="menu" style={{ right: 0, left: "auto" }} onMouseLeave={() => setMaskMenu(false)}>
                {[
                  ["white", "White mask (show all)"],
                  ["black", "Black mask (hide all)"],
                  ["edgeWear", "Edge wear"],
                  ["dirt", "Dirt in cavities"],
                  ["dustTop", "Dust on top"],
                  ["grimeBottom", "Grime from the ground"],
                  ["patches", "Noise patches"],
                  ["scratches", "Scratches"],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => {
                    run("mask.add", { layer: sel, preset: id });
                    setUi({ target: "mask" });
                    setMaskMenu(false);
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </span>
          <button title="Duplicate (Ctrl+D)" disabled={!sel} onClick={() => sel && run("layer.duplicate", { id: sel })}>
            <Icon name="duplicate" />
          </button>
          <button title="Delete (Del)" disabled={!sel} onClick={() => sel && run("layer.remove", { id: sel })}>
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <div className="layers" onClick={(e) => e.target === e.currentTarget && editor.select(null)}>
        {doc.layers.length === 0 ? (
          <div className="empty">
            <b>No layers yet</b>
            Pick a smart material from the shelf below, or just start painting: a paint layer is created for you.
          </div>
        ) : (
          [...doc.layers].reverse().map((l) => <Row key={l.id} layer={l} depth={0} drop={drop} setDrop={setDrop} />)
        )}
      </div>
    </>
  );
}
