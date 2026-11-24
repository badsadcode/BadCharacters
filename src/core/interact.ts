/**
 * Clips where the body touches the world: crawling (hands on the floor), carrying things (a bag,
 * a duffle over the shoulder, a heavy box), and doors. Hands that touch something are placed with
 * the same two-bone IK as weapons (hold.ts), so they land where they should for every body shape.
 *
 * Conventions as everywhere: facing +Z, left = +X, metres, y = 0 is the floor.
 */
import { add, DEG, lerp, norm, qChain, qMul, Quat, qRotate, qx, qy, qz, QI, sub, V3 } from './math';
import { Clip, Pose, worldPose } from './anim';
import { frameMap, solveArm } from './hold';
import { actionClips } from './actions';
import type { Skeleton } from './skeleton';

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;
const pos = (x: number) => Math.max(0, x);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const keys = (k: [number, number][], t: number) => {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) return k[i][1] + (k[i + 1][1] - k[i][1]) * ease((t - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return k[k.length - 1][1];
};

export function interactionClips(sk: Skeleton, clips: Clip[]): Clip[] {
  const d = sk.dims;
  const W = (n: string) => sk.bones[sk.index[n]].world;
  const clip = (n: string) => clips.find((c) => c.name === n)!;
  const thighLen = d.hipY - d.kneeY;
  const restHipY = W('Hips')[1];
  const armReach = d.upperArmLen + d.foreArmLen;
  const shoulderAboveHips = W('RightUpperArm')[1] - restHipY;
  /** rest hand: fingers along the arm, thumb forward (+Z) */
  const restDir = (s: number): V3 => norm([d.armDir[0] * s, d.armDir[1], 0]);
  /** hand world orientation: fingers along `fingers`, thumb toward `thumb` */
  const handTo = (s: number, fingers: V3, thumb: V3): Quat => frameMap(restDir(s), [0, 0, 1], norm(fingers), norm(thumb));
  /** put a hand's PALM (not its wrist) at `p` */
  const palmToWrist = (p: V3, hand: Quat, s: number): V3 => sub(p, qRotate(hand, [restDir(s)[0] * d.handLen * 0.4, restDir(s)[1] * d.handLen * 0.4, 0]));
  const ik = (pose: Pose, rot: Record<string, Quat>, s: 1 | -1, palm: V3, hand: Quat, elbow?: V3) => solveArm(sk, { ...pose, rot }, s, palmToWrist(palm, hand, s), hand, rot, elbow);
  const out: Clip[] = [];

  // ───────────────────────────────────────────────────────── crawling
  /** on hands and knees: thighs straight down, shins flat on the floor, arms straight down */
  const crawlT = 1.5 * Math.sqrt(d.hipY / 0.9);
  const kneeFloor = Math.max(d.kneeR, 0.02 * d.H);
  const hipsUp = kneeFloor + thighLen;
  const handH = d.handHT * 0.6;
  // body pitch so straight arms reach the floor (clamped: long-armed bodies kneel more upright)
  const cosP = Math.max(0.05, Math.min(0.55, (armReach + handH - hipsUp) / shoulderAboveHips));
  const P = Math.acos(cosP) / DEG;
  out.push({
    name: 'Crawl',
    duration: crawlT,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / crawlT;
      const rot: Record<string, Quat> = {};
      rot.Hips = qChain(qx(P * DEG), qy(4 * sin(ph) * DEG));
      for (const s of [1, -1]) {
        const S = s > 0 ? 'Left' : 'Right';
        // contralateral: left hand with right knee
        const p = ph + (s > 0 ? 0 : Math.PI);
        const sw = 13 * sin(p);
        const lift = pos(cos(p)) * 12;
        const th = P + sw + lift * 0.3;
        rot[`${S}UpperLeg`] = qx(-th * DEG);
        rot[`${S}LowerLeg`] = qx((90 + th - P + lift) * DEG);
        rot[`${S}Foot`] = qx(80 * DEG);
      }
      rot.Neck = qx(-(P * 0.55) * DEG);
      rot.Head = qx(-(P * 0.25) * DEG);
      const pose: Pose = { rot, hips: [0, hipsUp - restHipY, 0] };
      const wp = worldPose(sk, pose);
      for (const s of [1, -1] as const) {
        const S = s > 0 ? 'Left' : 'Right';
        const sh = wp.pos[sk.index[`${S}UpperArm`]];
        const p = ph + (s > 0 ? Math.PI : 0);
        const reach = 0.12 * armReach * sin(p);
        const up = pos(cos(p)) * 0.05 * armReach;
        const palm: V3 = [sh[0] * 0.9, handH + up, sh[2] + reach];
        ik(pose, rot, s, palm, handTo(s, [0, 0, 1], [-s, 0, 0.3]), [0, 0, -1]);
      }
      return { rot, hips: pose.hips };
    },
  });

  /** army crawl: flat on the belly, elbows dragging, one knee drawn up at a time */
  const proneT = 2.2 * Math.sqrt(d.hipY / 0.9);
  const flatH = d.hipHD * 0.95;
  out.push({
    name: 'CrawlProne',
    duration: proneT,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / proneT;
      const rot: Record<string, Quat> = {};
      rot.Hips = qChain(qx(87 * DEG), qz(5 * sin(ph) * DEG), qy(5 * sin(ph) * DEG));
      for (const s of [1, -1]) {
        const S = s > 0 ? 'Left' : 'Right';
        const draw = pos(sin(ph + (s > 0 ? 0 : Math.PI)));
        // the knee slides up along the floor: twist the leg so the knee bends in the floor plane,
        // then swing it out to the side
        // turn out first, then bend: bending a knee that hasn't turned out points the foot at the sky
        rot[`${S}UpperLeg`] = qChain(qz(s * (8 + 48 * draw) * DEG), qy(s * 97 * Math.min(1, draw * 6) * DEG));
        rot[`${S}LowerLeg`] = qx(85 * Math.max(0, (draw - 0.12) / 0.88) * DEG);
        rot[`${S}Foot`] = qx((30 + 20 * draw) * DEG);
      }
      rot.Spine = qx(-6 * DEG);
      rot.Neck = qx(-48 * DEG);
      rot.Head = qx(-22 * DEG);
      const pose: Pose = { rot, hips: [0, flatH - restHipY, 0] };
      const wp = worldPose(sk, pose);
      for (const s of [1, -1] as const) {
        const S = s > 0 ? 'Left' : 'Right';
        const sh = wp.pos[sk.index[`${S}UpperArm`]];
        const reach = sin(ph + (s > 0 ? Math.PI : 0));
        // forearms flat on the floor ahead, palms down; the leading one reaches, the other pulls
        const palm: V3 = [sh[0] * 0.7, handH, sh[2] + armReach * (0.55 + 0.25 * reach)];
        ik(pose, rot, s, palm, handTo(s, [-s * 0.3, 0, 1], [-s, 0.2, 0]), [1, -0.4, -0.3]);
      }
      return { rot, hips: pose.hips };
    },
  });

  // ───────────────────────────────────────────────────────── carrying
  /** re-pose a base clip (idle / walk) with extra torso lean and some hand targets */
  const carry = (base: Clip, name: string, lean: Partial<Record<'Spine' | 'Chest' | 'Head', Quat>>, hands: (wp: ReturnType<typeof worldPose>, rot: Record<string, Quat>, pose: Pose) => void, slow = 1): Clip => ({
    name,
    duration: base.duration * slow,
    loop: base.loop,
    sample: (t) => {
      const p = base.sample(t / slow);
      const rot = { ...p.rot };
      for (const [k, q] of Object.entries(lean)) rot[k] = qMul(q, rot[k] ?? QI);
      const pose = { ...p, rot };
      hands(worldPose(sk, pose), rot, pose);
      return { ...p, rot };
    },
  });
  // a bag in the right hand: arm hangs straight, body leans away from the weight
  const bag = (wp: ReturnType<typeof worldPose>, rot: Record<string, Quat>, pose: Pose) => {
    const sh = wp.pos[sk.index.RightUpperArm];
    const palm: V3 = [sh[0] - 0.035 * d.H, sh[1] - armReach * 0.96 - d.handLen * 0.4, sh[2] + 0.01 * d.H];
    ik(pose, rot, -1, palm, handTo(-1, [0, -1, 0], [0, 0, 1]));
  };
  const bagLean = { Spine: qz(-5 * DEG), Chest: qz(-3 * DEG), Head: qz(5 * DEG) };
  // a duffle over the right shoulder: hand on the strap in front of the shoulder
  const duffle = (wp: ReturnType<typeof worldPose>, rot: Record<string, Quat>, pose: Pose) => {
    const ucW = wp.rot[sk.index.UpperChest];
    const sh = wp.pos[sk.index.RightUpperArm];
    const palm = add(sh, qRotate(ucW, [0.03 * d.H, -0.06 * d.H, d.chestHD * 0.9 + 0.02 * d.H]));
    ik(pose, rot, -1, palm, qMul(ucW, handTo(-1, [0.25, 1, 0.1], [0, 0, 1])), [0, -1, 0.3]);
  };
  const duffleLean = { Spine: qz(-3 * DEG), Chest: qz(-4 * DEG) };
  // a heavy box held in front, hands on its sides; lean back, slower steps
  const boxW = 0.2 * d.u;
  const box = (wp: ReturnType<typeof worldPose>, rot: Record<string, Quat>, pose: Pose) => {
    const ucW = wp.rot[sk.index.UpperChest];
    const centre = add(wp.pos[sk.index.UpperChest], qRotate(ucW, [0, -0.11 * d.H, d.chestHD + 0.21 * d.u]));
    for (const s of [1, -1] as const) {
      const palm = add(centre, qRotate(ucW, [s * boxW, -0.03 * d.u, 0]));
      ik(pose, rot, s, palm, qMul(ucW, handTo(s, [0, -0.25, 1], [0, 1, 0])), [0.5, -1, -0.2]);
    }
  };
  const boxLean = { Spine: qx(-7 * DEG), Chest: qx(-3 * DEG), Head: qx(5 * DEG) };
  out.push(
    carry(clip('Idle'), 'CarryBagIdle', bagLean, bag),
    carry(clip('Walk'), 'CarryBagWalk', bagLean, bag),
    carry(clip('Idle'), 'CarryDuffleIdle', duffleLean, duffle),
    carry(clip('Walk'), 'CarryDuffleWalk', duffleLean, duffle),
    carry(clip('Idle'), 'CarryBoxIdle', boxLean, box),
    carry(clip('Walk'), 'CarryBoxWalk', boxLean, box, 1.25),
  );

  // ───────────────────────────────────────────────────────── doors
  /**
   * A door in front (facing it), hinge on the character's left, handle on the right at hip-ish
   * height. Reach, press the handle, push the door open (30° away), let go. CloseDoor is the same
   * motion backwards: reach the open door's handle, pull it shut, let go.
   * Door, metres: hinge at x = +0.45·u, handle 0.8·u from the hinge, door plane 0.42·u ahead.
   */
  const doorT = 2.0;
  const hingeX = 0.45 * d.u;
  const doorZ = 0.42 * d.u;
  const handleR = 0.8 * d.u;
  const handleY = 0.56 * d.H;
  const doorPose = (t: number): Pose => {
    const reach = keys([[0, 0], [0.45, 1], [1.45, 1], [1.75, 0], [2.0, 0]], t);
    const press = keys([[0, 0], [0.45, 0], [0.6, 1], [0.8, 0.3], [2.0, 0.3]], t);
    const open = keys([[0, 0], [0.7, 0], [1.45, 1], [2.0, 1]], t);
    const lean = keys([[0, 0], [0.45, 0.4], [1.45, 1], [1.9, 0], [2.0, 0]], t);
    const base = clip('Idle').sample(t % clip('Idle').duration);
    const rot = { ...base.rot };
    rot.Spine = qMul(qx(9 * lean * DEG), rot.Spine ?? QI);
    rot.Chest = qMul(qChain(qx(5 * lean * DEG), qy(-8 * reach * DEG)), rot.Chest ?? QI);
    rot.Head = qMul(qy(-10 * reach * DEG), rot.Head ?? QI);
    const pose: Pose = { rot, hips: [0, base.hips[1] - 0.012 * d.H * lean, 0.05 * d.u * lean] };
    if (reach > 0.001) {
      const a = 30 * open * DEG;
      const handle: V3 = [hingeX - handleR * cos(a), handleY, doorZ + handleR * sin(a)];
      // the hand travels from where it hangs to the handle
      const wp = worldPose(sk, pose);
      const sh = wp.pos[sk.index.RightUpperArm];
      const rest: V3 = [sh[0] - 0.02 * d.H, sh[1] - armReach * 0.95, sh[2] + 0.03 * d.H];
      const palm: V3 = [lerp(rest[0], handle[0], reach), lerp(rest[1], handle[1], reach), lerp(rest[2], handle[2], reach)];
      // fingers over the lever, pressing it down; the hand turns with the door
      const hand = qChain(qy(-a), qz(-25 * press * DEG), handTo(-1, [0, -0.5, 1], [1, 0.3, 0]));
      ik(pose, rot, -1, palm, hand, [0.4, -1, -0.2]);
    }
    return pose;
  };
  const doorInfo = { hinge: [hingeX, 0, doorZ], handleFromHinge: handleR, handleHeight: handleY, openDeg: 30, pushStart: 0.7, pushEnd: 1.45 };
  out.push({ name: 'OpenDoor', duration: doorT, loop: false, sample: doorPose, info: doorInfo });
  out.push({ name: 'CloseDoor', duration: doorT, loop: false, sample: (t) => doorPose(doorT - t), info: { ...doorInfo, pullStart: doorT - 1.45, pullEnd: doorT - 0.7 } });
  return out;
}

/** all clips with the interaction clips inserted before RestPose (which stays last) */
export function withInteractions(sk: Skeleton, clips: Clip[]): Clip[] {
  const rest = clips.filter((c) => c.name === 'RestPose');
  const others = clips.filter((c) => c.name !== 'RestPose');
  const inter = interactionClips(sk, clips);
  return [...others, ...inter, ...actionClips(sk, clips), ...rest];
}
