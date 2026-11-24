/**
 * Markers → our standard 25-bone humanoid skeleton (same names, same identity rest rotations,
 * same conventions as generated characters), plus the handful of proportions the procedural
 * clips read (`Dims`), measured from the imported mesh.
 */
import { add, len, lerp, norm, scale, sub, V3 } from '../core/math';
import type { Bone, BoneName, Dims, Skeleton, Socket } from '../core/skeleton';
import { Markers, slice, weldIds } from './markers';
import type { Model } from './model';

export interface Fitted {
  skeleton: Skeleton;
  /** end points used for skinning the end bones */
  tips: { head: V3; handL: V3; handR: V3; toeL: V3; toeR: V3 };
}

export function fitSkeleton(mk: Markers, model: Model): Fitted {
  const H = model.height;
  const pos = model.positions;
  const tris = model.triangles;
  const weld = weldIds(pos, H);
  const widthAt = (y: number) => {
    const isl = slice(pos, tris, weld, y).find((i) => i.x0 < 0 && i.x1 > 0);
    return isl ? { hw: Math.min(-isl.x0, isl.x1), hd: (isl.z1 - isl.z0) / 2, zc: (isl.z0 + isl.z1) / 2 } : { hw: 0.1 * H, hd: 0.06 * H, zc: 0 };
  };

  const hipY = mk.groin[1] + 0.045 * H;
  const tl = mk.neck[1] - hipY;
  const zAt = (t: number) => lerp(mk.groin[2], mk.neck[2], t);
  const u = mk.neck[1] / 1.49;
  const bones: Bone[] = [];
  const index: Record<string, number> = {};
  const add_ = (name: BoneName, parent: BoneName | null, world: V3) => {
    index[name] = bones.length;
    bones.push({ name, parent: parent ? index[parent] : -1, world });
  };
  const chinY = mk.chin[1];
  const headH = H - chinY;
  add_('Root', null, [0, 0, 0]);
  add_('Hips', 'Root', [0, hipY, mk.groin[2]]);
  add_('Spine', 'Hips', [0, hipY + 0.2 * tl, zAt(0.2)]);
  add_('Chest', 'Spine', [0, hipY + 0.45 * tl, zAt(0.45)]);
  add_('UpperChest', 'Chest', [0, hipY + 0.7 * tl, zAt(0.7)]);
  add_('Neck', 'UpperChest', [0, mk.neck[1] - 0.02 * tl, mk.neck[2]]);
  add_('Head', 'Neck', [0, chinY + 0.12 * headH, lerp(mk.neck[2], mk.chin[2], 0.3)]);

  // how far each hand reaches past the wrist: the farthest vertex along the forearm direction
  const handReach = (wr: V3, el: V3, s: number) => {
    const d = norm(sub(wr, el));
    let far = 0.06 * H;
    for (let i = 0; i < pos.length; i += 3) {
      if (s * pos[i] <= 0) continue;
      const v: V3 = [pos[i] - wr[0], pos[i + 1] - wr[1], pos[i + 2] - wr[2]];
      const along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
      const off = len(sub(v, scale(d, along)));
      if (along > 0 && along < 0.2 * H && off < 0.06 * H) far = Math.max(far, along);
    }
    return far;
  };
  const handLens: number[] = [];
  const tipsHand: V3[] = [];
  for (const s of [1, -1] as const) {
    const k = s > 0 ? 'L' : 'R';
    const side = s > 0 ? 'Left' : 'Right';
    const sh = mk[`shoulder.${k}`];
    const el = mk[`elbow.${k}`];
    const wr = mk[`wrist.${k}`];
    const hl = handReach(wr, el, s);
    handLens.push(hl);
    const dir = norm(sub(wr, el));
    tipsHand.push(add(wr, scale(dir, hl)));
    add_(`${side}Shoulder` as BoneName, 'UpperChest', [s * Math.min(0.03 * u, Math.abs(sh[0]) * 0.3), sh[1] + 0.02 * tl, sh[2]]);
    add_(`${side}UpperArm` as BoneName, `${side}Shoulder` as BoneName, sh);
    add_(`${side}LowerArm` as BoneName, `${side}UpperArm` as BoneName, el);
    add_(`${side}Hand` as BoneName, `${side}LowerArm` as BoneName, wr);
    add_(`${side}ThumbProximal` as BoneName, `${side}Hand` as BoneName, add(add(wr, scale(dir, hl * 0.2)), [0, 0, hl * 0.2]));
  }
  const toeTips: V3[] = [];
  for (const s of [1, -1] as const) {
    const k = s > 0 ? 'L' : 'R';
    const side = s > 0 ? 'Left' : 'Right';
    const kn = mk[`knee.${k}`];
    const an = mk[`ankle.${k}`];
    const to = mk[`toes.${k}`];
    const hipX = s * Math.max(0.05 * H, Math.abs(kn[0]) * 0.9);
    add_(`${side}UpperLeg` as BoneName, 'Hips', [hipX, hipY, mk.groin[2]]);
    add_(`${side}LowerLeg` as BoneName, `${side}UpperLeg` as BoneName, kn);
    add_(`${side}Foot` as BoneName, `${side}LowerLeg` as BoneName, an);
    add_(`${side}Toes` as BoneName, `${side}Foot` as BoneName, to);
    const fwd = sub(to, an);
    toeTips.push([to[0] + fwd[0] * 0.45, to[1] * 0.6, to[2] + fwd[2] * 0.45]);
  }

  const avg = (a: number, b: number) => (a + b) / 2;
  const L = (k: 'L' | 'R') => ({ sh: mk[`shoulder.${k}`], el: mk[`elbow.${k}`], wr: mk[`wrist.${k}`] });
  const l = L('L');
  const r = L('R');
  const dl = norm(sub(l.wr, l.sh));
  const dr = norm(sub(r.wr, r.sh));
  const armDir = norm([(dl[0] - dr[0]) / 2, (dl[1] + dr[1]) / 2, 0]);
  const chest = widthAt(hipY + 0.7 * tl);
  const waist = widthAt(hipY + 0.38 * tl);
  const hip = widthAt(hipY);
  const kneeY = avg(mk['knee.L'][1], mk['knee.R'][1]);
  const ankleY = avg(mk['ankle.L'][1], mk['ankle.R'][1]);
  const footLen = Math.max(0.05 * H, avg(len(sub(mk['toes.L'], mk['ankle.L'])), len(sub(mk['toes.R'], mk['ankle.R']))) / 0.52);
  const handLen = avg(handLens[0], handLens[1]);
  const shoulderX = avg(Math.abs(l.sh[0]), Math.abs(r.sh[0]));
  const upperArmLen = avg(len(sub(l.el, l.sh)), len(sub(r.el, r.sh)));
  const foreArmLen = avg(len(sub(l.wr, l.el)), len(sub(r.wr, r.el)));
  const limb = 0.022 * H;
  const dims: Dims = {
    H, u, headH, headHW: 0.07 * H, headHD: 0.075 * H, chinY, neckBaseY: mk.neck[1], neckR: 0.03 * H,
    hipY, torsoLen: tl, shoulderY: avg(l.sh[1], r.sh[1]), shoulderX, shoulderHW: shoulderX + limb,
    chestHW: chest.hw, chestHD: chest.hd, waistHW: waist.hw, waistHD: waist.hd, hipHW: hip.hw, hipHD: hip.hd,
    belly: 0, breast: 0, pecs: 0, butt: 0, hipJX: Math.abs(bones[index.LeftUpperLeg].world[0]),
    kneeY, ankleY, thighR: 0.045 * H, midThighR: 0.04 * H, kneeR: 0.03 * H, calfR: 0.033 * H, ankleR: 0.02 * H,
    footLen, footHW: footLen * 0.2, armDir, upperArmLen, foreArmLen, handLen, handHW: handLen * 0.3, handHT: handLen * 0.12,
    deltR: limb * 1.2, upperArmR: limb, elbowR: limb * 0.85, foreArmR: limb, wristR: limb * 0.7,
    n: 2.5, eyeLine: 0.47, faceScale: 1, jaw: 1, ears: 'round', earScale: 1, noseScale: 1, tusks: false, hunch: 0,
    eyeSize: 1, eyeSpacing: 1, mouthWidth: 1, armL: 1, armR: 1, mutant: false,
  };

  const sockets: Socket[] = [
    { name: 'Socket_HeadTop', bone: 'Head', world: [0, H, bones[index.Head].world[2]] },
    { name: 'Socket_Back', bone: 'UpperChest', world: [0, hipY + 0.62 * tl, chest.zc - chest.hd * 1.05] },
  ];
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'Left' : 'Right';
    const wr = bones[index[`${side}Hand`]].world;
    const tip = tipsHand[s > 0 ? 0 : 1];
    sockets.push({ name: `Socket_${side}Hand`, bone: `${side}Hand`, world: lerp3(wr, tip, 0.5) });
    sockets.push({ name: `Socket_${side}Hip`, bone: 'Hips', world: [s * hip.hw * 1.05, hipY + 0.05 * tl, hip.zc] });
  }
  return {
    skeleton: { bones, sockets, dims, index },
    tips: { head: [0, H, bones[index.Head].world[2]], handL: tipsHand[0], handR: tipsHand[1], toeL: toeTips[0], toeR: toeTips[1] },
  };
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
