import { useState } from "react";
import { Icon, Mark } from "../icons";
import { exportGlbTo, importMesh, openProject, saveProject } from "../platform";
import { editor, setUi, useDoc, useEditorVersion, useUi } from "../store";

export function TopBar() {
  const doc = useDoc();
  useEditorVersion();
  const file = useUi((u) => u.filePath);
  const agent = useUi((u) => u.agent);
  const [menu, setMenu] = useState(false);
  const hist = editor.history();
  const item = (label: string, kbd: string, fn: () => void) => (
    <button onClick={() => {
      setMenu(false);
      fn();
    }}>
      {label}
      <small>{kbd}</small>
    </button>
  );
  return (
    <div className="top">
      <div className="brand">
        <Mark />
        <b>Patina<i>.</i></b>
        <span className={editor.dirty ? "dirty" : ""} title={file ?? undefined}>{file ? file.replace(/^.*[\\/]/, "") : doc.name}</span>
      </div>
      <span className="menu-wrap">
        <button className="pill ghost" onClick={() => setMenu(!menu)}>File <Icon name="chevron" size={12} /></button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            {item("New project", "Ctrl N", () => setUi({ modal: "new" }))}
            {item("Open", "Ctrl O", () => openProject())}
            {item("Save", "Ctrl S", () => saveProject())}
            {item("Save as", "Ctrl Shift S", () => saveProject(true))}
            <hr />
            {item("Import mesh", ".glb .gltf .obj", () => importMesh())}
            {item("Export textures", "Ctrl E", () => setUi({ modal: "export" }))}
            {item("Export GLB", "", () => exportGlbTo())}
            <hr />
            {item("About Patina", "", () => setUi({ modal: "about" }))}
          </div>
        )}
      </span>
      <button className="iconbtn" title="Undo (Ctrl Z)" disabled={!hist.undo.length} onClick={() => editor.undo()}>
        <Icon name="undo" />
      </button>
      <button className="iconbtn" title="Redo (Ctrl Shift Z)" disabled={!hist.redo.length} onClick={() => editor.redo()}>
        <Icon name="redo" />
      </button>
      <div className="spacer" />
      <div className={`agent ${agent.connected ? "on" : ""} ${agent.busy ? "busy" : ""}`} title="AI agents drive this window through MCP (patina mcp --live)">
        <span className="dot" />
        {agent.busy && agent.last ? <em>{agent.last}</em> : agent.connected ? "Agent bridge on" : "Agent bridge off"}
      </div>
      <button className="pill" onClick={() => importMesh()}><Icon name="import" size={15} />Import mesh</button>
      <button className="pill ink" onClick={() => setUi({ modal: "export" })}><Icon name="download" size={15} />Export</button>
    </div>
  );
}
