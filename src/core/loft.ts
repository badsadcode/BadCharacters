/**
 * The loft kernel. Every body part (and every garment) is a list of cross-section rings along a
 * path. A ring is a superellipse — |x/a|^n + |y/b|^n = 1 — so one exponent slides the whole
 * character from "Minecraft block" (n≈10) to "smooth pebble" (n≈2).
 *
 * Rings carry skin weights. Interpolating weights between rings is what makes elbows and knees
 * bend as one continuous surface instead of two boxes kissing.
 */
import { add, cross, dot, len, lerp, lerp3, norm, scale, sub, V3 } from './math';
import type { ShellSpec } from './shell';
import { PATTERN_TILE } from './patterns';

/** metres of creature skin per texture repeat along the body */
export const CREATURE_TILE = 1.5;

/** [boneIndex, weight] pairs */
export type Weights = [number, number][];

export interface Ring {
  /** centre */
  c: V3;
  /** cross-section axes: `a` is measured along p, `b` along q. d is the direction of travel. */
  p: V3;
  q: V3;
  d: V3;
  a: number;
  b: number;
  n: number;
  /** bulge on the +q side (belly, chest); `double` = two bumps (breasts, pecs) */
  fb?: number;
  fbDouble?: boolean;
  /** bulge on the -q side (butt, shoulder blades) */
  bb?: number;
  w: Weights;
  tag?: string;
}

export interface Part {
  name: string;
  material: string;
  rings: Ring[];
  capStart?: boolean;
  capEnd?: boolean;
  /** 'head' maps v to world height so the face texture lines up with the eye line */
  uv?: { mode: 'arc' } | { mode: 'head'; y0: number; h: number } | { mode: 'wrap' };
  /** fixed number of sides around (teeth and fins: 4) */
  sides?: number;
  /** render inside-out (a throat you look into) */
  flipWinding?: boolean;
  /** per-vertex weight override (skirts that follow both legs) */
  vertexWeights?: (ring: number, xn: number, yn: number, r: Ring) => Weights;
  /**
   * resolution class: 'full' parts get the detail level's side count, 'small' parts (thumbs,
   * noses, straps, knobs) get fewer, 'box' parts are true 4-sided boxes with hard edges
   */
  lod?: 'full' | 'small' | 'box';
  /** body part id ('leg.L', …) */
  id?: string;
  /** how this part was cut, so hidden stretches can be culled */
  spec?: ShellSpec;
  /** bevelled-box cross-section: chamfer size as a fraction of the smaller half-extent */
  bevel?: number;
  /** 'box': the simplest cross-section, a plain 4-cornered rectangle (voxel styles) */
  section?: 'box';
  /** torn edges: jag the first/last ring along the direction of travel (metres, seeded) */
  ragged?: { start?: number; end?: number; seed: number };
}

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  joints: number[];
  weights: number[];
  indices: number[];
}

export const emptyMesh = (): MeshData => ({ positions: [], normals: [], uvs: [], joints: [], weights: [], indices: [] });

// ───────────────────────────────────────────────────────────── rings ──
export function ring(c: V3, p: V3, q: V3, a: number, b: number, n: number, w: Weights, extra: Partial<Ring> = {}): Ring {
  return { c, p: norm(p), q: norm(q), d: norm(cross(p, q)), a, b, n, w, ...extra };
}

export function mergeWeights(a: Weights, b: Weights, t: number): Weights {
  const m = new Map<number, number>();
  for (const [j, w] of a) m.set(j, (m.get(j) ?? 0) + w * (1 - t));
  for (const [j, w] of b) m.set(j, (m.get(j) ?? 0) + w * t);
  return [...m.entries()].filter(([, w]) => w > 1e-4);
}

export function lerpRing(r0: Ring, r1: Ring, t: number): Ring {
  return {
    c: lerp3(r0.c, r1.c, t),
    p: norm(lerp3(r0.p, r1.p, t)),
    q: norm(lerp3(r0.q, r1.q, t)),
    d: norm(lerp3(r0.d, r1.d, t)),
    a: lerp(r0.a, r1.a, t),
    b: lerp(r0.b, r1.b, t),
    n: lerp(r0.n, r1.n, t),
    fb: lerp(r0.fb ?? 0, r1.fb ?? 0, t),
    fbDouble: r0.fbDouble ?? r1.fbDouble,
    bb: lerp(r0.bb ?? 0, r1.bb ?? 0, t),
    w: mergeWeights(r0.w, r1.w, t),
  };
}

/** Ring at fractional index k (k = 2.5 is halfway between ring 2 and ring 3). */
export function sampleRing(rings: Ring[], k: number): Ring {
  const kk = Math.min(rings.length - 1, Math.max(0, k));
  const i = Math.min(rings.length - 2, Math.floor(kk));
  return lerpRing(rings[i], rings[i + 1], kk - i);
}

export function anchor(rings: Ring[], tag: string): number {
  const i = rings.findIndex((r) => r.tag === tag);
  if (i < 0) throw new Error(`no ring tagged "${tag}"`);
  return i;
}

/** Ring indices of a slice from fractional k0 to k1: the ends plus every whole ring in between. */
export function sliceKs(k0: number, k1: number): number[] {
  const ks = [k0];
  for (let i = Math.floor(k0) + 1; i < k1; i++) if (i > k0 + 1e-3 && i < k1 - 1e-3) ks.push(i);
  ks.push(k1);
  return ks;
}

/** Rings from fractional index k0 to k1, including every original ring in between. */
export function sliceRings(rings: Ring[], k0: number, k1: number): Ring[] {
  return sliceKs(k0, k1).map((k) => (Number.isInteger(k) ? { ...rings[k] } : sampleRing(rings, k)));
}

/**
 * Ring simplification: drop rings that are (within `tol` metres, and within 0.08 of skin
 * weight) a straight interpolation of their kept neighbours. Blocky limbs are nearly straight,
 * so they lose most of their rings; a realistic calf keeps its bulge. Returns kept indices.
 */
export function simplifyRings(rings: Ring[], tol: number): number[] {
  const n = rings.length;
  if (n <= 2) return rings.map((_, i) => i);
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + len(sub(rings[i].c, rings[i - 1].c)));
  const fits = (s: number, j: number) => {
    for (let i = s + 1; i < j; i++) {
      const span = cum[j] - cum[s];
      const t = span > 1e-9 ? (cum[i] - cum[s]) / span : (i - s) / (j - s);
      const L = lerpRing(rings[s], rings[j], t);
      const r = rings[i];
      const ext = Math.max(r.a, r.b);
      const dev =
        len(sub(r.c, L.c)) + Math.abs(r.a - L.a) + Math.abs(r.b - L.b) + Math.abs((r.fb ?? 0) - (L.fb ?? 0)) + Math.abs((r.bb ?? 0) - (L.bb ?? 0)) +
        (len(sub(r.p, L.p)) + len(sub(r.q, L.q))) * ext;
      if (dev > tol) return false;
      const wm = new Map<number, number>();
      for (const [b, w] of r.w) wm.set(b, w);
      for (const [b, w] of L.w) wm.set(b, (wm.get(b) ?? 0) - w);
      let wd = 0;
      for (const v of wm.values()) wd += Math.abs(v);
      if (wd > 0.08) return false;
    }
    return true;
  };
  const keep = [0];
  let s = 0;
  while (s < n - 1) {
    let j = s + 1;
    while (j + 1 < n && fits(s, j + 1)) j++;
    keep.push(j);
    s = j;
  }
  return keep;
}

export function inflateRing(r: Ring, by: number, extra: Partial<Ring> = {}): Ring {
  return { ...r, a: r.a + by, b: r.b + by, ...extra };
}

function bump(xn: number, double?: boolean) {
  if (double) return Math.exp(-(((Math.abs(xn) - 0.5) / 0.3) ** 2));
  return Math.max(0, 1 - xn * xn) ** 1.2;
}

/** 2D point on the ring outline at parameter angle th. */
export function ringPoint(r: Ring, th: number): [number, number] {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const e = 2 / r.n;
  const x0 = Math.sign(c) * Math.abs(c) ** e;
  const y0 = Math.sign(s) * Math.abs(s) ** e;
  let x = r.a * x0;
  let y = r.b * y0;
  if (r.fb && s > 0) y += r.fb * s * bump(x0, r.fbDouble);
  if (r.bb && s < 0) y -= r.bb * -s * bump(x0, false);
  return [x, y];
}

// ────────────────────────────────────────────────────────────── loft ──
function finishWeights(w: Weights): [number[], number[]] {
  const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
  const j = [0, 0, 0, 0];
  const ww = [0, 0, 0, 0];
  top.forEach(([b, x], i) => {
    j[i] = b;
    ww[i] = x / sum;
  });
  return [j, ww];
}

/**
 * Appends a lofted part to `m`. K = vertices around each ring (multiple of 4, so there is always
 * a vertex at the middle of each side). Each ring gets K+1 vertices: the last duplicates the
 * first with u = 1 so textures wrap without a smear.
 */
export function loftPart(part: Part, K: number, m: MeshData) {
  // (K may be overridden for boxes below)
  const rings = part.rings;
  const base = m.positions.length / 3;
  const isBox = part.lod === 'box' || part.section === 'box';
  const bevel = !isBox && part.bevel ? part.bevel : 0;
  if (isBox) K = 4;
  if (bevel) K = 8;
  // boxes put their 4 vertices on the corners, everything else puts one mid-side
  const th0 = isBox ? -Math.PI / 2 + Math.PI / 4 : -Math.PI / 2;
  /**
   * Bevelled box: 8 vertices, flat sides, chamfered corners. Vertex k of 8, counter-clockwise
   * from the back edge. Returns [x, y] plus the angle used for per-vertex weights.
   */
  const bevelPoint = (r: Ring, k: number): [number, number] => {
    const c = bevel * Math.min(r.a, r.b);
    const X = 1 - c / Math.max(r.a, 1e-9);
    const Y = 1 - c / Math.max(r.b, 1e-9);
    const P: [number, number][] = [[X, -1], [1, -Y], [1, Y], [X, 1], [-X, 1], [-1, Y], [-1, -Y], [-X, -1]];
    const [px, py] = P[k % 8];
    let x = px * r.a;
    let y = py * r.b;
    // same front/back bulges as the superellipse profile (bump() is shared)
    if (r.fb && py > 0) y += r.fb * py * bump(px, r.fbDouble);
    if (r.bb && py < 0) y -= r.bb * -py * bump(px, false);
    return [x, y];
  };
  const angleOf = (r: Ring, k: number) => (bevel ? Math.atan2(bevelPoint(r, k)[1] / Math.max(r.b, 1e-9), bevelPoint(r, k)[0] / Math.max(r.a, 1e-9)) : th0 + (2 * Math.PI * k) / K);
  const pointAt = (r: Ring, th: number, k: number): [number, number] =>
    bevel ? bevelPoint(r, k) : isBox ? [r.a * Math.sign(Math.cos(th)), r.b * Math.sign(Math.sin(th))] : ringPoint(r, th);
  const R = K + 1;
  // winding: with p×q pointing along the direction of travel, (A,B,C) faces outward
  const travel = rings.length > 1 ? sub(rings[rings.length - 1].c, rings[0].c) : rings[0].d;
  const flip = (dot(cross(rings[0].p, rings[0].q), travel) < 0) !== !!part.flipWinding;
  // v: arc length along the centres
  const cum = [0];
  for (let i = 1; i < rings.length; i++) cum.push(cum[i - 1] + len(sub(rings[i].c, rings[i - 1].c)));
  const total = cum[cum.length - 1] || 1;

  // torn edges: a seeded saw-tooth pulled back along the travel direction
  const tdir = norm(travel);
  const jag = (i: number, k: number) => {
    const rg = part.ragged;
    if (!rg) return 0;
    const amt = i === 0 ? rg.start ?? 0 : i === rings.length - 1 ? rg.end ?? 0 : 0;
    if (!amt) return 0;
    const kk = k % K;
    const h = Math.sin(kk * 12.9898 + rg.seed * 78.233 + i * 3.1) * 43758.5453;
    const r01 = h - Math.floor(h);
    return (i === 0 ? 1 : -1) * amt * (kk % 2 ? r01 : 0.25 * r01);
  };
  rings.forEach((r, i) => {
    const pts: V3[] = [];
    for (let k = 0; k <= K; k++) {
      const th = th0 + (2 * Math.PI * k) / K;
      const [x, y] = pointAt(r, th, k);
      pts.push(add(add(r.c, add(scale(r.p, x), scale(r.q, y))), scale(tdir, jag(i, k))));
    }
    // u: arc length around the ring, starting at the back (-q) so the front sits at u = 0.5
    const arc = [0];
    for (let k = 1; k <= K; k++) arc.push(arc[k - 1] + len(sub(pts[k], pts[k - 1])));
    const per = arc[K] || 1;
    for (let k = 0; k <= K; k++) {
      const p = pts[k];
      m.positions.push(...p);
      m.normals.push(0, 0, 0);
      const uvMode = part.uv?.mode ?? 'arc';
      const v = uvMode === 'head' ? (p[1] - (part.uv as { y0: number }).y0) / (part.uv as { h: number }).h : cum[i] / total;
      // head: normalized cylinder for the face texture; everything else: metres / tile, so
      // fabric patterns keep the same scale on every part
      // (bevelled rings start at a corner, not the back centre: shift so the face stays at u = 0.5)
      // (box and bevelled rings start at a corner, not the back centre: shift so the face stays at u = 0.5)
      if (uvMode === 'head') m.uvs.push((arc[k] + (bevel ? bevelPoint(r, 0)[0] : isBox ? r.a : 0)) / per, 1 - v);
      // creatures: once around the body (u, for countershading), metres along it (v)
      else if (uvMode === 'wrap') m.uvs.push(arc[k] / per, cum[i] / CREATURE_TILE);
      else m.uvs.push(arc[k] / PATTERN_TILE, (cum[i] / PATTERN_TILE));
      const th = angleOf(r, k);
      const w = part.vertexWeights ? part.vertexWeights(i, Math.cos(th), Math.sin(th), r) : r.w;
      const [j, ww] = finishWeights(w);
      m.joints.push(...j);
      m.weights.push(...ww);
    }
  });
  const tri = (a: number, b: number, c: number) => (flip ? m.indices.push(a, c, b) : m.indices.push(a, b, c));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < K; k++) {
      const A = base + i * R + k;
      const B = A + 1;
      const D = A + R;
      const C = D + 1;
      tri(A, B, C);
      tri(A, C, D);
    }
  }
  const cap = (ri: number, start: boolean) => {
    const r = rings[ri];
    const ci = m.positions.length / 3;
    m.positions.push(...r.c);
    m.normals.push(0, 0, 0);
    const v = part.uv?.mode === 'head' ? (r.c[1] - part.uv.y0) / part.uv.h : cum[ri] / total;
    m.uvs.push(part.uv?.mode === 'head' ? 0.5 : 0, part.uv?.mode === 'head' ? 1 - v : cum[ri] / PATTERN_TILE);
    const [j, ww] = finishWeights(r.w);
    m.joints.push(...j);
    m.weights.push(...ww);
    for (let k = 0; k < K; k++) {
      const A = base + ri * R + k;
      if (start) tri(ci, A + 1, A);
      else tri(ci, A, A + 1);
    }
  };
  if (part.capStart) cap(0, true);
  if (part.capEnd) cap(rings.length - 1, false);
}

/** Append mesh b onto a. */
export function appendMesh(a: MeshData, b: MeshData) {
  const off = a.positions.length / 3;
  a.positions.push(...b.positions);
  a.normals.push(...b.normals);
  a.uvs.push(...b.uvs);
  a.joints.push(...b.joints);
  a.weights.push(...b.weights);
  for (const i of b.indices) a.indices.push(i + off);
}

/** Smooth normals, welded by position so u-seams and cap edges don't show. */
export function computeNormals(m: MeshData) {
  const n = m.positions.length / 3;
  const key = (i: number) => `${Math.round(m.positions[i * 3] * 1e4)},${Math.round(m.positions[i * 3 + 1] * 1e4)},${Math.round(m.positions[i * 3 + 2] * 1e4)}`;
  const groups = new Map<string, number[]>();
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = key(i);
    keys.push(k);
    if (!groups.has(k)) groups.set(k, [0, 0, 0]);
  }
  const P = (i: number): V3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const fn = cross(sub(P(b), P(a)), sub(P(c), P(a))); // area-weighted
    for (const v of [a, b, c]) {
      const g = groups.get(keys[v])!;
      g[0] += fn[0];
      g[1] += fn[1];
      g[2] += fn[2];
    }
  }
  for (let i = 0; i < n; i++) {
    const g = groups.get(keys[i])!;
    // degenerate spots (zero-area fans, collapsed tips) still need a unit normal
    const nn: V3 = Math.hypot(g[0], g[1], g[2]) > 1e-12 ? norm(g as V3) : [0, 1, 0];
    m.normals[i * 3] = nn[0];
    m.normals[i * 3 + 1] = nn[1];
    m.normals[i * 3 + 2] = nn[2];
  }
}

/** Faceted low-poly look: every triangle gets its own three vertices. */
export function unweld(m: MeshData): MeshData {
  const o = emptyMesh();
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const P = tri.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]] as V3);
    const cr = cross(sub(P[1], P[0]), sub(P[2], P[0]));
    const fn: V3 = Math.hypot(...cr) > 1e-14 ? norm(cr) : [0, 1, 0];
    for (const i of tri) {
      o.indices.push(o.positions.length / 3);
      o.positions.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
      o.normals.push(...fn);
      o.uvs.push(m.uvs[i * 2], m.uvs[i * 2 + 1]);
      o.joints.push(...m.joints.slice(i * 4, i * 4 + 4));
      o.weights.push(...m.weights.slice(i * 4, i * 4 + 4));
    }
  }
  return o;
}
