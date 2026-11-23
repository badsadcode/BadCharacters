/**
 * Faces are pixel art, painted into a small texture wrapped around the head (cylindrical,
 * arc-length mapped, so a pixel is the same width everywhere on a boxy head). Exported with
 * NEAREST filtering for that crisp voxel-game look.
 */
import { zlibSync } from 'fflate';
import { ringPoint, type Part } from './loft';
import type { FaceParams, Garment } from './recipe';
import type { Dims } from './skeleton';

export const TEX_W = 128;
export const TEX_H = 64;

export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array;
}

type RGB = [number, number, number];
export const hexRgb = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

export function ringPerimeter(part: Part, tag: string): number {
  const r = part.rings.find((x) => x.tag === tag) ?? part.rings[Math.floor(part.rings.length / 2)];
  let per = 0;
  let prev = ringPoint(r, 0);
  for (let k = 1; k <= 256; k++) {
    const p = ringPoint(r, (2 * Math.PI * k) / 256);
    per += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return per;
}

export function paintFace(face: FaceParams, skinHex: string, d: Dims, head: Part, beard?: Garment): Texture {
  const W = TEX_W;
  const H = TEX_H;
  const rgba = new Uint8Array(W * H * 4);
  const skin = hexRgb(skinHex);
  const dark: RGB = mix(skin, [20, 12, 10], 0.82);
  const white: RGB = [245, 245, 240];
  const iris = hexRgb(face.iris);
  const lips = mix(mix(skin, [150, 40, 50], 0.35), [0, 0, 0], 0.12);
  const set = (x: number, y: number, c: RGB, a = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(rgba[i + k] * (1 - a) + c[k] * a);
    rgba[i + 3] = 255;
  };
  const rect = (x: number, y: number, w: number, h: number, c: RGB, a = 1) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c, a);
  };
  rect(0, 0, W, H, skin);
  if (beard && beard.id !== 'none') {
    // stubble shadow on the jaw; real beards are geometry but get a matching shadow underneath
    const bc = hexRgb(beard.color);
    const jawTop = Math.round((1 - Math.max(0.12, d.eyeLine - 0.28 * Math.min(1.2, d.faceScale * 0.9)) - 0.1) * H);
    for (let y = jawTop; y < H; y++) for (let x = Math.round(W * 0.27); x < Math.round(W * 0.73); x++) set(x, y, bc, beard.id === 'stubble' ? 0.28 + 0.1 * (((x * 7 + y * 13) % 5) / 5) : 0.6);
  }

  // metres → pixels. Horizontal: arc length around the head; vertical: head height.
  const per = ringPerimeter(head, 'brow');
  const pxX = W / per;
  const pxY = H / d.headH;
  const cx = W / 2;
  const row = (t: number) => (1 - t) * H; // t = fraction of head height above the chin
  const fs = d.faceScale;
  const hw = d.headHW;
  const eyeY = row(d.eyeLine);
  const eyeDX = Math.max(2, Math.round(0.4 * hw * pxX * d.eyeSpacing));
  const ew = Math.max(2, Math.round(0.2 * hw * pxX * fs * d.eyeSize));
  const eh = Math.max(1, Math.round(0.07 * d.headH * pxY * fs * d.eyeSize));

  for (const s of [-1, 1]) {
    // s = +1 is the image's right = the character's left (it faces +Z, we look at it from +Z)
    const ex = Math.round(cx + s * eyeDX - ew / 2);
    const ey = Math.round(eyeY - eh / 2);
    const inner = s > 0 ? ex : ex + Math.ceil(ew / 2); // iris sits toward the nose, Minecraft-style
    switch (face.eyes) {
      case 'square':
        rect(ex, ey, ew, eh, white);
        rect(inner, ey, Math.ceil(ew / 2), eh, iris);
        break;
      case 'dot':
        rect(Math.round(cx + s * eyeDX - 1), Math.round(eyeY - 1), 2, Math.max(2, eh), dark);
        break;
      case 'round': {
        rect(ex, ey, ew, eh + 1, white);
        const iw = Math.max(1, Math.round(ew * 0.6));
        rect(Math.round(cx + s * eyeDX - iw / 2), ey, iw, eh + 1, iris);
        set(Math.round(cx + s * eyeDX), ey + Math.floor((eh + 1) / 2), dark);
        set(ex, ey, skin);
        set(ex + ew - 1, ey, skin);
        break;
      }
      case 'tall': {
        const th = eh + 2;
        rect(ex, ey - 1, ew, th, dark);
        rect(ex, ey + th - 3, ew, 2, iris);
        set(ex + (s > 0 ? 0 : ew - 1), ey - 1 + 1, white);
        rect(ex - (s > 0 ? 1 : 0), ey - 2, ew + 1, 1, dark);
        break;
      }
      case 'sleepy':
        rect(ex, ey + Math.floor(eh / 2), ew, 1, dark);
        rect(Math.round(cx + s * eyeDX - 1), ey + Math.floor(eh / 2) + 1, 2, 1, iris);
        break;
      case 'wide':
        rect(ex - 1, ey - 1, ew + 2, eh + 2, white);
        rect(Math.round(cx + s * eyeDX - 1), ey, 2, Math.max(1, eh), dark);
        break;
    }
    // brows (opt-in: the brief was "no facial hair", so default is none)
    const bc = hexRgb(face.browColor);
    const by = Math.round(eyeY - eh / 2 - Math.max(2, 0.07 * d.headH * pxY));
    if (face.brows === 'thin') rect(ex, by, ew, 1, bc);
    if (face.brows === 'thick') rect(ex - 1, by - 1, ew + 2, 2, bc);
    if (face.brows === 'angry') {
      for (let i = 0; i < ew + 1; i++) set(ex + i - (s > 0 ? 0 : 1), by + (s > 0 ? Math.floor((ew - i) / 2) : Math.floor(i / 2)) - 1, bc);
    }
    if (face.blush) rect(Math.round(cx + s * (eyeDX + 1) - ew / 2), ey + eh + 1, ew, 1, [235, 110, 120], 0.45);
  }

  // nose shading when there is no modelled nose
  if (!face.nose) rect(cx - 1, Math.round(row(d.eyeLine - 0.13)), 2, 1, mix(skin, [0, 0, 0], 0.18));

  // mouth
  const my = Math.round(row(Math.max(0.12, d.eyeLine - 0.28 * Math.min(1.2, fs * 0.9))));
  const mw = Math.max(3, Math.round(0.42 * hw * pxX * Math.min(1.25, fs) * d.mouthWidth));
  const mx = Math.round(cx - mw / 2);
  switch (face.mouth) {
    case 'line':
      rect(mx, my, mw, 1, lips);
      break;
    case 'small':
      rect(Math.round(cx - 1), my, 2, 1, lips);
      break;
    case 'smile':
      rect(mx + 1, my, mw - 2, 1, lips);
      set(mx, my - 1, lips);
      set(mx + mw - 1, my - 1, lips);
      break;
    case 'grin':
      rect(mx, my - 1, mw, 2, dark);
      rect(mx + 1, my - 1, mw - 2, 1, white);
      break;
    case 'open':
      rect(mx + Math.floor(mw / 4), my - 1, Math.max(2, Math.ceil(mw / 2)), 2, dark);
      break;
    case 'frown':
      rect(mx + 1, my - 1, mw - 2, 1, lips);
      set(mx, my, lips);
      set(mx + mw - 1, my, lips);
      break;
  }
  return { width: W, height: H, rgba };
}

// ─────────────────────────────────────────────────────────── PNG encoder ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(tex: Texture): Uint8Array {
  const { width: w, height: h, rgba } = tex;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
