import { useEffect, useReducer, useState } from "react";
import { ATTRIBUTION, EXPORT_PRESETS, PATINA_VERSION, PRIMITIVES } from "@patina/core";
import { Icon, Mark } from "../icons";
import { exportGlbTo, exportTexturesTo, importMesh, isDesktop, newProject } from "../platform";
import { session, setUi, useUi } from "../store";
import { onThumbs, thumb } from "../thumbs";

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setUi({ modal: null })}>
      <div className="modal" style={wide ? { width: 600 } : undefined}>{children}</div>
    </div>
  );
}

function NewProject() {
  const [prim, setPrim] = useState("orb");
  const [res, setRes] = useState(1024);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onThumbs(force), []);
  return (
    <Shell wide>
      <h2>New project</h2>
      <p>Start on a built-in mesh or bring your own. Every mesh needs UVs; strokes are stored in 3D, so you can change the resolution at any time.</p>
      <div className="prims">
        {PRIMITIVES.map((p) => {
          const src = thumb("primitive", p.name);
          return (
            <button key={p.name} className={`prim ${prim === p.name ? "on" : ""}`} title={p.description} onClick={() => setPrim(p.name)} onDoubleClick={() => newProject(p.name, res)}>
              {src ? <img src={src} alt="" /> : <i className="ph" />}
              <span>{p.title}</span>
            </button>
          );
        })}
        <button className="prim" onClick={() => {
          newProject("orb", res);
          void importMesh();
        }}>
          <span className="ph" style={{ display: "grid", placeItems: "center", color: "var(--muted)" }}><Icon name="import" size={22} /></span>
          <span>Import mesh</span>
        </button>
      </div>
      <div className="field-row">
        <span>Texture size</span>
        <div className="seg" style={{ justifySelf: "start" }}>
          {[512, 1024, 2048].map((r) => (
            <button key={r} className={res === r ? "on" : ""} onClick={() => setRes(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="foot">
        <span className="note">2048 paints slower; export can go up to 4096 later</span>
        <button className="pill ghost" onClick={() => setUi({ modal: null })}>Cancel</button>
        <button className="pill ink" onClick={() => newProject(prim, res)}>Create</button>
      </div>
    </Shell>
  );
}

function Export() {
  const [preset, setPreset] = useState("gltf");
  const [size, setSize] = useState(session.doc.resolution);
  return (
    <Shell wide>
      <h2>Export</h2>
      <p>PNG texture sets packed for your engine, or one .glb with the mesh and its textures. Exporting at a larger size re-renders every layer: nothing is upscaled.</p>
      {EXPORT_PRESETS.map((p) => (
        <button key={p.id} className={`opt ${preset === p.id ? "on" : ""}`} onClick={() => setPreset(p.id)}>
          <div>
            <b>{p.title}</b>
            <small>{p.description}</small>
          </div>
          <span className="ext">{p.maps.length} maps</span>
        </button>
      ))}
      <div className="field-row">
        <span>Size</span>
        <div className="seg" style={{ justifySelf: "start" }}>
          {[512, 1024, 2048, 4096].map((r) => (
            <button key={r} className={size === r ? "on" : ""} onClick={() => setSize(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="foot">
        <button className="pill" onClick={() => {
          setUi({ modal: null });
          void exportGlbTo();
        }}>
          <Icon name="cube" size={15} />Export GLB
        </button>
        <span className="spacer" />
        <button className="pill ghost" onClick={() => setUi({ modal: null })}>Cancel</button>
        <button className="pill ink" onClick={() => {
          setUi({ modal: null });
          void exportTexturesTo({ preset, size });
        }}>
          <Icon name="download" size={15} />{isDesktop ? "Export to folder" : "Download textures"}
        </button>
      </div>
    </Shell>
  );
}

function About() {
  return (
    <Shell>
      <Mark size={56} />
      <h2 style={{ marginTop: 14 }}>Patina {PATINA_VERSION}</h2>
      <p>3D texture painting for people and AI agents. Every tool is a command: agents paint the same layers you do, live in this window or headless through MCP and the CLI.</p>
      <pre>claude mcp add patina -- node {"<repo>"}/packages/headless/dist/patina.js mcp --live</pre>
      <p className="attrib">
        {ATTRIBUTION.split("https://dias.now")[0]}
        <a href="https://dias.now" target="_blank" rel="noreferrer">dias.now</a> · <a href="mailto:hello@dias.now">hello@dias.now</a>. MIT License.
      </p>
      <div className="foot">
        <button className="pill ink" onClick={() => setUi({ modal: null })}>Close</button>
      </div>
    </Shell>
  );
}

export function Modals() {
  const modal = useUi((u) => u.modal);
  if (modal === "new") return <NewProject />;
  if (modal === "export") return <Export />;
  if (modal === "about") return <About />;
  return null;
}
