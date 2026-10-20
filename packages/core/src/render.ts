import { cameraBasis } from "./camera.js";
import { irradianceSh, prefilteredEnv, sampleSpecular } from "./env.js";
import { clamp, hexToRgb, linearToSrgb, srgbToLinear, type Vec3 } from "./math.js";
import type { Mesh } from "./mesh.js";
import type { Camera, EnvironmentName } from "./types.js";
import type { DepthView } from "./brush.js";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Material maps for rendering, all `res` x `res`, islands already dilated. Colours sRGB 0..1. */
export interface MaterialTextures {
  res: number;
  baseColor: Float32Array;
  metallic: Float32Array;
  roughness: Float32Array;
  /** Tangent-space normal, -1..1, OpenGL convention (see computeTangents). */
  normal: Float32Array;
  emissive: Float32Array;
  ao?: Float32Array;
  height?: Float32Array;
  curvature?: Float32Array;
}

export interface GBuffer {
  width: number;
  height: number;
  tri: Int32Array;
  b1: Float32Array;
  b2: Float32Array;
  /** Distance along the view axis; Infinity where nothing was drawn. */
  depth: Float32Array;
}

/** Rasterize the mesh from a camera: triangle id + perspective-correct barycentrics per pixel. */
export function rasterizeView(mesh: Mesh, cam: Camera, width: number, height: number): GBuffer {
  const { right, up, forward } = cameraBasis(cam);
  const t = Math.tan(((cam.fov / 2) * Math.PI) / 180), aspect = width / height;
  const P = mesh.positions, I = mesh.indices;
  const vc = P.length / 3;
  const sx = new Float32Array(vc), sy = new Float32Array(vc), sz = new Float32Array(vc);
  const near = 1e-4;
  for (let v = 0; v < vc; v++) {
    const dx = P[v * 3] - cam.eye[0], dy = P[v * 3 + 1] - cam.eye[1], dz = P[v * 3 + 2] - cam.eye[2];
    const z = dx * forward[0] + dy * forward[1] + dz * forward[2];
    const x = (dx * right[0] + dy * right[1] + dz * right[2]) / (z * t * aspect);
    const y = (dx * up[0] + dy * up[1] + dz * up[2]) / (z * t);
    sx[v] = ((x + 1) / 2) * width;
    sy[v] = ((1 - y) / 2) * height;
    sz[v] = z;
  }
  const N = width * height;
  const g: GBuffer = { width, height, tri: new Int32Array(N).fill(-1), b1: new Float32Array(N), b2: new Float32Array(N), depth: new Float32Array(N).fill(Infinity) };
  for (let tr = 0; tr < I.length / 3; tr++) {
    const a = I[tr * 3], b = I[tr * 3 + 1], c = I[tr * 3 + 2];
    if (sz[a] < near || sz[b] < near || sz[c] < near) continue;
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const inv = 1 / area;
    const iza = 1 / sz[a], izb = 1 / sz[b], izc = 1 / sz[c];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const l1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) * inv;
        const l2 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
        const l0 = 1 - l1 - l2;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const iz = l0 * iza + l1 * izb + l2 * izc;
        const z = 1 / iz;
        const i = y * width + x;
        if (z >= g.depth[i]) continue;
        g.depth[i] = z;
        g.tri[i] = tr;
        g.b1[i] = (l1 * izb) * z;
        g.b2[i] = (l2 * izc) * z;
      }
    }
  }
  return g;
}

export function depthView(mesh: Mesh, camera: Camera, width = 512, height = 512): DepthView {
  return { camera, width, height, depth: rasterizeView(mesh, camera, width, height).depth };
}

function sampleTex(buf: Float32Array, res: number, stride: number, u: number, v: number, out: number[]) {
  const x = u * res - 0.5, y = v * res - 0.5;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  x0 = Math.max(0, Math.min(res - 1, x0));
  y0 = Math.max(0, Math.min(res - 1, y0));
  const x1 = Math.min(res - 1, x0 + 1), y1 = Math.min(res - 1, y0 + 1);
  const i00 = (y0 * res + x0) * stride, i10 = (y0 * res + x1) * stride, i01 = (y1 * res + x0) * stride, i11 = (y1 * res + x1) * stride;
  for (let c = 0; c < stride; c++) out[c] = (buf[i00 + c] * (1 - fx) + buf[i10 + c] * fx) * (1 - fy) + (buf[i01 + c] * (1 - fx) + buf[i11 + c] * fx) * fy;
}

export type ViewChannel = "material" | "baseColor" | "metallic" | "roughness" | "height" | "normal" | "emissive" | "ao" | "curvature" | "uv";

export interface RenderOptions {
  width: number;
  height: number;
  environment: EnvironmentName;
  exposure: number;
  /** Degrees. */
  rotation: number;
  /** "#rrggbb", "env" (blurred environment) or null for transparent. */
  background: string | null;
  /** Supersampling factor (1 or 2). */
  ssaa?: number;
  channel?: ViewChannel;
}

const aces = (x: number) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));

/** CPU path: deferred PBR shading with image-based light from the procedural environment. */
export function renderView(mesh: Mesh, tex: MaterialTextures, cam: Camera, opts: RenderOptions): RgbaImage {
  const ss = Math.max(1, Math.min(3, Math.round(opts.ssaa ?? 2)));
  const W = opts.width * ss, H = opts.height * ss;
  const g = rasterizeView(mesh, cam, W, H);
  const env = prefilteredEnv(opts.environment);
  const expo = Math.pow(2, opts.exposure);
  const rot = (opts.rotation * Math.PI) / 180;
  const cr = Math.cos(-rot), sr = Math.sin(-rot);
  const channel = opts.channel ?? "material";
  const P = mesh.positions, Nn = mesh.normals, UV = mesh.uvs, TG = mesh.tangents!, I = mesh.indices;
  const res = tex.res;
  const hi = new Float32Array(W * H * 4);
  const bg = opts.background && opts.background !== "env" ? hexToRgb(opts.background) : null;
  const { right, up, forward } = cameraBasis(cam);
  const tf = Math.tan(((cam.fov / 2) * Math.PI) / 180), aspect = W / H;
  const s3 = [0, 0, 0], s1 = [0], tmp: Vec3 = [0, 0, 0], spec: Vec3 = [0, 0, 0], irr: Vec3 = [0, 0, 0];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const pi = y * W + x, o = pi * 4;
      const t = g.tri[pi];
      if (t < 0) {
        if (opts.background === "env") {
          const px = ((2 * (x + 0.5)) / W - 1) * tf * aspect, py = (1 - (2 * (y + 0.5)) / H) * tf;
          const dx = forward[0] + right[0] * px + up[0] * py, dy = forward[1] + right[1] * px + up[1] * py, dz = forward[2] + right[2] * px + up[2] * py;
          const l = Math.hypot(dx, dy, dz);
          sampleSpecular(env, dx / l, dy / l, dz / l, 0.6, rot, tmp);
          for (let c = 0; c < 3; c++) hi[o + c] = linearToSrgb(aces(tmp[c] * expo * 0.8));
          hi[o + 3] = 1;
        } else if (bg) {
          hi.set([bg[0], bg[1], bg[2], 1], o);
        }
        continue;
      }
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      const w1 = g.b1[pi], w2 = g.b2[pi], w0 = 1 - w1 - w2;
      const u = UV[a * 2] * w0 + UV[b * 2] * w1 + UV[c * 2] * w2;
      const v = UV[a * 2 + 1] * w0 + UV[b * 2 + 1] * w1 + UV[c * 2 + 1] * w2;
      let rgb: Vec3;
      if (channel !== "material") {
        rgb = debugChannel(channel, tex, u, v, s3, s1);
      } else {
        const wpx = P[a * 3] * w0 + P[b * 3] * w1 + P[c * 3] * w2;
        const wpy = P[a * 3 + 1] * w0 + P[b * 3 + 1] * w1 + P[c * 3 + 1] * w2;
        const wpz = P[a * 3 + 2] * w0 + P[b * 3 + 2] * w1 + P[c * 3 + 2] * w2;
        let nx = Nn[a * 3] * w0 + Nn[b * 3] * w1 + Nn[c * 3] * w2;
        let ny = Nn[a * 3 + 1] * w0 + Nn[b * 3 + 1] * w1 + Nn[c * 3 + 1] * w2;
        let nz = Nn[a * 3 + 2] * w0 + Nn[b * 3 + 2] * w1 + Nn[c * 3 + 2] * w2;
        let nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        let vx = cam.eye[0] - wpx, vy = cam.eye[1] - wpy, vz = cam.eye[2] - wpz;
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        // two-sided: face the viewer
        const flip = nx * vx + ny * vy + nz * vz < 0 ? -1 : 1;
        nx *= flip;
        ny *= flip;
        nz *= flip;
        // tangent frame
        let tx = TG[a * 4] * w0 + TG[b * 4] * w1 + TG[c * 4] * w2;
        let ty = TG[a * 4 + 1] * w0 + TG[b * 4 + 1] * w1 + TG[c * 4 + 1] * w2;
        let tz = TG[a * 4 + 2] * w0 + TG[b * 4 + 2] * w1 + TG[c * 4 + 2] * w2;
        const tw = TG[a * 4 + 3] < 0 ? -1 : 1;
        const td = tx * nx + ty * ny + tz * nz;
        tx -= nx * td;
        ty -= ny * td;
        tz -= nz * td;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const bx = (ny * tz - nz * ty) * tw, by = (nz * tx - nx * tz) * tw, bz = (nx * ty - ny * tx) * tw;
        sampleTex(tex.normal, res, 3, u, v, s3);
        const mx = s3[0], my = s3[1], mz = s3[2];
        nx = tx * mx + bx * my + nx * mz;
        ny = ty * mx + by * my + ny * mz;
        nz = tz * mx + bz * my + nz * mz;
        nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        sampleTex(tex.baseColor, res, 3, u, v, s3);
        const br = srgbToLinear(clamp(s3[0])), bgc = srgbToLinear(clamp(s3[1])), bb = srgbToLinear(clamp(s3[2]));
        sampleTex(tex.metallic, res, 1, u, v, s1);
        const metal = clamp(s1[0]);
        sampleTex(tex.roughness, res, 1, u, v, s1);
        const rough = clamp(s1[0], 0.03, 1);
        let ao = 1;
        if (tex.ao) {
          sampleTex(tex.ao, res, 1, u, v, s1);
          ao = clamp(s1[0]);
        }
        const nv = Math.max(1e-4, nx * vx + ny * vy + nz * vz);
        // reflection
        const rx = 2 * nv * nx - vx, ry = 2 * nv * ny - vy, rz = 2 * nv * nz - vz;
        // rotate lookups by -rotation around Y
        irradianceSh(env.sh, nx * cr + nz * sr, ny, -nx * sr + nz * cr, irr);
        sampleSpecular(env, rx, ry, rz, rough, rot, spec);
        // Karis' analytic split-sum approximation
        const c0 = [-1, -0.0275, -0.572, 0.022], c1 = [1, 0.0425, 1.04, -0.04];
        const r0 = rough * c0[0] + c1[0], r1 = rough * c0[1] + c1[1], r2 = rough * c0[2] + c1[2], r3 = rough * c0[3] + c1[3];
        const a004 = Math.min(r0 * r0, Math.pow(2, -9.28 * nv)) * r0 + r1;
        const A = a004 * -1.04 + r2, B = a004 * 1.04 + r3;
        const specOcc = clamp(Math.pow(nv + ao, Math.pow(2, -16 * rough - 1)) - 1 + ao);
        sampleTex(tex.emissive, res, 3, u, v, s3);
        const em = [srgbToLinear(clamp(s3[0])), srgbToLinear(clamp(s3[1])), srgbToLinear(clamp(s3[2]))];
        const base = [br, bgc, bb];
        rgb = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const f0 = 0.04 * (1 - metal) + base[k] * metal;
          const diffuse = base[k] * (1 - metal) * irr[k] * ao;
          const specular = spec[k] * (f0 * A + B) * specOcc;
          rgb[k] = linearToSrgb(aces((diffuse + specular) * expo + em[k] * 4));
        }
      }
      hi[o] = rgb[0];
      hi[o + 1] = rgb[1];
      hi[o + 2] = rgb[2];
      hi[o + 3] = 1;
    }
  // downsample
  const out = new Uint8ClampedArray(opts.width * opts.height * 4);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < opts.height; y++)
    for (let x = 0; x < opts.width; x++) {
      let r = 0, gg = 0, b = 0, al = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const o = ((y * ss + j) * W + x * ss + i) * 4;
          const aa = hi[o + 3];
          r += hi[o] * aa;
          gg += hi[o + 1] * aa;
          b += hi[o + 2] * aa;
          al += aa;
        }
      const o = (y * opts.width + x) * 4;
      if (al > 0) {
        out[o] = (r / al) * 255 + 0.5;
        out[o + 1] = (gg / al) * 255 + 0.5;
        out[o + 2] = (b / al) * 255 + 0.5;
      }
      out[o + 3] = al * inv * 255 + 0.5;
    }
  return { width: opts.width, height: opts.height, data: out };
}

function debugChannel(ch: ViewChannel, tex: MaterialTextures, u: number, v: number, s3: number[], s1: number[]): Vec3 {
  const res = tex.res;
  const grey = (buf: Float32Array | undefined, map = (x: number) => x): Vec3 => {
    if (!buf) return [1, 0, 1];
    sampleTex(buf, res, 1, u, v, s1);
    const g = clamp(map(s1[0]));
    return [g, g, g];
  };
  switch (ch) {
    case "baseColor":
      sampleTex(tex.baseColor, res, 3, u, v, s3);
      return [clamp(s3[0]), clamp(s3[1]), clamp(s3[2])];
    case "emissive":
      sampleTex(tex.emissive, res, 3, u, v, s3);
      return [clamp(s3[0]), clamp(s3[1]), clamp(s3[2])];
    case "normal":
      sampleTex(tex.normal, res, 3, u, v, s3);
      return [s3[0] * 0.5 + 0.5, s3[1] * 0.5 + 0.5, s3[2] * 0.5 + 0.5];
    case "metallic":
      return grey(tex.metallic);
    case "roughness":
      return grey(tex.roughness);
    case "height":
      return grey(tex.height, (h) => h * 0.5 + 0.5);
    case "ao":
      return grey(tex.ao);
    case "curvature":
      return grey(tex.curvature, (c) => c * 0.5 + 0.5);
    case "uv": {
      const cx = Math.floor(u * 16) + Math.floor(v * 16);
      const k = cx % 2 ? 0.85 : 0.35;
      return [u * k + 0.1, v * k + 0.1, k * 0.6];
    }
    default:
      return [1, 0, 1];
  }
}

/** Flat 2D view of a texture (for the UV view and contact sheets). */
export function textureImage(tex: MaterialTextures, channel: ViewChannel, size: number): RgbaImage {
  const out = new Uint8ClampedArray(size * size * 4);
  const s3 = [0, 0, 0], s1 = [0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const rgb = channel === "material" ? debugChannel("baseColor", tex, (x + 0.5) / size, (y + 0.5) / size, s3, s1) : debugChannel(channel, tex, (x + 0.5) / size, (y + 0.5) / size, s3, s1);
      const o = (y * size + x) * 4;
      out[o] = rgb[0] * 255 + 0.5;
      out[o + 1] = rgb[1] * 255 + 0.5;
      out[o + 2] = rgb[2] * 255 + 0.5;
      out[o + 3] = 255;
    }
  return { width: size, height: size, data: out };
}

