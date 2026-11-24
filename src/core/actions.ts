/**
 * Fighting, tools and pastimes: punches and kicks at three heights, sword and staff attacks,
 * chopping with an axe, digging with a shovel, sawing, hammering, welding and fishing.
 *
 * Tools are described, not modelled: every keyframe says where a tool is (in the upper-chest frame,
 * so it moves with the body) and which way it points, and the hands are solved onto it with
 * two-bone IK. The hand ↔ tool convention (exported as Socket_LeftHand_Tool / Socket_RightHand_Tool):
 * a shaft runs through the fist along the THUMB (+Z of the tool, toward the axe head / blade tip /
 * rod tip), and +Y of the tool is the direction the fingers point.
 */
import { add, cross, DEG, lerp, norm, qChain, qMul, Quat, qRotate, qx, qy, qz, QI, scale, sub, V3 } from './math';
import { Clip, Pose, worldPose } from './anim';
import { frameMap, solveArm } from './hold';
import type { Skeleton } from './skeleton';

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** smoothed keyframes for numbers */
const key = (times: number[], vals: number[], t: number) => {
  if (t <= times[0]) return vals[0];
  for (let i = 0; i < times.length - 1; i++) if (t <= times[i + 1]) return lerp(vals[i], vals[i + 1], ease((t - times[i]) / (times[i + 1] - times[i])));
  return vals[vals.length - 1];
};
/** smoothed keyframes for vectors */
const keyV = (times: number[], vals: V3[], t: number): V3 => [0, 1, 2].map((k) => key(times, vals.map((v) => v[k]), t)) as V3;

type WP = ReturnType<typeof worldPose>;
interface Grip {
  side: 1 | -1;
  /** palm position, upper-chest frame (metres) */
  at: V3;
  /** tool axis (through the fist along the thumb), upper-chest frame */
  axis: V3;
  /** fingers direction hint, upper-chest frame (made perpendicular to the axis) */
  fingers: V3;
  /** where the elbow points (world; x mirrored for the left arm) */
  elbow?: V3;
  /** at / axis / fingers are in world space instead of the upper-chest frame (targets out in the world) */
  world?: boolean;
  /** out of reach? slide the grip along the tool axis until the arm can reach (hands on a shaft) */
  slide?: boolean;
}

export function actionClips(sk: Skeleton, clips: Clip[]): Clip[] {
  const d = sk.dims;
  const u = d.u;
  const thighLen = d.hipY - d.kneeY;
  const shinLen = d.kneeY - d.ankleY;
  const armReach = d.upperArmLen + d.foreArmLen;
  const restDir = (s: number): V3 => norm([d.armDir[0] * s, d.armDir[1], 0]);
  const palmOff = (s: number): V3 => scale(restDir(s), d.handLen * 0.4);
  const clip = (n: string) => clips.find((c) => c.name === n)!;
  const idle = clip('Idle');

  /** leg rotations (thigh forward swing, knee bend, foot pitch; default keeps the foot flat) */
  const leg = (th: number, kn: number, foot = kn - th): [Quat, Quat, Quat] => [qx(-th * DEG), qx(kn * DEG), qx(-foot * DEG)];
  const drop = (th: number, kn: number) => thighLen * (1 - Math.cos(th * DEG)) + shinLen * (1 - Math.cos((kn - th) * DEG));
  const setLegs = (rot: Record<string, Quat>, l: [Quat, Quat, Quat], r: [Quat, Quat, Quat]) => {
    [rot.LeftUpperLeg, rot.LeftLowerLeg, rot.LeftFoot] = l;
    [rot.RightUpperLeg, rot.RightLowerLeg, rot.RightFoot] = r;
  };

  /** solve hands onto tools/targets given in the upper-chest frame of `pose` */
  const grips = (pose: Pose, rot: Record<string, Quat>, list: Grip[]) => {
    const wp: WP = worldPose(sk, { ...pose, rot });
    const ucP = wp.pos[sk.index.UpperChest];
    const ucR = wp.rot[sk.index.UpperChest];
    for (const g of list) {
      const R = g.world ? QI : ucR;
      const axis = norm(qRotate(R, g.axis));
      let fingers = qRotate(R, g.fingers);
      if (Math.abs(fingers[0] * axis[0] + fingers[1] * axis[1] + fingers[2] * axis[2]) > 0.98 * Math.hypot(...fingers)) fingers = cross(axis, [0, 1, 0]);
      // the thumb IS the tool axis (exact); the fingers wrap as close to the hint as they can
      const hand = frameMap([0, 0, 1], restDir(g.side), axis, fingers);
      let palm = g.world ? g.at : add(ucP, qRotate(ucR, g.at));
      if (g.slide) {
        const S = g.side > 0 ? 'Left' : 'Right';
        const A = wp.pos[sk.index[`${S}UpperArm`]];
        const reach = 0.98 * (armReach + d.handLen * 0.4);
        const o = sub(palm, A);
        const oo = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
        if (oo > reach * reach) {
          // |o + axis·k| = reach: the nearest k
          const b = o[0] * axis[0] + o[1] * axis[1] + o[2] * axis[2];
          const disc = b * b - (oo - reach * reach);
          const k = disc >= 0 ? (Math.abs(-b + Math.sqrt(disc)) < Math.abs(-b - Math.sqrt(disc)) ? -b + Math.sqrt(disc) : -b - Math.sqrt(disc)) : -b;
          palm = add(palm, scale(axis, k));
        }
      }
      solveArm(sk, { ...pose, rot }, g.side, sub(palm, qRotate(hand, palmOff(g.side))), hand, rot, g.elbow);
    }
  };
  /** body: idle breathing + twist (yaw), lean (pitch), side tilt, hips offset and legs */
  const body = (t: number, o: { yaw?: number; lean?: number; tilt?: number; hips?: V3; legs?: [[number, number, number?], [number, number, number?]]; head?: [number, number] }) => {
    const b = idle.sample(t % idle.duration);
    const rot: Record<string, Quat> = { ...b.rot };
    const yaw = o.yaw ?? 0;
    const lean = o.lean ?? 0;
    rot.Hips = qMul(qy(yaw * 0.25 * DEG), rot.Hips ?? QI);
    rot.Spine = qMul(qChain(qy(yaw * 0.3 * DEG), qx(lean * 0.5 * DEG), qz((o.tilt ?? 0) * 0.5 * DEG)), rot.Spine ?? QI);
    rot.Chest = qMul(qChain(qy(yaw * 0.25 * DEG), qx(lean * 0.3 * DEG), qz((o.tilt ?? 0) * 0.5 * DEG)), rot.Chest ?? QI);
    rot.UpperChest = qMul(qChain(qy(yaw * 0.2 * DEG), qx(lean * 0.2 * DEG)), rot.UpperChest ?? QI);
    // eyes on the work: undo most of the twist and lean, plus an optional look
    rot.Head = qMul(qChain(qy((-yaw * 0.6 + (o.head?.[1] ?? 0)) * DEG), qx((-lean * 0.6 + (o.head?.[0] ?? 0)) * DEG)), rot.Head ?? QI);
    let hy = b.hips[1];
    if (o.legs) {
      const [l, r] = o.legs;
      setLegs(rot, leg(l[0], l[1], l[2]), leg(r[0], r[1], r[2]));
      hy = -Math.min(drop(l[0], l[1]), drop(r[0], r[1]));
    }
    const h = o.hips ?? [0, 0, 0];
    return { rot, pose: { rot, hips: [h[0], hy + h[1], h[2]] as V3 } as Pose };
  };
  const out: Clip[] = [];
  const stance: [[number, number], [number, number]] = [[14, 22], [-12, 16]];

  // ───────────────────────────────────────────────────────── punches
  /** fists up by the chin, in the upper-chest frame */
  const guard = (s: number): V3 => [s * 0.1 * u, 0.13 * u, d.chestHD + 0.2 * u];
  const fistFwd = (s: number): Grip => ({ side: s as 1 | -1, at: guard(s), axis: [-s * 0.3, 0.9, 0.2], fingers: [-s * 0.2, -0.3, 1] });
  for (const s of [1, -1] as const) {
    for (const level of ['High', 'Mid', 'Low'] as const) {
      const T = 0.8;
      const times = [0, 0.1, 0.26, 0.38, 0.8];
      // target height relative to the upper chest: head, chest, belly
      const ty = { High: 0.2 * u, Mid: -0.04 * u, Low: -0.3 * u }[level];
      const crouch = { High: 0, Mid: 0.3, Low: 1 }[level];
      out.push({
        name: `Punch${s > 0 ? 'Left' : 'Right'}${level}`,
        duration: T,
        loop: false,
        sample: (t) => {
          const hit = key(times, [0, -0.2, 1, 1, 0], t);
          const twist = -s * 26 * hit;
          const l = stance[0];
          const r = stance[1];
          const k = 1 + 0.6 * crouch * Math.max(0, hit);
          const { rot, pose } = body(t, { yaw: twist, lean: 6 + 14 * crouch * Math.max(0, hit), legs: [[l[0] * k, l[1] * k], [r[0] * k, r[1] * k]] });
          // the target is out in the world, straight ahead on the centre line (the torso twists
          // into the punch, so it can't be fixed to the chest)
          const wp = worldPose(sk, pose);
          const ucP = wp.pos[sk.index.UpperChest];
          const ucR = wp.rot[sk.index.UpperChest];
          const sh = wp.pos[sk.index[s > 0 ? 'LeftUpperArm' : 'RightUpperArm']];
          const tgt: V3 = [0, ucP[1] + ty, sh[2] + armReach * 0.86];
          const g0 = fistFwd(s);
          const from = add(ucP, qRotate(ucR, g0.at));
          const e = Math.max(0, hit);
          const at: V3 = [lerp(from[0], tgt[0], e), lerp(from[1], tgt[1], e), lerp(from[2] - 0.15 * u * Math.max(0, -hit), tgt[2], e)];
          // the fist turns palm-down as it lands
          const ax0 = qRotate(ucR, g0.axis);
          const fi0 = qRotate(ucR, g0.fingers);
          const strike: Grip = { side: s, at, world: true, axis: [lerp(ax0[0], -s, e), lerp(ax0[1], 0.1, e), lerp(ax0[2], 0.1, e)], fingers: [lerp(fi0[0], 0, e), lerp(fi0[1], -0.6, e), lerp(fi0[2], 1, e)] };
          grips(pose, rot, [strike, fistFwd(-s)]);
          return pose;
        },
      });
    }
  }

  // ───────────────────────────────────────────────────────── kicks (front kicks)
  for (const s of [1, -1] as const) {
    for (const level of ['High', 'Mid', 'Low'] as const) {
      const T = 1.0;
      const times = [0, 0.22, 0.38, 0.52, 0.72, 1.0];
      const lift = { High: 100, Mid: 72, Low: 38 }[level];
      const leanBack = { High: 26, Mid: 12, Low: 2 }[level];
      const S = s > 0 ? 'Left' : 'Right';
      const O = s > 0 ? 'Right' : 'Left';
      out.push({
        name: `Kick${S}${level}`,
        duration: T,
        loop: false,
        sample: (t) => {
          const th = key(times, [0, lift * 0.8, lift, lift, lift * 0.7, 0], t);
          const kn = key(times, [8, 105, 8, 8, 100, 8], t);
          const up = key(times, [0, 1, 1, 1, 1, 0], t);
          const { rot, pose } = body(t, { lean: -leanBack * up, hips: [-s * 0.04 * u * up, 0, 0] });
          rot[`${S}UpperLeg`] = qx(-th * DEG);
          rot[`${S}LowerLeg`] = qx(kn * DEG);
          rot[`${S}Foot`] = qx(-12 * DEG); // toes pulled back: kick with the ball of the foot
          rot[`${O}UpperLeg`] = qx(-4 * DEG);
          rot[`${O}LowerLeg`] = qx(10 * DEG);
          rot[`${O}Foot`] = qx(-6 * DEG);
          pose.hips[1] = -drop(4, 10);
          grips(pose, rot, [fistFwd(1), fistFwd(-1)]);
          return pose;
        },
      });
    }
  }

  // ───────────────────────────────────────────────────────── one-handed sword (right hand)
  interface Frame { t: number; at: V3; axis: V3; fingers: V3; yaw: number; lean: number; lunge: number }
  const swordClip = (name: string, T: number, frames: Frame[]): Clip => ({
    name,
    duration: T,
    loop: false,
    sample: (t) => {
      const ts = frames.map((f) => f.t);
      const lunge = key(ts, frames.map((f) => f.lunge), t);
      const { rot, pose } = body(t, {
        yaw: key(ts, frames.map((f) => f.yaw), t),
        lean: key(ts, frames.map((f) => f.lean), t),
        hips: [0, 0, 0.06 * u * lunge],
        legs: [[14 + 22 * lunge, 22 + 26 * lunge], [-12 - 6 * lunge, 16 + 6 * lunge]],
      });
      const blade: Grip = { side: -1, at: keyV(ts, frames.map((f) => f.at), t), axis: keyV(ts, frames.map((f) => f.axis), t), fingers: keyV(ts, frames.map((f) => f.fingers), t) };
      // the free hand stays up and out for balance
      const free: Grip = { side: 1, at: [0.24 * u, -0.06 * u, d.chestHD + 0.1 * u], axis: [0, 1, 0.2], fingers: [0.3, 0, 1] };
      grips(pose, rot, [blade, free]);
      return pose;
    },
  });
  const swGuard: Omit<Frame, 't'> = { at: [-0.1 * u, -0.06 * u, d.chestHD + 0.26 * u], axis: [0.15, 0.65, 0.75], fingers: [1, 0, -0.2], yaw: 0, lean: 4, lunge: 0 };
  out.push(
    swordClip('SwordSlash', 1.1, [
      { t: 0, ...swGuard },
      { t: 0.32, at: [-0.34 * u, 0.2 * u, d.chestHD + 0.02 * u], axis: [-0.55, 0.55, -0.6], fingers: [0.3, 0.6, 0.6], yaw: -32, lean: 2, lunge: 0 },
      { t: 0.56, at: [0.2 * u, -0.02 * u, d.chestHD + 0.4 * u], axis: [0.92, 0.05, 0.38], fingers: [0, -1, 0.1], yaw: 28, lean: 8, lunge: 0.8 },
      { t: 0.74, at: [0.3 * u, -0.1 * u, d.chestHD + 0.26 * u], axis: [0.7, -0.25, -0.5], fingers: [0, -1, 0], yaw: 34, lean: 8, lunge: 0.7 },
      { t: 1.1, ...swGuard },
    ]),
    swordClip('SwordOverhead', 1.2, [
      { t: 0, ...swGuard },
      { t: 0.38, at: [-0.05 * u, 0.42 * u, d.chestHD + 0.04 * u], axis: [0.05, 0.4, -0.9], fingers: [1, 0, 0], yaw: -8, lean: -6, lunge: 0 },
      { t: 0.62, at: [-0.03 * u, -0.08 * u, d.chestHD + 0.42 * u], axis: [0, -0.08, 1], fingers: [1, 0, 0], yaw: 4, lean: 18, lunge: 1 },
      { t: 0.8, at: [-0.03 * u, -0.12 * u, d.chestHD + 0.4 * u], axis: [0, -0.25, 0.97], fingers: [1, 0, 0], yaw: 4, lean: 20, lunge: 1 },
      { t: 1.2, ...swGuard },
    ]),
    swordClip('SwordThrust', 0.9, [
      { t: 0, ...swGuard },
      { t: 0.28, at: [-0.16 * u, 0, d.chestHD + 0.08 * u], axis: [0.05, 0.1, 1], fingers: [1, -0.2, 0], yaw: -18, lean: 0, lunge: 0 },
      { t: 0.46, at: [-0.02 * u, 0.02 * u, d.chestHD + armReach * 0.98], axis: [0, 0.05, 1], fingers: [1, -0.2, 0], yaw: 12, lean: 10, lunge: 1 },
      { t: 0.58, at: [-0.02 * u, 0.02 * u, d.chestHD + armReach * 0.98], axis: [0, 0.05, 1], fingers: [1, -0.2, 0], yaw: 12, lean: 10, lunge: 1 },
      { t: 0.9, ...swGuard },
    ]),
  );

  // ───────────────────────────────────────────────────────── two-handed shaft tools
  interface ShaftFrame { t: number; base: V3; axis: V3; up: V3; yaw: number; lean: number; legs?: [[number, number], [number, number]]; hips?: V3 }
  /**
   * A shaft held in both hands: `base` is a point on it (upper-chest frame), `axis` points toward
   * its head; each hand grips at a distance along the axis, thumb toward the head, fingers wrapping
   * toward `up` turned 90° around the shaft.
   */
  const shaftClip = (name: string, T: number, loop: boolean, hands: { side: 1 | -1; at: number; wrap: number }[], frames: ShaftFrame[], extra?: (t: number, rot: Record<string, Quat>) => void): Clip => ({
    name,
    duration: T,
    loop,
    sample: (t) => {
      const ts = frames.map((f) => f.t);
      const lg = frames[0].legs ? ([0, 1].map((i) => [0, 1].map((j) => key(ts, frames.map((f) => f.legs![i][j]), t))) as [[number, number], [number, number]]) : undefined;
      const { rot, pose } = body(t, { yaw: key(ts, frames.map((f) => f.yaw), t), lean: key(ts, frames.map((f) => f.lean), t), legs: lg, hips: frames[0].hips ? keyV(ts, frames.map((f) => f.hips!), t) : undefined });
      extra?.(t, rot);
      const base = keyV(ts, frames.map((f) => f.base), t);
      const axis = norm(keyV(ts, frames.map((f) => f.axis), t));
      const up = keyV(ts, frames.map((f) => f.up), t);
      const side = norm(cross(axis, up));
      grips(
        pose,
        rot,
        hands.map((h) => ({ side: h.side, at: add(base, scale(axis, h.at)), axis, fingers: add(scale(norm(up), Math.cos(h.wrap * DEG)), scale(side, Math.sin(h.wrap * DEG))), slide: true })),
      );
      return pose;
    },
  });
  const wide: [[number, number], [number, number]] = [[10, 18], [-8, 14]];
  // staff: right hand near the middle, left hand toward the front end
  const staffHands = [{ side: -1 as const, at: -0.12 * u, wrap: 90 }, { side: 1 as const, at: 0.26 * u, wrap: 90 }];
  const stG = { base: [-0.05 * u, -0.12 * u, d.chestHD + 0.24 * u] as V3, axis: [0.25, 0.15, 0.95] as V3, up: [0, 1, 0] as V3, yaw: -6, lean: 4, legs: stance };
  out.push(
    shaftClip('StaffThrust', 0.9, false, staffHands, [
      { t: 0, ...stG },
      { t: 0.28, ...stG, base: [-0.1 * u, -0.1 * u, d.chestHD + 0.1 * u], yaw: -16 },
      { t: 0.46, ...stG, base: [0, -0.06 * u, d.chestHD + 0.42 * u], axis: [0.05, 0.1, 1], yaw: 10, lean: 10, legs: [[30, 44], [-16, 20]] },
      { t: 0.58, ...stG, base: [0, -0.06 * u, d.chestHD + 0.42 * u], axis: [0.05, 0.1, 1], yaw: 10, lean: 10, legs: [[30, 44], [-16, 20]] },
      { t: 0.9, ...stG },
    ]),
    shaftClip('StaffSwing', 1.1, false, staffHands, [
      { t: 0, ...stG },
      { t: 0.32, ...stG, base: [-0.14 * u, -0.02 * u, d.chestHD + 0.14 * u], axis: [-0.85, 0.25, 0.45], yaw: -34 },
      { t: 0.58, ...stG, base: [0.06 * u, -0.06 * u, d.chestHD + 0.3 * u], axis: [0.9, 0.05, 0.42], yaw: 32, lean: 8, legs: [[24, 36], [-14, 18]] },
      { t: 0.76, ...stG, base: [0.1 * u, -0.08 * u, d.chestHD + 0.22 * u], axis: [0.75, -0.1, -0.6], yaw: 38, lean: 8, legs: [[24, 36], [-14, 18]] },
      { t: 1.1, ...stG },
    ]),
    shaftClip('StaffOverhead', 1.2, false, staffHands, [
      { t: 0, ...stG },
      { t: 0.4, ...stG, base: [-0.02 * u, 0.3 * u, d.chestHD + 0.02 * u], axis: [0.1, 0.55, 0.82], yaw: -4, lean: -6 },
      { t: 0.66, ...stG, base: [0, -0.08 * u, d.chestHD + 0.32 * u], axis: [0.05, -0.65, 0.76], yaw: 4, lean: 22, legs: [[30, 46], [-14, 20]] },
      { t: 0.84, ...stG, base: [0, -0.1 * u, d.chestHD + 0.3 * u], axis: [0.05, -0.7, 0.7], yaw: 4, lean: 22, legs: [[30, 46], [-14, 20]] },
      { t: 1.2, ...stG },
    ]),
  );

  // axe: left hand at the end of the handle, right hand higher up; chop a tree at hip height, front left
  const axeHands = [{ side: 1 as const, at: 0, wrap: 90 }, { side: -1 as const, at: 0.3 * u, wrap: 90 }];
  const axG = { base: [-0.02 * u, -0.24 * u, d.chestHD + 0.18 * u] as V3, axis: [0.25, 0.3, 0.9] as V3, up: [0, 1, 0] as V3, yaw: 0, lean: 8, legs: wide };
  out.push(
    shaftClip('AxeChop', 1.6, true, axeHands, [
      { t: 0, ...axG },
      { t: 0.55, ...axG, base: [-0.26 * u, 0.12 * u, d.chestHD - 0.02 * u], axis: [-0.55, 0.65, -0.45], yaw: -38, lean: -2 },
      { t: 0.82, ...axG, base: [0.02 * u, -0.22 * u, d.chestHD + 0.3 * u], axis: [0.82, -0.28, 0.5], yaw: 28, lean: 18, legs: [[16, 28], [-6, 20]] },
      { t: 0.95, ...axG, base: [0.04 * u, -0.2 * u, d.chestHD + 0.28 * u], axis: [0.78, -0.2, 0.55], yaw: 26, lean: 17, legs: [[16, 28], [-6, 20]] },
      { t: 1.6, ...axG },
    ]),
  );

  // shovel: left hand on the top grip, right hand down the shaft; push in, pry, lift, toss right
  const shovelHands = [{ side: 1 as const, at: 0, wrap: 0 }, { side: -1 as const, at: 0.42 * u, wrap: 180 }];
  const shG = { base: [0.06 * u, -0.06 * u, d.chestHD + 0.2 * u] as V3, axis: [-0.05, -0.86, 0.5] as V3, up: [0, 0, 1] as V3, yaw: 0, lean: 12, legs: wide, hips: [0, 0, 0] as V3 };
  out.push(
    shaftClip(
      'ShovelDig',
      2.6,
      true,
      shovelHands,
      [
        { t: 0, ...shG },
        { t: 0.55, ...shG, base: [0.05 * u, -0.12 * u, d.chestHD + 0.24 * u], axis: [0, -0.93, 0.36], lean: 18 },
        { t: 1.0, ...shG, base: [0.07 * u, -0.06 * u, d.chestHD + 0.1 * u], axis: [0, -0.76, 0.65], lean: 8, hips: [0, 0, -0.03 * u] },
        { t: 1.5, ...shG, base: [0.06 * u, -0.12 * u, d.chestHD + 0.12 * u], axis: [-0.1, -0.3, 0.95], lean: 22, legs: [[30, 52], [22, 46]] },
        { t: 2.0, ...shG, base: [0.02 * u, -0.06 * u, d.chestHD + 0.12 * u], axis: [-0.75, -0.05, 0.65], up: [0.3, -0.6, 0.7], yaw: -38, lean: 10 },
        { t: 2.6, ...shG },
      ],
      // the right foot steps onto the blade to push it in
      (t, rot) => {
        const step = key([0, 0.25, 0.45, 0.62, 0.8, 2.6], [0, 0, 1, 0.6, 0, 0], t);
        if (step > 0) {
          rot.RightUpperLeg = qx(-30 * step * DEG);
          rot.RightLowerLeg = qx(55 * step * DEG);
          rot.RightFoot = qx(-(25 * step) * DEG);
        }
      },
    ),
  );

  // ───────────────────────────────────────────────────────── one-handed tools
  // saw: a board on a bench at hip height; saw strokes forward and back, the left hand holds the board
  out.push({
    name: 'Saw',
    duration: 0.9,
    loop: true,
    sample: (t) => {
      const st = Math.sin((t / 0.9) * Math.PI * 2);
      const { rot, pose } = body(t, { lean: 22, yaw: -6, legs: [[16, 24], [-8, 14]], head: [18, 0] });
      grips(pose, rot, [
        { side: -1, at: [-0.08 * u, -0.28 * u, d.chestHD + (0.24 + 0.12 * st) * u], axis: [0.02, 0.2, 1], fingers: [0.95, -0.2, 0], elbow: [0.2, -0.3, -1] },
        { side: 1, at: [0.2 * u, -0.36 * u, d.chestHD + 0.22 * u], axis: [-0.3, 0, 1], fingers: [0, -1, 0.2] },
      ]);
      return pose;
    },
  });
  // hammer: driving a nail into a wall at chest height; the left hand holds the nail
  out.push({
    name: 'Hammer',
    duration: 0.7,
    loop: true,
    sample: (t) => {
      const ts = [0, 0.32, 0.42, 0.5, 0.7];
      const lift = key(ts, [0, 1, 0, 0.05, 0], t);
      const { rot, pose } = body(t, { lean: 4, yaw: -8, legs: stance });
      grips(pose, rot, [
        { side: -1, at: [-0.08 * u, lerp(0.04, 0.16, lift) * u, d.chestHD + lerp(0.34, 0.2, lift) * u], axis: [0.05, lerp(0.98, 0.45, lift), lerp(0.1, -0.85, lift)], fingers: [1, lerp(0, 0.2, lift), lerp(0, 0.5, lift)] },
        { side: 1, at: [0.08 * u, 0.12 * u, d.chestHD + 0.42 * u], axis: [-0.2, 0.9, 0.3], fingers: [-1, 0, 0.3] },
      ]);
      return pose;
    },
  });
  // welding: crouched over the work, torch in the right hand, left hand steadying it
  const crouch = clip('Crouch');
  out.push({
    name: 'Weld',
    duration: 4,
    loop: true,
    sample: (t) => {
      const b = crouch.sample(t % crouch.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      rot.Spine = qMul(qx(12 * DEG), rot.Spine ?? QI);
      rot.Head = qMul(qx(26 * DEG), rot.Head ?? QI);
      const pose: Pose = { rot, hips: b.hips };
      const bead = -0.06 + 0.12 * (t / 4); // the torch travels along the seam
      const jig = 0.006 * Math.sin(t * 19);
      grips(pose, rot, [
        { side: -1, at: [(bead - 0.04) * u, -0.24 * u + jig * u, d.chestHD + 0.3 * u], axis: [0.1, -0.55, 0.83], fingers: [1, 0.2, 0.2] },
        { side: 1, at: [(bead + 0.06) * u, -0.25 * u, d.chestHD + 0.26 * u], axis: [-0.6, 0.2, 0.75], fingers: [-0.2, -1, 0.2] },
      ]);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── fishing
  // rod in the right hand (thumb along the rod), left hand on the butt (casting) or the reel
  const rodAt: V3 = [-0.1 * u, -0.08 * u, d.chestHD + 0.26 * u];
  const reelHand = (at: V3, axis: V3, crank: number): Grip => {
    const a = norm(axis);
    // the reel hangs just below and ahead of the grip; the handle circles beside it
    const c = add(add(at, scale(a, 0.07 * u)), [0.03 * u, -0.05 * u, 0]);
    const r = 0.035 * u;
    return { side: 1, at: [c[0] + 0.02 * u, c[1] + r * Math.cos(crank), c[2] + r * Math.sin(crank)], axis: [-1, 0, 0.2], fingers: [0, -0.6, 0.8] };
  };
  out.push({
    name: 'FishCast',
    duration: 1.8,
    loop: false,
    sample: (t) => {
      const ts = [0, 0.55, 0.85, 1.1, 1.8];
      const at = keyV(ts, [rodAt, [-0.13 * u, 0.24 * u, d.chestHD + 0.04 * u], [-0.08 * u, 0.06 * u, d.chestHD + 0.36 * u], [-0.09 * u, -0.04 * u, d.chestHD + 0.3 * u], rodAt], t);
      const axis = keyV(ts, [[0.05, 0.55, 0.83], [-0.1, 0.75, -0.65], [0, 0.45, 0.9], [0, 0.35, 0.94], [0.05, 0.5, 0.86]], t);
      const { rot, pose } = body(t, { yaw: key(ts, [0, -22, 10, 6, 0], t), lean: key(ts, [2, -6, 10, 6, 2], t), legs: stance });
      const butt = add(at, scale(norm(axis), -0.17 * u));
      grips(pose, rot, [
        { side: -1, at, axis, fingers: [1, 0, 0] },
        { side: 1, at: butt, axis, fingers: [-1, 0, 0] },
      ]);
      return pose;
    },
  });
  const fishHold = (name: string, T: number, crankSpeed: number) => ({
    name,
    duration: T,
    loop: true,
    sample: (t: number) => {
      const bob = 0.02 * Math.sin((t / T) * Math.PI * 2);
      const twitch = crankSpeed ? 0.04 * Math.sin((t / T) * Math.PI * 6) : 0;
      const axis: V3 = [0.05, 0.5 + bob + twitch, 0.86];
      const { rot, pose } = body(t, { lean: 3, legs: stance });
      grips(pose, rot, [{ side: -1, at: rodAt, axis, fingers: [1, 0, 0] }, reelHand(rodAt, axis, crankSpeed ? (t / T) * Math.PI * 2 * crankSpeed : 0.4)]);
      return pose;
    },
  });
  out.push(fishHold('FishIdle', 4, 0), fishHold('FishReel', 1.2, 2));
  return out;
}
