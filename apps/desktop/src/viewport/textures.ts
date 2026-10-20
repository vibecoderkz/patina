import * as THREE from "three";
import type { DirtyRect, TextureEngine } from "@patina/core";

const to8 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/**
 * Engine float buffers -> RGBA8 textures for the viewport and the UV view. Only the dirty rectangle
 * is converted; the upload itself is the whole texture (cheap at these sizes).
 *   baseColor (sRGB) | orm: R=AO G=roughness B=metallic (glTF / three.js layout) | normal | emissive (sRGB)
 *   aux: R=height G=curvature B=AO (for channel views)
 */
export class GpuTextures {
  readonly res: number;
  readonly data: Record<"baseColor" | "orm" | "normal" | "emissive" | "aux", Uint8Array>;
  readonly tex: Record<"baseColor" | "orm" | "normal" | "emissive" | "aux", THREE.DataTexture>;
  version = 0;
  private fullPending = true;

  constructor(res: number) {
    this.res = res;
    const make = () => new Uint8Array(res * res * 4);
    this.data = { baseColor: make(), orm: make(), normal: make(), emissive: make(), aux: make() };
    const t = (d: Uint8Array, srgb: boolean) => {
      const tx = new THREE.DataTexture(d, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
      tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tx.flipY = false;
      tx.generateMipmaps = true;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.magFilter = THREE.LinearFilter;
      tx.anisotropy = 8;
      tx.needsUpdate = true;
      return tx;
    };
    this.tex = { baseColor: t(this.data.baseColor, true), orm: t(this.data.orm, false), normal: t(this.data.normal, false), emissive: t(this.data.emissive, true), aux: t(this.data.aux, false) };
  }

  update(engine: TextureEngine, rect: DirtyRect | null) {
    const res = this.res;
    const r = rect ?? { x0: 0, y0: 0, x1: res - 1, y1: res - 1 };
    const o = engine.out;
    const ao = engine.baked?.ao, curv = engine.baked?.curvature;
    const { baseColor: bc, orm, normal: nm, emissive: em, aux } = this.data;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * res + x, p = i * 4, q = i * 3;
        bc[p] = to8(o.baseColor[q]);
        bc[p + 1] = to8(o.baseColor[q + 1]);
        bc[p + 2] = to8(o.baseColor[q + 2]);
        bc[p + 3] = 255;
        const a = ao ? ao[i] : 1;
        orm[p] = to8(a);
        orm[p + 1] = to8(o.roughness[i]);
        orm[p + 2] = to8(o.metallic[i]);
        orm[p + 3] = 255;
        const nz = o.normal[q + 2];
        if (nz === 0 && o.normal[q] === 0) {
          nm[p] = 128;
          nm[p + 1] = 128;
          nm[p + 2] = 255;
        } else {
          nm[p] = to8(o.normal[q] * 0.5 + 0.5);
          nm[p + 1] = to8(o.normal[q + 1] * 0.5 + 0.5);
          nm[p + 2] = to8(nz * 0.5 + 0.5);
        }
        nm[p + 3] = 255;
        em[p] = to8(o.emissive[q]);
        em[p + 1] = to8(o.emissive[q + 1]);
        em[p + 2] = to8(o.emissive[q + 2]);
        em[p + 3] = 255;
        aux[p] = to8(o.height[i] * 0.5 + 0.5);
        aux[p + 1] = to8(curv ? curv[i] * 0.5 + 0.5 : 0.5);
        aux[p + 2] = to8(a);
        aux[p + 3] = engine.maps.covered[i] ? 255 : 0;
      }
    // three.js uploads the queued row ranges on the next render and then clears them; a full upload
    // pending from an earlier update must not be narrowed down to a later partial one
    const partial = !!rect && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) < res * res * 0.6;
    if (!partial) this.fullPending = true;
    for (const t of Object.values(this.tex)) {
      if (this.fullPending) t.clearUpdateRanges();
      else for (let y = r.y0; y <= r.y1; y++) t.addUpdateRange((y * res + r.x0) * 4, (r.x1 - r.x0 + 1) * 4);
      t.needsUpdate = true;
    }
    this.version++;
  }

  /** Call after a render has uploaded the textures. */
  uploaded() {
    this.fullPending = false;
  }

  dispose() {
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
