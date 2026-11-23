/**
 * The other body plans: tentacled (kraken, jellies, observer), legged (crab, isopod, hatcher) and
 * rays (rift ray, lantern skate). Same rules as fish: lofts of rings, skin weights blended along
 * each chain, identity rest rotations, front = +Z.
 */
import { limbFrame } from '../core/body';
import { Part, ring, Ring, Weights } from '../core/loft';
import { add, lerp, norm, scale, sub, V3 } from '../core/math';
import { Channel, chainWeights, CreatureBuild, Rig } from './core';

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];

/** a tube along a polyline, skinned along a bone chain (one bone per point except the last) */
function chainTube(rig: Rig, name: string, material: string, pts: V3[], radii: number[], bones: string[], n = 2.5, up: V3 = Y, flat = 1): Part {
  const L = pts.reduce((s, p, i) => (i ? s + Math.hypot(...sub(p, pts[i - 1])) : 0), 0);
  let acc = 0;
  const ts = pts.map((p, i) => (i ? (acc += Math.hypot(...sub(p, pts[i - 1]))) / L : 0));
  // each bone's region starts at the path point nearest to the bone itself
  const joints: [string, number][] = bones.map((b) => {
    const bw = rig.bones[rig.index[b]].world;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.hypot(...sub(p, bw)) < Math.hypot(...sub(pts[best], bw))) best = i;
    });
    return [b, ts[best]];
  });
  const rings: Ring[] = pts.map((P, i) => {
    const tan = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const f = limbFrame(tan, up);
    return ring(P, f.p, f.q, radii[i], radii[i] * flat, n, chainWeights(rig, joints, ts[i]));
  });
  return { name, material, rings, capStart: true, capEnd: true, uv: { mode: 'wrap' } };
}

/** sample a smooth path through control points (Catmull-Rom), `count` points */
function smoothPath(ctrl: V3[], count: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i / (count - 1)) * (ctrl.length - 1);
    const k = Math.min(ctrl.length - 2, Math.floor(u));
    const t = u - k;
    const p0 = ctrl[Math.max(k - 1, 0)];
    const p1 = ctrl[k];
    const p2 = ctrl[k + 1];
    const p3 = ctrl[Math.min(k + 2, ctrl.length - 1)];
    const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

const box = (name: string, material: string, c: V3, half: V3, w: Weights): Part => ({
  name,
  material,
  lod: 'box',
  capStart: true,
  capEnd: true,
  rings: [ring([c[0], c[1] - half[1], c[2]], X, Z, half[0], half[2], 40, w), ring([c[0], c[1] + half[1], c[2]], X, Z, half[0], half[2], 40, w)],
});
const blob = (name: string, material: string, c: V3, r: number, w: Weights, squash = 1): Part => ({
  name,
  material,
  lod: 'small',
  capStart: true,
  capEnd: true,
  rings: [[-1, 0.15], [-0.65, 0.78], [0, 1], [0.65, 0.78], [1, 0.15]].map(([t, s]) => ring([c[0], c[1] + t * r * squash, c[2]], X, Z, r * s, r * s, 2.2, w)),
});

// ─────────────────────────────────────────────────────────────────────── tentacled
export interface TentacledSpec {
  length: number;
  body: { shape: 'octo' | 'bell' | 'orb'; h: number; r: number };
  arms: { count: number; len: number; r: number; segments: number; down: number; curl: number; suckers?: boolean; flat?: number };
  filaments?: { count: number; len: number };
  eyes: { kind: 'pair' | 'cyclops' | 'none'; size: number };
  translucent?: boolean;
  core?: boolean;
  cycle: number;
  temperament: 'Grazer' | 'Apex';
}

export function buildTentacled(s: TentacledSpec): CreatureBuild {
  const L = s.length;
  const R = s.body.r * L;
  const Hb = s.body.h * L;
  const rig = new Rig();
  rig.add('Body', null, [0, 0, 0]);
  const parts: Part[] = [];
  const bodyMat = s.translucent ? 'bell' : 'skin';
  // mantle / bell / orb: rings up the Y axis
  const shape: [number, number][] =
    s.body.shape === 'octo'
      ? [[0, 0.62], [0.12, 0.9], [0.35, 1.08], [0.6, 1.0], [0.82, 0.72], [0.95, 0.38], [1, 0.08]]
      : s.body.shape === 'bell'
        ? [[0, 1], [0.08, 1.04], [0.35, 0.98], [0.65, 0.78], [0.88, 0.45], [1, 0.08]]
        : [[0, 0.15], [0.12, 0.65], [0.35, 0.97], [0.6, 1.0], [0.85, 0.7], [1, 0.12]];
  const y0 = s.body.shape === 'orb' ? -Hb * 0.5 : -Hb * 0.15;
  parts.push({ name: 'body', material: bodyMat, uv: { mode: 'wrap' }, capStart: true, capEnd: true, rings: shape.map(([t, k]) => ring([0, y0 + t * Hb, s.body.shape === 'octo' ? -t * t * R * 0.5 : 0], X, Z, R * k, R * k, s.body.shape === 'orb' ? 2.6 : 2.4, rig.w(['Body', 1]))) });
  if (s.core) parts.push(blob('core', 'glow', [0, y0 + Hb * 0.35, 0], R * 0.45, rig.w(['Body', 1]), 0.8));

  // arms: radial, out and down, curling at the tips
  const swim: Channel[] = [];
  const chains: string[][] = [];
  const armBaseY = y0 + Hb * 0.04;
  for (let i = 0; i < s.arms.count; i++) {
    const a = (i / s.arms.count) * Math.PI * 2 + Math.PI / s.arms.count;
    const out: V3 = [Math.cos(a), 0, Math.sin(a)];
    const base: V3 = add([0, armBaseY, 0], scale(out, R * 0.55));
    const len = s.arms.len * L;
    const ctrl: V3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const horiz = len * (0.15 + 0.85 * t) * (1 - s.arms.down * 0.5);
      const drop = len * s.arms.down * t;
      const curlUp = len * s.arms.curl * t * t * t;
      ctrl.push(add(base, add(scale(out, horiz * t), [0, -drop + curlUp, 0])));
    }
    ctrl[0] = base;
    const pts = smoothPath(ctrl, s.arms.segments * 2 + 2);
    const bones: string[] = [];
    let parent = 'Body';
    for (let k = 0; k < s.arms.segments; k++) {
      const P = pts[Math.round((k / s.arms.segments) * (pts.length - 1))];
      const b = rig.add(`Tentacle${i}_${k}`, parent, P);
      bones.push(b);
      parent = b;
      // bend about the horizontal axis across this arm: split into pitch (X) and roll (Z)
      const ax: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const amp = 0.16 + 0.1 * k;
      swim.push({ bone: b, axis: 'pitch', amp: amp * ax[0], phase: k * 0.9 });
      swim.push({ bone: b, axis: 'roll', amp: amp * ax[2], phase: k * 0.9 });
    }
    chains.push(bones);
    const radii = pts.map((_, k) => s.arms.r * L * lerp(1, 0.12, k / (pts.length - 1)));
    const armPart = chainTube(rig, `arm.${i}`, 'skin', pts, radii, bones, 2.4, Y, s.arms.flat ?? 1);
    parts.push(armPart);
    if (s.arms.suckers) {
      for (let k = 2; k < pts.length - 2; k += 1) {
        const r = radii[k];
        const w = armPart.rings[k].w; // exactly the arm's own skin weights at this ring
        parts.push(box(`sucker.${i}.${k}`, 'suckers', add(pts[k], [0, -r * 0.92, 0]), [r * 0.38, r * 0.12, r * 0.38], w));
      }
    }
  }
  // thin filaments (jellies)
  if (s.filaments) {
    for (let i = 0; i < s.filaments.count; i++) {
      const a = (i / s.filaments.count) * Math.PI * 2;
      const base: V3 = [Math.cos(a) * R * 0.85, y0, Math.sin(a) * R * 0.85];
      const len = s.filaments.len * L;
      const b0 = rig.add(`Filament${i}_0`, 'Body', base);
      const b1 = rig.add(`Filament${i}_1`, b0, add(base, [0, -len * 0.5, 0]));
      swim.push({ bone: b0, axis: 'pitch', amp: 0.12 * -Math.sin(a), phase: 1.2 });
      swim.push({ bone: b0, axis: 'roll', amp: 0.12 * Math.cos(a), phase: 1.2 });
      swim.push({ bone: b1, axis: 'pitch', amp: 0.2 * -Math.sin(a), phase: 2.2 });
      swim.push({ bone: b1, axis: 'roll', amp: 0.2 * Math.cos(a), phase: 2.2 });
      const pts: V3[] = [base, add(base, [0, -len * 0.33, 0]), add(base, [0, -len * 0.66, 0]), add(base, [Math.cos(a) * len * 0.05, -len, Math.sin(a) * len * 0.05])];
      parts.push({ ...chainTube(rig, `filament.${i}`, 'glow', pts, [0.006 * L, 0.005 * L, 0.004 * L, 0.002 * L], [b0, b1], 2, Z), sides: 4 });
    }
  }
  // eyes
  if (s.eyes.kind === 'pair') {
    for (const sd of [1, -1]) parts.push(box(`eye.${sd}`, 'eye', [sd * R * 0.42, y0 + Hb * 0.22, R * 0.98], [s.eyes.size * L, s.eyes.size * L * 0.55, s.eyes.size * L * 0.3], rig.w(['Body', 1])));
  } else if (s.eyes.kind === 'cyclops') {
    const er = s.eyes.size * L;
    const c: V3 = [0, y0 + Hb * 0.55, R * 0.72];
    parts.push({ ...blob('eyeball', 'eyeball', c, er, rig.w(['Body', 1])), rings: [[-1, 0.15], [-0.6, 0.8], [0, 1], [0.6, 0.8], [1, 0.15]].map(([t, k]) => ring(add(c, [0, 0, t * er]), X, Y, er * k, er * k, 2.2, rig.w(['Body', 1]))) });
    parts.push(box('iris', 'iris', add(c, [0, 0, er * 0.96]), [er * 0.55, er * 0.55, er * 0.06], rig.w(['Body', 1])));
    parts.push(box('pupil', 'pupil', add(c, [0, 0, er * 1.02]), [er * 0.1, er * 0.42, er * 0.04], rig.w(['Body', 1])));
  }
  swim.push({ bone: 'Body', axis: 'pitch', amp: 0.04, phase: 0 });
  return {
    bones: rig.bones,
    index: rig.index,
    parts,
    motion: { cycle: s.cycle, swim, temperament: s.temperament, pulse: { bell: 'Body', tentacles: chains } },
    moveBone: 'Body',
    length: L,
    grounded: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────── legged
export interface LeggedSpec {
  length: number;
  body: { shape: 'crab' | 'isopod' | 'spider'; w: number; h: number; plates?: number };
  legs: { pairs: number; len: number; r: number; height: number };
  fangs?: number;
  eyes: { size: number };
  eggs?: number;
  antennae?: boolean;
  cycle: number;
  temperament: 'Grazer' | 'Apex';
}

export function buildLegged(s: LeggedSpec): CreatureBuild {
  const L = s.length;
  const BW = s.body.w * L;
  const BH = s.body.h * L;
  const lift = s.legs.height * L;
  const rig = new Rig();
  rig.add('Body', null, [0, lift, 0]);
  const parts: Part[] = [];
  // carapace along Z
  const prof: [number, number, number][] =
    s.body.shape === 'crab'
      ? [[0, 0.45, 0.5], [0.12, 0.85, 0.85], [0.4, 1, 1], [0.75, 0.85, 0.85], [1, 0.3, 0.35]]
      : s.body.shape === 'isopod'
        ? [[0, 0.45, 0.55], [0.08, 0.85, 0.85], [0.45, 1, 1], [0.85, 0.85, 0.8], [1, 0.4, 0.35]]
        : [[0, 0.5, 0.55], [0.2, 0.9, 0.9], [0.5, 1, 1], [0.8, 0.8, 0.8], [1, 0.2, 0.2]];
  const stations = s.body.plates ? s.body.plates * 2 + 2 : 10;
  const rings: Ring[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    let k = 0;
    while (k < prof.length - 2 && prof[k + 1][0] < t) k++;
    const f = (t - prof[k][0]) / (prof[k + 1][0] - prof[k][0]);
    let wk = lerp(prof[k][1], prof[k + 1][1], f);
    let hk = lerp(prof[k][2], prof[k + 1][2], f);
    if (s.body.plates) {
      const bump = 1 + 0.09 * Math.abs(Math.sin(s.body.plates * Math.PI * t));
      wk *= bump;
      hk *= bump;
    }
    // the shell sits on top: belly flatter than back
    rings.push(ring([0, lift + hk * BH * 0.15, (0.5 - t) * L * 0.62], X, Y, (wk * BW) / 2, (hk * BH) / 2, s.body.shape === 'isopod' ? 3.2 : 2.6, rig.w(['Body', 1])));
  }
  parts.push({ name: 'carapace', material: 'skin', uv: { mode: 'wrap' }, capStart: true, capEnd: true, rings });
  // legs: hip on the side, knee up and out, foot on the floor
  const legs: { upper: string; lower: string; side: 1 | -1; phase: number }[] = [];
  const swim: Channel[] = [];
  for (let i = 0; i < s.legs.pairs; i++) {
    const t = lerp(0.2, 0.8, s.legs.pairs === 1 ? 0.5 : i / (s.legs.pairs - 1));
    const zc = (0.5 - t) * L * 0.62;
    const fan = lerp(0.6, -0.6, s.legs.pairs === 1 ? 0.5 : i / (s.legs.pairs - 1));
    for (const sd of [1, -1] as const) {
      const side = sd > 0 ? 'L' : 'R';
      const len = s.legs.len * L;
      const hip: V3 = [sd * BW * 0.42, lift, zc];
      const knee: V3 = [sd * (BW * 0.42 + len * 0.42), lift + len * 0.32, zc + fan * len * 0.25];
      const foot: V3 = [sd * (BW * 0.42 + len * 0.8), 0, zc + fan * len * 0.5];
      const b0 = rig.add(`Leg${i}${side}_0`, 'Body', hip);
      const b1 = rig.add(`Leg${i}${side}_1`, b0, knee);
      const pts = [hip, add(hip, scale(sub(knee, hip), 0.5)), knee, add(knee, scale(sub(foot, knee), 0.5)), foot];
      const r = s.legs.r * L;
      parts.push({ ...chainTube(rig, `leg.${i}.${side}`, 'skin', pts, [r, r * 0.95, r * 0.8, r * 0.6, r * 0.15], [b0, b1], 3, Y), lod: 'small' });
      legs.push({ upper: b0, lower: b1, side: sd, phase: (i % 2 ? Math.PI : 0) + (sd > 0 ? 0 : Math.PI) });
    }
  }
  // face: fangs and eyes at the front
  const front = L * 0.31;
  for (let i = 0; i < (s.fangs ?? 0); i++) {
    const x = lerp(-BW * 0.18, BW * 0.18, s.fangs === 1 ? 0.5 : i / ((s.fangs ?? 1) - 1));
    const base: V3 = [x, lift - BH * 0.05, front];
    const dir = norm([0, -1, 0.35]);
    const f = limbFrame(dir);
    parts.push({ name: `fang.${i}`, material: 'teeth', sides: 4, capStart: true, capEnd: true, rings: [ring(base, f.p, f.q, BH * 0.06, BH * 0.06, 2, rig.w(['Body', 1])), ring(add(base, scale(dir, BH * 0.35)), f.p, f.q, 0.002, 0.002, 2, rig.w(['Body', 1]))] });
  }
  for (const sd of [1, -1]) parts.push(box(`eye.${sd}`, 'eye', [sd * BW * 0.16, lift + BH * 0.32, front - L * 0.01], [s.eyes.size * L, s.eyes.size * L * 0.6, s.eyes.size * L * 0.4], rig.w(['Body', 1])));
  if (s.antennae) {
    for (const sd of [1, -1]) {
      const base: V3 = [sd * BW * 0.12, lift + BH * 0.2, front];
      const pts = smoothPath([base, add(base, [sd * L * 0.05, L * 0.08, L * 0.12]), add(base, [sd * L * 0.15, L * 0.04, L * 0.25])], 5);
      parts.push({ ...chainTube(rig, `antenna.${sd}`, 'skin', pts, [L * 0.008, L * 0.006, L * 0.005, L * 0.004, L * 0.001], ['Body'], 2), sides: 4 });
    }
  }
  if (s.eggs) {
    for (let i = 0; i < s.eggs; i++) {
      const a = (i / s.eggs) * Math.PI * 2;
      const ring2 = i % 2 ? 0.55 : 0.25;
      parts.push(blob(`egg.${i}`, 'egg', [Math.cos(a) * BW * ring2, lift + BH * (0.75 + 0.2 * (i % 3)), Math.sin(a) * BW * ring2 - L * 0.05], BW * 0.17, rig.w(['Body', 1])));
    }
  }
  swim.push({ bone: 'Body', axis: 'roll', amp: 0.03, phase: 0 });
  return {
    bones: rig.bones,
    index: rig.index,
    parts,
    motion: { cycle: s.cycle, swim, temperament: s.temperament, walk: { legs, stride: 0.28 } },
    moveBone: 'Body',
    length: L,
    grounded: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────── rays
export interface RaySpec {
  length: number;
  span: number;
  tail: number;
  lanterns?: number;
  eyes: { size: number };
  cycle: number;
  temperament: 'Grazer' | 'Apex';
}

export function buildRay(s: RaySpec): CreatureBuild {
  const L = s.length;
  const half = (s.span * L) / 2;
  const rig = new Rig();
  rig.add('Body', null, [0, 0, 0]);
  for (const sd of [1, -1]) {
    const side = sd > 0 ? 'L' : 'R';
    rig.add(`Wing${side}1`, 'Body', [sd * half * 0.25, 0, -L * 0.05]);
    rig.add(`Wing${side}2`, `Wing${side}1`, [sd * half * 0.62, 0, -L * 0.16]);
  }
  const parts: Part[] = [];
  // the disc is lofted ACROSS the span (left tip → right tip) so the wings bend smoothly
  const rings: Ring[] = [];
  const st = 14;
  for (let i = 0; i <= st; i++) {
    const x = lerp(-half, half, i / st);
    const ax = Math.abs(x) / half;
    const chord = L * 0.62 * (1 - ax ** 1.4) + L * 0.02;
    const zc = L * 0.05 - ax * L * 0.22 - (1 - ax) * L * 0.08;
    const thick = L * 0.06 * (1 - ax) ** 1.5 + L * 0.004;
    const side = x >= 0 ? 'L' : 'R';
    const w: Weights = ax < 0.25 ? rig.w(['Body', 1]) : ax < 0.62 ? rig.w(['Body', 1 - (ax - 0.25) / 0.37], [`Wing${side}1`, (ax - 0.25) / 0.37]) : rig.w([`Wing${side}1`, 1 - (ax - 0.62) / 0.38], [`Wing${side}2`, (ax - 0.62) / 0.38]);
    rings.push(ring([x, 0, zc], Z, Y, chord / 2, thick, 2.2, w));
  }
  parts.push({ name: 'disc', material: 'skin', uv: { mode: 'wrap' }, capStart: true, capEnd: true, rings });
  // head bump and tail whip
  parts.push(blob('head', 'skin', [0, L * 0.02, L * 0.22], L * 0.07, rig.w(['Body', 1]), 0.6));
  const tailBones: string[] = [];
  let parent = 'Body';
  const tailLen = s.tail * L;
  const tpts: V3[] = [];
  for (let k = 0; k <= 4; k++) tpts.push([0, 0, -L * 0.25 - (k / 4) * tailLen]);
  for (let k = 0; k < 4; k++) {
    tailBones.push(rig.add(`Tail${k}`, parent, tpts[k]));
    parent = `Tail${k}`;
  }
  parts.push({ ...chainTube(rig, 'tail', 'fin', smoothPath(tpts, 8), [0.025, 0.02, 0.016, 0.012, 0.009, 0.006, 0.004, 0.001].map((r) => r * L), tailBones, 2.4, Y), lod: 'small' });
  for (const sd of [1, -1]) parts.push(box(`eye.${sd}`, 'eye', [sd * L * 0.05, L * 0.05, L * 0.24], [s.eyes.size * L, s.eyes.size * L * 0.5, s.eyes.size * L * 0.6], rig.w(['Body', 1])));
  for (let i = 0; i < (s.lanterns ?? 0); i++) {
    const x = lerp(-L * 0.14, L * 0.14, s.lanterns === 1 ? 0.5 : i / ((s.lanterns ?? 1) - 1));
    const base: V3 = [x, -L * 0.03, -L * 0.02 - Math.abs(x) * 0.6];
    const end: V3 = add(base, [x * 0.3, -L * 0.18, -L * 0.04]);
    parts.push({ ...chainTube(rig, `lantern.stalk.${i}`, 'fin', [base, add(base, scale(sub(end, base), 0.5)), end], [L * 0.006, L * 0.005, L * 0.004], ['Body'], 2), sides: 4 });
    parts.push(blob(`lantern.${i}`, 'glow', end, L * 0.025, rig.w(['Body', 1])));
  }
  const swim: Channel[] = [
    { bone: 'WingL1', axis: 'roll', amp: 0.3, phase: 0 },
    { bone: 'WingL2', axis: 'roll', amp: 0.42, phase: 0.7 },
    { bone: 'WingR1', axis: 'roll', amp: -0.3, phase: 0 },
    { bone: 'WingR2', axis: 'roll', amp: -0.42, phase: 0.7 },
    ...tailBones.map((b, k) => ({ bone: b, axis: 'yaw' as const, amp: 0.05 + 0.06 * k, phase: 0.5 + 0.7 * k, curl: 0.1 + 0.05 * k })),
    { bone: 'Body', axis: 'pitch', amp: 0.03, phase: 1 },
  ];
  return { bones: rig.bones, index: rig.index, parts, motion: { cycle: s.cycle, swim, temperament: s.temperament }, moveBone: 'Body', length: L * 0.35 + tailLen, grounded: false };
}

