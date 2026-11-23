/**
 * Divers (retro hard-hat, modern scuba, sci-fi hard suit) and the adventuring party's kit
 * (hood, cape, fur collar, ponytail). Built with the shared wardrobe toolkit, so everything is a
 * shell of the body's own rings or a part skinned to the bones underneath.
 */
import { limbFrame } from './body';
import { box, KTag, tube } from './clothing';
import { Part, ring, ringPoint, Ring, sampleRing, Weights } from './loft';
import { add, lerp, norm, scale, sub, V3 } from './math';
import { wardrobeKit, WardrobeCtx } from './military';
import { shell } from './shell';

const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

/** a tube through a list of points, with explicit per-point weights */
function path(name: string, material: string, pts: V3[], radii: number[], ws: Weights[], up: V3 = Z): Part {
  return {
    name,
    material,
    lod: 'small',
    capStart: true,
    capEnd: true,
    rings: pts.map((P, i) => {
      const tan = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
      const f = limbFrame(tan, up);
      return ring(P, f.p, f.q, radii[i], radii[i], 2.4, ws[i]);
    }),
  };
}

export function buildExtras(c: WardrobeCtx) {
  const { body, out, e, d, W, mat, torso, hh, hw, sides, at, tk, id, frontZ, backZ, shellOf, headShell, sleeves, legsTo, torsoShell, pocket, chestW, waistW, hairPad } = wardrobeKit(c);
  const u = d.u;

  /** a sphere around the whole head (helmets): radius from every head, nose and ear vertex */
  const headSphere = (pad: number) => {
    const cy = d.chinY + 0.5 * hh;
    const cz = 0.03 * hh;
    let R = 0;
    for (const pid of ['head', 'nose', 'ear.L', 'ear.R']) {
      const p = body[pid];
      if (!p) continue;
      for (const r of p.rings)
        for (let k = 0; k < 16; k++) {
          const [x, y] = ringPoint(r, (k / 16) * Math.PI * 2);
          const P = add(r.c, add(scale(r.p, x), scale(r.q, y)));
          R = Math.max(R, Math.hypot(P[0], P[1] - cy, P[2] - cz));
        }
    }
    return { R: R * 1.05 + pad + hairPad, cy, cz };
  };
  const sphere = (name: string, material: string, cy: number, cz: number, R: number, neckR: number): Part => {
    const rings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const th = -Math.PI / 2 + (Math.PI * i) / 8;
      const rr = Math.max(Math.cos(th), 0.02) * R;
      rings.push(ring([0, cy + Math.sin(th) * R, cz], X, Z, rr, rr, 2, hw));
    }
    rings[0] = { ...rings[1], a: neckR, b: neckR };
    return { name, material, rings, capStart: true, capEnd: true };
  };
  const disc = (name: string, material: string, c0: V3, dir: V3, r: number, depth: number, w: Weights) => out.push({ ...tube(name, material, c0, dir, r, depth, w), lod: undefined });

  // ═══════════════════════════════════════════════════════════════════ DIVERS
  const hd = id('head');
  if (hd === 'divehelm') {
    // Mark V style: brass sphere, three portholes and a top light, bolted to a corselet
    const s = headSphere(0.06 * hh + 2 * e);
    out.push(sphere('head.divehelm', mat('head'), s.cy, s.cz, s.R, d.neckR * 1.7));
    const fz = s.cz + s.R;
    disc('head.port.front', 'divglass', [0, s.cy, fz - 0.01 * hh], Z, s.R * 0.36, 0.05 * hh, hw);
    disc('head.port.front.rim', mat('head', true), [0, s.cy, fz - 0.025 * hh], Z, s.R * 0.44, 0.05 * hh, hw);
    for (const sd of [1, -1]) {
      disc(`head.port.${sd}`, 'divglass', [sd * (s.R - 0.01 * hh), s.cy + 0.02 * hh, s.cz], [sd, 0, 0], s.R * 0.24, 0.05 * hh, hw);
      disc(`head.port.${sd}.rim`, mat('head', true), [sd * (s.R - 0.025 * hh), s.cy + 0.02 * hh, s.cz], [sd, 0, 0], s.R * 0.3, 0.05 * hh, hw);
    }
    disc('head.port.top', 'divglass', [0, s.cy + s.R - 0.02 * hh, s.cz + s.R * 0.15], norm([0, 1, 0.3]), s.R * 0.18, 0.05 * hh, hw);
    // air fitting at the back
    disc('head.fitting', mat('head', true), [0, s.cy - s.R * 0.2, s.cz - s.R + 0.01 * hh], [0, 0, -1], s.R * 0.12, 0.12 * hh, hw);
  } else if (hd === 'divedome') {
    // sci-fi: a tinted dome on a metal collar, lamps either side
    const s = headSphere(0.08 * hh + 2 * e);
    out.push(sphere('head.dome', 'glass', s.cy, s.cz, s.R, d.neckR * 1.7));
    out.push(shell('head.domecollar', body.neck, 0, 1.6, { material: mat('head'), inflate: d.neckR * 0.7 + 5 * e, cuffStart: true, cuffEnd: true }));
    for (const sd of [1, -1]) {
      out.push(box(`head.lamp.${sd}`, mat('head'), [sd * s.R * 0.95, s.cy - s.R * 0.45, s.cz + s.R * 0.25], [0.05 * hh, 0.07 * hh, 0.08 * hh], hw));
      out.push(box(`head.lamp.${sd}.glow`, 'lamp', [sd * s.R * 0.95, s.cy - s.R * 0.45, s.cz + s.R * 0.25 + 0.085 * hh], [0.04 * hh, 0.055 * hh, 0.01 * hh], hw));
    }
  }

  const mk = id('mask');
  if (mk === 'divemask') {
    // one wide lens over eyes and nose, a strap, a snorkel and a regulator
    const r = at(d.eyeLine);
    const fz = r.b + 0.05 * hh;
    out.push(box('mask.frame', mat('mask'), [0, d.chinY + (d.eyeLine - 0.04) * hh, fz - 0.025 * hh], [r.a * 0.82, 0.17 * hh, 0.045 * hh], hw));
    out.push(box('mask.lens', 'divglass', [0, d.chinY + (d.eyeLine - 0.02) * hh, fz + 0.022 * hh], [r.a * 0.7, 0.12 * hh, 0.006 * hh], hw));
    headShell('mask.strap', mat('mask'), d.eyeLine - 0.04, d.eyeLine + 0.04, 0.012 * hh + e, { capEnd: false, cuffEnd: true });
    const sx = r.a + 0.03 * hh;
    out.push(path('mask.snorkel', mat('mask', true), [[sx, d.chinY + 0.2 * hh, 0.3 * r.b], [sx + 0.02 * hh, d.chinY + 0.75 * hh, 0.1 * r.b], [sx, d.chinY + 1.08 * hh, -0.05 * r.b]], [0.035 * hh, 0.035 * hh, 0.04 * hh], [hw, hw, hw]));
    const mouth = at(0.2);
    out.push(box('mask.regulator', mat('mask', true), [0, d.chinY + 0.18 * hh, mouth.b + 0.06 * hh], [0.1 * hh, 0.08 * hh, 0.06 * hh], hw));
  }

  const top = id('top');
  const bot = id('bottom');
  if (top === 'drysuit') {
    // heavy canvas: thick, a little baggy
    torsoShell('top.body', mat('top'), 'hip', -0.3, 'neckBase', -0.1, 5 * e);
    sleeves('top', 'wrist', -0.05, 5 * e, 1.5 * e);
    for (const s of sides) shellOf(`top.cuff.${s}`, body[`arm.${s}`], KTag(body[`arm.${s}`], 'wrist', -0.3), KTag(body[`arm.${s}`], 'wrist', 0.05), { material: mat('top', true), inflate: 6.5 * e, cuffStart: true, cuffEnd: true });
  } else if (top === 'wetsuit') {
    torsoShell('top.body', mat('top'), 'lowWaist', 0.3, 'neckBase', -0.15, 1.2 * e);
    sleeves('top', 'wrist', -0.1, 1.2 * e);
    // contrast panels on the flanks and shoulders
    torsoShell('top.panel', mat('top', true), 'ribs', -0.1, 'chest', 0.2, 1.5 * e);
    for (const s of sides) shellOf(`top.shoulder.${s}`, body[`arm.${s}`], 0.5, KTag(body[`arm.${s}`], 'deltoid', 0.4), { material: mat('top', true), inflate: 1.5 * e, cuffEnd: true });
  }
  if (bot === 'drysuit') {
    shellOf('bottom.pelvis', torso, 0, tk('lowWaist', 0.4), { material: mat('bottom'), inflate: 4 * e, capStart: true, cuffEnd: true });
    legsTo('bottom', 'ankle', 0.1, 4.5 * e, 1.2 * e);
  } else if (bot === 'wetsuit') {
    shellOf('bottom.pelvis', torso, 0, tk('lowWaist', 0.5), { material: mat('bottom'), inflate: 1.1 * e, capStart: true, cuffEnd: true });
    legsTo('bottom', 'ankle', 0.25, 1.1 * e);
    for (const s of sides) shellOf(`bottom.kneepanel.${s}`, body[`leg.${s}`], KTag(body[`leg.${s}`], 'aboveKnee', 0.2), KTag(body[`leg.${s}`], 'belowKnee', -0.2), { material: mat('bottom', true), inflate: 1.4 * e, cuffStart: true, cuffEnd: true });
  }

  const ft = id('feet');
  const foot = (s: 'L' | 'R', inflate: number, nBoost = 0, material = mat('feet')) => {
    const f = body[`foot.${s}`];
    const lifted: Part = { ...f, rings: f.rings.map((r) => ({ ...r, c: [r.c[0], r.c[1] + inflate, r.c[2]] as V3 })) };
    out.push(shell(`feet.foot.${s}`, lifted, 0, f.rings.length - 1, { material, inflate, capStart: true, capEnd: true, nBoost }));
    return f;
  };
  if (ft === 'leadboots') {
    for (const s of sides) {
      const f = foot(s, 6 * e, 2);
      const L = body[`leg.${s}`];
      out.push(shell(`feet.shaft.${s}`, L, KTag(L, 'shin', 0), L.rings.length - 1, { material: mat('feet'), inflate: 6 * e, cuffStart: true, capEnd: true, nBoost: 1 }));
      const heel = f.rings[0].c;
      const toe = f.rings[f.rings.length - 1].c;
      const th = d.ankleY * 0.45;
      out.push(box(`feet.lead.${s}`, mat('feet', true), [heel[0], th / 2, (heel[2] + toe[2]) / 2], [d.footHW * 1.25 + 6 * e, th / 2, (toe[2] - heel[2]) / 2 + 6 * e], W([s === 'L' ? 'LeftFoot' : 'RightFoot', 1])));
    }
  } else if (ft === 'fins') {
    for (const s of sides) {
      const f = foot(s, 1.6 * e);
      const toeBone = s === 'L' ? 'LeftToes' : 'RightToes';
      const tip = f.rings[f.rings.length - 1].c;
      const x = tip[0];
      const len = d.footLen * 1.5;
      const blade: Ring[] = [0, 0.35, 0.7, 1].map((t) => ring([x, d.ankleY * 0.12, tip[2] - d.footLen * 0.2 + t * len], X, [0, 1, 0], d.footHW * lerp(1.3, 2.1, t), d.ankleY * (0.1 - 0.06 * t), 6, W([toeBone, 1])));
      out.push({ name: `feet.fin.${s}`, material: mat('feet', true), capStart: true, capEnd: true, sides: 4, rings: blade });
    }
  }

  const ar = id('armor');
  if (ar === 'corselet') {
    // the bolted brass breastplate the hard-hat locks onto
    torsoShell('armor.corselet', mat('armor'), 'armpit', 0.2, 'neckBase', 0, 6 * e + 0.02 * u, { nBoost: -0.5, cuffStart: true });
    const r = sampleRing(torso.rings, tk('shoulder', 0.3));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      out.push(box(`armor.bolt.${i}`, mat('armor', true), [Math.cos(a) * (r.a + 7 * e + 0.02 * u), r.c[1] - 0.01 * u, r.c[2] + Math.sin(a) * (r.b + 7 * e + 0.02 * u)], [0.012 * u, 0.012 * u, 0.012 * u], W(['UpperChest', 1])));
    }
  } else if (ar === 'bcd') {
    torsoShell('armor.bcd', mat('armor'), 'lowWaist', -0.1, 'shoulder', 0.45, 4.5 * e, { nBoost: 1 });
    for (const s of [1, -1]) pocket(`armor.bcdpocket.${s}`, mat('armor', true), tk('waist', -0.2), s * 0.6, 4.5 * e, d.waistHW * 0.2, waistW);
    const f = frontZ(tk('armpit', 0.6), 0.5, 5 * e);
    out.push(path('armor.inflator', mat('armor', true), [[f.x, f.y + 0.06 * u, f.z], [f.x + 0.02 * u, f.y - 0.06 * u, f.z + 0.03 * u], [f.x + 0.01 * u, f.y - 0.2 * u, f.z + 0.035 * u]], [0.012 * u, 0.012 * u, 0.016 * u], [chestW, chestW, chestW]));
  } else if (ar === 'hardsuit') {
    torsoShell('armor.body', mat('armor'), 'lowWaist', -0.3, 'shoulderTop', 0.3, 8 * e, { nBoost: 2 });
    torsoShell('armor.lightstrip', 'armorglow', 'chest', -0.06, 'chest', 0.06, 8.6 * e);
    for (const s of sides) {
      const A = body[`arm.${s}`];
      out.push(shell(`armor.pauldron.${s}`, A, 0.3, KTag(A, 'deltoid', 0.5), { material: mat('armor'), inflate: 7 * e, flare: 2 * e, cuffEnd: true, nBoost: 2 }));
      out.push(shell(`armor.forearm.${s}`, A, KTag(A, 'belowElbow', 0.1), KTag(A, 'wristUp', 0), { material: mat('armor'), inflate: 5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      const L = body[`leg.${s}`];
      out.push(shell(`armor.thigh.${s}`, L, KTag(L, 'thighTop', 0.3), KTag(L, 'aboveKnee', 0.1), { material: mat('armor'), inflate: 5 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      out.push(shell(`armor.shin.${s}`, L, KTag(L, 'belowKnee', 0.1), KTag(L, 'shin', 0.6), { material: mat('armor'), inflate: 6 * e, cuffStart: true, cuffEnd: true, nBoost: 2 }));
      const sr = sampleRing(A.rings, KTag(A, 'shoulder', 0.2));
      out.push(box(`armor.shoulderlamp.${s}`, 'lamp', add(sr.c, [0, sr.b + 8 * e + 0.015 * u, sr.b * 0.2]), [0.025 * u, 0.012 * u, 0.03 * u], sr.w));
    }
  }

  const bk = id('back');
  const bw = W(['UpperChest', 0.6], ['Chest', 0.4]);
  const tl = d.neckBaseY - d.hipY;
  const bz = backZ(tk('chest', 0), 6 * e);
  if (bk === 'scubatank') {
    const r = d.chestHW * 0.36;
    const hgt = tl * 0.85;
    const yc = d.hipY + tl * 0.5;
    out.push({ ...tube('back.tank', mat('back'), [0, yc, bz - r], [0, 1, 0], r, hgt, bw), lod: undefined });
    out.push(box('back.valve', mat('back', true), [0, yc + hgt / 2 + r * 0.25, bz - r], [r * 0.3, r * 0.3, r * 0.3], bw));
    out.push(path('back.hose', mat('back', true), [[0, yc + hgt / 2 + r * 0.4, bz - r], [d.chestHW * 0.35, d.neckBaseY + 0.04 * u, bz * 0.2], [d.headHW * 0.4, d.chinY + 0.2 * hh, at(0.2).b + 0.05 * hh]], [0.012 * u, 0.012 * u, 0.012 * u], [bw, W(['UpperChest', 0.5], ['Head', 0.5]), hw]));
  } else if (bk === 'rebreather') {
    const dep = d.chestHD * 0.55;
    const yc = d.hipY + tl * 0.55;
    out.push(box('back.rebreather', mat('back'), [0, yc, bz - dep], [d.chestHW * 0.75, tl * 0.3, dep], bw));
    for (const s of [1, -1]) out.push({ ...tube(`back.cell.${s}`, mat('back', true), [s * d.chestHW * 0.5, yc, bz - dep * 2.2], [0, 1, 0], dep * 0.35, tl * 0.5, bw), lod: undefined });
    out.push(box('back.indicator', 'lamp', [0, yc + tl * 0.18, bz - dep * 2 - 0.004], [d.chestHW * 0.3, 0.008 * u, 0.004], bw));
  } else if (bk === 'airhose') {
    // retro diver's air line: from the back of the helmet down and away
    const hz = -(d.headHD + 0.1 * hh);
    out.push(path('back.airhose', mat('back'), [[0, d.chinY + 0.3 * hh, hz], [0.05 * u, d.neckBaseY - 0.05 * tl, bz - 0.04 * u], [0.12 * u, d.hipY + tl * 0.3, bz - 0.08 * u], [0.25 * u, d.hipY - 0.1 * tl, bz - 0.2 * u]], [0.03 * u, 0.03 * u, 0.03 * u, 0.03 * u], [hw, W(['UpperChest', 1]), W(['Chest', 0.5], ['Spine', 0.5]), W(['Hips', 1])]));
  } else if (bk === 'cape') {
    // a cloak from the shoulders to the knees, hanging behind and flaring back at the hem
    const top = d.neckBaseY + 0.01 * tl;
    const hem = d.kneeY + 0.1 * (d.hipY - d.kneeY);
    const rings: Ring[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = lerp(top, hem, t);
      const k = tk('shoulderTop', 0) - t * (tk('shoulderTop', 0) - 0);
      const back = i === 0 ? backZ(tk('shoulder', 0), 5 * e) * 0.7 : Math.min(backZ(Math.max(0, k), 5 * e), backZ(tk('hip', 0), 5 * e)) - 0.01 * u - t * t * 0.12 * u;
      const w: Weights = t < 0.25 ? W(['UpperChest', 1]) : t < 0.55 ? W(['Chest', 0.6], ['Spine', 0.4]) : W(['Hips', 0.8], ['Spine', 0.2]);
      rings.push(ring([0, y, back], X, Z, d.shoulderHW * lerp(1.02, 1.35, t), 0.012 * u, 6, w));
    }
    out.push({ name: 'back.cape', material: mat('back'), rings, capStart: true, capEnd: true });
    for (const s of [1, -1]) {
      const f = frontZ(tk('shoulderTop', 0), s * 0.55, 4 * e);
      out.push(box(`back.clasp.${s}`, mat('back', true), [f.x, f.y - 0.01 * u, f.z], [0.018 * u, 0.018 * u, 0.008 * u], W(['UpperChest', 1])));
    }
  }

  const bl = id('belt');
  if (bl === 'weights') {
    out.push(shell('belt.band', torso, tk('lowWaist', -0.1), tk('lowWaist', 0.1), { material: mat('belt'), inflate: 5 * e, cuffStart: true, cuffEnd: true }));
    for (const xf of [-0.7, -0.25, 0.25, 0.7]) pocket(`belt.lead.${xf}`, mat('belt', true), tk('lowWaist', 0), xf, 5.2 * e, d.waistHW * 0.13, W(['Hips', 1]));
  }

  // ═══════════════════════════════════════════════════════════════ PARTY GEAR
  if (hd === 'hood') {
    // the hood sits back on the head so the face shows; the face front sits forward of its edge
    const rs: Ring[] = [];
    const pad = 0.05 * hh + hairPad + 2 * e;
    for (const [t, k] of [[0.3, 0.95], [0.55, 1.04], [0.8, 1.0], [1.0, 0.82], [1.08, 0.45], [1.12, 0.06]] as [number, number][]) {
      const r = at(Math.min(1, t));
      rs.push(ring([0, d.chinY + t * hh, -r.b * 0.32], X, Z, (r.a + pad) * k, (r.b * 1.02 + pad) * k, Math.min(r.n, 3), hw));
    }
    out.push({ name: 'head.hood', material: mat('head'), rings: rs, capStart: false, capEnd: true });
    // the cowl that drapes over the shoulders
    torsoShell('head.cowl', mat('head'), 'shoulder', -0.2, 'neckBase', 0, 4 * e + 0.025 * u, { flare: 0 });
  }
  if (id('neck') === 'furcollar') {
    out.push(shell('neck.fur', torso, tk('shoulder', -0.5), tk('neckBase', -0.05), { material: mat('neck'), inflate: 5 * e + 0.04 * u, cuffStart: true, cuffEnd: true, ragged: 0.03 * u, nBoost: -0.5 }));
  }
  if (id('hair') === 'ponytail' && hd !== 'hood' && hd !== 'divehelm' && hd !== 'divedome') {
    const r = at(0.7);
    const start: V3 = [0, d.chinY + 0.72 * hh, -(r.b + 0.04 * hh)];
    const pts: V3[] = [start, add(start, [0, -0.12 * hh, -0.08 * hh]), add(start, [0, -0.38 * hh, -0.1 * hh]), add(start, [0, -0.62 * hh, -0.06 * hh])];
    out.push(path('hair.ponytail', 'hair', pts, [0.08 * hh, 0.07 * hh, 0.06 * hh, 0.02 * hh], [hw, hw, W(['Head', 0.5], ['Neck', 0.5]), W(['Neck', 0.4], ['UpperChest', 0.6])]));
    out.push(box('hair.tie', mat('hair', true), add(start, [0, -0.06 * hh, -0.04 * hh]), [0.06 * hh, 0.03 * hh, 0.06 * hh], hw));
  }
}

