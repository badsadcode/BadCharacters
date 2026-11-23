/**
 * Fabric patterns: small tileable textures (64×64) for camouflage, plaid, stripes and grime.
 * Built from wrap-around value noise, so they repeat seamlessly. Clothing UVs are in metres
 * (one tile = PATTERN_TILE metres), so a camo blob is the same size on a sleeve and on a chest.
 */
import { hexRgb, Texture } from './face';
import { Rng } from './rng';

export const PATTERN_TILE = 0.3; // metres per texture repeat
const N = 64;

export const PATTERNS = {
  solid: 'Solid',
  woodland: 'Woodland camo',
  desert: 'Desert camo',
  tiger: 'Tiger stripe',
  erdl: 'ERDL / leaf',
  flecktarn: 'Flecktarn dots',
  digital: 'Digital camo',
  urban: 'Urban camo',
  splinter: 'Splinter camo',
  snow: 'Snow camo',
  plaid: 'Plaid',
  stripes: 'Stripes',
  grime: 'Grimy / worn',
  bloody: 'Bloodstained',
  patched: 'Patched',
} as const;
export type PatternId = keyof typeof PATTERNS;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

/** tileable value noise with period `p` lattice cells across the texture */
function noiseField(seed: number, p: number, sx = 1, sy = 1): (x: number, y: number) => number {
  const r = new Rng(seed);
  const px = Math.max(1, Math.round(p * sx));
  const py = Math.max(1, Math.round(p * sy));
  const g = Array.from({ length: px * py }, () => r.next());
  const at = (i: number, j: number) => g[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / N) * px;
    const fy = (y / N) * py;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fade(fx - i);
    const v = fade(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}
function fbm(seed: number, base: number, sx = 1, sy = 1) {
  const o = [noiseField(seed, base, sx, sy), noiseField(seed + 1, base * 2, sx, sy), noiseField(seed + 2, base * 4, sx, sy)];
  return (x: number, y: number) => (o[0](x, y) * 0.6 + o[1](x, y) * 0.28 + o[2](x, y) * 0.12);
}

export function paintPattern(id: PatternId, color: string, color2: string, seed = 7): Texture {
  const rgba = new Uint8Array(N * N * 4);
  const base = hexRgb(color);
  const c2 = hexRgb(color2);
  const dark = mix(base, [0, 0, 0], 0.45);
  const black: RGB = [30, 29, 26];
  const light = mix(base, [255, 255, 255], 0.35);
  const set = (x: number, y: number, c: RGB) => {
    const i = (y * N + x) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 255;
  };
  const each = (f: (x: number, y: number) => RGB) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set(x, y, f(x, y));
  };
  const r = new Rng(seed);
  switch (id) {
    case 'woodland': {
      const a = fbm(seed, 3);
      const b = fbm(seed + 10, 3);
      const k = fbm(seed + 20, 4);
      each((x, y) => (k(x, y) > 0.66 ? black : b(x, y) > 0.6 ? dark : a(x, y) > 0.55 ? c2 : base));
      break;
    }
    case 'desert': {
      const a = fbm(seed, 2);
      const b = fbm(seed + 10, 3);
      each((x, y) => (b(x, y) > 0.64 ? mix(c2, black, 0.2) : a(x, y) > 0.52 ? c2 : base));
      break;
    }
    case 'snow': {
      const a = fbm(seed, 3);
      const b = fbm(seed + 5, 4);
      each((x, y) => (b(x, y) > 0.68 ? c2 : a(x, y) > 0.62 ? mix(c2, [255, 255, 255], 0.5) : [236, 238, 240]));
      break;
    }
    case 'tiger': {
      // long horizontal brush strokes
      const a = fbm(seed, 4, 0.35, 2.2);
      const b = fbm(seed + 9, 4, 0.35, 2.2);
      each((x, y) => (a(x, y) > 0.6 ? black : b(x, y) > 0.58 ? c2 : base));
      break;
    }
    case 'erdl': {
      const a = fbm(seed, 3, 1, 1.6);
      const b = fbm(seed + 3, 4, 1, 1.6);
      const k = fbm(seed + 6, 5, 1, 1.6);
      each((x, y) => (k(x, y) > 0.68 ? black : b(x, y) > 0.6 ? dark : a(x, y) > 0.5 ? c2 : base));
      break;
    }
    case 'flecktarn': {
      each(() => base);
      const cols = [c2, dark, black, light];
      for (let i = 0; i < 260; i++) {
        const cx = r.int(0, N - 1);
        const cy = r.int(0, N - 1);
        const c = cols[i % cols.length];
        const s = r.int(1, 2);
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s + 1; dx++) set((cx + dx) % N, (cy + dy) % N, c);
      }
      break;
    }
    case 'digital': {
      const a = fbm(seed, 3);
      const b = fbm(seed + 7, 4);
      const q = 4; // pixel blocks
      each((x, y) => {
        const X = Math.floor(x / q) * q;
        const Y = Math.floor(y / q) * q;
        return b(X, Y) > 0.62 ? black : a(X, Y) > 0.58 ? dark : a(X, Y) > 0.45 ? c2 : base;
      });
      break;
    }
    case 'urban': {
      const a = fbm(seed, 2);
      const b = fbm(seed + 4, 3);
      each((x, y) => (b(x, y) > 0.62 ? [40, 42, 44] : a(x, y) > 0.56 ? [150, 152, 154] : a(x, y) > 0.42 ? [105, 107, 110] : [190, 192, 194]));
      break;
    }
    case 'splinter': {
      const a = fbm(seed, 2);
      each((x, y) => {
        const band = Math.floor(((x + y * 0.6 + a(x, y) * 30) / 9) % 4);
        return [base, c2, dark, base][band] as RGB;
      });
      break;
    }
    case 'plaid': {
      each((x, y) => {
        const h = Math.floor(y / 8) % 2 === 0 && y % 8 < 3;
        const v = Math.floor(x / 8) % 2 === 0 && x % 8 < 3;
        const thinH = y % 16 === 12;
        const thinV = x % 16 === 12;
        if (h && v) return mix(c2, black, 0.35);
        if (h || v) return c2;
        if (thinH || thinV) return light;
        return base;
      });
      break;
    }
    case 'stripes':
      each((x, y) => (Math.floor(y / 8) % 2 === 0 ? base : c2));
      break;
    case 'grime': {
      const a = fbm(seed, 3);
      const b = fbm(seed + 2, 6);
      each((x, y) => {
        const dirt = Math.max(0, a(x, y) - 0.45) * 1.4 + (b(x, y) > 0.72 ? 0.25 : 0);
        const c = mix(base, [62, 50, 36], Math.min(0.75, dirt));
        return (x * 13 + y * 7) % 17 === 0 ? mix(c, black, 0.3) : c;
      });
      break;
    }
    case 'bloody': {
      const a = fbm(seed, 3);
      const b = fbm(seed + 3, 5);
      each((x, y) => {
        const dirt = mix(base, [62, 50, 36], Math.min(0.6, Math.max(0, a(x, y) - 0.45) * 1.4));
        const blood = b(x, y);
        return blood > 0.66 ? [96, 14, 12] : blood > 0.6 ? mix(dirt, [120, 22, 18], 0.6) : dirt;
      });
      break;
    }
    case 'patched': {
      const g = fbm(seed, 4);
      each((x, y) => mix(base, [50, 44, 36], Math.max(0, g(x, y) - 0.5)));
      for (let i = 0; i < 3; i++) {
        const px = r.int(0, N - 1);
        const py = r.int(0, N - 1);
        const w = r.int(10, 18);
        const h = r.int(8, 14);
        const pc = i % 2 ? c2 : mix(c2, base, 0.5);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const stitch = (x === 0 || y === 0 || x === w - 1 || y === h - 1) && (x + y) % 2 === 0;
            set((px + x) % N, (py + y) % N, stitch ? [230, 220, 190] : pc);
          }
      }
      break;
    }
    default:
      each(() => base);
  }
  return { width: N, height: N, rgba };
}
