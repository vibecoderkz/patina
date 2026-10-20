import { add, cross, dot, normalize, scale, sub, type Vec3 } from "./math.js";
import type { Bounds } from "./mesh.js";
import type { Camera } from "./types.js";

export const VIEW_NAMES = ["front", "back", "left", "right", "top", "bottom", "iso", "isoBack"] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

const VIEW_DIRS: Record<ViewName, Vec3> = {
  front: [0, 0.18, 1],
  back: [0, 0.18, -1],
  left: [-1, 0.18, 0],
  right: [1, 0.18, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  iso: [0.85, 0.6, 1],
  isoBack: [-0.85, 0.6, -1],
};

/** A camera that frames the whole mesh from a named direction. `zoom` > 1 moves closer. */
export function namedCamera(view: ViewName, bounds: Bounds, fov = 30, zoom = 1): Camera {
  const dir = normalize(VIEW_DIRS[view]);
  const dist = (bounds.size / 2 / Math.sin(((fov / 2) * Math.PI) / 180)) * 1.02 / zoom;
  const eye = add(bounds.center, scale(dir, dist));
  const up: Vec3 = view === "top" ? [0, 0, -1] : view === "bottom" ? [0, 0, 1] : [0, 1, 0];
  return { eye, target: [...bounds.center], up, fov };
}

/** Orthonormal camera basis: right, up, forward (towards the target). */
export function cameraBasis(cam: Camera) {
  const f = normalize(sub(cam.target, cam.eye));
  let r = cross(f, cam.up);
  if (Math.hypot(...r) < 1e-6) r = cross(f, Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  r = normalize(r);
  const u = cross(r, f);
  return { right: r, up: u, forward: f };
}

/** World-space ray through a screen point (x, y in 0..1, origin top-left) for an image of `aspect` = w/h. */
export function screenRay(cam: Camera, x: number, y: number, aspect: number): { origin: Vec3; dir: Vec3 } {
  const { right, up, forward } = cameraBasis(cam);
  const t = Math.tan(((cam.fov / 2) * Math.PI) / 180);
  const px = (2 * x - 1) * t * aspect, py = (1 - 2 * y) * t;
  const dir = normalize(add(add(forward, scale(right, px)), scale(up, py)));
  return { origin: [...cam.eye], dir };
}

/** Project a world point to screen (0..1, origin top-left) and its distance along the view axis. */
export function projectPoint(cam: Camera, p: Vec3, aspect: number): { x: number; y: number; depth: number } {
  const { right, up, forward } = cameraBasis(cam);
  const d = sub(p, cam.eye);
  const z = dot(d, forward);
  const t = Math.tan(((cam.fov / 2) * Math.PI) / 180);
  return { x: (dot(d, right) / (z * t * aspect) + 1) / 2, y: (1 - dot(d, up) / (z * t)) / 2, depth: z };
}
