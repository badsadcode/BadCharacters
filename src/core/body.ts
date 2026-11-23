/**
 * The naked, bald body: torso, neck, head (+ optional nose/ears), arms with mitten hands and
 * thumbs, legs with feet. Each part is a loft whose rings overlap their neighbours, so at rest
 * nothing shows a gap, and whose weights blend across joints, so in motion nothing tears.
 */
import { Part, ring, Ring, Weights } from './loft';
import { bodySpec } from './shell';
import { add, clamp, cross, dot, lerp, norm, scale, sub, V3 } from './math';
import type { Skeleton } from './skeleton';
import { STYLES, type CharacterRecipe } from './recipe';

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
  if (rc.face.nose) {
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
        A(at(sh, -d.deltR * 1.15), d.deltR * 0.85, d.deltR * 0.85, W([SH, 1]), 'top'),
        A(sh, d.deltR, d.deltR * 1.04, W([SH, 0.35], [UA, 0.65]), 'shoulder'),
        A(at(sh, 0.3 * ua), lerp(d.deltR, d.upperArmR, 0.6), lerp(d.deltR, d.upperArmR, 0.5), W([UA, 1]), 'deltoid'),
        A(at(sh, 0.62 * ua), d.upperArmR, d.upperArmR * 0.97, W([UA, 1]), 'bicep'),
        A(at(el, -0.12 * ua), d.elbowR * 1.05, d.elbowR * 1.02, W([UA, 0.85], [LA, 0.15]), 'aboveElbow'),
        A(el, d.elbowR, d.elbowR, W([UA, 0.5], [LA, 0.5]), 'elbow'),
        A(at(el, 0.13 * fa), d.foreArmR * 0.98, d.foreArmR * 0.92, W([LA, 0.85], [UA, 0.15]), 'belowElbow'),
        A(at(el, 0.36 * fa), d.foreArmR, d.foreArmR * 0.88, W([LA, 1]), 'forearm'),
        A(at(wr, -0.12 * fa), d.wristR * 1.08, d.wristR * 0.86, W([LA, 0.9], [HA, 0.1]), 'wristUp'),
        A(wr, d.wristR, d.wristR * 0.82, W([LA, 0.5], [HA, 0.5]), 'wrist'),
        A(at(wr, 0.12 * d.handLen), d.wristR * 0.95, d.wristR * 0.8, W([HA, 1]), 'end'),
      ],
    };

    // mitten hand — fingers would triple the triangle count for very little in a low-poly game
    const hl = d.handLen;
    const hw = d.handHW;
    const ht = d.handHT;
    const down = scale(q, -ht * 0.2);
    const Hd = (t: number, a: number, b: number, tag: string) => ring(add(at(wr, t * hl), down), p, q, a, b, Math.max(n, 2.6), W([HA, 1]), { tag });
    parts[s > 0 ? 'hand.L' : 'hand.R'] = {
      name: 'hand',
      material: 'skin',
      capStart: true,
      capEnd: true,
      rings: [
        Hd(-0.02, d.wristR * 0.92, d.wristR * 0.75, 'wrist'),
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
  for (const [id, p] of Object.entries(parts)) bodySpec(id, p);
  // small parts get fewer sides around
  for (const id of Object.keys(parts)) if (/^(nose|ear|tusk|thumb|hand|foot)/.test(id)) parts[id].lod = 'small';
  return parts;
}
