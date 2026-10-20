import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createEnvMap, meshBounds, sampleEnv, type Camera, type EnvironmentName, type Mesh, type ViewChannel } from "@patina/core";
import { editor, getUi, session, setUi, toast, useUi } from "../store";
import { currentGpu, onTextures } from "./gpu";
import { beginPaint, cancelPaint, endPaint, extendPaint, isPainting } from "./paint";

const CHANNEL_MODE: Record<ViewChannel, number> = { material: -1, baseColor: 0, metallic: 1, roughness: 2, height: 3, normal: 4, emissive: 5, ao: 6, curvature: 7, uv: 8 };

const channelShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tBase; uniform sampler2D tOrm; uniform sampler2D tNormal; uniform sampler2D tEmissive; uniform sampler2D tAux;
    uniform int mode;
    varying vec2 vUv;
    void main() {
      vec3 c;
      bool srgb = false;
      if (mode == 0) { c = texture2D(tBase, vUv).rgb; srgb = true; }
      else if (mode == 1) c = vec3(texture2D(tOrm, vUv).b);
      else if (mode == 2) c = vec3(texture2D(tOrm, vUv).g);
      else if (mode == 3) c = vec3(texture2D(tAux, vUv).r);
      else if (mode == 4) c = texture2D(tNormal, vUv).rgb;
      else if (mode == 5) { c = texture2D(tEmissive, vUv).rgb; srgb = true; }
      else if (mode == 6) c = vec3(texture2D(tAux, vUv).b);
      else if (mode == 7) c = vec3(texture2D(tAux, vUv).g);
      else { vec2 g = floor(vUv * 16.0); float k = mod(g.x + g.y, 2.0) > 0.5 ? 0.85 : 0.35; c = vec3(vUv * k + 0.1, k * 0.6); }
      gl_FragColor = srgb ? linearToOutputTexel(vec4(c, 1.0)) : vec4(c, 1.0);
    }`,
};

/** Equirect in three.js' layout, sampled from Patina's procedural environment (same light as the CPU renderer). */
function envTexture(name: EnvironmentName): THREE.DataTexture {
  const src = createEnvMap(name, 512);
  const W = 512, H = 256;
  const data = new Float32Array(W * H * 4);
  const tmp: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // three: u = atan(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5, row 0 = v 0 (bottom)
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      const phi = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
      const dx = Math.cos(lat) * Math.cos(phi), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(phi);
      sampleEnv(src, dx, dy, dz, 0, tmp);
      data.set([tmp[0], tmp[1], tmp[2], 1], (y * W + x) * 4);
    }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function geometryOf(mesh: Mesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.tangents) g.setAttribute("tangent", new THREE.BufferAttribute(mesh.tangents, 4));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

class Controller {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  pmrem: THREE.PMREMGenerator;
  object: THREE.Mesh | null = null;
  pbr: THREE.MeshStandardMaterial;
  chan: THREE.ShaderMaterial;
  cursor: THREE.Group;
  meshRef: Mesh | null = null;
  envName: EnvironmentName | null = null;
  envTarget: THREE.WebGLRenderTarget | null = null;
  orbit = { target: new THREE.Vector3(), radius: 5, theta: 0.6, phi: 1.2 };
  drag: { mode: "orbit" | "pan" | "paint"; x: number; y: number; id: number } | null = null;
  raf = 0;
  ro: ResizeObserver;
  unsub: (() => void)[] = [];
  size = 1;

  constructor(private host: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pbr = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 2, side: THREE.DoubleSide });
    this.chan = new THREE.ShaderMaterial({ ...channelShader, uniforms: { tBase: { value: null }, tOrm: { value: null }, tNormal: { value: null }, tEmissive: { value: null }, tAux: { value: null }, mode: { value: 0 } }, side: THREE.DoubleSide, toneMapped: false });
    // brush cursor: ring + centre dot, drawn on top
    this.cursor = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 64), ringMat);
    const shadow = new THREE.Mesh(new THREE.RingGeometry(1, 1.045, 64), new THREE.MeshBasicMaterial({ color: 0x0a0a0b, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshBasicMaterial({ color: 0xff3b2e, depthTest: false, side: THREE.DoubleSide }));
    for (const m of [shadow, ring, dot]) m.renderOrder = 10;
    this.cursor.add(shadow, ring, dot);
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", () => {
      this.cursor.visible = false;
      this.request();
    });
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub.push(onTextures(() => this.request()));
    this.unsub.push(editor.subscribe(() => this.syncScene()));
    this.syncScene();
    this.frame();
    viewportApi.current = this;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const u of this.unsub) u();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (viewportApi.current === this) viewportApi.current = null;
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  /** Mesh, environment and material view follow the document and UI. */
  syncScene() {
    const { gpu, engine } = currentGpu();
    if (this.meshRef !== engine.mesh) {
      this.meshRef = engine.mesh;
      if (this.object) {
        this.scene.remove(this.object);
        this.object.geometry.dispose();
      }
      this.object = new THREE.Mesh(geometryOf(engine.mesh), this.pbr);
      this.scene.add(this.object);
      const b = meshBounds(engine.mesh);
      this.size = b.size;
      this.frame();
    }
    const t = gpu.tex;
    if (this.pbr.map !== t.baseColor) {
      Object.assign(this.pbr, { map: t.baseColor, roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm, normalMap: t.normal, emissiveMap: t.emissive });
      this.pbr.needsUpdate = true;
      Object.assign(this.chan.uniforms, { tBase: { value: t.baseColor }, tOrm: { value: t.orm }, tNormal: { value: t.normal }, tEmissive: { value: t.emissive }, tAux: { value: t.aux } });
    }
    const view = editor.doc.view;
    if (view.environment !== this.envName) {
      this.envName = view.environment;
      const eq = envTexture(view.environment);
      this.envTarget?.dispose();
      this.envTarget = this.pmrem.fromEquirectangular(eq);
      eq.dispose();
      this.scene.environment = this.envTarget.texture;
    }
    this.scene.environmentRotation.y = (-view.rotation * Math.PI) / 180;
    this.renderer.toneMappingExposure = Math.pow(2, view.exposure);
    this.applyChannel(getUi().channel);
    this.request();
  }

  applyChannel(ch: ViewChannel) {
    if (!this.object) return;
    const mode = CHANNEL_MODE[ch];
    this.object.material = mode < 0 ? this.pbr : this.chan;
    this.chan.uniforms.mode.value = mode;
    this.request();
  }

  frame() {
    const b = this.meshRef ? meshBounds(this.meshRef) : null;
    if (!b) return;
    this.orbit.target.set(...b.center);
    this.orbit.radius = b.size / 2 / Math.sin((15 * Math.PI) / 180) * 0.95;
    this.updateCamera();
  }

  setView(dir: "front" | "back" | "left" | "right" | "top" | "iso") {
    const o = this.orbit;
    const map = { front: [0, 1.4], back: [Math.PI, 1.4], left: [-Math.PI / 2, 1.4], right: [Math.PI / 2, 1.4], top: [0, 0.02], iso: [0.6, 1.1] } as const;
    [o.theta, o.phi] = map[dir];
    this.frame();
  }

  updateCamera() {
    const o = this.orbit;
    const p = new THREE.Vector3().setFromSphericalCoords(o.radius, o.phi, o.theta).add(o.target);
    this.camera.position.copy(p);
    this.camera.near = Math.max(0.001, o.radius * 0.01);
    this.camera.far = o.radius * 20;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(o.target);
    this.request();
  }

  cameraData(): Camera {
    const c = this.camera;
    return { eye: c.position.toArray() as [number, number, number], target: this.orbit.target.toArray() as [number, number, number], up: [0, 1, 0], fov: c.fov };
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderer.render(this.scene, this.camera);
      currentGpu().gpu.uploaded();
    });
  }

  pick(e: PointerEvent | MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    return session.engine().raycast([o.x, o.y, o.z], [d.x, d.y, d.z]);
  }

  placeCursor(e: PointerEvent) {
    const hit = this.pick(e);
    if (!hit) {
      this.cursor.visible = false;
      this.request();
      return null;
    }
    const ui = getUi();
    const r = ui.brush.size * this.size;
    this.cursor.visible = ui.tool !== "picker";
    this.cursor.position.set(...hit.position);
    const n = new THREE.Vector3(...hit.normal);
    // face the viewer for view projection, the surface otherwise
    if (ui.brush.projection === "view") n.copy(this.camera.position).sub(this.cursor.position).normalize();
    this.cursor.lookAt(this.cursor.position.clone().add(n));
    this.cursor.scale.setScalar(r);
    this.request();
    return hit;
  }

  onDown = (e: PointerEvent) => {
    const el = this.renderer.domElement;
    el.focus();
    const ui = getUi();
    let mode: "orbit" | "pan" | "paint" = e.button === 1 || (e.button === 2 && e.shiftKey) || (e.altKey && e.shiftKey) ? "pan" : e.button === 2 || e.altKey ? "orbit" : "paint";
    if (mode === "paint") {
      const hit = this.pick(e);
      if (!hit) mode = "orbit";
      else if (ui.tool === "picker") {
        const eng = session.engine();
        const s = eng.sampleTexel(eng.texelNear(hit.position));
        setUi({ paint: { ...ui.paint, baseColor: s.baseColor, roughness: s.roughness, metallic: s.metallic }, tool: "paint" });
        toast(`Picked ${s.baseColor}, roughness ${s.roughness}, metallic ${s.metallic}`);
        return;
      } else if (!beginPaint(hit.position, this.cameraData(), e.pointerType === "pen" ? e.pressure : undefined)) return;
    }
    this.drag = { mode, x: e.clientX, y: e.clientY, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  };

  onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) {
      this.placeCursor(e);
      return;
    }
    if (d.mode === "paint") {
      const evs = (e.getCoalescedEvents?.() ?? []).length ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const hit = this.pick(ev);
        if (hit) extendPaint(hit.position, ev.pointerType === "pen" ? ev.pressure : undefined);
      }
      this.placeCursor(e);
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const o = this.orbit;
    if (d.mode === "orbit") {
      o.theta -= dx * 0.008;
      o.phi = Math.max(0.02, Math.min(Math.PI - 0.02, o.phi - dy * 0.008));
    } else {
      const k = (o.radius * Math.tan((this.camera.fov * Math.PI) / 360) * 2) / this.renderer.domElement.clientHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      o.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    }
    this.updateCamera();
  };

  onUp = (e: PointerEvent) => {
    if (!this.drag) return;
    if (this.drag.mode === "paint" && isPainting()) endPaint();
    this.renderer.domElement.releasePointerCapture?.(e.pointerId);
    this.drag = null;
  };

  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // ctrl + wheel resizes the brush
      const b = getUi().brush;
      setUi({ brush: { ...b, size: Math.max(0.002, Math.min(0.5, b.size * (e.deltaY > 0 ? 0.9 : 1.1))) } });
      this.placeCursor(e as unknown as PointerEvent);
      return;
    }
    this.orbit.radius = Math.max(this.size * 0.05, Math.min(this.size * 20, this.orbit.radius * Math.pow(1.0015, e.deltaY)));
    this.updateCamera();
  };

  cancel() {
    if (isPainting()) cancelPaint();
    this.drag = null;
  }
}

/** The mounted 3D viewport (for keyboard shortcuts and screenshots). */
export const viewportApi: { current: Controller | null } = { current: null };

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const channel = useUi((u) => u.channel);
  const projection = useUi((u) => u.brush.projection);
  useEffect(() => {
    const c = new Controller(ref.current!);
    return () => c.dispose();
  }, []);
  useEffect(() => viewportApi.current?.applyChannel(channel), [channel]);
  useEffect(() => viewportApi.current?.request(), [projection]);
  return <div className="pane" ref={ref} />;
}
