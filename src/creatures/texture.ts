/**
 * Creature skin: mottled, faceted-looking noise with countershading (dark back, pale belly),
 * accent blotches, optional scars and belly grooves. U wraps once around the body (u = 0 is the
 * belly, 0.5 the back); V repeats every CREATURE_TILE metres along it. Plus an emissive map for
 * bioluminescent spots.
 */
import { hexRgb, Texture } from '../core/face';
import { Rng } from '../core/rng';

const W = 128;
const H = 128;
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.min(1, Math.max(0, t)))) as RGB;

/** tileable value noise (period cells across the texture) */
function noise(seed: number, px: number, py: number) {
  const r = new Rng(seed);
  const g = Array.from({ length: px * py }, () => r.next());
  const at = (i: number, j: number) => g[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  const f = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = (x / W) * px;
    const fy = (y / H) * py;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = f(fx - i);
    const v = f(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

export interface SkinOpts {
  base: string;
  belly: string;
  accent: string;
  /** 0 … 1 amount of accent blotching */
  blotch: number;
  scars?: boolean;
  grooves?: boolean;
  /** stripe across the back (tiger-ish), 0 = none */
  bands?: number;
  seed: number;
}

export function paintCreatureSkin(o: SkinOpts): Texture {
  const rgba = new Uint8Array(W * H * 4);
  const base = hexRgb(o.base);
  const belly = hexRgb(o.belly);
  const accent = hexRgb(o.accent);
  const fine = noise(o.seed, 32, 32);
  const mid = noise(o.seed + 1, 8, 8);
  const blot = noise(o.seed + 2, 6, 5);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const back = (1 - Math.cos(u * Math.PI * 2)) / 2; // 0 belly … 1 back
      let c = mix(belly, base, (back - 0.18) / 0.4);
      // faceted mottling: blocky fine noise × soft mid noise
      const fx = Math.floor(x / 2) * 2;
      const fy = Math.floor(y / 2) * 2;
      const k = 0.78 + 0.32 * fine(fx, fy) + 0.18 * (mid(x, y) - 0.5);
      c = [c[0] * k, c[1] * k, c[2] * k].map((v) => Math.min(255, Math.round(v))) as RGB;
      if (blot(x, y) > 1 - 0.42 * o.blotch) c = mix(c, accent, 0.5 + 0.3 * fine(x, y));
      if (o.bands && Math.sin((y / H) * Math.PI * 2 * o.bands + mid(x, y) * 3) > 0.75 && back > 0.4) c = mix(c, [20, 18, 30], 0.45);
      if (o.grooves && back < 0.22 && x % 6 === 0) c = mix(c, [40, 40, 50], 0.55);
      const i = (y * W + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  if (o.scars) {
    const r = new Rng(o.seed + 9);
    for (let s = 0; s < 4; s++) {
      let x = r.int(W * 0.3, W * 0.7);
      let y = r.int(0, H - 1);
      const dx = r.range(-1.2, 1.2);
      for (let k = 0; k < 40; k++) {
        for (const o2 of [0, 1]) {
          const xi = (((Math.round(x) + o2) % W) + W) % W;
          const yi = ((Math.round(y) % H) + H) % H;
          const i = (yi * W + xi) * 4;
          const c = mix([rgba[i], rgba[i + 1], rgba[i + 2]], [110, 24, 30], 0.7);
          rgba[i] = c[0];
          rgba[i + 1] = c[1];
          rgba[i + 2] = c[2];
        }
        x += dx;
        y += 1;
      }
    }
  }
  return { width: W, height: H, rgba };
}

/** emissive map: glowing spots on the back half (black elsewhere) */
export function paintGlowSpots(color: string, amount: number, seed: number): Texture {
  const rgba = new Uint8Array(W * H * 4);
  const c = hexRgb(color);
  const r = new Rng(seed);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = 255;
  const count = Math.round(40 * amount);
  for (let s = 0; s < count; s++) {
    const cx = r.int(Math.round(W * 0.22), Math.round(W * 0.78));
    const cy = r.int(0, H - 1);
    const w = r.int(2, 5);
    const h = r.int(2, 6);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = ((((cy + y) % H) * W + ((cx + x) % W)) * 4);
        const f = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? 0.55 : 1;
        rgba[i] = Math.round(c[0] * f);
        rgba[i + 1] = Math.round(c[1] * f);
        rgba[i + 2] = Math.round(c[2] * f);
      }
  }
  return { width: W, height: H, rgba };
}
