/**
 * Clothing = shells cut from the body's own rings and inflated outward by a layer thickness.
 * A sleeve is literally "arm rings 0 → elbow, plus 8 mm". Because the shell copies the body's
 * skin weights ring-for-ring, clothes bend exactly where the body bends. No cloth sim, no
 * poke-through at the knees, no tears. Only skirts and robes get special per-vertex weights so
 * they follow both legs.
 *
 * Layering (inner → outer): underwear/suit 1 · trousers 2 · shirt 3 · footwear/gloves 4 ·
 * belt 4.5 · vest 5–6 · armour 7+. Each layer is `e` metres thicker than the one below.
 */
import { anchor, inflateRing, lerpRing, mergeWeights, Part, ring, Ring, ringPoint, sampleRing, Weights } from './loft';
import { shell, ShellOpts } from './shell';
import { add, clamp, lerp, norm, qRotate, Quat, scale, sub, V3 } from './math';
import { buildClips, worldPose } from './anim';
import type { PartMap } from './body';
import { limbFrame, weightsOf } from './body';
import type { CharacterRecipe, SlotId } from './recipe';
import type { Skeleton } from './skeleton';
import { Rng, subSeed } from './rng';
import { buildProps } from './props';
import { buildMilitary } from './military';
import { buildExtras } from './extras';

const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

/**
 * How much a superellipse of exponent nOut must be scaled (same a:b aspect) to contain one of
 * exponent nIn. The worst point is the diagonal corner, so this is exact.
 */
export function encloseScale(nIn: number, nOut: number) {
  return nIn > nOut ? 2 ** (1 / nOut - 1 / nIn) : 1;
}

/** tag lookup with a fractional offset in ring units */
const K = (p: Part, tag: string, off = 0) => anchor(p.rings, tag) + off;
export const KTag = K;

/** head ring index for a fraction t of head height (head rings sit at t = 0, .1, .35, .6, .86, 1) */
export function headK(t: number) {
  const ts = [0, 0.1, 0.35, 0.6, 0.86, 1];
  if (t <= 0) return 0;
  for (let i = 0; i < ts.length - 1; i++) if (t <= ts[i + 1]) return i + (t - ts[i]) / (ts[i + 1] - ts[i]);
  return ts.length - 1;
}

export function buildClothing(rc: CharacterRecipe, sk: Skeleton, body: PartMap): Part[] {
  const d = sk.dims;
  const e = Math.max(0.006, 0.0075 * d.u * Math.sqrt(d.headH / (d.H / 7.3)));
  const out: Part[] = [];
  const o = rc.outfit;
  const W = (...p: [string, number][]) => weightsOf(sk, ...p);
  const mat = (slot: SlotId, accent = false) => `${slot}${accent ? '.2' : ''}`;
  const torso = body.torso;
  const sides = ['L', 'R'] as const;

  // ─────────────────────────────────────────────── helpers for common garment shapes
  const sleeves = (slot: SlotId, toTag: string, off: number, inflate: number, flare = 0) => {
    for (const s of sides) out.push(shell(`${slot}.sleeve.${s}`, body[`arm.${s}`], 0, K(body[`arm.${s}`], toTag, off), { material: mat(slot), inflate, flare, cuffEnd: true }));
  };
  const trouserLegs = (slot: SlotId, toTag: string, off: number, inflate: number, flare = 0) => {
    for (const s of sides) out.push(shell(`${slot}.leg.${s}`, body[`leg.${s}`], 0, K(body[`leg.${s}`], toTag, off), { material: mat(slot), inflate, flare, cuffEnd: true }));
  };
  const pelvis = (slot: SlotId, topTag: string, off: number, inflate: number) =>
    out.push(shell(`${slot}.pelvis`, torso, 0, K(torso, topTag, off), { material: mat(slot), inflate, capStart: true, cuffEnd: true }));
  const shirtBody = (slot: SlotId, fromTag: string, fromOff: number, toTag: string, toOff: number, inflate: number, extra: Partial<ShellOpts> = {}) =>
    out.push(shell(`${slot}.body`, torso, K(torso, fromTag, fromOff), K(torso, toTag, toOff), { material: mat(slot), inflate, cuffStart: true, cuffEnd: true, ...extra }));
  const band = (name: string, material: string, src: Part, k: number, halfWidth: number, inflate: number) =>
    out.push(shell(name, src, k - halfWidth, k + halfWidth, { material, inflate, cuffStart: true, cuffEnd: true }));

  /** skirt / robe / coat tail: a tube from the waist down that follows both legs */
  const skirt = (name: string, material: string, lengthY: number, inflate: number, flare: number) => {
    const top = sampleRing(torso.rings, K(torso, 'lowWaist', -0.2));
    const hip = sampleRing(torso.rings, K(torso, 'hip'));
    const hipY = d.hipY;
    const encl = Math.max(hip.a, d.hipJX + d.thighR * 1.05);
    const steps = 6;
    const y0 = hipY - 0.04 * d.u;
    const n = Math.max(2.4, d.n * 0.8);
    const shape: [number, number, number, number][] = [[hipY, hip.a, hip.b, 0]]; // y, a, b, flare progress
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      shape.push([lerp(y0, lengthY, t), encl + flare * t, Math.max(hip.b, d.thighR * 1.1) + flare * 0.7 * t, t]);
    }
    // everything a skirt must hide: torso, legs and any lower-body garment already built
    const inner: [number, number, number][] = [];
    const sample = (p: Part) => {
      for (const r of p.rings)
        for (let k = 0; k < 16; k++) {
          const [x, y] = ringPoint(r, (k / 16) * Math.PI * 2);
          inner.push(add(r.c, add(scale(r.p, x), scale(r.q, y))));
        }
    };
    sample(torso);
    for (const sd of sides) sample(body[`leg.${sd}`]);
    for (const g of out) if (/^(bottom|top)\.(pelvis|leg)/.test(g.name)) sample(g);
    const rings: Ring[] = [inflateRing(top, inflate)];
    shape.forEach(([y, a0, b0, t], i) => {
      // grow the planned cross-section until every point near this height is inside it
      const band = 0.6 * Math.abs((shape[Math.min(i + 1, shape.length - 1)][0] - shape[Math.max(i - 1, 0)][0]) / 2) + 1e-3;
      let k = 1;
      for (const P of inner) if (Math.abs(P[1] - y) <= band) k = Math.max(k, (Math.abs(P[0] / a0) ** n + Math.abs(P[2] / b0) ** n) ** (1 / n));
      // A-line: never narrower than the ring above (no hip bulge then pinch)
      const prev = i > 0 ? rings[rings.length - 1] : null;
      const a = Math.max(a0 * k + inflate, prev ? prev.a : 0);
      const b = Math.max(b0 * k + inflate, prev ? prev.b : 0);
      rings.push(ring([0, y, 0], X, Z, a, b, n, hip.w, { bb: (hip.bb ?? 0) * (1 - t) }));
    });
    const legSpan = d.hipY - d.kneeY;
    const part: Part = {
      name,
      material,
      rings: [...rings, { ...rings[rings.length - 1], a: rings[rings.length - 1].a - inflate - flare * 0.6, b: rings[rings.length - 1].b - inflate - flare * 0.4 }],
      vertexWeights: (_i, xn, _yn, r): Weights => {
        const follow = clamp((d.hipY - r.c[1]) / legSpan) * 0.75;
        if (follow <= 0.001) return r.w;
        const left = clamp(0.5 + xn * 0.9);
        return mergeWeights(W(['Hips', 1]), [...W(['LeftUpperLeg', left]), ...W(['RightUpperLeg', 1 - left])], follow);
      },
    };
    out.push(part);
  };

  /** sole slab under a foot */
  const soles = (slot: SlotId, thick: number, inflate: number) => {
    for (const s of sides) {
      const f = body[`foot.${s}`];
      out.push({
        name: `${slot}.sole.${s}`,
        material: mat(slot, true),
        capStart: true,
        capEnd: true,
        lod: 'small',
        // a sole only needs its outline: heel, instep, ball, toe
        rings: [0, 2, 4, 6].map((k) => f.rings[k]).map((r) => ({ ...r, c: [r.c[0], thick / 2 + 0.0005, r.c[2]] as V3, a: r.a + inflate + 0.002, b: thick / 2, n: Math.max(r.n, 4) })),
      });
    }
  };
  const footwear = (slot: SlotId, upTag: string, upOff: number, inflate: number) => {
    for (const s of sides) {
      const f = body[`foot.${s}`];
      // lift the shoe by its own thickness so the sole sits exactly on y = 0 (never under the floor)
      const lifted: Part = { ...f, rings: f.rings.map((r) => ({ ...r, c: [r.c[0], r.c[1] + inflate, r.c[2]] as V3 })) };
      out.push(shell(`${slot}.foot.${s}`, lifted, 0, f.rings.length - 1, { material: mat(slot), inflate, capStart: true, capEnd: true }));
      const leg = body[`leg.${s}`];
      out.push(shell(`${slot}.shaft.${s}`, leg, K(leg, upTag, upOff), leg.rings.length - 1, { material: mat(slot), inflate: inflate * 1.05, cuffStart: true, capEnd: true }));
    }
  };

  // ───────────────────────────────────────────────────────────────── bottom
  const b = o.bottom.id;
  if (b === 'briefs') {
    pelvis('bottom', 'hip', 0.45, e);
    trouserLegs('bottom', 'thighTop', 0.25, e);
  } else if (b === 'shorts') {
    pelvis('bottom', 'lowWaist', 0.3, 2 * e);
    trouserLegs('bottom', 'midThigh', 0.55, 2 * e, e * 1.5);
  } else if (b === 'pants') {
    pelvis('bottom', 'lowWaist', 0.3, 2 * e);
    trouserLegs('bottom', 'ankle', 0.1, 2 * e, e * 0.8);
  } else if (b === 'suit') {
    pelvis('bottom', 'lowWaist', 0.5, e);
    trouserLegs('bottom', 'ankle', 0.2, e);
  } else if (b === 'skirt') {
    pelvis('bottom', 'lowWaist', 0.2, e);
    skirt('bottom.skirt', mat('bottom'), d.kneeY + 0.35 * (d.hipY - d.kneeY), 2 * e, 0.05 * d.u);
  }

  // ──────────────────────────────────────────────────────────────────── top
  const t = o.top.id;
  if (t === 'bra') {
    shirtBody('top', 'ribs', -0.15, 'armpit', 0.25, e);
  } else if (t === 'tank') {
    shirtBody('top', 'hip', -0.15, 'shoulderTop', 0.1, 3 * e);
  } else if (t === 'tee') {
    shirtBody('top', 'hip', -0.25, 'neckBase', -0.3, 3 * e);
    sleeves('top', 'bicep', 0.45, 3 * e, e * 1.5);
  } else if (t === 'longsleeve' || t === 'suit') {
    const inf = t === 'suit' ? e : 3 * e;
    shirtBody('top', t === 'suit' ? 'lowWaist' : 'hip', t === 'suit' ? 0.3 : -0.25, 'neckBase', -0.2, inf);
    sleeves('top', 'wrist', -0.1, inf);
  } else if (t === 'tunic') {
    shirtBody('top', 'hip', -0.25, 'neckBase', -0.3, 3 * e);
    sleeves('top', 'wristUp', 0, 3 * e, e);
    skirt('top.skirt', mat('top'), d.hipY - 0.45 * (d.hipY - d.kneeY), 3 * e, 0.03 * d.u);
  } else if (t === 'robe') {
    shirtBody('top', 'hip', -0.25, 'neckBase', -0.25, 3 * e);
    sleeves('top', 'wrist', 0.1, 3 * e, 0.035 * d.u);
    skirt('top.skirt', mat('top'), d.ankleY * 1.3, 3 * e, 0.11 * d.u);
  } else if (t === 'coat') {
    shirtBody('top', 'hip', -0.25, 'neckBase', -0.1, 4 * e);
    sleeves('top', 'wrist', -0.1, 4 * e, e * 2);
    skirt('top.skirt', mat('top'), d.kneeY - 0.1 * (d.kneeY - d.ankleY), 4 * e, 0.06 * d.u);
    // lapel accent band
    band('top.collar', mat('top', true), torso, K(torso, 'shoulderTop', 0.2), 0.22, 5 * e);
  }
  if (t === 'suit') {
    band('top.trim.waist', mat('top', true), torso, K(torso, 'waist'), 0.06, e * 1.8);
    band('top.trim.collar', mat('top', true), torso, K(torso, 'neckBase', -0.25), 0.08, e * 2);
    for (const s of sides) band(`top.trim.elbow.${s}`, mat('top', true), body[`arm.${s}`], K(body[`arm.${s}`], 'elbow'), 0.12, e * 1.8);
    if (b === 'suit') for (const s of sides) band(`bottom.trim.knee.${s}`, mat('top', true), body[`leg.${s}`], K(body[`leg.${s}`], 'knee'), 0.15, e * 1.8);
  }

  // ─────────────────────────────────────────────────────────────────── feet
  const f = o.feet.id;
  if (f === 'sneakers') {
    footwear('feet', 'ankle', -0.15, 2.5 * e);
    soles('feet', d.ankleY * 0.28, 2.5 * e);
  } else if (f === 'boots') {
    footwear('feet', 'shin', -0.2, 4 * e);
    soles('feet', d.ankleY * 0.3, 4 * e);
  } else if (f === 'tallboots') {
    footwear('feet', 'belowKnee', 0, 4 * e);
    soles('feet', d.ankleY * 0.3, 4 * e);
    for (const s of sides) band(`feet.cuff.${s}`, mat('feet'), body[`leg.${s}`], K(body[`leg.${s}`], 'belowKnee', 0.12), 0.14, 6 * e);
  } else if (f === 'jungle') {
    // leather foot, canvas upper (accent colour)
    footwear('feet', 'ankle', 0.2, 4 * e);
    soles('feet', d.ankleY * 0.3, 4 * e);
    for (const s of sides) {
      const L = body[`leg.${s}`];
      out.push(shell(`feet.canvas.${s}`, L, K(L, 'shin', -0.3), K(L, 'ankle', 0.25), { material: mat('feet', true), inflate: 4.2 * e, cuffStart: true, cuffEnd: true }));
    }
  } else if (f === 'hikers') {
    footwear('feet', 'shin', 0.1, 4 * e);
    soles('feet', d.ankleY * 0.32, 4.5 * e);
    for (const s of sides) band(`feet.cuff.${s}`, mat('feet'), body[`leg.${s}`], K(body[`leg.${s}`], 'shin', 0.2), 0.16, 6.5 * e);
  } else if (f === 'sabatons') {
    footwear('feet', 'calf', 0.3, 5 * e);
    soles('feet', d.ankleY * 0.3, 5 * e);
  }

  // ────────────────────────────────────────────────────────────────── hands
  const h = o.hands.id;
  if (h === 'gloves' || h === 'gauntlets') {
    const inf = h === 'gauntlets' ? 3 * e : 1.5 * e;
    for (const s of sides) {
      const hand = body[`hand.${s}`];
      out.push(shell(`hands.hand.${s}`, hand, 0, hand.rings.length - 1, { material: mat('hands'), inflate: inf, capStart: true, capEnd: true }));
      const th = body[`thumb.${s}`];
      out.push(shell(`hands.thumb.${s}`, th, 0, th.rings.length - 1, { material: mat('hands'), inflate: inf, capStart: true, capEnd: true }));
      const arm = body[`arm.${s}`];
      const from = h === 'gauntlets' ? K(arm, 'forearm', -0.3) : K(arm, 'wristUp', -0.2);
      out.push(shell(`hands.cuff.${s}`, arm, from, arm.rings.length - 1, { material: mat('hands'), inflate: h === 'gauntlets' ? 5 * e : 4 * e, flare: h === 'gauntlets' ? -2 * e : 0, cuffStart: true, capEnd: true, nBoost: h === 'gauntlets' ? 2 : 0 }));
    }
  }

  // ────────────────────────────────────────────────────────────────── armor
  const a = o.armor.id;
  if (a === 'vest' || a === 'hivis') {
    shirtBody('armor', 'lowWaist', a === 'vest' ? -0.3 : 0, 'shoulder', 0.45, a === 'vest' ? 6 * e : 5 * e, { nBoost: a === 'vest' ? 2.5 : 0 });
    if (a === 'hivis') {
      band('armor.stripe.1', mat('armor', true), torso, K(torso, 'waist', 0.1), 0.07, 5.6 * e);
      band('armor.stripe.2', mat('armor', true), torso, K(torso, 'chest', -0.2), 0.07, 5.6 * e);
    } else {
      // pouches
      for (const s of [-1, 0, 1]) {
        const y = lerp(d.hipY, d.neckBaseY, 0.42);
        const z = sampleRing(torso.rings, K(torso, 'waist', 0.5)).b + 6 * e;
        const x = s * d.waistHW * 0.45;
        const pw = d.waistHW * 0.18;
        out.push(box(`armor.pouch.${s}`, mat('armor', true), [x, y, z + pw * 0.4], [pw, pw * 1.2, pw * 0.5], W(['Spine', 0.5], ['Chest', 0.5]), 3));
      }
    }
  } else if (a === 'chestplate' || a === 'plate') {
    shirtBody('armor', 'lowWaist', -0.1, 'shoulderTop', 0.35, 7 * e, { nBoost: 1.5 });
    if (a === 'plate') {
      for (const s of sides) {
        const arm = body[`arm.${s}`];
        out.push(shell(`armor.pauldron.${s}`, arm, 0.4, K(arm, 'deltoid', 0.4), { material: mat('armor'), inflate: 6 * e, flare: 3 * e, cuffEnd: true, nBoost: 1.5 }));
        out.push(shell(`armor.vambrace.${s}`, arm, K(arm, 'belowElbow', 0.1), K(arm, 'wristUp', -0.1), { material: mat('armor'), inflate: 4 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
        out.push(shell(`armor.rerebrace.${s}`, arm, K(arm, 'deltoid', 0.2), K(arm, 'aboveElbow', 0), { material: mat('armor'), inflate: 4.5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
        const leg = body[`leg.${s}`];
        out.push(shell(`armor.cuisse.${s}`, leg, K(leg, 'thighTop', 0.2), K(leg, 'aboveKnee', 0.1), { material: mat('armor'), inflate: 4 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
        out.push(shell(`armor.poleyn.${s}`, leg, K(leg, 'aboveKnee', 0.3), K(leg, 'belowKnee', -0.3), { material: mat('armor', true), inflate: 6 * e, cuffStart: true, cuffEnd: true, nBoost: 1 }));
        out.push(shell(`armor.greave.${s}`, leg, K(leg, 'belowKnee', 0.05), K(leg, 'shin', 0.6), { material: mat('armor'), inflate: 5.5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      }
      skirt('armor.fauld', mat('armor'), d.hipY - 0.32 * (d.hipY - d.kneeY), 6 * e, 0.03 * d.u);
    }
  }

  // ─────────────────────────────────────────────────────────────────── belt
  if (o.belt.id === 'belt' || o.belt.id === 'sash') {
    const sash = o.belt.id === 'sash';
    const k = K(torso, 'lowWaist', sash ? 0.15 : 0.05);
    band('belt.band', mat('belt'), torso, k, sash ? 0.2 : 0.09, 4.5 * e);
    const r = sampleRing(torso.rings, k);
    const bz = r.b + (r.fb ?? 0) + 4.5 * e;
    if (!sash) {
      const bs = Math.max(0.018 * d.u, (r.b * 0.25) / 1.5);
      out.push(box('belt.buckle', mat('belt', true), [0, r.c[1], bz + bs * 0.25], [bs * 1.3, bs, bs * 0.4], r.w));
    } else {
      // knot + hanging tails on the left hip
      const kx = r.a * 0.7;
      out.push(box('belt.knot', mat('belt'), [kx, r.c[1], bz * 0.85], [r.a * 0.15, r.a * 0.12, r.a * 0.12], r.w));
      out.push(box('belt.tail', mat('belt'), [kx * 1.05, r.c[1] - d.u * 0.09, bz * 0.82], [r.a * 0.1, d.u * 0.08, r.a * 0.05], r.w));
    }
  }

  // ─────────────────────────────────────────────────────────────────── neck
  if (o.neck.id === 'scarf') {
    out.push(shell('neck.scarf', body.neck, 0.4, 2.2, { material: mat('neck'), inflate: 3.5 * e + d.neckR * 0.25, cuffStart: true, cuffEnd: true }));
    band('neck.wrap', mat('neck'), torso, K(torso, 'neckBase', -0.4), 0.25, 3 * e + d.neckR * 0.2);
  }

  // ─────────────────────────────────────────────────────────────────── back
  const back = o.back.id;
  const chestR = sampleRing(torso.rings, K(torso, 'chest'));
  const backZ = -(chestR.b + 7 * e);
  const bw = W(['UpperChest', 0.6], ['Chest', 0.4]);
  if (back === 'backpack') {
    const hgt = (d.neckBaseY - d.hipY) * 0.55;
    const dep = d.chestHD * 0.6;
    const yc = d.hipY + (d.neckBaseY - d.hipY) * 0.58;
    out.push(box('back.pack', mat('back'), [0, yc, backZ - dep], [d.chestHW * 0.72, hgt / 2, dep], bw, 3));
    out.push(box('back.flap', mat('back', true), [0, yc + hgt * 0.32, backZ - dep * 1.05], [d.chestHW * 0.74, hgt * 0.2, dep * 1.03], bw, 3));
    out.push(box('back.pocket', mat('back', true), [0, yc - hgt * 0.2, backZ - dep * 2], [d.chestHW * 0.45, hgt * 0.17, dep * 0.25], bw, 3));
  } else if (back === 'rucksack') {
    const hgt = (d.neckBaseY - d.hipY) * 0.68;
    const dep = d.chestHD * 0.75;
    const yc = d.hipY + (d.neckBaseY - d.hipY) * 0.52;
    const pw = d.chestHW * 0.82;
    out.push(box('back.pack', mat('back'), [0, yc, backZ - dep], [pw, hgt / 2, dep], bw));
    out.push(box('back.flap', mat('back'), [0, yc + hgt * 0.36, backZ - dep * 1.02], [pw * 1.02, hgt * 0.17, dep * 1.04], bw));
    out.push(box('back.pocket', mat('back'), [0, yc - hgt * 0.18, backZ - dep * 2.05], [pw * 0.62, hgt * 0.2, dep * 0.28], bw));
    // bedroll across the top, plus a smaller roll on the side
    const rollR = Math.min(dep * 0.75, hgt * 0.2);
    out.push(tube('back.bedroll', mat('back', true), [0, yc + hgt / 2 + rollR * 0.9, backZ - dep], [1, 0, 0], rollR, pw * 2.3, bw));
    out.push(tube('back.sideroll', mat('back', true), [pw + rollR * 0.55, yc - hgt * 0.05, backZ - dep], [0, 1, 0], rollR * 0.6, hgt * 0.75, bw));
    // gold buckles and the shoulder straps that wrap over to the chest
    const bs = pw * 0.12;
    for (const s of [1, -1]) {
      out.push(box(`back.buckle.${s}`, mat('belt', true), [s * pw * 0.45, yc + hgt * 0.25, backZ - dep * 2.05], [bs, bs * 0.8, bs * 0.25], bw));
      const sx = s * d.chestHW * 0.48;
      const front = sampleRing(torso.rings, K(torso, 'chest'));
      const fz = front.b + (front.fb ?? 0) * 0.3 + 4.5 * e;
      const topY = sampleRing(torso.rings, K(torso, 'shoulderTop')).c[1];
      const sw = d.chestHW * 0.11;
      out.push(box(`back.strap.front.${s}`, mat('back'), [sx, lerp(d.hipY + 0.6 * (d.neckBaseY - d.hipY), topY, 0.5), fz], [sw, (topY - (d.hipY + 0.6 * (d.neckBaseY - d.hipY))) / 2, 0.012 * d.u], W(['UpperChest', 1])));
      out.push(box(`back.strap.top.${s}`, mat('back'), [sx, topY + 0.01 * d.u, (fz + backZ) / 2], [sw, 0.014 * d.u, (fz - backZ) / 2], W(['UpperChest', 1])));
    }
  } else if (back === 'jetpack') {
    const hgt = (d.neckBaseY - d.hipY) * 0.6;
    const yc = d.hipY + (d.neckBaseY - d.hipY) * 0.55;
    const r = d.chestHW * 0.3;
    for (const s of [1, -1]) {
      out.push(capsuleY(`back.tank.${s}`, mat('back'), [s * r * 1.15, yc, backZ - r], r, hgt, bw));
      out.push(capsuleY(`back.nozzle.${s}`, mat('back', true), [s * r * 1.15, yc - hgt / 2 - r * 0.25, backZ - r], r * 0.6, r * 0.9, bw));
    }
  } else if (back === 'quiver') {
    const hgt = (d.neckBaseY - d.hipY) * 0.95;
    const yc = d.hipY + (d.neckBaseY - d.hipY) * 0.6;
    const r = d.chestHW * 0.2;
    const tilt = norm([0.45, 1, 0]);
    out.push(tube('back.quiver', mat('back'), [0, yc, backZ - r], tilt, r, hgt, bw));
    out.push(tube('back.fletching', mat('back', true), add([0, yc, backZ - r], scale(tilt, hgt * 0.55)), tilt, r * 0.85, hgt * 0.15, bw));
  }

  // ─────────────────────────────────────────────────────────────────── head
  const head = body.head;
  const hd = o.head.id;
  const hh = d.headH;
  const headShell = (name: string, material: string, t0: number, t1: number, inflate: number, extra: Partial<ShellOpts> = {}) =>
    out.push(shell(name, head, headK(t0), headK(t1), { material, inflate, cuffStart: true, capEnd: t1 >= 1, ...extra }));
  const hw = W(['Head', 1]);
  const ring0 = (t: number) => sampleRing(head.rings, headK(t));
  out.push(...buildHair(rc, d, head, hw, hd !== 'none', ring0));
  out.push(...buildBeard(rc, d, head, hw, ring0));
  if (o.prop.id === 'staff' && rc.mesh.exportProps) out.push(...buildStaff(sk, rc));
  out.push(...buildProps(rc, sk));
  if (hd === 'beanie') {
    headShell('head.beanie', mat('head'), 0.56, 1, 3 * e);
    headShell('head.beanie.fold', mat('head'), 0.56, 0.68, 4.5 * e, { capEnd: false, cuffEnd: true });
  } else if (hd === 'cap') {
    headShell('head.cap', mat('head'), 0.62, 1, 2.5 * e);
    const r = ring0(0.64);
    out.push(slab('head.brim', mat('head', true), [0, d.chinY + 0.64 * hh, r.b * 0.75], r.a * 0.85, r.b * 0.62, 0.035 * hh, hw));
  } else if (hd === 'headband') {
    headShell('head.band', mat('head'), 0.66, 0.78, 2 * e, { capEnd: false, cuffEnd: true });
  } else if (hd === 'bandana') {
    headShell('head.bandana', mat('head'), 0.6, 1, 2 * e);
    out.push(box('head.knot', mat('head'), [0, d.chinY + 0.62 * hh, -(ring0(0.62).b + 2 * e)], [0.12 * hh, 0.08 * hh, 0.06 * hh], hw));
  } else if (hd === 'helmet') {
    headShell('head.helmet', mat('head'), 0.48, 1, 6 * e + 0.03 * hh, { nBoost: -Math.max(0, d.n - 2.6) });
    const r = ring0(0.5);
    out.push(slab('head.rim', mat('head'), [0, d.chinY + 0.5 * hh, 0], r.a + 6 * e + 0.06 * hh, r.b + 6 * e + 0.06 * hh, 0.03 * hh, hw));
    out.push(band2('head.strap', mat('head', true), head, headK(0.62), 0.04, 6.5 * e + 0.03 * hh));
  } else if (hd === 'hardhat') {
    headShell('head.hardhat', mat('head'), 0.6, 1, 4 * e + 0.04 * hh);
    const r = ring0(0.6);
    out.push(slab('head.brim', mat('head'), [0, d.chinY + 0.6 * hh, 0.08 * r.b], r.a + 0.16 * hh, r.b + 0.2 * hh, 0.03 * hh, hw));
  } else if (hd === 'wizard') {
    // the cone must swallow the whole upper head (boxy heads have corners!) plus any hair
    const base = 0.6;
    const pad = 0.025 * hh + (o.hair.id !== 'none' ? 0.05 * hh : 0) + e;
    const upper = head.rings.filter((r) => r.c[1] >= d.chinY + (base - 0.05) * hh);
    const nOut = 2.4;
    const A = Math.max(...upper.map((r) => r.a * encloseScale(r.n, nOut))) + pad;
    const B = Math.max(...upper.map((r) => r.b * encloseScale(r.n, nOut))) + pad;
    const y0 = d.chinY + base * hh;
    const yTop = d.chinY + hh + pad;
    out.push(slab('head.brim', mat('head'), [0, y0, 0], A * 1.75, B * 1.6, 0.03 * hh, hw, 2.2));
    const cone: Ring[] = [ring([0, y0 - 0.01 * hh, 0], X, Z, A, B, nOut, hw), ring([0, yTop, 0], X, Z, A * 0.97, B * 0.97, nOut, hw)];
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const tt = i / steps;
      const rad = 0.97 * (1 - tt) ** 1.2 + 0.03;
      const lean = 0.5 * hh * tt ** 2.2;
      cone.push(ring([0, yTop + tt * hh * 0.95, -lean], X, Z, A * rad, B * rad, nOut, hw));
    }
    out.push({ name: 'head.cone', material: mat('head'), rings: cone, capStart: true, capEnd: true });
    out.push(shell('head.hatband', { rings: cone.map((c) => ({ ...c })) }, 0.02, 0.45, { material: mat('head', true), inflate: 0.004 * d.u, cuffStart: true, cuffEnd: true }));
  } else if (hd === 'greathelm') {
    const hr = head.rings.map((r) => ({ ...r }));
    const ext: Ring = { ...hr[0], c: [hr[0].c[0], hr[0].c[1] - 0.12 * hh, hr[0].c[2]] as V3, a: hr[1].a, b: hr[1].b };
    const helm: Part = { ...head, id: undefined, spec: undefined, rings: [ext, { ...hr[1] }, ...hr.slice(2)] };
    out.push(shell('head.greathelm', helm, 0, helm.rings.length - 1, { material: mat('head'), inflate: 5 * e + 0.05 * hh, capStart: true, capEnd: true, nBoost: 3 }));
    const fz = ring0(d.eyeLine).b + 5 * e + 0.05 * hh;
    out.push(box('head.visor', 'visor', [0, d.chinY + d.eyeLine * hh, fz], [d.headHW * 0.78, 0.035 * hh, 0.006 * d.u + 0.004], hw));
    out.push(box('head.crest', mat('head', true), [0, d.chinY + 0.55 * hh, fz], [0.035 * hh, 0.4 * hh, 0.01 * d.u], hw));
  } else if (hd === 'crown') {
    headShell('head.crown', mat('head'), 0.8, 0.94, 3 * e, { capEnd: false, cuffEnd: true });
    const r = ring0(0.94);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const c: V3 = [Math.sin(ang) * (r.a + 3 * e), d.chinY + 0.94 * hh, Math.cos(ang) * (r.b + 3 * e)];
      out.push(spike(`head.spike.${i}`, mat('head'), c, 0.05 * hh, 0.16 * hh, hw));
    }
  } else if (hd === 'spacehelm') {
    // a glass bubble sized to contain every vertex of the head, nose, ears and hair
    const cy = d.chinY + 0.5 * hh;
    const cz = 0.04 * hh;
    let R = 0;
    for (const id of ['head', 'nose', 'ear.L', 'ear.R']) {
      const p = body[id];
      if (!p) continue;
      for (const r of p.rings)
        for (let k = 0; k < 16; k++) {
          const [x, y] = ringPoint(r, (k / 16) * Math.PI * 2);
          const P = add(r.c, add(scale(r.p, x), scale(r.q, y)));
          R = Math.max(R, Math.hypot(P[0], P[1] - cy, P[2] - cz));
        }
    }
    R = R * 1.06 + (o.hair.id !== 'none' ? 0.06 * hh : 0) + e;
    const rings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const th = -Math.PI / 2 + (Math.PI * i) / 8;
      const rr = Math.max(Math.cos(th), 0.02) * R;
      rings.push(ring([0, cy + Math.sin(th) * R, cz], X, Z, rr, rr, 2, hw));
    }
    rings[0] = { ...rings[1], c: [0, rings[1].c[1], cz], a: d.neckR * 1.6, b: d.neckR * 1.6 };
    out.push({ name: 'head.glass', material: 'glass', rings, capStart: true, capEnd: true });
    out.push(shell('head.collar', body.neck, 0, 1.6, { material: mat('head'), inflate: d.neckR * 0.6 + 4 * e, cuffStart: true, cuffEnd: true, nBoost: 0 }));
  }

  buildMilitary({ rc, sk, body, out, e });
  buildExtras({ rc, sk, body, out, e });

  // torn garments: rebuild every shell of that slot with jagged hems
  const rag = 0.035 * d.u;
  for (let j = 0; j < out.length; j++) {
    const p = out[j];
    const slot = p.material.split('.')[0] as SlotId;
    if (!o[slot]?.torn) continue;
    const sp = p.spec;
    if (sp && !sp.body && (sp.o.cuffEnd || sp.o.cuffStart)) {
      out[j] = { ...shell(p.name, { id: sp.src, rings: sp.rings, lod: p.lod }, sp.k0, sp.k1, { ...sp.o, ragged: rag }, sp.f0, sp.f1), vertexWeights: p.vertexWeights };
    } else if (p.vertexWeights) {
      // skirts and coats: tear the bottom ring
      out[j] = { ...p, ragged: { end: rag * 1.5, seed: j } };
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── primitives
/** an axis-aligned rounded box, as a loft along +Y */
/** an axis-aligned box: 8 corners, hard edges. `n` < 4 makes a rounded block instead (buns, pouches). */
export function box(name: string, material: string, c: V3, half: V3, w: Weights, n = 40): Part {
  const [hx, hy, hz] = half;
  const R = (y: number, s: number): Ring => ring([c[0], c[1] + y, c[2]], X, Z, hx * s, hz * s, n, w);
  if (n >= 4) return { name, material, capStart: true, capEnd: true, lod: 'box', rings: [R(-hy, 1), R(hy, 1)] };
  return { name, material, capStart: true, capEnd: true, lod: 'small', rings: [R(-hy, 0.85), R(-hy * 0.88, 1), R(hy * 0.88, 1), R(hy, 0.85)] };
}

/** flat disc / brim on the XZ plane */
export function slab(name: string, material: string, c: V3, a: number, b: number, thick: number, w: Weights, n = 2.6): Part {
  return { name, material, capStart: true, capEnd: true, rings: [ring([c[0], c[1] - thick / 2, c[2]], X, Z, a, b, n, w), ring([c[0], c[1] + thick / 2, c[2]], X, Z, a, b, n, w)] };
}

function capsuleY(name: string, material: string, c: V3, r: number, h: number, w: Weights): Part {
  const R = (y: number, s: number) => ring([c[0], c[1] + y, c[2]], X, Z, r * s, r * s, 2.3, w);
  return { name, material, capStart: true, capEnd: true, lod: 'small', rings: [R(-h / 2, 0.55), R(-h / 2 + r * 0.25, 0.95), R(h / 2 - r * 0.25, 0.95), R(h / 2, 0.55)] };
}

export function tube(name: string, material: string, c: V3, dir: V3, r: number, h: number, w: Weights): Part {
  const { p, q } = limbFrame(dir, Z);
  const R = (t: number, s: number) => ring(add(c, scale(dir, t)), p, q, r * s, r * s, 2.4, w);
  return { name, material, capStart: true, capEnd: true, lod: 'small', rings: [R(-h / 2, 0.9), R(-h / 2 + r * 0.2, 1), R(h / 2, 1), R(h / 2 + 0.001, 0.85)] };
}

function spike(name: string, material: string, base: V3, r: number, h: number, w: Weights): Part {
  const R = (t: number, s: number) => ring([base[0], base[1] + t * h, base[2]], X, Z, r * s, r * s, 2.2, w);
  return { name, material, capStart: true, capEnd: true, lod: 'small', rings: [R(-0.2, 1), R(0.3, 0.75), R(1, 0.05)] };
}

/** a band whose ring index k is already resolved */
function band2(name: string, material: string, src: Part, k: number, halfWidth: number, inflate: number): Part {
  return shell(name, src, k - halfWidth, k + halfWidth, { material, inflate, cuffStart: true, cuffEnd: true });
}

export { lerpRing };

// ─────────────────────────────────────────────────────────── hair & beards
// Voxel style: a cap shell plus seeded chunky blocks. Off by default (the brief: bald).
type RingAt = (t: number) => Ring;

export function mouthLine(d: Skeleton['dims']) {
  return Math.max(0.12, d.eyeLine - 0.28 * Math.min(1.2, d.faceScale * 0.9));
}

function buildHair(rc: CharacterRecipe, d: Skeleton['dims'], head: Part, w: Weights, hatted: boolean, at: RingAt): Part[] {
  const id = rc.outfit.hair.id;
  if (id === 'none') return [];
  const m = 'hair';
  const hh = d.headH;
  const r = new Rng(subSeed(rc.seed, 'hair'));
  const out: Part[] = [];
  const th = 0.045 * hh; // hair thickness
  const top = at(0.95);
  const back = at(0.6);
  const Y0 = d.chinY;
  if (!hatted) out.push(shell('hair.cap', head, headK(0.74), headK(1), { material: m, inflate: th, capEnd: true, cuffStart: true, nBoost: 1 }));
  // back block, from crown down to the nape (or the shoulders for long hair)
  const lowT = id === 'long' ? -0.25 : 0.4;
  const backZ = -(back.b + th * 0.5);
  out.push(box('hair.back', m, [0, Y0 + ((0.86 + lowT) / 2) * hh, backZ], [back.a + th * 0.6, ((0.86 - lowT) / 2) * hh, th * 0.9], w));
  // sideburns / side panels
  for (const s of [1, -1]) {
    const sideLow = id === 'long' ? -0.15 : 0.45;
    out.push(box(`hair.side.${s}`, m, [s * (back.a + th * 0.25), Y0 + ((0.84 + sideLow) / 2) * hh, -back.b * 0.4], [th * 0.45, ((0.84 - sideLow) / 2) * hh, back.b * 0.6], w));
  }
  if (hatted) return out;
  if (id === 'messy' || id === 'short') {
    // a fringe of chunky voxels along the front and a few tufts on top
    const n = id === 'messy' ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const fx = lerp(-1, 1, (i + 0.5) / n) * top.a * 0.85 + r.range(-0.03, 0.03) * hh;
      const sz = r.range(0.07, id === 'messy' ? 0.14 : 0.1) * hh;
      const fy = Y0 + r.range(0.84, 0.94) * hh;
      out.push(box(`hair.fringe.${i}`, m, [fx, fy, top.b * 0.82], [sz, sz * r.range(0.8, 1.3), sz * 0.9], w));
    }
    const tufts = id === 'messy' ? 5 : 2;
    for (let i = 0; i < tufts; i++) {
      const sz = r.range(0.07, 0.12) * hh;
      out.push(box(`hair.tuft.${i}`, m, [r.range(-0.7, 0.7) * top.a, Y0 + hh + th + sz * 0.3, r.range(-0.6, 0.5) * top.b], [sz * 1.2, sz * 0.6, sz], w));
    }
  } else if (id === 'mohawk') {
    for (let i = 0; i < 6; i++) {
      const z = lerp(0.85, -0.95, i / 5) * top.b;
      const hgt = (0.16 + 0.06 * Math.sin(i * 1.7)) * hh;
      out.push(box(`hair.mohawk.${i}`, m, [0, Y0 + hh + hgt / 2, z], [0.07 * hh, hgt / 2 + th, top.b * 0.18], w));
    }
  } else if (id === 'bun') {
    out.push(box('hair.bun', m, [0, Y0 + hh + th + 0.08 * hh, -top.b * 0.35], [0.14 * hh, 0.1 * hh, 0.14 * hh], w, 3));
  } else if (id === 'long') {
    for (let i = 0; i < 4; i++) {
      const fx = lerp(-1, 1, (i + 0.5) / 4) * top.a * 0.85;
      out.push(box(`hair.fringe.${i}`, m, [fx, Y0 + 0.9 * hh, top.b * 0.85], [top.a * 0.24, 0.08 * hh, 0.07 * hh], w));
    }
  }
  return out;
}

function buildBeard(rc: CharacterRecipe, d: Skeleton['dims'], head: Part, w: Weights, at: RingAt): Part[] {
  const id = rc.outfit.beard.id;
  if (id === 'none' || id === 'stubble') return []; // stubble is painted into the face texture
  const m = 'beard';
  const hh = d.headH;
  const mt = mouthLine(d);
  const Y0 = d.chinY;
  const out: Part[] = [];
  const front = at(mt);
  const th = 0.05 * hh;
  const fz = front.b + (front.fb ?? 0);
  // mustache sits just above the mouth line
  out.push(box('beard.mustache', m, [0, Y0 + (mt + 0.065) * hh, fz + th * 0.4], [front.a * 0.48, 0.04 * hh, th * 0.6], w));
  if (id === 'full') {
    out.push(shell('beard.jaw', head, 0, headK(mt - 0.03), { material: m, inflate: th, capStart: true, cuffEnd: true, nBoost: 1.5 }));
    out.push(box('beard.chin', m, [0, Y0 - 0.06 * hh, front.b * 0.45], [front.a * 0.82, 0.08 * hh, front.b * 0.6], w));
    for (const s of [1, -1]) out.push(box(`beard.cheek.${s}`, m, [s * (front.a + th * 0.2), Y0 + (mt + 0.08) * hh, front.b * 0.2], [th * 0.45, 0.12 * hh, front.b * 0.6], w));
  } else if (id === 'goatee') {
    out.push(box('beard.goatee', m, [0, Y0 + (mt - 0.1) * hh, fz + th * 0.2], [front.a * 0.3, 0.09 * hh, th * 0.7], w));
  }
  return out;
}

/**
 * Walking staff, rigidly skinned to the right hand. Its rest direction is solved backwards from
 * the Idle pose (forward kinematics), so when the character relaxes the staff stands vertical,
 * planted on the ground in front of the fist.
 */
function buildStaff(sk: Skeleton, rc: CharacterRecipe): Part[] {
  void rc;
  const d = sk.dims;
  const idle = buildClips(sk).find((c) => c.name === 'Idle')!.sample(0);
  const wp = worldPose(sk, idle);
  const hi = sk.index.RightHand;
  const qHand = wp.rot[hi];
  const inv: Quat = [-qHand[0], -qHand[1], -qHand[2], qHand[3]];
  const wr = sk.bones[hi].world;
  const armDir: V3 = [-d.armDir[0], d.armDir[1], 0];
  // grip: middle of the fist, nudged forward so the staff passes in front of the knuckles
  const gripRest = add(add(wr, scale(armDir, d.handLen * 0.55)), [0, 0, d.handHW * 0.9]);
  const gripIdle = add(wp.pos[hi], qRotate(qHand, sub(gripRest, wr)));
  const down = norm(qRotate(inv, [0, -1, 0])); // world "down" in the hand's rest frame
  const below = gripIdle[1];
  const above = d.H * 0.16;
  const len = below + above;
  const r = Math.max(0.016, d.handHT * 0.5);
  const w = weightsOf(sk, ['RightHand', 1]);
  const c = add(gripRest, scale(down, (below - above) / 2));
  return [
    tube('prop.staff', 'prop', c, down, r, len, w),
    tube('prop.knob', 'prop', add(gripRest, scale(down, -above - r)), down, r * 1.45, r * 3, w),
    tube('prop.wrap', 'prop.2', add(gripRest, scale(down, -above * 0.55)), down, r * 1.15, above * 0.35, w),
  ];
}
