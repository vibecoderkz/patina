import { Icon, type IconName } from "../icons";
import { getUi, setUi, useUi, type Tool } from "../store";
import { viewportApi } from "../viewport/Viewport";

function T({ icon, tip, kbd, on, toggle, onClick }: { icon: IconName; tip: string; kbd?: string; on?: boolean; toggle?: boolean; onClick: () => void }) {
  return (
    <button className={`tool ${toggle ? "toggle" : ""} ${on ? "on" : ""}`} onClick={onClick} aria-label={tip}>
      <Icon name={icon} size={18} />
      <span className="tip">
        {tip}
        {kbd && <kbd>{kbd}</kbd>}
      </span>
    </button>
  );
}

export function ToolRail() {
  const tool = useUi((u) => u.tool);
  const sym = useUi((u) => u.brush.symmetry);
  const proj = useUi((u) => u.brush.projection);
  const layout = useUi((u) => u.layout);
  const dark = useUi((u) => u.darkStage);
  const set = (t: Tool) => setUi({ tool: t });
  return (
    <div className="rail">
      <T icon="brush" tip="Paint" kbd="B" on={tool === "paint"} onClick={() => set("paint")} />
      <T icon="eraser" tip="Erase" kbd="E" on={tool === "erase"} onClick={() => set("erase")} />
      <T icon="picker" tip="Pick material" kbd="I" on={tool === "picker"} onClick={() => set("picker")} />
      <hr />
      <T icon="symmetry" tip="Symmetry X" kbd="X" toggle on={sym !== "none"} onClick={() => setUi({ brush: { ...getUi().brush, symmetry: sym === "none" ? "x" : "none" } })} />
      <T
        icon="cube"
        tip={proj === "view" ? "Projection: from camera" : "Projection: 3D sphere"}
        kbd="P"
        toggle
        on={proj === "sphere"}
        onClick={() => setUi({ brush: { ...getUi().brush, projection: proj === "view" ? "sphere" : "view" } })}
      />
      <hr />
      <T icon="frame" tip="Frame the mesh" kbd="F" onClick={() => viewportApi.current?.frame()} />
      <T icon="split" tip="3D and UV side by side" kbd="Tab" toggle on={layout === "split"} onClick={() => setUi({ layout: layout === "split" ? "3d" : "split" })} />
      <T icon="uv" tip="UV view only" toggle on={layout === "uv"} onClick={() => setUi({ layout: layout === "uv" ? "3d" : "uv" })} />
      <T icon={dark ? "sun" : "moon"} tip={dark ? "Light backdrop" : "Dark backdrop"} toggle on={dark} onClick={() => setUi({ darkStage: !dark })} />
    </div>
  );
}
