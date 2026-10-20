import type { RgbaImage } from "./render.js";

/** A raster ready to encode: 1 (grey), 3 (RGB) or 4 (RGBA) channels, 8 or 16 bits. */
export interface PixelBuffer {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  bits: 8 | 16;
  data: Uint8Array | Uint16Array;
}

export type Deflate = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG encoder. `deflate` must produce a zlib stream (node: zlib.deflateSync, browser: CompressionStream("deflate")). */
export async function encodePng(img: PixelBuffer, deflate: Deflate): Promise<Uint8Array> {
  const { width, height, channels, bits } = img;
  const bpp = channels * (bits / 8);
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1; // Sub filter: cheap and compresses noise-free texture maps well
    if (bits === 8) {
      const src = img.data as Uint8Array;
      const o = y * stride;
      for (let x = 0; x < stride; x++) raw[row + 1 + x] = (src[o + x] - (x >= bpp ? src[o + x - bpp] : 0)) & 255;
    } else {
      const src = img.data as Uint16Array;
      const line = new Uint8Array(stride);
      for (let x = 0; x < width * channels; x++) {
        line[x * 2] = src[y * width * channels + x] >> 8;
        line[x * 2 + 1] = src[y * width * channels + x] & 255;
      }
      for (let x = 0; x < stride; x++) raw[row + 1 + x] = (line[x] - (x >= bpp ? line[x - bpp] : 0)) & 255;
    }
  }
  const idat = await deflate(raw);
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const chunks: [string, Uint8Array][] = [
    ["IHDR", new Uint8Array([...u32(width), ...u32(height), bits, colorType, 0, 0, 0])],
    ["IDAT", idat],
    ["IEND", new Uint8Array(0)],
  ];
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  for (const [type, data] of chunks) {
    out.set(u32(data.length), o);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    out.set(u32(crc32(out, o + 4, o + 8 + data.length)), o + 8 + data.length);
    o += 12 + data.length;
  }
  return out;
}

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

export const rgbaToPixels = (img: RgbaImage): PixelBuffer => ({ width: img.width, height: img.height, channels: 4, bits: 8, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) });

/** Lay images out in a grid with a gap and optional captions (tiny built-in bitmap font). */
export function composeGrid(cells: { image: RgbaImage; caption?: string }[], cols: number, gap: number, background: [number, number, number]): RgbaImage {
  const cw = Math.max(...cells.map((c) => c.image.width)), ch = Math.max(...cells.map((c) => c.image.height));
  const captionH = cells.some((c) => c.caption) ? 22 : 0;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * cw + (cols + 1) * gap, H = rows * (ch + captionH) + (rows + 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([background[0], background[1], background[2], 255], i * 4);
  const out: RgbaImage = { width: W, height: H, data };
  cells.forEach((c, k) => {
    const x0 = gap + (k % cols) * (cw + gap), y0 = gap + Math.floor(k / cols) * (ch + captionH + gap);
    blit(out, c.image, x0, y0);
    if (c.caption) drawText(out, c.caption, x0 + 2, y0 + ch + 6, 2, [40, 40, 44]);
  });
  return out;
}

/** Alpha-blend `src` onto `dst` at (x, y). */
export function blit(dst: RgbaImage, src: RgbaImage, x: number, y: number) {
  for (let j = 0; j < src.height; j++)
    for (let i = 0; i < src.width; i++) {
      const dx = x + i, dy = y + j;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const s = (j * src.width + i) * 4, d = (dy * dst.width + dx) * 4;
      const a = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) dst.data[d + c] = src.data[s + c] * a + dst.data[d + c] * (1 - a);
      dst.data[d + 3] = Math.max(dst.data[d + 3], src.data[s + 3]);
    }
}

// 3x5 pixel font, enough for view captions and numbers
const FONT: Record<string, string> = {
  A: "111101111101101", B: "110101110101110", C: "111100100100111", D: "110101101101110", E: "111100110100111", F: "111100110100100", G: "111100101101111", H: "101101111101101", I: "111010010010111",
  J: "001001001101111", K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "111101101101101", O: "111101101101111", P: "111101111100100", Q: "111101101111001", R: "111101110101101",
  S: "111100111001111", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101111010010", Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001", "8": "111101111101111", "9": "111101111001111",
  ".": "000000000000010", ":": "000010000010000", "-": "000000111000000", "/": "001001010100100", " ": "000000000000000", "_": "000000000000111", "(": "010100100100010", ")": "010001001001010",
};

export function drawText(img: RgbaImage, text: string, x: number, y: number, scale: number, color: [number, number, number]) {
  let cx = x;
  for (const chr of text.toUpperCase()) {
    const g = FONT[chr] ?? FONT[" "];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        if (g[r * 3 + c] !== "1") continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const px = cx + c * scale + sx, py = y + r * scale + sy;
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
            img.data.set([color[0], color[1], color[2], 255], (py * img.width + px) * 4);
          }
      }
    cx += 4 * scale;
  }
}
