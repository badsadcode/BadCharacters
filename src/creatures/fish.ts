/**
 * The fish body plan: sharks, serpents, anglers, gulpers, whales, lampreys, worms.
 *
 * A body is a loft along -Z from the snout (t = 0) to the tail base (t = 1). The head is split at
 * the mouth line: an upper skull (Head bone) and a lower jaw (Jaw bone) sculpted open at rest, with
 * a stretchy mouth cavity between them and teeth along both rims. Fins are thin diamond blades.
 */
import { limbFrame } from '../core/body';
import { Part, ring, Ring, Weights } from '../core/loft';
import { add, clamp, lerp, norm, qx, scale, V3 } from '../core/math';
import { Channel, chainWeights, CreatureBuild, Motion, Rig, rotateRing } from './core';

export interface FinSpec {
  /** where along the body (0 snout … 1 tail base) */
  t: number;
  /** height / length, as fractions of body length */
  h: number;
  /** chord (front-to-back size) at the base, fraction of length */
  len: number;
  /** how far the tip leans back, per unit height */
  sweep: number;
}

export interface FishSpec {
  length: number;
  /** body profile [t, height, width] as fractions of length; t 0 = snout, 1 = tail base */
  profile: [number, number, number][];
  /** cross-section exponent (2 round … 6 boxy) */
  n: number;
  /** belly sag of the centre line (fraction of length) */
  sag?: number;
  /** spine bones behind the body bone */
  segments: number;
  /** ripple the outline into segments (worms): [count, depth] */
  rings?: [number, number];
  mouth: {
    /** where the jaw hinge is (t) */
    end: number;
    /** rest gape (radians) */
    gape: number;
    /** mouth line height on the head, 0 = bottom … 1 = top */
    line: number;
    teeth: number;
    /** tooth length as a fraction of body length */
    tooth: number;
    /** lamprey: a round mouth ringed with teeth, no jaw */
    round?: boolean;
  };
  eyes: { t: number; up: number; size: number; count?: 1 | 2 };
  dorsal?: FinSpec[];
  /** a row of spines along the back */
  spines?: { from: number; to: number; count: number; h: number; sweep: number };
  pectoral?: { t: number; len: number; chord: number; down: number; back: number };
  pelvic?: { t: number; len: number; chord: number };
  anal?: FinSpec;
  caudal: { kind: 'shark' | 'fork' | 'fluke' | 'paddle' | 'none'; size: number };
  lure?: { len: number };
  frill?: { r: number; blades: number };
  gills?: number;
  /** anguilliform (serpent) or thunniform (shark) or pitch (whale) swimming */
  swim: 'serpent' | 'fish' | 'whale';
  cycle: number;
  temperament: 'Grazer' | 'Apex';
}

/** sample the profile at t: [height, width] (fractions of length) */
function prof(spec: FishSpec, t: number): [number, number] {
  const p = spec.profile;
  if (t <= p[0][0]) return [p[0][1], p[0][2]];
  for (let i = 0; i < p.length - 1; i++) {
    if (t <= p[i + 1][0]) {
      const f = (t - p[i][0]) / (p[i + 1][0] - p[i][0]);
      const s = f * f * (3 - 2 * f);
      return [lerp(p[i][1], p[i + 1][1], s), lerp(p[i][2], p[i + 1][2], s)];
    }
  }
  const l = p[p.length - 1];
  return [l[1], l[2]];
}

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

export function buildFish(spec: FishSpec): CreatureBuild {
  const L = spec.length;
  const T0 = 0.45; // the body bone sits here; it is the origin
  const z = (t: number) => L * (T0 - t);
  const yc = (t: number) => -(spec.sag ?? 0) * L * Math.sin(Math.PI * clamp(t));
  const dims = (t: number) => {
    let [h, w] = prof(spec, t);
    if (spec.rings) {
      const [count, depth] = spec.rings;
      const bump = 1 + depth * Math.abs(Math.sin(count * Math.PI * t));
      h *= bump;
      w *= bump;
    }
    return { a: (w * L) / 2, b: (h * L) / 2 };
  };
  const n = spec.n;
  const rig = new Rig();
  const m = spec.mouth;

  // ── skeleton: Body (origin) → Head (neck) → Jaw; Body → Spine1…n → Tail
  const tHead = clamp(m.end + 0.04, 0.05, 0.4);
  rig.add('Body', null, [0, yc(T0), 0]);
  rig.add('Head', 'Body', [0, yc(tHead), z(tHead)]);
  const hingeT = m.end;
  const mouthY = (t: number) => {
    const d = dims(t);
    return yc(t) - d.b + m.line * 2 * d.b;
  };
  const hinge: V3 = [0, mouthY(hingeT), z(hingeT)];
  if (!m.round) rig.add('Jaw', 'Head', hinge);
  const spineTs: number[] = [];
  for (let i = 1; i <= spec.segments; i++) spineTs.push(lerp(0.55, 0.95, (i - 1) / Math.max(1, spec.segments - 1)));
  let parent = 'Body';
  spineTs.forEach((t, i) => {
    rig.add(`Spine${i + 1}`, parent, [0, yc(t), z(t)]);
    parent = `Spine${i + 1}`;
  });
  rig.add('Tail', parent, [0, yc(1), z(1)]);
  const joints: [string, number][] = [['Head', 0], ['Body', tHead], ...spineTs.map((t, i) => [`Spine${i + 1}`, t] as [string, number]), ['Tail', 1]];
  const W = (t: number) => chainWeights(rig, joints, t);

  const parts: Part[] = [];
  const skin = (name: string, rings: Ring[], o: Partial<Part> = {}): Part => ({ name, material: 'skin', rings, capStart: true, capEnd: true, uv: { mode: 'wrap' }, ...o });

  // ── body: from inside the head to the tail base
  const bodyStations = Math.max(14, spec.segments * 3 + 8);
  const t0 = m.round ? 0 : m.end * 0.45;
  const bodyRings: Ring[] = [];
  for (let i = 0; i <= bodyStations; i++) {
    const t = lerp(t0, 1, i / bodyStations);
    const d = dims(t);
    bodyRings.push(ring([0, yc(t), z(t)], X, Y, d.a, d.b, n, W(t)));
  }
  // taper the very end into the tail
  const dT = dims(1);
  bodyRings.push(ring([0, yc(1), z(1) - 0.012 * L], X, Y, dT.a * 0.4, dT.b * 0.4, n, W(1)));
  parts.push(skin('body', bodyRings, { capStart: !m.round }));

  if (m.round) {
    // ── lamprey mouth: an open lip, a throat turned inside out, a ring of teeth pointing in
    const d0 = dims(0);
    const throat: Ring[] = [0, 0.02, 0.05, 0.09].map((t, i) => ring([0, yc(t), z(t) - 0.001], X, Y, d0.a * (0.86 - i * 0.16), d0.b * (0.86 - i * 0.16), n, W(t)));
    parts.push({ name: 'throat', material: 'mouth', rings: throat, capStart: false, capEnd: true, flipWinding: true });
    for (let k = 0; k < m.teeth; k++) {
      const a = (k / m.teeth) * Math.PI * 2;
      const base: V3 = [Math.cos(a) * d0.a * 0.84, yc(0) + Math.sin(a) * d0.b * 0.84, z(0) - 0.004 * L];
      const dir = norm([-Math.cos(a) * 0.8, -Math.sin(a) * 0.8, -0.6]);
      parts.push(tooth(`tooth.${k}`, base, dir, m.tooth * L, W(0)));
    }
  } else {
    // ── upper skull: from the snout to the hinge, above the mouth line
    const upper: Ring[] = [];
    const lower: Ring[] = [];
    const gap: Ring[] = [];
    const steps = 6;
    const q = qx(m.gape);
    for (let i = 0; i <= steps; i++) {
      const t = lerp(0.004, m.end * 1.08, i / steps);
      const d = dims(t);
      const tip = i === 0 ? 0.35 : 1;
      const top = yc(t) + d.b;
      const bot = yc(t) - d.b;
      const my = mouthY(t);
      upper.push(ring([0, (top + my) / 2, z(t)], X, Y, d.a * tip, ((top - my) / 2) * tip, n, rig.w(['Head', 1])));
      const lr = ring([0, (bot + my) / 2, z(t)], X, Y, d.a * 0.94 * tip, ((my - bot) / 2) * tip, n, rig.w(['Jaw', 1]));
      lower.push(rotateRing(lr, hinge, q));
      // the mouth cavity fills the gap; its top follows the skull, its bottom the jaw
      const jawTop = rotateRing(ring([0, my, z(t)], X, Y, 1, 1, n, []), hinge, q).c;
      const gb = Math.max(0.001 * L, (my - jawTop[1]) / 2);
      gap.push(ring([0, (my + jawTop[1]) / 2, (z(t) + jawTop[2]) / 2], X, Y, d.a * 0.88 * tip, gb * 0.98, n, rig.w(['Head', 0.5], ['Jaw', 0.5])));
    }
    parts.push(skin('skull', upper));
    parts.push(skin('jaw', lower));
    parts.push({ name: 'mouth', material: 'mouth', rings: gap.slice(1), capStart: true, capEnd: true, vertexWeights: (_i, _xn, yn) => (yn > 0 ? rig.w(['Head', 1]) : rig.w(['Jaw', 1])) });
    // teeth along both rims (bigger at the front)
    const tn = m.teeth;
    for (let k = 0; k < tn; k++) {
      const f = k / Math.max(1, tn - 1);
      // start where the snout reaches full width, so no tooth floats outside the jaw
      const t = lerp((m.end * 1.08) / steps, m.end * 0.9, f);
      const d = dims(t);
      const len = m.tooth * L * (1.15 - 0.55 * f);
      for (const s of [1, -1]) {
        const up: V3 = [s * d.a * 0.82, mouthY(t), z(t)];
        parts.push(tooth(`tooth.u.${k}.${s}`, up, norm([-s * 0.15, -1, 0.15]), len, rig.w(['Head', 1])));
        const lo = rotateRing(ring([s * d.a * 0.78, mouthY(t), z(t)], X, Y, 1, 1, n, []), hinge, q).c;
        const ldir = rotateRing(ring([0, 0, 0], X, norm([-s * 0.15, 1, 0.1]), 1, 1, n, []), [0, 0, 0], q).q;
        parts.push(tooth(`tooth.l.${k}.${s}`, lo, ldir, len * 0.85, rig.w(['Jaw', 1])));
      }
    }
  }

  // ── eyes
  const eyeD = dims(spec.eyes.t);
  const eyeY = yc(spec.eyes.t) + spec.eyes.up * eyeD.b;
  const dy = Math.min(0.95, Math.abs((eyeY - yc(spec.eyes.t)) / eyeD.b));
  const eyeX = eyeD.a * (1 - dy ** n) ** (1 / n);
  const es = spec.eyes.size * L;
  const eyeSides = spec.eyes.count === 1 ? [0] : [1, -1];
  for (const s of eyeSides) {
    const c: V3 = s === 0 ? [0, eyeY, z(spec.eyes.t) + eyeD.b * 0.2] : [s * eyeX, eyeY, z(spec.eyes.t)];
    // a glowing slit: long, short, barely proud of the skin
    const ex = s === 0 ? es : es * 0.3;
    const ez = s === 0 ? es * 0.3 : es;
    parts.push({ name: `eye.${s}`, material: 'eye', lod: 'box', capStart: true, capEnd: true, rings: [ring([c[0], c[1] - es * 0.45, c[2]], X, [0, 0, 1], ex, ez, 40, rig.w(['Head', 1])), ring([c[0], c[1] + es * 0.45, c[2]], X, [0, 0, 1], ex, ez, 40, rig.w(['Head', 1]))] });
  }

  // ── fins
  const topY = (t: number) => yc(t) + dims(t).b;
  const botY = (t: number) => yc(t) - dims(t).b;
  const blade = (name: string, base: V3, dir: V3, length: number, chord: number, chordHint: V3, w: Weights | ((i: number) => Weights), thick = 0.012, material = 'fin'): Part => {
    const { p, q } = limbFrame(dir, chordHint);
    const prof: [number, number][] = [[-0.12, 1], [0.3, 0.8], [0.7, 0.45], [1, 0.06]];
    return {
      name,
      material,
      sides: 4,
      capStart: true,
      capEnd: true,
      uv: { mode: 'wrap' },
      rings: prof.map(([t, c], i) => ring(add(base, scale(dir, t * length)), p, q, Math.max(0.002 * L, thick * L * c), (chord / 2) * c, 2, typeof w === 'function' ? w(i) : w)),
    };
  };
  for (const [i, f] of (spec.dorsal ?? []).entries()) {
    const base: V3 = [0, topY(f.t) - 0.15 * dims(f.t).b, z(f.t)];
    parts.push(blade(`dorsal.${i}`, base, norm([0, 1, -f.sweep]), f.h * L, f.len * L, [0, 0, 1], W(f.t)));
  }
  if (spec.spines) {
    const sp = spec.spines;
    for (let i = 0; i < sp.count; i++) {
      const t = lerp(sp.from, sp.to, i / Math.max(1, sp.count - 1));
      const h = sp.h * L * (1 - 0.5 * Math.abs(i / Math.max(1, sp.count - 1) - 0.35));
      parts.push(blade(`spine.${i}`, [0, topY(t) - 0.1 * dims(t).b, z(t)], norm([0, 1, -sp.sweep]), h, h * 0.9, [0, 0, 1], W(t)));
    }
  }
  if (spec.pectoral) {
    const pf = spec.pectoral;
    const d = dims(pf.t);
    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R';
      const base: V3 = [s * d.a * 0.7, yc(pf.t) - 0.35 * d.b, z(pf.t)];
      rig.add(`Fin${side}`, 'Body', base);
      const dir = norm([s, -pf.down, -pf.back]);
      parts.push(blade(`pectoral.${side}`, base, dir, pf.len * L, pf.chord * L, [0, 0, 1], (i) => (i === 0 ? rig.w(['Body', 0.5], [`Fin${side}`, 0.5]) : rig.w([`Fin${side}`, 1]))));
    }
  }
  if (spec.pelvic) {
    const pf = spec.pelvic;
    const d = dims(pf.t);
    for (const s of [1, -1]) parts.push(blade(`pelvic.${s}`, [s * d.a * 0.4, botY(pf.t) + 0.1 * d.b, z(pf.t)], norm([s * 0.5, -1, -0.6]), pf.len * L, pf.chord * L, [0, 0, 1], W(pf.t)));
  }
  if (spec.anal) {
    const f = spec.anal;
    parts.push(blade('anal', [0, botY(f.t) + 0.15 * dims(f.t).b, z(f.t)], norm([0, -1, -f.sweep]), f.h * L, f.len * L, [0, 0, 1], W(f.t)));
  }
  // ── tail fin
  const tb: V3 = [0, yc(1), z(1) + 0.01 * L];
  const cs = spec.caudal.size * L;
  const tw = rig.w(['Tail', 1]);
  if (spec.caudal.kind === 'shark') {
    parts.push(blade('caudal.upper', tb, norm([0, 0.95, -0.85]), cs, cs * 0.45, [0, 0, 1], tw));
    parts.push(blade('caudal.lower', tb, norm([0, -0.75, -0.75]), cs * 0.62, cs * 0.38, [0, 0, 1], tw));
  } else if (spec.caudal.kind === 'fork') {
    for (const s of [1, -1]) parts.push(blade(`caudal.${s}`, tb, norm([0, s * 0.85, -0.85]), cs, cs * 0.42, [0, 0, 1], tw));
  } else if (spec.caudal.kind === 'fluke') {
    for (const s of [1, -1]) parts.push(blade(`fluke.${s}`, tb, norm([s, 0.02, -0.55]), cs, cs * 0.5, [0, 0, 1], tw, 0.012));
  } else if (spec.caudal.kind === 'paddle') {
    parts.push(blade('caudal', tb, [0, 0, -1], cs, cs * 0.9, [0, 1, 0], tw));
  }

  // ── angler lure: a bent stalk and a glowing bulb
  if (spec.lure) {
    const lt = 0.06;
    const d = dims(lt);
    const base: V3 = [0, yc(lt) + d.b * 0.9, z(lt)];
    const Ll = spec.lure.len * L;
    const pts: V3[] = [base, add(base, [0, Ll * 0.55, -Ll * 0.05]), add(base, [0, Ll * 0.85, Ll * 0.3]), add(base, [0, Ll * 0.75, Ll * 0.62])];
    const r0 = 0.008 * L;
    parts.push({ name: 'lure.stalk', material: 'fin', lod: 'small', capStart: true, capEnd: true, rings: pts.map((P, i) => { const tan = norm(sub3(pts[Math.min(i + 1, 3)], pts[Math.max(i - 1, 0)])); const fr = limbFrame(tan, [0, 0, 1]); return ring(P, fr.p, fr.q, r0 * (1 - i * 0.2), r0 * (1 - i * 0.2), 2.4, rig.w(['Head', 1])); }) });
    const bc = add(pts[3], [0, -0.035 * L, 0.01 * L]);
    const br = 0.035 * L;
    parts.push({ name: 'lure.bulb', material: 'glow', lod: 'small', capStart: true, capEnd: true, rings: [[-1, 0.2], [-0.6, 0.85], [0, 1], [0.6, 0.85], [1, 0.2]].map(([t, w]) => ring([bc[0], bc[1] + t * br, bc[2]], X, [0, 0, 1], br * w, br * w, 2.2, rig.w(['Head', 1]))) });
  }

  // ── frill: a fan of blades around the back of the head
  if (spec.frill) {
    const ft = m.end + 0.03;
    const d = dims(ft);
    for (let i = 0; i < spec.frill.blades; i++) {
      const a = lerp(-0.85, 0.85, i / Math.max(1, spec.frill.blades - 1)) * Math.PI + Math.PI / 2; // around the top, not the belly
      const radial: V3 = [Math.cos(a), Math.sin(a), 0];
      const base: V3 = [radial[0] * d.a * 0.8, yc(ft) + radial[1] * d.b * 0.8, z(ft)];
      const dir = norm([radial[0], radial[1], -0.5]);
      // wide, overlapping blades read as one pleated fan (a frilled-lizard collar)
      parts.push(blade(`frill.${i}`, base, dir, spec.frill.r * L, spec.frill.r * L * 1.1, [0, 0, 1], rig.w(['Head', 0.7], ['Body', 0.3]), 0.006, 'frill'));
    }
  }
  // ── gill slits
  for (let i = 0; i < (spec.gills ?? 0); i++) {
    const t = m.end + 0.03 + i * 0.022;
    const d = dims(t);
    for (const s of [1, -1]) parts.push({ name: `gill.${i}.${s}`, material: 'mouth', lod: 'box', capStart: true, capEnd: true, rings: [ring([s * d.a * 0.99, yc(t) - d.b * 0.45, z(t)], X, [0, 0, 1], 0.004 * L, 0.004 * L, 40, W(t)), ring([s * d.a * 0.96, yc(t) + d.b * 0.35, z(t) - 0.012 * L], X, [0, 0, 1], 0.004 * L, 0.004 * L, 40, W(t))] });
  }

  // ── motion (Solitude channels)
  const swim: Channel[] = [];
  const spineBones = ['Body', ...spineTs.map((_, i) => `Spine${i + 1}`), 'Tail'];
  const k = spec.swim === 'serpent' ? 1.0 : 0.7;
  spineBones.forEach((b, i) => {
    const f = (i + 1) / spineBones.length;
    if (spec.swim === 'whale') swim.push({ bone: b, axis: 'pitch', amp: 0.02 + 0.14 * f ** 2, phase: i * k });
    else if (spec.swim === 'serpent') swim.push({ bone: b, axis: 'yaw', amp: 0.12 + 0.2 * f, phase: (i + 2) * k, curl: 0.2 + 0.15 * f });
    else swim.push({ bone: b, axis: 'yaw', amp: (0.02 + 0.3 * f ** 2.2) * (i === 0 ? 0.3 : 1), phase: i * k, curl: 0.1 + 0.25 * f });
  });
  // head counters the body so the eyes stay on target
  swim.push({ bone: 'Head', axis: spec.swim === 'whale' ? 'pitch' : 'yaw', amp: spec.swim === 'serpent' ? -0.12 : -0.04, phase: 0 });
  if (spec.pectoral) {
    swim.push({ bone: 'FinL', axis: 'roll', amp: 0.12, phase: 0.6 });
    swim.push({ bone: 'FinR', axis: 'roll', amp: -0.12, phase: 0.6 });
  }
  const motion: Motion = {
    cycle: spec.cycle,
    swim,
    temperament: spec.temperament,
    bodySway: spec.swim === 'serpent' ? 0.1 : 0,
    // absolute jaw angles (pitch about +X, positive = open); the rest pose is sculpted at `gape`
    jaw: m.round ? undefined : { bone: 'Jaw', rest: m.gape, open: m.gape + 0.3, closed: 0.02 },
  };
  return { bones: rig.bones, index: rig.index, parts, motion, moveBone: 'Body', length: L * (1 + 0.02) + cs * 0.6, grounded: false };
}

/** a 4-sided pyramid tooth: cheap and pointy */
function tooth(name: string, base: V3, dir: V3, len: number, w: Weights): Part {
  const { p, q } = limbFrame(dir);
  const r = len * 0.28;
  return {
    name,
    material: 'teeth',
    sides: 4,
    capStart: true,
    capEnd: true,
    rings: [ring(add(base, scale(dir, -len * 0.15)), p, q, r, r, 2, w), ring(add(base, scale(dir, len)), p, q, r * 0.04, r * 0.04, 2, w)],
  };
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
