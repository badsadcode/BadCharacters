/**
 * The naked, bald body: torso, neck, head (+ optional nose/ears), arms with mitten hands and
 * thumbs, legs with feet. Each part is a loft whose rings overlap their neighbours, so at rest
 * nothing shows a gap, and whose weights blend across joints, so in motion nothing tears.
 */
import { Part, ring, Ring, Weights } from './loft';
import { bodySpec } from './shell';
import { Rng, subSeed } from './rng';
import { add, clamp, cross, dot, lerp, norm, scale, sub, V3 } from './math';
import type { Skeleton } from './skeleton';
import { COVERS_NOSE, STYLES, type CharacterRecipe } from './recipe';
import { RACES } from './races';

export type PartMap = Record<string, Part>;

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];

export function weightsOf(sk: Skeleton, ...pairs: [string, number][]): Weights {
  return pairs.map(([n, w]) => [sk.index[n], w]);
}

/** cross-section frame for a limb travelling along `dir`: q ≈ up (or forward for vertical limbs). */
export function limbFrame(dir: V3, upHint: V3 = Y): { p: V3; q: V3 } {
  let q = sub(upHint, scale(dir, dot(upHint, dir)));
  if (Math.hypot(...q) < 1e-4) q = Z;
  q = norm(q);
  const p = norm(cross(q, dir));
  return { p, q };
}

export function buildBody(rc: CharacterRecipe, sk: Skeleton): PartMap {
  const d = sk.dims;
  const st = STYLES[rc.style];
  const def = st.definition;
  const W = (...pairs: [string, number][]) => weightsOf(sk, ...pairs);
  const n = d.n;
  const u = d.u;
  const tl = d.torsoLen;
  const parts: PartMap = {};
  const g = clamp(rc.body.gender);

  // ───────────────────────────────────────────────────────── torso (bottom → top)
  // p = +X, q = +Z (front). Bulges: fb = front, bb = back.
  const T = (y: number, a: number, b: number, w: Weights, tag: string, extra: Partial<Ring> = {}, z = 0) =>
    ring([0, y, z], X, Z, a, b, n, w, { tag, ...extra });
  const hy = d.hipY;
  parts.torso = {
    name: 'torso',
    material: 'skin',
    capStart: true,
    capEnd: true,
    rings: [
      T(hy - 0.09 * u, d.hipHW * 0.32, d.hipHD * 0.4, W(['Hips', 1]), 'bottom'),
      T(hy - 0.065 * u, d.hipHW * 0.74, d.hipHD * 0.84, W(['Hips', 1]), 'crotch', { bb: d.butt * 0.6 }),
      T(hy, d.hipHW, d.hipHD, W(['Hips', 1]), 'hip', { bb: d.butt }),
      T(hy + 0.2 * tl, lerp(d.hipHW, d.waistHW, 0.55), lerp(d.hipHD, d.waistHD, 0.5), W(['Hips', 0.55], ['Spine', 0.45]), 'lowWaist', { bb: d.butt * 0.35, fb: d.belly * 0.75 }),
      T(hy + 0.38 * tl, d.waistHW, d.waistHD, W(['Spine', 1]), 'waist', { fb: d.belly }),
      T(hy + 0.55 * tl, lerp(d.waistHW, d.chestHW, 0.65), lerp(d.waistHD, d.chestHD, 0.7), W(['Spine', 0.4], ['Chest', 0.6]), 'ribs', { fb: d.belly * 0.45 + d.breast * 0.25, fbDouble: d.breast > d.belly }),
      T(hy + 0.72 * tl, d.chestHW, d.chestHD, W(['Chest', 0.35], ['UpperChest', 0.65]), 'chest', { fb: d.breast + d.pecs, fbDouble: true }),
      T(hy + 0.86 * tl, lerp(d.chestHW, d.shoulderHW, 0.75), d.chestHD * 0.93, W(['UpperChest', 1]), 'armpit', { fb: (d.breast + d.pecs) * 0.35, fbDouble: true, bb: 0.01 * u * def }),
      T(d.neckBaseY - 0.03 * tl, d.shoulderHW, d.chestHD * lerp(0.92, 0.8, def), W(['UpperChest', 1]), 'shoulder'),
      T(d.neckBaseY + 0.015 * tl, d.shoulderHW * lerp(0.97, 0.75, def), d.chestHD * lerp(0.9, 0.62, def), W(['UpperChest', 1]), 'shoulderTop'),
      T(d.neckBaseY + 0.03 * tl, Math.max(d.neckR * 1.25, d.shoulderHW * lerp(0.9, 0, def)), Math.max(d.neckR * 1.15, d.chestHD * lerp(0.8, 0, def)), W(['UpperChest', 1]), 'neckBase'),
    ],
  };

  // ───────────────────────────────────────────────────────────────── neck
  const nz = -0.06 * d.headHD;
  parts.neck = {
    name: 'neck',
    material: 'skin',
    capStart: true,
    capEnd: true,
    rings: [
      T(d.neckBaseY - 0.04 * tl, d.neckR * 1.1, d.neckR * 1.05, W(['UpperChest', 1]), 'base', {}, nz),
      T(d.neckBaseY + 0.04 * tl, d.neckR, d.neckR * 0.95, W(['UpperChest', 0.3], ['Neck', 0.7]), 'low', {}, nz),
      T((d.neckBaseY + d.chinY) / 2 + 0.02 * tl, d.neckR * 0.95, d.neckR * 0.92, W(['Neck', 1]), 'mid', {}, nz),
      T(d.chinY + 0.2 * d.headH, d.neckR * 0.95, d.neckR * 0.9, W(['Neck', 0.2], ['Head', 0.8]), 'top', {}, nz),
    ],
  };

  // ───────────────────────────────────────────────────────────────── head
  const jaw = lerp(1, lerp(0.9, 0.82, g) + 0.1 * rc.body.fat, def) * d.jaw;
  const H = (t: number, aw: number, bd: number, z: number, tag: string) =>
    ring([0, d.chinY + t * d.headH, z * d.headHD], X, Z, d.headHW * aw, d.headHD * bd, n, W(['Head', 1]), { tag });
  parts.head = {
    name: 'head',
    material: 'face',
    capStart: true,
    capEnd: true,
    uv: { mode: 'head', y0: d.chinY, h: d.headH },
    rings: [
      H(0, jaw * lerp(0.97, 0.62, def), lerp(0.97, 0.6, def), lerp(0, 0.12, def), 'chin'),
      H(0.1, jaw * lerp(1, 0.9, def), lerp(1, 0.86, def), lerp(0, 0.06, def), 'jaw'),
      H(0.35, lerp(1, 0.97, def), lerp(1, 0.97, def), 0, 'cheek'),
      H(0.6, 1, 1, 0, 'brow'),
      H(0.86, lerp(1, 0.95, def), lerp(1, 0.95, def), 0, 'crown'),
      H(1, lerp(0.97, 0.6, def), lerp(0.97, 0.62, def), 0, 'top'),
    ],
  };

  // big-headed styles get proportionally smaller noses and ears, or chibis look like gnomes
  const featureScale = Math.min(1, 0.16 / (d.headH / d.H)) ** 0.7;
  if (rc.face.nose && !COVERS_NOSE.has(rc.outfit.mask?.id ?? 'none')) {
    const hh = d.headH * featureScale * d.noseScale;
    const ny = d.chinY + d.headH * (d.eyeLine - 0.13 * featureScale);
    const fz = d.headHD * lerp(1, 0.97, def);
    parts.nose = {
      name: 'nose',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        ring([0, ny + 0.02 * hh, fz * 0.82], X, Y, 0.06 * hh, 0.1 * hh, n, W(['Head', 1])),
        ring([0, ny, fz + 0.035 * hh], X, Y, 0.055 * hh, 0.075 * hh, n, W(['Head', 1])),
        ring([0, ny - 0.025 * hh, fz + 0.065 * hh], X, Y, 0.035 * hh, 0.04 * hh, n, W(['Head', 1])),
      ],
    };
  }
  if (rc.face.ears) {
    for (const s of [1, -1]) {
      const key = s > 0 ? 'ear.L' : 'ear.R';
      const ey = d.chinY + d.headH * (d.eyeLine - 0.06);
      const ex = d.headHW * lerp(1, 0.97, def);
      if (d.ears === 'round') {
        const hh = d.headH * featureScale * d.earScale;
        const p: V3 = [0, 0, -s];
        parts[key] = {
          name: 'ear',
          material: 'skin',
          capStart: true,
          capEnd: true,
          rings: [
            ring([s * ex * 0.85, ey, -0.08 * d.headHD], p, Y, 0.11 * hh, 0.16 * hh, n, W(['Head', 1])),
            ring([s * (ex + 0.025 * hh), ey, -0.1 * d.headHD], p, Y, 0.1 * hh, 0.15 * hh, n, W(['Head', 1])),
            ring([s * (ex + 0.045 * hh), ey + 0.01 * hh, -0.12 * d.headHD], p, Y, 0.06 * hh, 0.1 * hh, n, W(['Head', 1])),
          ],
        };
        continue;
      }
      // leaf ears: a flat, tapering blade. direction, length, width and which way the flat faces
      const spec = {
        pointed: { dir: [0.8, 0.5, -0.35], len: 0.3, wid: 0.13, face: [1, 0, 0.25] },
        elf: { dir: [0.55, 0.72, -0.45], len: 0.42, wid: 0.12, face: [1, 0, 0.15] },
        wide: { dir: [1, 0.22, -0.15], len: 0.42, wid: 0.17, face: [0.5, 0, 1] },
        bat: { dir: [0.8, 0.8, -0.05], len: 0.42, wid: 0.21, face: [0.3, 0, 1] },
      }[d.ears];
      const dir = norm([s * spec.dir[0], spec.dir[1], spec.dir[2]]);
      const faceN = norm([s * spec.face[0], spec.face[1], spec.face[2]]);
      const widthAxis = norm(cross(dir, faceN));
      const { p, q } = limbFrame(dir, widthAxis);
      const L = spec.len * d.headH * d.earScale;
      const Wd = spec.wid * d.headH * d.earScale ** 0.8;
      const th = 0.03 * d.headH * Math.sqrt(d.earScale);
      const base: V3 = [s * ex * 0.8, ey, -0.1 * d.headHD];
      const prof: [number, number][] = [[0, 0.75], [0.12, 1], [0.35, 0.95], [0.6, 0.68], [0.82, 0.33], [1, 0.03]];
      parts[key] = {
        name: 'ear',
        material: 'skin',
        capStart: true,
        capEnd: true,
        rings: prof.map(([t, w]) => ring(add(base, scale(dir, t * L)), p, q, th * (1 - 0.6 * t), Wd * w, 2.6, W(['Head', 1]))),
      };
    }
  }
  if (d.tusks) {
    for (const s of [1, -1]) {
      const hh = d.headH * featureScale;
      const tb: V3 = [s * d.headHW * 0.32, d.chinY + 0.1 * d.headH, d.headHD * 0.8];
      const tdir = norm([s * 0.18, 1, 0.3]);
      const { p, q } = limbFrame(tdir);
      const R = 0.035 * hh;
      parts[s > 0 ? 'tusk.L' : 'tusk.R'] = {
        name: 'tusk',
        material: 'tusk',
        capStart: true,
        capEnd: true,
        rings: [[-0.3, 1], [0.4, 0.85], [0.8, 0.45], [1, 0.05]].map(([t, w]) => ring(add(tb, scale(tdir, t * 0.17 * hh)), p, q, R * w, R * w, 2.4, W(['Head', 1]))),
      };
    }
  }

  // ───────────────────────────────────────────────────────────────── legs
  const legSpan = d.hipY - d.kneeY;
  const shinSpan = d.kneeY - d.ankleY;
  const legN = n;
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    const UL = `${side}UpperLeg`;
    const LL = `${side}LowerLeg`;
    const FT = `${side}Foot`;
    const x = sk.bones[sk.index[UL]].world[0];
    // travelling down (-Y): p = X, q = -Z would face backwards, so use p = -X … simpler: let loft fix winding
    const L = (y: number, xx: number, a: number, b: number, w: Weights, tag: string, extra: Partial<Ring> = {}) =>
      ring([xx, y, 0], X, Z, a, b, legN, w, { tag, ...extra });
    parts[s > 0 ? 'leg.L' : 'leg.R'] = {
      name: 'leg',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        L(d.hipY + 0.07 * u, x * 0.82, d.thighR * 0.8, d.thighR * 0.82, W(['Hips', 1]), 'top'),
        L(d.hipY - 0.07 * u, x, d.thighR, d.thighR * 0.98, W([UL, 0.8], ['Hips', 0.2]), 'thighTop'),
        L(d.hipY - 0.45 * legSpan, x, d.midThighR, d.midThighR * 0.98, W([UL, 1]), 'midThigh'),
        L(d.kneeY + 0.14 * legSpan, x, d.kneeR * 1.06, d.kneeR * 1.04, W([UL, 0.85], [LL, 0.15]), 'aboveKnee'),
        L(d.kneeY, x, d.kneeR, d.kneeR * 1.04, W([UL, 0.5], [LL, 0.5]), 'knee', { fb: d.kneeR * 0.08 * def }),
        L(d.kneeY - 0.12 * shinSpan, x, d.kneeR * 0.98, d.kneeR, W([LL, 0.85], [UL, 0.15]), 'belowKnee'),
        L(d.kneeY - 0.33 * shinSpan, x, d.calfR * 0.92, d.calfR, W([LL, 1]), 'calf', { bb: d.calfR * 0.22 * def }),
        L(d.kneeY - 0.72 * shinSpan, x, lerp(d.calfR, d.ankleR, 0.7), lerp(d.calfR, d.ankleR, 0.7), W([LL, 1]), 'shin'),
        L(d.ankleY * 1.5, x, d.ankleR, d.ankleR, W([LL, 0.75], [FT, 0.25]), 'ankle'),
        L(d.ankleY * 0.75, x, d.ankleR * 1.02, d.ankleR * 1.05, W([FT, 1]), 'end'),
      ],
    };

    // feet: travel +Z, p = X, q = Y. Sole on y = 0.
    const fl = d.footLen;
    const hw = d.footHW;
    const ay = d.ankleY;
    const TO = `${side}Toes`;
    const fn = Math.max(n, 3.2);
    const F = (z: number, a: number, h: number, w: Weights, tag: string) => ring([x, h, z * fl], X, Y, a * hw, h, fn, w, { tag });
    parts[s > 0 ? 'foot.L' : 'foot.R'] = {
      name: 'foot',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        F(-0.26, 0.62, ay * 0.55, W([FT, 1]), 'heel'),
        F(-0.18, 0.86, ay * 0.78, W([FT, 1]), 'back'),
        F(0.04, 0.95, ay * 0.86, W([FT, 1]), 'instep'),
        F(0.3, 1, ay * 0.58, W([FT, 0.75], [TO, 0.25]), 'arch'),
        F(0.52, 1.03, ay * 0.42, W([FT, 0.4], [TO, 0.6]), 'ball'),
        F(0.68, 0.96, ay * 0.32, W([TO, 1]), 'toes'),
        F(0.76, 0.62, ay * 0.22, W([TO, 1]), 'tip'),
      ],
    };
  }

  // ───────────────────────────────────────────────────────────────── arms
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    const am = s > 0 ? d.armL : d.armR;
    // per-side arm bulk (mutants); lengths stay with the skeleton
    const D = { ...d, deltR: d.deltR * am, upperArmR: d.upperArmR * am, elbowR: d.elbowR * am ** 0.8, foreArmR: d.foreArmR * am, wristR: d.wristR * am ** 0.8, handHW: d.handHW * am ** 0.7, handHT: d.handHT * am ** 0.7 };
    const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
    const { p, q } = limbFrame(dir);
    const SH = `${side}Shoulder`;
    const UA = `${side}UpperArm`;
    const LA = `${side}LowerArm`;
    const HA = `${side}Hand`;
    const sh = sk.bones[sk.index[UA]].world;
    const el = sk.bones[sk.index[LA]].world;
    const wr = sk.bones[sk.index[HA]].world;
    const ua = d.upperArmLen;
    const fa = d.foreArmLen;
    // p is horizontal (front/back), q vertical; a = width, b = thickness
    const A = (c: V3, a: number, b: number, w: Weights, tag: string) => ring(c, p, q, a, b, n, w, { tag });
    const at = (o: V3, t: number) => add(o, scale(dir, t));
    parts[s > 0 ? 'arm.L' : 'arm.R'] = {
      name: 'arm',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        A(at(sh, -D.deltR * 1.15), D.deltR * 0.85, D.deltR * 0.85, W([SH, 1]), 'top'),
        A(sh, D.deltR, D.deltR * 1.04, W([SH, 0.35], [UA, 0.65]), 'shoulder'),
        A(at(sh, 0.3 * ua), lerp(D.deltR, D.upperArmR, 0.6), lerp(D.deltR, D.upperArmR, 0.5), W([UA, 1]), 'deltoid'),
        A(at(sh, 0.62 * ua), D.upperArmR, D.upperArmR * 0.97, W([UA, 1]), 'bicep'),
        A(at(el, -0.12 * ua), D.elbowR * 1.05, D.elbowR * 1.02, W([UA, 0.85], [LA, 0.15]), 'aboveElbow'),
        A(el, D.elbowR, D.elbowR, W([UA, 0.5], [LA, 0.5]), 'elbow'),
        A(at(el, 0.13 * fa), D.foreArmR * 0.98, D.foreArmR * 0.92, W([LA, 0.85], [UA, 0.15]), 'belowElbow'),
        A(at(el, 0.36 * fa), D.foreArmR, D.foreArmR * 0.88, W([LA, 1]), 'forearm'),
        A(at(wr, -0.12 * fa), D.wristR * 1.08, D.wristR * 0.86, W([LA, 0.9], [HA, 0.1]), 'wristUp'),
        A(wr, D.wristR, D.wristR * 0.82, W([LA, 0.5], [HA, 0.5]), 'wrist'),
        A(at(wr, 0.12 * d.handLen), D.wristR * 0.95, D.wristR * 0.8, W([HA, 1]), 'end'),
      ],
    };

    // mitten hand — fingers would triple the triangle count for very little in a low-poly game
    const hl = d.handLen;
    const hw = D.handHW;
    const ht = D.handHT;
    const down = scale(q, -ht * 0.2);
    const Hd = (t: number, a: number, b: number, tag: string) => ring(add(at(wr, t * hl), down), p, q, a, b, Math.max(n, 2.6), W([HA, 1]), { tag });
    parts[s > 0 ? 'hand.L' : 'hand.R'] = {
      name: 'hand',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        Hd(-0.02, D.wristR * 0.92, D.wristR * 0.75, 'wrist'),
        Hd(0.16, hw * 0.9, ht * 1.1, 'palm'),
        Hd(0.46, hw, ht, 'knuckles'),
        Hd(0.76, hw * 0.94, ht * 0.82, 'fingers'),
        Hd(0.95, hw * 0.74, ht * 0.62, 'tips'),
        Hd(1.0, hw * 0.4, ht * 0.32, 'end'),
      ],
    };

    // thumb: from the side of the palm, pointing forward and along the arm
    const TH = `${side}ThumbProximal`;
    const tb = sk.bones[sk.index[TH]].world;
    const tdir = norm(add(scale(dir, 0.75), [0, -0.15, 0.65]));
    const tf = limbFrame(tdir);
    const tr = ht * 0.95;
    const tlen = hl * 0.45;
    const Tm = (t: number, a: number, w: Weights) => ring(add(tb, scale(tdir, t * tlen)), tf.p, tf.q, a, a * 0.9, Math.max(n, 2.6), w);
    parts[s > 0 ? 'thumb.L' : 'thumb.R'] = {
      name: 'thumb',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [Tm(-0.35, tr * 0.9, W([HA, 1])), Tm(0.05, tr, W([HA, 0.4], [TH, 0.6])), Tm(0.6, tr * 0.88, W([TH, 1])), Tm(0.95, tr * 0.62, W([TH, 1])), Tm(1.02, tr * 0.3, W([TH, 1]))],
    };
  }
  if (d.mutant) {
    const mr = new Rng(subSeed(rc.seed, 'mutant.growths'));
    const anchors: [string, V3][] = [
      ['UpperChest', [mr.range(-1, 1) * d.shoulderHW * 0.7, d.neckBaseY - 0.12 * tl, -d.chestHD * 0.9]],
      ['UpperChest', [mr.chance(0.5) ? d.shoulderHW * 0.8 : -d.shoulderHW * 0.8, d.neckBaseY - 0.02 * tl, -d.chestHD * 0.3]],
      ['Spine', [mr.range(-0.6, 0.6) * d.waistHW, d.hipY + 0.4 * tl, -d.waistHD * 0.95]],
      ['Head', [mr.range(-1, 1) * d.headHW * 0.8, d.chinY + 0.8 * d.headH, -d.headHD * 0.6]],
      ['Chest', [(mr.chance(0.5) ? 1 : -1) * d.chestHW * 0.98, d.hipY + 0.55 * tl, -d.chestHD * 0.1]], // side of the ribs (front-centre read as… something else)
    ];
    const count = mr.int(3, 5);
    for (let i = 0; i < count; i++) {
      const [bone, c] = anchors[i];
      const r0 = (0.035 + mr.next() * 0.035) * d.u;
      const blob: Part = {
        name: `growth.${i}`,
        material: 'growth',
        capStart: true,
        capEnd: true,
        lod: 'small',
        rings: [[-1, 0.3], [-0.5, 0.92], [0.2, 1], [0.75, 0.7], [1, 0.15]].map(([t, w]) => ring([c[0], c[1] + t * r0, c[2]], X, Z, r0 * w * mr.range(0.9, 1.15), r0 * w, 2.3, W([bone, 1]))),
      };
      parts[`growth.${i}`] = blob;
    }
    if (mr.chance(0.5)) {
      for (const s of [1, -1]) {
        const base: V3 = [s * d.headHW * 0.55, d.chinY + 0.92 * d.headH, d.headHD * 0.2];
        const hdir = norm([s * 0.55, 1, 0.25]);
        const { p, q } = limbFrame(hdir);
        const L = 0.28 * d.headH;
        parts[`horn.${s > 0 ? 'L' : 'R'}`] = {
          name: 'horn',
          material: 'horn',
          capStart: true,
          capEnd: true,
          lod: 'small',
          rings: [[-0.15, 1], [0.4, 0.7], [0.8, 0.35], [1, 0.04]].map(([t, w]) => {
            const bend = scale([0, 0, -1], t * t * 0.35 * L);
            return ring(add(add(base, scale(hdir, t * L)), bend), p, q, 0.07 * d.headH * w, 0.07 * d.headH * w, 2.4, W(['Head', 1]));
          }),
        };
      }
    }
  }
  // visible joints (Mannequin: wooden balls, Action Figure: toy pegs). Each is skinned 100% to the
  // child bone and centred on the pivot, so it turns in place and never drifts off the joint.
  if (st.joints) {
    const J = (name: string, bone: string, r: number, axis: V3) => {
      const c = sk.bones[sk.index[bone]].world;
      const w = W([bone, 1]);
      const { p, q } = limbFrame(norm(axis));
      // cheap on purpose: 6 sides, 2-3 rings (13 joints add ~300-450 triangles, not ~1000)
      const prof: [number, number][] = st.joints === 'ball' ? [[-1, 0.35], [0, 1], [1, 0.35]] : [[-1, 1], [1, 1]];
      const len = st.joints === 'ball' ? r : r * 1.25;
      const rr = st.joints === 'ball' ? r : r * 0.85;
      parts[name] = { name, material: 'joint', sides: 6, capStart: true, capEnd: true, rings: prof.map(([t, k]) => ring(add(c, scale(norm(axis), t * len)), p, q, rr * k, rr * k, st.joints === 'ball' ? 2.2 : 2, w)) };
    };
    J('joint.neck', 'Neck', d.neckR * 1.1, Y);
    for (const s of [1, -1]) {
      const side = s > 0 ? 'Left' : 'Right';
      const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
      const bend = cross([0, 0, 1], dir); // elbows and wrists bend about this axis
      J(`joint.shoulder.${side}`, `${side}UpperArm`, d.deltR * 1.08, dir);
      J(`joint.elbow.${side}`, `${side}LowerArm`, d.elbowR * 1.18, bend);
      J(`joint.wrist.${side}`, `${side}Hand`, d.wristR * 1.12, bend);
      J(`joint.hip.${side}`, `${side}UpperLeg`, d.thighR * 0.95, X);
      J(`joint.knee.${side}`, `${side}LowerLeg`, d.kneeR * 1.2, X);
      J(`joint.ankle.${side}`, `${side}Foot`, d.ankleR * 1.15, X);
    }
  }
  const race = RACES[rc.body.race ?? 'human'];
  if (race?.rocky || race?.sprout) {
    const rr = new Rng(subSeed(rc.seed, 'golem'));
    const add_ = (name: string, material: string, bone: string, c: V3, half: V3) => {
      parts[name] = { name, material, lod: 'box', capStart: true, capEnd: true, rings: [ring([c[0], c[1] - half[1], c[2]], X, Z, half[0], half[2], 40, W([bone, 1])), ring([c[0], c[1] + half[1], c[2]], X, Z, half[0], half[2], 40, W([bone, 1]))] };
    };
    if (race.rocky) {
      // rock chunks on the shoulders, back, forearms and head, with moss on the top surfaces
      const chunks: [string, V3, number][] = [
        ['UpperChest', [d.shoulderHW * 0.85, d.neckBaseY + 0.02 * tl, -d.chestHD * 0.1], 0.07],
        ['UpperChest', [-d.shoulderHW * 0.85, d.neckBaseY + 0.02 * tl, -d.chestHD * 0.1], 0.065],
        ['UpperChest', [d.chestHW * 0.35, d.hipY + 0.75 * tl, -d.chestHD * 1.0], 0.06],
        ['Chest', [-d.chestHW * 0.4, d.hipY + 0.5 * tl, -d.chestHD * 0.95], 0.055],
        ['Head', [d.headHW * 0.4, d.H - 0.02 * d.headH, -d.headHD * 0.3], 0.05],
      ];
      for (const s of [1, -1]) {
        const side = s > 0 ? 'Left' : 'Right';
        const fa = sk.bones[sk.index[`${side}LowerArm`]].world;
        const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
        chunks.push([`${side}LowerArm`, add(add(fa, scale(dir, d.foreArmLen * 0.45)), [0, d.foreArmR * 0.9, 0]), 0.045]);
      }
      chunks.forEach(([bone, c, size], i) => {
        const sz = size * d.u * rr.range(0.8, 1.2);
        add_(`rock.${i}`, 'rock', bone, c, [sz * rr.range(0.9, 1.3), sz * 0.7, sz * rr.range(0.8, 1.2)]);
        if (rr.chance(0.6)) add_(`moss.${i}`, 'moss', bone, [c[0], c[1] + sz * 0.72, c[2]], [sz * 0.8, sz * 0.12, sz * 0.75]);
      });
    }
    if (race.sprout) {
      // a little meadow on the head, leaves on the shoulders, a warm heartstone in the chest
      const top = d.H;
      for (let f = 0; f < 4; f++) {
        const fx = rr.range(-0.7, 0.7) * d.headHW;
        const fz = rr.range(-0.6, 0.6) * d.headHD;
        const ps = 0.06 * d.headH;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + f;
          add_(`petal.${f}.${k}`, 'petal', 'Head', [fx + Math.cos(a) * ps, top + 0.02 * d.headH, fz + Math.sin(a) * ps], [ps * 0.6, ps * 0.15, ps * 0.6]);
        }
        add_(`flower.${f}`, 'flowercore', 'Head', [fx, top + 0.035 * d.headH, fz], [ps * 0.45, ps * 0.2, ps * 0.45]);
      }
      for (const s of [1, -1]) {
        for (let k = 0; k < 3; k++) add_(`leaf.${s}.${k}`, 'leaf', 'UpperChest', [s * (d.shoulderHW * 0.7 + k * 0.03 * d.u), d.neckBaseY + 0.01 * tl, (k - 1) * 0.04 * d.u], [0.03 * d.u, 0.008 * d.u, 0.05 * d.u]);
      }
      add_('heartstone', 'heart', 'Chest', [0, d.hipY + 0.68 * tl, d.chestHD + 0.01 * d.u], [0.035 * d.u, 0.035 * d.u, 0.012 * d.u]);
    }
  }
  for (const [id, p] of Object.entries(parts)) bodySpec(id, p);
  // small parts get fewer sides around
  for (const id of Object.keys(parts)) if (/^(nose|ear|tusk|thumb|hand|foot)/.test(id)) parts[id].lod = 'small';
  return parts;
}
