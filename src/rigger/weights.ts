/**
 * Automatic skin weights for an imported mesh.
 *
 * 1. Every deforming bone is a segment (joint → child joint, or → a measured tip for hands, toes
 *    and the head).
 * 2. Distances are measured relative to how thick that body part actually is (a vertex 10 cm from
 *    the spine is "on the torso", 10 cm from the forearm bone is not on the forearm), learned from
 *    the mesh itself in a first pass.
 * 3. A vertex blends softly between its nearest bone and that bone's parent / children, which is
 *    what makes elbows and knees bend smoothly instead of creasing.
 * 4. A few smoothing passes over the mesh surface even it out. Vertices are welded by position
 *    first, so UV seams and hard edges can never tear apart.
 * 5. Left bones never take vertices clearly on the right side and vice versa.
 */
import type { V3 } from '../core/math';
import type { Skeleton } from '../core/skeleton';
import { weldIds } from './markers';
import type { Fitted } from './fit';

export interface SkinWeights {
  /** 4 joint indices per vertex */
  joints: Uint8Array;
  /** 4 weights per vertex (sum 1) */
  weights: Float32Array;
}

interface Seg {
  bone: number;
  a: V3;
  b: V3;
  side: number;
  /** bones allowed to blend with this one */
  nbr: Set<number>;
  clavicle?: boolean;
}

const SOFT = 0.22;
const SMOOTH_PASSES = 3;

export function segments(f: Fitted): Seg[] {
  const sk = f.skeleton;
  const W = (n: string) => sk.bones[sk.index[n]].world;
  const I = (n: string) => sk.index[n];
  const segs: Seg[] = [];
  const addSeg = (name: string, end: V3) => {
    const side = name.startsWith('Left') ? 1 : name.startsWith('Right') ? -1 : 0;
    segs.push({ bone: I(name), a: W(name), b: end, side, nbr: new Set(), clavicle: name.endsWith('Shoulder') });
  };
  addSeg('Hips', W('Spine'));
  addSeg('Spine', W('Chest'));
  addSeg('Chest', W('UpperChest'));
  addSeg('UpperChest', W('Neck'));
  addSeg('Neck', W('Head'));
  addSeg('Head', f.tips.head);
  for (const side of ['Left', 'Right']) {
    const s = side === 'Left' ? 'L' : 'R';
    addSeg(`${side}Shoulder`, W(`${side}UpperArm`));
    addSeg(`${side}UpperArm`, W(`${side}LowerArm`));
    addSeg(`${side}LowerArm`, W(`${side}Hand`));
    addSeg(`${side}Hand`, s === 'L' ? f.tips.handL : f.tips.handR);
    addSeg(`${side}UpperLeg`, W(`${side}LowerLeg`));
    addSeg(`${side}LowerLeg`, W(`${side}Foot`));
    addSeg(`${side}Foot`, W(`${side}Toes`));
    addSeg(`${side}Toes`, s === 'L' ? f.tips.toeL : f.tips.toeR);
  }
  // neighbours: self, parent, children (only bones that have segments)
  const has = new Set(segs.map((s) => s.bone));
  for (const sg of segs) {
    sg.nbr.add(sg.bone);
    const p = sk.bones[sg.bone].parent;
    if (has.has(p)) sg.nbr.add(p);
    sk.bones.forEach((b, i) => b.parent === sg.bone && has.has(i) && sg.nbr.add(i));
  }
  return segs;
}

/**
 * Distance from p to a bone segment, split into the part perpendicular to the bone and the part
 * beyond its ends. Overshoot is what stops a broad torso from claiming a hat brim above the neck.
 */
function segDist(p: V3, a: V3, b: V3): { perp: number; over: number } {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
  const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2;
  const perp = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
  const over = (t < 0 ? -t : t > 1 ? t - 1 : 0) * Math.sqrt(L2);
  return { perp, over };
}

/** the trunk is one blob: Hips, Spine, Chest and UpperChest share a thickness */
const TRUNK = new Set(['Hips', 'Spine', 'Chest', 'UpperChest']);
/** how much more a metre past a bone's end costs than a metre to its side */
const OVER = 2;

export function computeWeights(positions: Float64Array, triangles: Uint32Array, f: Fitted): SkinWeights {
  const sk: Skeleton = f.skeleton;
  const H = sk.dims.H;
  const segs = segments(f);
  const weld = weldIds(positions, H);
  const nU = weld.reduce((m, v) => Math.max(m, v), 0) + 1;
  const up = new Float64Array(nU * 3);
  for (let i = 0; i < weld.length; i++) up.set(positions.subarray(i * 3, i * 3 + 3), weld[i] * 3);

  // raw distances (side-gated)
  const S = segs.length;
  const P = new Float64Array(nU * S);
  const O = new Float64Array(nU * S);
  const sideTol = 0.015 * H;
  const neckY = sk.bones[sk.index.Neck].world[1];
  for (let v = 0; v < nU; v++) {
    const p: V3 = [up[v * 3], up[v * 3 + 1], up[v * 3 + 2]];
    for (let s = 0; s < S; s++) {
      const sg = segs[s];
      // collarbones never own anything above the base of the neck (jaws, ears, hair)
      if ((sg.side && sg.side * p[0] < -sideTol) || (sg.clavicle && p[1] > neckY)) {
        P[v * S + s] = Infinity;
        continue;
      }
      const d = segDist(p, sg.a, sg.b);
      P[v * S + s] = d.perp;
      O[v * S + s] = d.over;
    }
  }
  const raw = (v: number, s: number) => Math.hypot(P[v * S + s], O[v * S + s]);
  // pass 1: learn each bone's typical thickness from the vertices nearest to it
  const near: number[][] = segs.map(() => []);
  for (let v = 0; v < nU; v++) {
    let best = 0;
    for (let s = 1; s < S; s++) if (raw(v, s) < raw(v, best)) best = s;
    near[best].push(P[v * S + best]);
  }
  const median = (ds: number[]) => {
    if (!ds.length) return 0.03 * H;
    const a = [...ds].sort((x, y) => x - y);
    return Math.max(0.01 * H, a[Math.floor(a.length * 0.6)]);
  };
  const trunk = median(segs.flatMap((sg, i) => (TRUNK.has(sk.bones[sg.bone].name) ? near[i] : [])));
  const radius = segs.map((sg, i) => (TRUNK.has(sk.bones[sg.bone].name) ? trunk : median(near[i])));

  // pass 2: relative distance, soft blend with the winner's neighbours
  const Wt: Map<number, number>[] = [];
  for (let v = 0; v < nU; v++) {
    let best = 0;
    let bestE = Infinity;
    const E = new Float64Array(S);
    for (let s = 0; s < S; s++) {
      E[s] = (P[v * S + s] + OVER * O[v * S + s]) / radius[s];
      if (E[s] < bestE) {
        bestE = E[s];
        best = s;
      }
    }
    const m = new Map<number, number>();
    const allowed = segs[best].nbr;
    let sum = 0;
    for (let s = 0; s < S; s++) {
      if (!allowed.has(segs[s].bone) || !isFinite(E[s])) continue;
      const w = Math.exp(-(E[s] - bestE) / SOFT);
      if (w < 0.01) continue;
      m.set(segs[s].bone, (m.get(segs[s].bone) ?? 0) + w);
      sum += w;
    }
    for (const [k, w] of m) m.set(k, w / sum);
    Wt.push(m);
  }

  // smoothing over the welded surface graph
  const adj: Set<number>[] = Array.from({ length: nU }, () => new Set());
  for (let t = 0; t < triangles.length; t += 3) {
    const a = weld[triangles[t]];
    const b = weld[triangles[t + 1]];
    const c = weld[triangles[t + 2]];
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }
  let cur = Wt;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next: Map<number, number>[] = [];
    for (let v = 0; v < nU; v++) {
      const m = new Map<number, number>();
      for (const [k, w] of cur[v]) m.set(k, w * 0.5);
      const n = adj[v].size;
      if (!n) {
        next.push(cur[v]);
        continue;
      }
      for (const u of adj[v]) for (const [k, w] of cur[u]) m.set(k, (m.get(k) ?? 0) + (0.5 * w) / n);
      next.push(m);
    }
    cur = next;
  }

  // top 4, normalised, per original vertex
  const joints = new Uint8Array(weld.length * 4);
  const weights = new Float32Array(weld.length * 4);
  const packed = cur.map((m) => {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    return top.map(([k, w]) => [k, w / sum] as [number, number]);
  });
  for (let i = 0; i < weld.length; i++) {
    const top = packed[weld[i]];
    // renormalise after float32 rounding so the sum is exactly 1 within float precision
    let acc = 0;
    top.forEach(([k, w], j) => {
      joints[i * 4 + j] = k;
      const fw = j === top.length - 1 ? 1 - acc : Math.fround(w);
      weights[i * 4 + j] = fw;
      acc += Math.fround(w);
    });
  }
  return { joints, weights };
}
