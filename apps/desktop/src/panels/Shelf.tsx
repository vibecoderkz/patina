import { useEffect, useReducer } from "react";
import { MASKS, MATERIALS, SMART_MATERIALS } from "@patina/core";
import { editor, run, setUi, toast, useSelection, useUi } from "../store";
import { onThumbs, thumb, type ThumbKind } from "../thumbs";

function Tile({ kind, id, title, hint, onPick }: { kind: ThumbKind; id: string; title: string; hint?: string; onPick: () => void }) {
  const src = thumb(kind, id);
  return (
    <button className="tile" title={hint ?? title} onClick={onPick}>
      <div className="pic">{src ? <img src={src} alt="" draggable={false} /> : <i className="ph" />}</div>
      <span>{title}</span>
    </button>
  );
}

export function Shelf() {
  const tab = useUi((u) => u.shelfTab);
  const selection = useSelection();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onThumbs(force), []);
  const hint =
    tab === "smart" ? "Click to add as a folder of layers" : tab === "materials" ? "Click to add a fill layer" : selection ? "Click to set the selected layer's mask" : "Select a layer to give it a smart mask";
  return (
    <div className="shelf">
      <div className="shelf-bar">
        <div className="seg">
          <button className={tab === "smart" ? "on" : ""} onClick={() => setUi({ shelfTab: "smart" })}>Smart materials</button>
          <button className={tab === "materials" ? "on" : ""} onClick={() => setUi({ shelfTab: "materials" })}>Materials</button>
          <button className={tab === "masks" ? "on" : ""} onClick={() => setUi({ shelfTab: "masks" })}>Smart masks</button>
        </div>
        <span className="hint">{hint}</span>
      </div>
      <div className="tiles">
        {tab === "smart" &&
          SMART_MATERIALS.map((s) => (
            <Tile key={s.id} kind="smart" id={s.id} title={s.title} hint={s.description} onPick={() => {
              if (run("smart.apply", { preset: s.id })) setUi({ target: "layer" });
            }} />
          ))}
        {tab === "materials" &&
          MATERIALS.map((m) => (
            <Tile key={m.id} kind="material" id={m.id} title={m.title} onPick={() => {
              if (run("material.apply", { preset: m.id })) setUi({ target: "layer" });
            }} />
          ))}
        {tab === "masks" &&
          MASKS.map((m) => (
            <Tile key={m.id} kind="mask" id={m.id} title={m.title} hint={m.description} onPick={() => {
              const id = editor.state.selection;
              if (!id) return toast("Select a layer first, then pick a smart mask", true);
              if (run("mask.add", { layer: id, preset: m.id })) setUi({ target: "mask" });
            }} />
          ))}
      </div>
    </div>
  );
}
