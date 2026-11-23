/**
 * The military (and survival) wardrobe: era helmets and caps, face gear, uniforms, webbing,
 * vests, packs and leg wear, from the Great War to the not-so-great future. Same principle as
 * every other garment: shells of the body's own rings, boxes and tubes skinned to the bones
 * underneath, so it all bends where the body bends.
 */
import { box, encloseScale, headK, KTag, slab, tube } from './clothing';
import type { PartMap } from './body';
import { limbFrame, weightsOf } from './body';
import { Part, ring, Ring, ringPoint, sampleRing, Weights } from './loft';
import { add, lerp, norm, scale, sub, V3 } from './math';
import type { CharacterRecipe, SlotId } from './recipe';
import { shell, ShellOpts } from './shell';
import type { Skeleton } from './skeleton';

const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

export interface WardrobeCtx {
  rc: CharacterRecipe;
  sk: Skeleton;
  body: PartMap;
  out: Part[];
  /** layer thickness unit (metres) */
  e: number;
}

export function buildMilitary(c: WardrobeCtx) {
  const { rc, sk, body, out, e } = c;
  const d = sk.dims;
  const o = rc.outfit;
  const W = (...p: [string, number][]) => weightsOf(sk, ...p);
  const mat = (slot: SlotId, accent = false) => `${slot}${accent ? '.2' : ''}`;
  const torso = body.torso;
  const head = body.head;
  const hh = d.headH;
  const hw = W(['Head', 1]);
  const sides = ['L', 'R'] as const;
  const at = (t: number) => sampleRing(head.rings, headK(t));
  const tk = (tag: string, off = 0) => KTag(torso, tag, off);
  const id = (slot: SlotId) => o[slot]?.id ?? 'none';

  /** z of the torso's front surface at fractional ring k, lateral fraction xf (-1..1), plus `lift` */
  const frontZ = (k: number, xf: number, lift = 0) => {
    const r = sampleRing(torso.rings, k);
    const xn = Math.min(0.98, Math.abs(xf));
    const z = r.b * (1 - xn ** r.n) ** (1 / r.n) + (r.fb ?? 0) * Math.max(0, 1 - xn * xn) ** 1.2;
    return { y: r.c[1], x: xf * r.a, z: r.c[2] + z + lift, r };
  };
  const backZ = (k: number, lift = 0) => {
    const r = sampleRing(torso.rings, k);
    return r.c[2] - r.b - (r.bb ?? 0) * 0.5 - lift;
  };
  const shellOf = (name: string, src: Part, k0: number, k1: number, o2: ShellOpts) => out.push(shell(name, src, k0, k1, o2));
  const headShell = (name: string, material: string, t0: number, t1: number, inflate: number, extra: Partial<ShellOpts> = {}) =>
    shellOf(name, head, headK(t0), headK(t1), { material, inflate, cuffStart: true, capEnd: t1 >= 1, ...extra });
  const sleeves = (slot: SlotId, toTag: string, off: number, inflate: number, flare = 0) => {
    for (const s of sides) shellOf(`${slot}.sleeve.${s}`, body[`arm.${s}`], 0, KTag(body[`arm.${s}`], toTag, off), { material: mat(slot), inflate, flare, cuffEnd: true });
  };
  const legsTo = (slot: SlotId, toTag: string, off: number, inflate: number, flare = 0, name = 'leg') => {
    for (const s of sides) shellOf(`${slot}.${name}.${s}`, body[`leg.${s}`], 0, KTag(body[`leg.${s}`], toTag, off), { material: mat(slot), inflate, flare, cuffEnd: true });
  };
  const legBand = (name: string, material: string, fromTag: string, fromOff: number, toTag: string, toOff: number, inflate: number, nBoost = 0) => {
    for (const s of sides) {
      const L = body[`leg.${s}`];
      shellOf(`${name}.${s}`, L, KTag(L, fromTag, fromOff), KTag(L, toTag, toOff), { material, inflate, cuffStart: true, cuffEnd: true, nBoost });
    }
  };
  const torsoShell = (name: string, material: string, fromTag: string, fromOff: number, toTag: string, toOff: number, inflate: number, extra: Partial<ShellOpts> = {}) =>
    shellOf(name, torso, tk(fromTag, fromOff), tk(toTag, toOff), { material, inflate, cuffStart: true, cuffEnd: true, ...extra });
  const pocket = (name: string, material: string, k: number, xf: number, lift: number, size: number, w: Weights) => {
    const f = frontZ(k, xf, lift);
    out.push(box(name, material, [f.x, f.y, f.z + size * 0.3], [size, size * 1.15, size * 0.35], w));
  };
  const chestW = W(['Chest', 0.4], ['UpperChest', 0.6]);
  const waistW = W(['Spine', 0.6], ['Hips', 0.4]);

  // ─────────────────────────────────────────────────────────────── helmets & caps
  const hd = id('head');
  const hairPad = o.hair?.id !== 'none' ? 0.05 * hh : 0;
  /** a dome that encloses the head from t0 upward, with exponent n */
  const dome = (name: string, material: string, t0: number, pad: number, n: number, flat = 0.0) => {
    const upper = head.rings.filter((r) => r.c[1] >= d.chinY + (t0 - 0.06) * hh);
    const A = Math.max(...upper.map((r) => r.a * encloseScale(r.n, n))) + pad;
    const B = Math.max(...upper.map((r) => r.b * encloseScale(r.n, n))) + pad;
    const y0 = d.chinY + t0 * hh;
    const top = d.chinY + hh + pad * 0.8;
    const rings: Ring[] = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s = Math.cos(t * Math.PI * 0.5) ** (0.45 + flat);
      rings.push(ring([0, lerp(y0, top + pad * 0.6, Math.sin(t * Math.PI * 0.5)), 0], X, Z, Math.max(A * s, 0.01 * hh), Math.max(B * s, 0.01 * hh), n, hw));
    }
    out.push({ name, material, rings, capStart: true, capEnd: true });
    return { A, B, y0 };
  };
  if (hd === 'brodie') {
    const h = dome('head.brodie', mat('head'), 0.66, 0.035 * hh + hairPad + e, 2.4, 0.6);
    out.push(slab('head.brodie.brim', mat('head'), [0, h.y0, 0], h.A * 1.55, h.B * 1.5, 0.025 * hh, hw, 2.2));
  } else if (hd === 'stahlhelm') {
    const h = dome('head.stahlhelm', mat('head'), 0.5, 0.045 * hh + hairPad + e, 2.6);
    // the flared skirt over the ears and neck
    out.push({ name: 'head.stahlhelm.skirt', material: mat('head'), rings: [ring([0, h.y0 + 0.02 * hh, 0], X, Z, h.A * 0.99, h.B * 0.99, 2.6, hw), ring([0, h.y0 - 0.12 * hh, -0.04 * hh], X, Z, h.A * 1.1, h.B * 1.12, 2.6, hw), ring([0, h.y0 - 0.12 * hh, -0.04 * hh], X, Z, h.A * 1.02, h.B * 1.04, 2.6, hw)] });
  } else if (hd === 'm1') {
    const h = dome('head.m1', mat('head'), 0.52, 0.05 * hh + hairPad + e, 2.3);
    out.push(slab('head.m1.rim', mat('head'), [0, h.y0, 0.02 * hh], h.A * 1.08, h.B * 1.1, 0.03 * hh, hw, 2.3));
    out.push(...strap('head.m1.strap', mat('head', true), h.y0));
  } else if (hd === 'modern') {
    const h = dome('head.modern', mat('head'), 0.56, 0.05 * hh + hairPad + e, 2.6);
    // NVG mount on the front, rails on the sides
    out.push(box('head.modern.nvg', mat('head', true), [0, h.y0 + 0.2 * hh, h.B * 0.92], [0.1 * hh, 0.07 * hh, 0.04 * hh], hw));
    for (const s of [1, -1]) out.push(box(`head.modern.rail.${s}`, mat('head', true), [s * h.A * 0.97, h.y0 + 0.12 * hh, 0], [0.02 * hh, 0.04 * hh, h.B * 0.45], hw));
    out.push(...strap('head.modern.strap', mat('head', true), h.y0));
  } else if (hd === 'visorhelm') {
    const pad = 0.06 * hh + hairPad + e;
    const n = 2.6;
    const A = Math.max(...head.rings.map((r) => r.a * encloseScale(r.n, n))) + pad;
    const B = Math.max(...head.rings.map((r) => r.b * encloseScale(r.n, n))) + pad;
    const rings: Ring[] = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const y = lerp(d.chinY - 0.08 * hh, d.chinY + hh + pad, t);
      const s = Math.min(1, Math.sin((0.25 + 0.75 * t) * Math.PI) * 1.25 + 0.15);
      rings.push(ring([0, y, 0.02 * hh], X, Z, A * s, B * s, n, hw));
    }
    out.push({ name: 'head.visorhelm', material: mat('head'), rings, capStart: true, capEnd: true });
    out.push(box('head.visor.glow', 'visorglow', [0, d.chinY + d.eyeLine * hh, B * 0.97 + 0.02 * hh], [A * 0.75, 0.07 * hh, 0.02 * hh], hw));
  } else if (hd === 'beret') {
    const r = at(0.8);
    out.push({
      name: 'head.beret',
      material: mat('head'),
      capStart: true,
      capEnd: true,
      rings: [
        ring([0, d.chinY + 0.76 * hh, 0], X, Z, r.a + e, r.b + e, r.n, hw),
        ring([0.12 * hh, d.chinY + 0.98 * hh, -0.02 * hh], X, Z, r.a * 1.18, r.b * 1.12, 2.4, hw),
        ring([0.18 * hh, d.chinY + 1.06 * hh, -0.02 * hh], X, Z, r.a * 0.9, r.b * 0.85, 2.4, hw),
        ring([0.2 * hh, d.chinY + 1.08 * hh, -0.02 * hh], X, Z, r.a * 0.3, r.b * 0.3, 2.4, hw),
      ],
    });
  } else if (hd === 'boonie') {
    const h = dome('head.boonie', mat('head'), 0.64, 0.02 * hh + hairPad + e, 2.6, 0.5);
    out.push(slab('head.boonie.brim', mat('head'), [0, h.y0 - 0.02 * hh, 0], h.A * 1.6, h.B * 1.55, 0.02 * hh, hw, 2.2));
    out.push(...strap('head.boonie.band', mat('head', true), h.y0 + 0.04 * hh, 0.03));
  } else if (hd === 'patrol') {
    const r = at(0.7);
    const A = r.a * encloseScale(r.n, 3) + e + hairPad;
    const B = r.b * encloseScale(r.n, 3) + e + hairPad;
    const y0 = d.chinY + 0.64 * hh;
    out.push({ name: 'head.patrol', material: mat('head'), capStart: true, capEnd: true, rings: [ring([0, y0, 0], X, Z, A, B, 3, hw), ring([0, d.chinY + 1.12 * hh, 0], X, Z, A * 1.02, B * 1.02, 3, hw)] });
    out.push(slab('head.patrol.brim', mat('head'), [0, y0 + 0.02 * hh, B * 0.85], A * 0.8, B * 0.45, 0.025 * hh, hw, 2.4));
  } else if (hd === 'sidecap') {
    const r = at(0.95);
    out.push({ name: 'head.sidecap', material: mat('head'), capStart: true, capEnd: true, lod: 'small', rings: [ring([0, d.chinY + 0.9 * hh, 0], X, Z, r.a * 0.55, r.b + e * 2, 6, hw), ring([0, d.chinY + 1.08 * hh, 0], X, Z, r.a * 0.15, r.b * 0.95, 6, hw)] });
  } else if (hd === 'peaked') {
    const r = at(0.7);
    const A = r.a * encloseScale(r.n, 2.4) + e + hairPad;
    const B = r.b * encloseScale(r.n, 2.4) + e + hairPad;
    const y0 = d.chinY + 0.68 * hh;
    out.push({ name: 'head.peaked.band', material: mat('head', true), capStart: false, capEnd: false, rings: [ring([0, y0, 0], X, Z, A, B, 2.4, hw), ring([0, y0 + 0.12 * hh, 0], X, Z, A, B, 2.4, hw)] });
    out.push({ name: 'head.peaked.crown', material: mat('head'), capStart: true, capEnd: true, rings: [ring([0, y0 + 0.1 * hh, 0], X, Z, A, B, 2.4, hw), ring([0, y0 + 0.36 * hh, -0.03 * hh], X, Z, A * 1.3, B * 1.3, 2.2, hw), ring([0, y0 + 0.42 * hh, -0.03 * hh], X, Z, A * 1.26, B * 1.26, 2.2, hw)] });
    out.push(slab('head.peaked.visor', 'visor', [0, y0 + 0.01 * hh, B * 0.9], A * 0.75, B * 0.42, 0.02 * hh, hw, 2.4));
  } else if (hd === 'ushanka') {
    const h = dome('head.ushanka', mat('head'), 0.55, 0.08 * hh + hairPad + e, 2.8, 0.7);
    for (const s of [1, -1]) out.push(box(`head.ushanka.flap.${s}`, mat('head'), [s * (h.A * 0.95), h.y0 - 0.13 * hh, -0.05 * hh], [0.05 * hh, 0.17 * hh, h.B * 0.55], hw, 3));
    out.push(box('head.ushanka.front', mat('head'), [0, h.y0 + 0.08 * hh, h.B * 0.9], [h.A * 0.8, 0.09 * hh, 0.05 * hh], hw, 3));
  }

  function strap(name: string, material: string, y0: number, thick = 0.02): Part[] {
    // chinstrap: a thin loop under the jaw, from temple to temple
    const r = at(0.5);
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const ang = Math.PI * (0.5 + t);
      pts.push([Math.cos(ang) * -(r.a + e), lerp(y0, d.chinY - 0.04 * hh, Math.sin(t * Math.PI)), 0.15 * hh]);
    }
    return [{ name, material, capStart: true, capEnd: true, lod: 'small', rings: pts.map((P) => ring(P, Z, [0, 1, 0], thick * hh, thick * hh * 0.5, 2.4, hw)) }];
  }

  // ─────────────────────────────────────────────────────────────── face gear
  const fg = id('mask');
  if (fg === 'gasmask') {
    headShell('mask.mask', mat('mask'), 0, 0.62, 0.03 * hh + e, { capStart: true, capEnd: false, cuffEnd: true, cuffStart: false });
    const fz = at(d.eyeLine).b + 0.035 * hh + e;
    for (const s of [1, -1]) {
      const ex = s * d.headHW * 0.42;
      out.push(tube(`mask.lens.${s}`, mat('mask', true), [ex, d.chinY + d.eyeLine * hh, fz + 0.012 * hh], [0, 0, 1], 0.1 * hh, 0.03 * hh, hw));
    }
    out.push(tube('mask.filter', mat('mask'), [0, d.chinY + 0.12 * hh, fz + 0.09 * hh], norm([0, -0.6, 1]), 0.11 * hh, 0.18 * hh, hw));
    out.push(...strap('mask.straps', mat('mask'), d.chinY + 0.6 * hh, 0.025));
  } else if (fg === 'respirator') {
    headShell('mask.resp', mat('mask'), 0.03, 0.36, 0.02 * hh + e, { capStart: false, cuffStart: true, cuffEnd: true });
    const fz = at(0.2).b + 0.03 * hh;
    for (const s of [1, -1]) out.push(tube(`mask.cart.${s}`, mat('mask', true), [s * d.headHW * 0.48, d.chinY + 0.16 * hh, fz], norm([s * 0.8, -0.2, 0.6]), 0.085 * hh, 0.09 * hh, hw));
  } else if (fg === 'goggles') {
    headShell('mask.gogglestrap', mat('mask'), d.eyeLine - 0.05, d.eyeLine + 0.06, 0.012 * hh + e, { capEnd: false, cuffEnd: true });
    const fz = at(d.eyeLine).b + 0.015 * hh;
    for (const s of [1, -1]) out.push(tube(`mask.goggle.${s}`, mat('mask', true), [s * d.headHW * 0.42, d.chinY + d.eyeLine * hh, fz + 0.02 * hh], [0, 0, 1], 0.12 * hh, 0.05 * hh, hw));
  } else if (fg === 'shemagh' || fg === 'bandanamask') {
    headShell('mask.wrap', mat('mask'), 0, fg === 'shemagh' ? 0.42 : 0.36, 0.025 * hh + e, { capStart: true, capEnd: false, cuffEnd: true, cuffStart: false });
    if (fg === 'shemagh') shellOf('mask.neckwrap', body.neck, 0.3, 2.3, { material: mat('mask'), inflate: d.neckR * 0.35 + 3 * e, cuffStart: true, cuffEnd: true });
  }

  // ─────────────────────────────────────────────────────────────── uniforms (tops)
  const top = id('top');
  const uniformTop = (inflate: number, collar: boolean, pockets: 2 | 4 | 0, hem = -0.25) => {
    torsoShell('top.body', mat('top'), 'hip', hem, 'neckBase', -0.2, inflate);
    sleeves('top', 'wrist', -0.1, inflate);
    if (collar) out.push(shell('top.collar', torso, tk('neckBase', -0.45), tk('neckBase', -0.1), { material: mat('top'), inflate: inflate + 0.012 * d.u, cuffStart: true, cuffEnd: true }));
    const ps = Math.max(0.018, 0.045 * d.u * (d.chestHW / (0.165 * d.u)));
    if (pockets >= 2) for (const s of [1, -1]) pocket(`top.pocket.chest.${s}`, mat('top'), tk('chest', 0), s * 0.5, inflate, ps, chestW);
    if (pockets === 4) for (const s of [1, -1]) pocket(`top.pocket.hip.${s}`, mat('top'), tk('waist', -0.4), s * 0.5, inflate, ps * 1.1, waistW);
  };
  if (top === 'tunicww1') {
    uniformTop(3 * e, true, 4, -0.6);
  } else if (top === 'fieldjacket') {
    uniformTop(3.5 * e, true, 4, -0.5);
  } else if (top === 'fatigues') {
    uniformTop(3 * e, true, 2);
  } else if (top === 'combat') {
    uniformTop(3 * e, true, 0);
    for (const s of sides) {
      const A = body[`arm.${s}`];
      const k = KTag(A, 'deltoid', 0.3);
      const r = sampleRing(A.rings, k);
      out.push(box(`top.armpocket.${s}`, mat('top'), add(r.c, scale(r.p, 0)), [r.a * 0.35 + 0.004, r.b * 0.25, r.a * 0.6], r.w));
    }
  } else if (top === 'hoodie') {
    torsoShell('top.body', mat('top'), 'hip', -0.6, 'neckBase', -0.2, 3.5 * e);
    sleeves('top', 'wrist', 0, 3.5 * e, 0.5 * e);
    // hood, pushed down: a fat roll around the neck and shoulders
    out.push(shell('top.hood', torso, tk('shoulderTop', -0.3), tk('neckBase', 0), { material: mat('top'), inflate: 3.5 * e + 0.035 * d.u, cuffStart: true, cuffEnd: true }));
    const f = frontZ(tk('waist', -0.2), 0, 3.5 * e);
    out.push(box('top.pouch', mat('top'), [0, f.y, f.z + 0.006], [f.r.a * 0.5, f.r.a * 0.22, 0.008 * d.u], waistW));
  } else if (top === 'jacket') {
    torsoShell('top.body', mat('top'), 'hip', -0.3, 'neckBase', -0.15, 4 * e);
    sleeves('top', 'wrist', -0.1, 4 * e);
    out.push(shell('top.collar', torso, tk('neckBase', -0.5), tk('neckBase', -0.05), { material: mat('top'), inflate: 4 * e + 0.02 * d.u, cuffStart: true, cuffEnd: true, flare: 0.01 * d.u }));
    const f = frontZ(tk('chest', -0.3), 0, 4 * e);
    out.push(box('top.zip', mat('top', true), [0, (f.y + d.hipY) / 2, f.z], [0.004 * d.u + 0.002, (f.y - d.hipY) / 2, 0.003], chestW));
  }

  // ─────────────────────────────────────────────────────────────── trousers
  const bot = id('bottom');
  if (bot === 'breeches' || bot === 'cargo') {
    shellOf('bottom.pelvis', torso, 0, tk('lowWaist', 0.3), { material: mat('bottom'), inflate: 2 * e, capStart: true, cuffEnd: true });
    if (bot === 'breeches') {
      // puffed thighs, tight below the knee
      for (const s of sides) {
        const L = body[`leg.${s}`];
        shellOf(`bottom.leg.${s}`, L, 0, KTag(L, 'midThigh', 0), { material: mat('bottom'), inflate: 2 * e, flare: 0.03 * d.u });
        shellOf(`bottom.knee.${s}`, L, KTag(L, 'midThigh', 0), KTag(L, 'belowKnee', 0.3), { material: mat('bottom'), inflate: 2 * e + 0.03 * d.u, flare: -0.03 * d.u, cuffEnd: true });
        shellOf(`bottom.shin.${s}`, L, KTag(L, 'belowKnee', 0.2), KTag(L, 'ankle', 0), { material: mat('bottom'), inflate: 1.5 * e, cuffEnd: true });
      }
    } else {
      legsTo('bottom', 'ankle', 0.1, 2.2 * e, 0.6 * e);
      for (const s of sides) {
        const L = body[`leg.${s}`];
        const r = sampleRing(L.rings, KTag(L, 'midThigh', 0.2));
        const sx = s === 'L' ? 1 : -1;
        out.push(box(`bottom.cargo.${s}`, mat('bottom'), [r.c[0] + sx * (r.a + 2.2 * e + 0.006), r.c[1], r.c[2] + r.b * 0.1], [0.012 * d.u, r.a * 0.55, r.b * 0.55], r.w));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────── leg wear
  const lg = id('legs');
  if (lg === 'puttees') {
    // wound wraps: stacked, slightly offset bands so the winding reads
    for (let i = 0; i < 5; i++) {
      for (const s of sides) {
        const L = body[`leg.${s}`];
        const k0 = lerp(KTag(L, 'belowKnee', 0.1), KTag(L, 'ankle', 0.1), i / 5);
        const k1 = lerp(KTag(L, 'belowKnee', 0.1), KTag(L, 'ankle', 0.1), (i + 1) / 5);
        shellOf(`legs.puttee.${s}.${i}`, L, k0, k1 + 0.05, { material: mat('legs'), inflate: 3 * e + (i % 2) * 0.003 * d.u, cuffStart: true, cuffEnd: true });
      }
    }
  } else if (lg === 'kneepads') {
    for (const s of sides) {
      const L = body[`leg.${s}`];
      const r = sampleRing(L.rings, KTag(L, 'knee', 0));
      out.push(box(`legs.kneepad.${s}`, mat('legs'), [r.c[0], r.c[1], r.c[2] + r.b + 3 * e + 0.012 * d.u], [r.a * 0.85, r.a * 1.15, 0.02 * d.u], r.w, 3));
      shellOf(`legs.kneestrap.${s}`, L, KTag(L, 'aboveKnee', 0.3), KTag(L, 'aboveKnee', 0.45), { material: mat('legs', true), inflate: 3.2 * e, cuffStart: true, cuffEnd: true });
    }
  } else if (lg === 'gaiters') {
    legBand('legs.gaiter', mat('legs'), 'shin', -0.3, 'end', 0, 5 * e);
  }

  // ─────────────────────────────────────────────────────────────── vests, webbing, armour
  const ar = id('armor');
  const yAt = (k: number) => sampleRing(torso.rings, k).c[1];
  if (ar === 'webbing' || ar === 'chestrig') {
    // Y-straps over the shoulders + a belt with ammo pouches
    for (const s of [1, -1]) {
      const fTop = frontZ(tk('armpit', 0.6), s * 0.45, 5 * e);
      const fLow = frontZ(tk('lowWaist', 0), s * 0.45, 5 * e);
      out.push(box(`armor.strap.f.${s}`, mat('armor'), [fTop.x, (fTop.y + fLow.y) / 2, (fTop.z + fLow.z) / 2], [d.chestHW * 0.07, (fTop.y - fLow.y) / 2, 0.006 * d.u + 0.002], chestW));
      const topY = yAt(tk('shoulderTop', 0));
      out.push(box(`armor.strap.t.${s}`, mat('armor'), [fTop.x, topY + 0.008 * d.u, (fTop.z + backZ(tk('shoulder', 0), 5 * e)) / 2], [d.chestHW * 0.07, 0.008 * d.u, (fTop.z - backZ(tk('shoulder', 0), 5 * e)) / 2], W(['UpperChest', 1])));
    }
    out.push(shell('armor.belt', torso, tk('lowWaist', -0.12), tk('lowWaist', 0.12), { material: mat('armor'), inflate: 5 * e, cuffStart: true, cuffEnd: true }));
    const n = ar === 'chestrig' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const xf = lerp(-0.6, 0.6, i / (n - 1));
      if (ar === 'chestrig') pocket(`armor.mag.${i}`, mat('armor', true), tk('ribs', 0.2), xf, 5.5 * e, d.chestHW * 0.13, chestW);
      else pocket(`armor.pouch.${i}`, mat('armor', true), tk('lowWaist', 0), xf, 5.5 * e, d.waistHW * 0.16, W(['Hips', 0.7], ['Spine', 0.3]));
    }
  } else if (ar === 'bandolier') {
    // diagonal ammo belt from the left shoulder to the right hip
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const k = lerp(tk('shoulderTop', 0), tk('lowWaist', 0), t);
      const xf = lerp(0.5, -0.65, t);
      pts.push([frontZ(k, xf).x, yAt(k), frontZ(k, xf, 5 * e).z]);
    }
    const ws = pts.map((_, i) => (i < 4 ? chestW : W(['Spine', 0.5], ['Chest', 0.5])));
    out.push({ name: 'armor.bandolier', material: mat('armor'), capStart: true, capEnd: true, lod: 'small', rings: pts.map((P, i) => { const tan = norm(sub(pts[Math.min(i + 1, 8)], pts[Math.max(i - 1, 0)])); const f = limbFrame(tan, Z); return ring(P, f.p, f.q, d.chestHW * 0.09, 0.008 * d.u, 6, ws[i]); }) });
    for (let i = 1; i < 8; i += 1) out.push(box(`armor.round.${i}`, mat('armor', true), add(pts[i], [0, 0, 0.01 * d.u]), [d.chestHW * 0.03, d.chestHW * 0.06, 0.006 * d.u], ws[i]));
  } else if (ar === 'flak') {
    torsoShell('armor.body', mat('armor'), 'lowWaist', -0.2, 'shoulder', 0.5, 6.5 * e, { nBoost: 1 });
    for (const k of [tk('waist', 0), tk('ribs', 0), tk('chest', 0.1)]) out.push(shell('armor.rib', torso, k - 0.06, k + 0.06, { material: mat('armor'), inflate: 7.2 * e, cuffStart: true, cuffEnd: true }));
    for (const s of [1, -1]) pocket(`armor.flakpocket.${s}`, mat('armor'), tk('waist', -0.2), s * 0.55, 6.5 * e, d.waistHW * 0.2, waistW);
  } else if (ar === 'platecarrier') {
    const fT = frontZ(tk('armpit', 0.4), 0, 6 * e);
    const fB = frontZ(tk('waist', -0.1), 0, 6 * e);
    const plateHW = d.chestHW * 0.72;
    out.push(box('armor.plate.front', mat('armor'), [0, (fT.y + fB.y) / 2, Math.max(fT.z, fB.z) + 0.018 * d.u], [plateHW, (fT.y - fB.y) / 2, 0.022 * d.u], chestW));
    out.push(box('armor.plate.back', mat('armor'), [0, (fT.y + fB.y) / 2, backZ(tk('chest', 0), 6 * e) - 0.018 * d.u], [plateHW, (fT.y - fB.y) / 2, 0.022 * d.u], chestW));
    out.push(shell('armor.cummerbund', torso, tk('waist', -0.25), tk('ribs', 0.1), { material: mat('armor'), inflate: 5.5 * e, cuffStart: true, cuffEnd: true }));
    for (let i = 0; i < 3; i++) pocket(`armor.mag.${i}`, mat('armor', true), tk('ribs', 0), lerp(-0.45, 0.45, i / 2), 6 * e + 0.04 * d.u, d.chestHW * 0.12, chestW);
    for (const s of [1, -1]) {
      const topY = yAt(tk('shoulderTop', 0));
      out.push(box(`armor.shoulder.${s}`, mat('armor'), [s * d.chestHW * 0.45, topY + 0.01 * d.u, (fT.z + backZ(tk('shoulder', 0), 6 * e)) / 2], [d.chestHW * 0.1, 0.01 * d.u, (fT.z - backZ(tk('shoulder', 0), 6 * e)) / 2], W(['UpperChest', 1])));
    }
  } else if (ar === 'exo') {
    torsoShell('armor.body', mat('armor'), 'waist', -0.3, 'shoulderTop', 0.3, 7 * e, { nBoost: 2 });
    for (const k of [tk('waist', 0.2), tk('chest', 0)]) out.push(shell('armor.glow', torso, k - 0.05, k + 0.05, { material: 'armorglow', inflate: 7.6 * e, cuffStart: true, cuffEnd: true }));
    for (const s of sides) {
      const A = body[`arm.${s}`];
      out.push(shell(`armor.pauldron.${s}`, A, 0.4, KTag(A, 'deltoid', 0.5), { material: mat('armor'), inflate: 6 * e, flare: 2 * e, cuffEnd: true, nBoost: 2 }));
      out.push(shell(`armor.forearm.${s}`, A, KTag(A, 'belowElbow', 0.1), KTag(A, 'wristUp', 0), { material: mat('armor'), inflate: 4 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      const L = body[`leg.${s}`];
      out.push(shell(`armor.thigh.${s}`, L, KTag(L, 'thighTop', 0.3), KTag(L, 'aboveKnee', 0.1), { material: mat('armor'), inflate: 4.5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      out.push(shell(`armor.shin.${s}`, L, KTag(L, 'belowKnee', 0.1), KTag(L, 'shin', 0.5), { material: mat('armor'), inflate: 5.5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
    }
  }

  if (ar === 'scrap') {
    // road-sign chestplate (tilted), car-tyre pauldron, spikes and straps
    const f = frontZ(tk('chest', -0.3), 0.1, 6 * e);
    out.push(box('armor.sign', mat('armor'), [f.x, f.y, f.z + 0.012 * d.u], [d.chestHW * 0.62, d.chestHW * 0.55, 0.008 * d.u], chestW));
    out.push(box('armor.sign.stripe', mat('armor', true), [f.x, f.y, f.z + 0.022 * d.u], [d.chestHW * 0.62, d.chestHW * 0.1, 0.004 * d.u], chestW));
    const A = body['arm.L'];
    const sr = sampleRing(A.rings, KTag(A, 'shoulder', 0.3));
    const R = Math.max(sr.a, sr.b) + 6 * e;
    const tyre: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      tyre.push(add(sr.c, add(scale(sr.p, Math.cos(a) * R), scale(sr.q, Math.sin(a) * R))));
    }
    out.push({ name: 'armor.tyre', material: 'tyre', capStart: true, capEnd: true, lod: 'small', rings: tyre.map((P, i) => { const tan = norm(sub(tyre[Math.min(i + 1, 10)], tyre[Math.max(i - 1, 0)])); const fr = limbFrame(tan, norm(sub(P, sr.c))); return ring(P, fr.p, fr.q, 0.03 * d.u, 0.022 * d.u, 4, sr.w); }) });
    for (let i = 0; i < 3; i++) {
      const P = add(sr.c, scale(sr.q, R + 0.02 * d.u));
      out.push(tube(`armor.spike.${i}`, mat('armor', true), add(P, scale(sr.d, (i - 1) * 0.04 * d.u)), sr.q, 0.012 * d.u, 0.07 * d.u, sr.w));
    }
    for (const s of [1, -1]) {
      const fTop = frontZ(tk('armpit', 0.5), s * 0.55, 6.5 * e);
      out.push(box(`armor.strap.${s}`, mat('armor', true), [fTop.x, fTop.y - 0.05 * d.u, fTop.z], [0.012 * d.u, 0.07 * d.u, 0.004 * d.u], chestW));
    }
  }

  // ─────────────────────────────────────────────────────────────── belts
  if (id('belt') === 'utility') {
    out.push(shell('belt.band', torso, tk('lowWaist', -0.08), tk('lowWaist', 0.12), { material: mat('belt'), inflate: 4.5 * e, cuffStart: true, cuffEnd: true }));
    for (const xf of [-0.75, 0.75]) pocket(`belt.pouch.${xf}`, mat('belt', true), tk('lowWaist', 0.02), xf, 4.8 * e, d.waistHW * 0.14, W(['Hips', 1]));
    const bz = backZ(tk('lowWaist', 0), 5 * e);
    out.push(tube('belt.canteen', mat('belt', true), [d.waistHW * 0.55, yAt(tk('lowWaist', -0.4)), bz + 0.01 * d.u], [0, 1, 0], d.waistHW * 0.2, d.waistHW * 0.45, W(['Hips', 1])));
  }

  // ─────────────────────────────────────────────────────────────── packs
  const bk = id('back');
  const bw = W(['UpperChest', 0.6], ['Chest', 0.4]);
  const bz = backZ(tk('chest', 0), 7 * e);
  const tl = d.neckBaseY - d.hipY;
  if (bk === 'ww1pack' || bk === 'alice' || bk === 'assault' || bk === 'radio') {
    const tall = bk === 'alice' ? 0.62 : bk === 'radio' ? 0.5 : 0.55;
    const dep = d.chestHD * (bk === 'ww1pack' ? 0.55 : bk === 'radio' ? 0.65 : 0.75);
    const yc = d.hipY + tl * (bk === 'alice' ? 0.5 : 0.58);
    const pw = d.chestHW * (bk === 'radio' ? 0.6 : 0.78);
    out.push(box('back.pack', mat('back'), [0, yc, bz - dep], [pw, (tl * tall) / 2, dep], bw, bk === 'radio' ? 40 : 4));
    if (bk === 'ww1pack') {
      // rolled greatcoat in a horseshoe over the pack
      const R = dep * 0.55;
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (i / 8);
        pts.push([Math.cos(a) * pw * 1.05, yc + (tl * tall) / 2 + Math.sin(a) * R * 1.5 - R * 0.3, bz - dep]);
      }
      out.push({ name: 'back.roll', material: mat('back', true), capStart: true, capEnd: true, lod: 'small', rings: pts.map((P, i) => { const tan = norm(sub(pts[Math.min(i + 1, 8)], pts[Math.max(i - 1, 0)])); const f = limbFrame(tan, Z); return ring(P, f.p, f.q, R, R, 2.4, bw); }) });
    } else if (bk === 'alice') {
      for (const s of [1, -1]) out.push(box(`back.side.${s}`, mat('back'), [s * (pw + dep * 0.25), yc - tl * tall * 0.15, bz - dep], [dep * 0.25, tl * tall * 0.2, dep * 0.6], bw, 4));
      out.push(box('back.frame', mat('back', true), [0, yc - (tl * tall) / 2 - 0.02 * d.u, bz - dep * 0.2], [pw * 0.9, 0.015 * d.u, dep * 0.3], bw));
    } else if (bk === 'assault') {
      for (let i = 0; i < 3; i++) out.push(box(`back.molle.${i}`, mat('back', true), [0, yc - tl * tall * 0.3 + i * tl * tall * 0.18, bz - dep * 2 - 0.004], [pw * 0.85, 0.006 * d.u, 0.004], bw));
    } else {
      out.push(tube('back.antenna', mat('back', true), [pw * 0.6, yc + (tl * tall) / 2 + tl * 0.45, bz - dep], norm([0.08, 1, -0.04]), 0.006 * d.u, tl * 0.9, bw));
      out.push(box('back.dial', mat('back', true), [-pw * 0.3, yc + tl * tall * 0.3, bz - dep * 2 - 0.006], [pw * 0.25, tl * tall * 0.08, 0.008], bw));
    }
    // shoulder straps
    for (const s of [1, -1]) {
      const fTop = frontZ(tk('armpit', 0.6), s * 0.48, 4.5 * e);
      const fLow = frontZ(tk('ribs', 0), s * 0.48, 4.5 * e);
      out.push(box(`back.strap.f.${s}`, mat('back'), [fTop.x, (fTop.y + fLow.y) / 2, (fTop.z + fLow.z) / 2], [d.chestHW * 0.08, (fTop.y - fLow.y) / 2, 0.006 * d.u + 0.002], chestW));
    }
  }

  void ringPoint;
}
