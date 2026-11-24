/**
 * Holding a real weapon. Given where a weapon's hands go (BadGun-style sockets in the weapon's own
 * frame: grip at the origin, +Z = muzzle, +Y = up, +X = the character's left), this builds clips in
 * which the gun sits where it should and both arms reach it with two-bone IK, every frame.
 *
 * The hand ↔ weapon convention (also exported as Socket_RightHand_Weapon / Socket_LeftHand_Weapon):
 * a fist around a grip has the barrel running along the fingers and the gun's "up" along the
 * thumb. In the rest pose that's: +Z(weapon) = the hand's pointing direction, +Y(weapon) = +Z(world)
 * (where the thumb points), origin in the middle of the palm.
 */
import { add, cross, dot, len, lerp, norm, qAxis, qMul, Quat, qRotate, scale, sub, V3, DEG, QI, qx, qy, qz, qChain } from './math';
import { Clip, Pose, worldPose } from './anim';
import type { Skeleton } from './skeleton';

export interface WeaponHold {
  /** long guns (stocked: rifles, SMGs, shotguns, snipers, LMGs, crossbows) or one-handed (pistols) */
  kind: 'long' | 'pistol';
  /** trigger-hand grip is the weapon origin; these are in the weapon frame (metres) */
  support?: V3;
  shoulder?: V3;
  ads?: V3;
  muzzle?: V3;
  /** a label for exports */
  name?: string;
}

const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** torso turn for long guns (deg): support shoulder forward */
const BLADE = 34;

/** rotation taking the orthonormal frame (a1, b1) onto (a2, b2) (b is made perpendicular to a) */
export function frameMap(a1: V3, b1: V3, a2: V3, b2: V3): Quat {
  const basis = (a: V3, b: V3) => {
    const x = norm(a);
    const y = norm(sub(b, scale(x, dot(b, x))));
    return [x, y, cross(x, y)];
  };
  const [x1, y1, z1] = basis(a1, b1);
  const [x2, y2, z2] = basis(a2, b2);
  // R = M2 · M1ᵀ
  const m = (r: number, c: number) => x2[r] * x1[c] + y2[r] * y1[c] + z2[r] * z1[c];
  const tr = m(0, 0) + m(1, 1) + m(2, 2);
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m(2, 1) - m(1, 2)) / s, (m(0, 2) - m(2, 0)) / s, (m(1, 0) - m(0, 1)) / s, 0.25 * s];
  } else if (m(0, 0) > m(1, 1) && m(0, 0) > m(2, 2)) {
    const s = Math.sqrt(1 + m(0, 0) - m(1, 1) - m(2, 2)) * 2;
    q = [0.25 * s, (m(0, 1) + m(1, 0)) / s, (m(0, 2) + m(2, 0)) / s, (m(2, 1) - m(1, 2)) / s];
  } else if (m(1, 1) > m(2, 2)) {
    const s = Math.sqrt(1 + m(1, 1) - m(0, 0) - m(2, 2)) * 2;
    q = [(m(0, 1) + m(1, 0)) / s, 0.25 * s, (m(1, 2) + m(2, 1)) / s, (m(0, 2) - m(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + m(2, 2) - m(0, 0) - m(1, 1)) * 2;
    q = [(m(0, 2) + m(2, 0)) / s, (m(1, 2) + m(2, 1)) / s, 0.25 * s, (m(1, 0) - m(0, 1)) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** the weapon attach frame on a hand, in the rest pose (position relative to the hand joint) */
export function handWeaponFrame(sk: Skeleton, side: 1 | -1): { offset: V3; rot: Quat } {
  const d = sk.dims;
  const dir: V3 = norm([d.armDir[0] * side, d.armDir[1], 0]);
  // weapon +Z along the fingers, weapon +Y along the thumb (world +Z in the rest pose)
  const rot = frameMap([0, 0, 1], [0, 1, 0], dir, [0, 0, 1]);
  return { offset: scale(dir, d.handLen * 0.45), rot };
}

/** two-bone IK for one arm; writes UpperArm, LowerArm and Hand local rotations into `rot` */
function solveArm(sk: Skeleton, pose: Pose, side: 1 | -1, wristTarget: V3, handWorld: Quat, rot: Record<string, Quat>) {
  const S = side > 0 ? 'Left' : 'Right';
  const d = sk.dims;
  const B = (n: string) => sk.bones[sk.index[n]];
  const wp = worldPose(sk, { ...pose, rot });
  const sh = B(`${S}UpperArm`);
  const A = wp.pos[sk.index[`${S}UpperArm`]];
  const parentRot = wp.rot[sh.parent];
  const l1 = len(sub(B(`${S}LowerArm`).world, sh.world));
  const l2 = len(sub(B(`${S}Hand`).world, B(`${S}LowerArm`).world));
  const toT = sub(wristTarget, A);
  const dist = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, len(toT)));
  const ax = norm(toT);
  // elbows hang down and a little out and back
  const pole0: V3 = [side * 0.45, -1, -0.25];
  const pole = norm(sub(pole0, scale(ax, dot(pole0, ax))));
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const E = add(add(A, scale(ax, a)), scale(pole, h));
  const T = add(A, scale(ax, dist));
  const u = norm(sub(E, A));
  const v = norm(sub(T, E));
  // rest: arm straight along armDir, elbow hinge cross(Z, dir); a negative turn about it folds forward
  const dir0: V3 = norm([d.armDir[0] * side, d.armDir[1], 0]);
  const h0 = norm(cross([0, 0, 1], dir0));
  const bend = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  // a straight arm has no bend plane: keep the hinge where the elbow would naturally bend
  const hw = len(cross(v, u)) > 1e-6 ? norm(cross(v, u)) : norm(cross([0, 0, 1], u));
  const upperWorld = frameMap(dir0, h0, u, hw);
  const lower = qAxis(h0, -bend);
  rot[`${S}UpperArm`] = qMul(inv(parentRot), upperWorld);
  rot[`${S}LowerArm`] = lower;
  rot[`${S}Hand`] = qMul(inv(qMul(upperWorld, lower)), handWorld);
}

/**
 * Re-pose the arms of `base` so the weapon (with this hold) sits at `place(world pose)` and both
 * hands are on it. `place` returns the weapon's world position (grip) and rotation.
 */
function holding(
  sk: Skeleton,
  hold: WeaponHold,
  base: Clip,
  name: string,
  place: (wp: ReturnType<typeof worldPose>, t: number) => { pos: V3; rot: Quat; head?: Quat },
  /** bladed stance: turn the torso right by this much (deg) so the support shoulder comes forward */
  blade = 0,
): Clip {
  const fr = handWeaponFrame(sk, -1);
  const frL = handWeaponFrame(sk, 1);
  return {
    name,
    duration: base.duration,
    loop: base.loop,
    sample: (t) => {
      const p = base.sample(t);
      const rot = { ...p.rot };
      if (blade) {
        rot.Spine = qMul(qy((-blade * 0.4) * DEG), rot.Spine ?? QI);
        rot.Chest = qMul(qy((-blade * 0.35) * DEG), rot.Chest ?? QI);
        rot.UpperChest = qMul(qy((-blade * 0.25) * DEG), rot.UpperChest ?? QI);
        // eyes stay on the target
        rot.Neck = qMul(qy(blade * 0.5 * DEG), rot.Neck ?? QI);
        rot.Head = qMul(qy(blade * 0.5 * DEG), rot.Head ?? QI);
      }
      const wp0 = worldPose(sk, { ...p, rot });
      const w = place(wp0, t);
      if (w.head) rot.Head = qMul(rot.Head ?? QI, w.head);
      // trigger hand: the weapon frame on the hand must land on the weapon's grip frame
      const rHand = qMul(w.rot, inv(fr.rot));
      solveArm(sk, p, -1, sub(w.pos, qRotate(rHand, fr.offset)), rHand, rot);
      // support hand: under the handguard (long guns) or wrapped around the trigger hand (pistols)
      if (hold.support) {
        let sp = add(w.pos, qRotate(w.rot, hold.support));
        // out of reach (long barrel, short arms)? grip the handguard further back, the way a person
        // would, but never behind the magazine well
        const A = wp0.pos[sk.index.LeftUpperArm];
        const reach = 0.97 * (len(sub(sk.bones[sk.index.LeftLowerArm].world, sk.bones[sk.index.LeftUpperArm].world)) + len(sub(sk.bones[sk.index.LeftHand].world, sk.bones[sk.index.LeftLowerArm].world)) + sk.dims.handLen * 0.36);
        if (hold.kind === 'long' && len(sub(sp, A)) > reach) {
          const back = qRotate(w.rot, [0, 0, -1]);
          const maxSlide = Math.max(0, hold.support[2] - 0.12);
          // |sp + back·k − A| = reach  →  k² + 2k(back·(sp−A)) + |sp−A|² − reach² = 0
          const o = sub(sp, A);
          const bq = dot(back, o);
          const disc = bq * bq - (dot(o, o) - reach * reach);
          const k = disc >= 0 ? Math.min(maxSlide, -bq - Math.sqrt(disc)) : maxSlide;
          sp = add(sp, scale(back, Math.max(0, k)));
        }
        const gx = qRotate(w.rot, [1, 0, 0]);
        const gy = qRotate(w.rot, [0, 1, 0]);
        const gz = qRotate(w.rot, [0, 0, 1]);
        // fingers wrap from the left side toward the right; thumb along the barrel (long) or up (pistol)
        const fingers = hold.kind === 'long' ? norm(add(scale(gx, -0.75), scale(gy, -0.35))) : norm(add(scale(gx, -0.8), scale(gy, -0.25)));
        const thumb = hold.kind === 'long' ? gz : norm(add(gz, gy));
        const lHand = frameMap(norm([sk.dims.armDir[0], sk.dims.armDir[1], 0]), [0, 0, 1], fingers, thumb);
        // the palm, not the wrist, goes to the support point
        solveArm(sk, p, 1, sub(sp, qRotate(lHand, scale(frL.offset, 0.8))), lHand, rot);
      }
      return { ...p, rot };
    },
  };
}

/** clips for this weapon, built from the character's own aim/ready/walk clips */
export function weaponClips(sk: Skeleton, clips: Clip[], hold: WeaponHold): Clip[] {
  const d = sk.dims;
  const clip = (n: string) => clips.find((c) => c.name === n)!;
  const ix = (n: string) => sk.index[n];
  const armLen = d.upperArmLen + d.foreArmLen;
  if (hold.kind === 'long') {
    const shoulder = hold.shoulder ?? [0, 0.02, -0.3];
    /** butt in the right shoulder pocket (in the upper-chest frame), weapon pitched / yawed */
    const longGun = (pitch: number, yaw: number) => (wp: ReturnType<typeof worldPose>) => {
      const uc = ix('UpperChest');
      const ucW = wp.rot[uc];
      const shR = wp.pos[ix('RightUpperArm')];
      const pocketLocal: V3 = [0, -0.035 * d.H, d.chestHD * 0.7];
      const pocket = add(add(shR, [d.shoulderX * 0.35, 0, 0]), qRotate(ucW, pocketLocal));
      const r = qChain(qy(yaw * DEG), qx(pitch * DEG));
      return { pos: sub(pocket, qRotate(r, shoulder)), rot: r, head: pitch < 5 ? qChain(qx(12 * DEG), qz(-8 * DEG)) : undefined };
    };
    return [
      holding(sk, hold, clip('RifleAim'), 'RifleAim', longGun(0, 3), BLADE),
      holding(sk, hold, clip('RifleReady'), 'RifleReady', longGun(38, 22), BLADE),
      holding(sk, hold, clip('Walk'), 'RifleReadyWalk', longGun(38, 22), BLADE * 0.7),
    ];
  }
  // pistols: two-handed, out in front at eye level (aim) or low and close (ready)
  const pistol = (reach: number, drop: number, pitch: number) => (wp: ReturnType<typeof worldPose>) => {
    const uc = ix('UpperChest');
    const ucW = wp.rot[uc];
    const sh = lerp(wp.pos[ix('RightUpperArm')][1], wp.pos[ix('LeftUpperArm')][1], 0.5);
    const centre: V3 = [wp.pos[uc][0], sh, wp.pos[uc][2]];
    const local: V3 = [-0.02 * d.H, -drop * d.H, armLen * reach];
    const r = qChain(qx(pitch * DEG));
    return { pos: add(centre, qRotate(ucW, local)), rot: r };
  };
  return [
    holding(sk, hold, clip('RifleAim'), 'PistolAim', pistol(0.86, 0.01, 0)),
    holding(sk, hold, clip('RifleReady'), 'PistolReady', pistol(0.5, 0.12, 45)),
    holding(sk, hold, clip('Walk'), 'PistolReadyWalk', pistol(0.5, 0.12, 45)),
  ];
}

/** hold profile from a BadGun manifest (or any list of SOCKET_* nodes in the weapon frame) */
export function holdFromSockets(sockets: { name: string; position: V3 }[], archetype?: string): WeaponHold {
  const s = (n: string) => sockets.find((x) => x.name === n)?.position;
  const long = !!s('SOCKET_Shoulder') || (archetype !== undefined && archetype !== 'pistol' && archetype !== 'bow');
  return { kind: long ? 'long' : 'pistol', support: s('SOCKET_Hand_Support'), shoulder: s('SOCKET_Shoulder'), ads: s('SOCKET_ADS'), muzzle: s('SOCKET_Muzzle'), name: archetype };
}
