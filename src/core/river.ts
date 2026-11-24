/**
 * River work, for a raft: steering with a sweep oar, poling, dropping and hauling the anchor,
 * climbing out of the water onto the deck, and carrying a lantern.
 *
 * The oar, pole, rope and deck are described, not modelled: every clip's `info` (exported into the
 * animation's extras) says where they are, in metres, from the clip's origin (the feet), facing +Z.
 */
import { add, DEG, lerp, norm, qMul, Quat, qx, qy, qz, QI, scale, sub, V3 } from './math';
import { Clip, Pose, worldPose } from './anim';
import type { Grip, Kit } from './actions';

const TAU = Math.PI * 2;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const key = (times: number[], vals: number[], t: number) => {
  if (t <= times[0]) return vals[0];
  for (let i = 0; i < times.length - 1; i++) if (t <= times[i + 1]) return lerp(vals[i], vals[i + 1], ease((t - times[i]) / (times[i + 1] - times[i])));
  return vals[vals.length - 1];
};
const keyV = (times: number[], vals: V3[], t: number): V3 => [0, 1, 2].map((k) => key(times, vals.map((v) => v[k]), t)) as V3;
const mix = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

export function riverClips(kit: Kit): Clip[] {
  const { sk, clips, grips, body, leg, restHipY } = kit;
  const d = sk.dims;
  const u = d.u;
  const H = d.H;
  const armReach = d.upperArmLen + d.foreArmLen;
  const clip = (n: string) => clips.find((c) => c.name === n)!;
  const out: Clip[] = [];

  /** hands hanging by the sides (world) */
  const hanging = (pose: Pose): Grip[] => {
    const wp = worldPose(sk, pose);
    return ([1, -1] as const).map((s) => {
      const sh = wp.pos[sk.index[s > 0 ? 'LeftUpperArm' : 'RightUpperArm']];
      return { side: s, at: [sh[0] + s * 0.03 * u, sh[1] - armReach * 0.95 - d.handLen * 0.35, sh[2] + 0.02 * u], world: true, axis: [0, 0, 1], fingers: [0, -1, 0] } as Grip;
    });
  };
  /** blend two grip lists (same sides, same order) */
  const blendGrips = (a: Grip[], b: Grip[], k: number): Grip[] => a.map((g, i) => ({ ...g, at: mix(g.at, b[i].at, k), axis: mix(g.axis, b[i].axis, k), fingers: mix(g.fingers, b[i].fingers, k) }));

  // ───────────────────────────────────────────────────────── sweep oar
  /**
   * A long steering oar over the stern, pivoting on a crutch ahead of the oarsman: he faces the
   * pivot with both hands on the handle (overhand, thumbs toward the blade) and walks the handle
   * left and right. The shaft runs forward and down from the handle at `slope` toward the pivot.
   */
  const oarSlope = 0.33;
  const pivotDist = 2.2 * (H / 1.8);
  const handle: V3 = [-0.07 * u, 0.56 * H, 0.27 * H];
  const pivot: V3 = add(handle, [0, -pivotDist * Math.sin(oarSlope), pivotDist * Math.cos(oarSlope)]);
  const oarInfo = { handle, pivot, slope: oarSlope, sweepDeg: 9 };
  const oarAt = (deg: number) => {
    // the handle swings around the pivot; the blade goes the other way
    const a = deg * DEG;
    const back = [Math.sin(a) * Math.cos(oarSlope), Math.sin(oarSlope), -Math.cos(a) * Math.cos(oarSlope)] as V3;
    const h = add(pivot, scale(back, pivotDist));
    return { h, axis: scale(back, -1) };
  };
  const oarGrips = (deg: number): Grip[] => {
    const { h, axis } = oarAt(deg);
    // right hand at the end, left hand further along
    return [
      { side: 1, at: add(h, scale(axis, 0.24 * u)), axis, fingers: [0.8, -0.4, 0], world: true, slide: true, elbow: [1, -1, -0.3] },
      { side: -1, at: h, axis, fingers: [-0.8, -0.4, 0], world: true, slide: true, elbow: [1, -1, -0.3] },
    ];
  };
  const oarClip = (name: string, T: number, amp: number, effort: number): Clip => ({
    name,
    duration: T,
    loop: true,
    info: { ...oarInfo, sweepDeg: amp },
    sample: (t) => {
      const ph = (TAU * t) / T;
      // a held push one way, a quick swing through, a push the other way
      const sw = Math.sin(ph) + 0.18 * Math.sin(3 * ph);
      const deg = amp * sw;
      const { h } = oarAt(deg);
      const push = Math.cos(ph); // the push leads the swing
      const { rot, pose } = body(t, {
        yaw: -deg * 0.7,
        lean: 14 + 6 * effort * Math.abs(push),
        tilt: -deg * 0.6 * effort,
        hips: [(h[0] - handle[0]) * 0.65, 0, -0.03 * u * effort * Math.abs(push)],
        legs: [[8 + 10 * effort * Math.max(0, -push), 14 + 14 * effort], [-6 + 10 * effort * Math.max(0, push), 12 + 14 * effort]],
      });
      // the legs spread wide: the oarsman walks the deck with the handle
      rot.LeftUpperLeg = qMul(qz(9 * DEG), rot.LeftUpperLeg);
      rot.RightUpperLeg = qMul(qz(-9 * DEG), rot.RightUpperLeg);
      rot.LeftFoot = qMul(qz(-9 * DEG), rot.LeftFoot);
      rot.RightFoot = qMul(qz(9 * DEG), rot.RightFoot);
      pose.hips[1] -= d.hipY * (1 - Math.cos(9 * DEG));
      rot.Head = qMul(qy(deg * 0.5 * DEG), rot.Head ?? QI);
      grips(pose, rot, oarGrips(deg));
      return pose;
    },
  });
  out.push(oarClip('SweepOar', 2.6, 9, 1), oarClip('SweepOarHold', 4, 1.5, 0.15));

  // ───────────────────────────────────────────────────────── pole
  /**
   * Poling on the right of the deck: plant the pole forward and down to the river bed, push it
   * back hand under hand as the raft slides over it, then lift it and swing it forward again.
   * In place: the bed point travels backward under the character, as it would from the raft.
   */
  const poleT = 3.4;
  const deckY = 0;
  const bedY = -1.6 * (H / 1.8);
  const poleX = -0.34 * u;
  const poleTimes = [0, 0.5, 1.9, 2.5, 3.4];
  // the pole's tip, and the top (right) hand
  const tip: V3[] = [[poleX - 0.05 * u, bedY, 0.95 * u], [poleX - 0.05 * u, bedY, 0.85 * u], [poleX - 0.08 * u, bedY, -0.3 * u], [poleX - 0.1 * u, deckY - 0.3 * u, -0.25 * u], [poleX - 0.05 * u, bedY, 0.95 * u]];
  const topHand: V3[] = [[poleX + 0.03 * u, 0.78 * H, 0.2 * u], [poleX + 0.04 * u, 0.66 * H, 0.22 * u], [poleX - 0.02 * u, 0.42 * H, -0.12 * u], [poleX + 0.02 * u, 0.7 * H, -0.05 * u], [poleX + 0.03 * u, 0.78 * H, 0.2 * u]];
  out.push({
    name: 'PoleRaft',
    duration: poleT,
    loop: true,
    info: { poleSide: 'right', poleX, bedDepthBelowDeck: -bedY, poleLength: 3.6 * (H / 1.8) },
    sample: (t) => {
      const push = key(poleTimes, [0.1, 0.4, 1, 0.3, 0.1], t);
      const { rot, pose } = body(t, {
        yaw: -18 - 10 * push,
        lean: 10 + 22 * push,
        tilt: -6 * push,
        hips: [-0.03 * u * push, 0, 0.02 * u * push],
        legs: [[18 + 6 * push, 24 + 16 * push], [-14 - 6 * push, 14 + 10 * push]],
      });
      const top = keyV(poleTimes, topHand, t);
      const tp = keyV(poleTimes, tip, t);
      const axis = norm(sub(top, tp)); // toward the top of the pole
      grips(pose, rot, [
        { side: -1, at: top, axis, fingers: [0.8, 0, 0.4], world: true, slide: true },
        { side: 1, at: sub(top, scale(axis, 0.42 * u)), axis, fingers: [0.8, 0, -0.4], world: true, slide: true, elbow: [0.2, -1, -0.6] },
      ]);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── anchor
  /** an anchor stone held in both hands like a box: lift, swing and throw it forward over the side */
  const anchorW = 0.13 * u;
  const anchorHands = (c: V3): Grip[] => ([1, -1] as const).map((s) => ({ side: s, at: add(c, [s * anchorW, 0, 0]), axis: [0, -0.25, 1], fingers: [0, 1, 0], world: true, elbow: [0.5, -1, -0.2] }));
  const dropT = 2.6;
  const dropTimes = [0, 0.45, 1.0, 1.35, 1.55, 2.0, 2.6];
  const stone: V3[] = [
    [0, 0.5 * H, 0.2 * u], // held at the belly
    [0, 0.42 * H, 0.16 * u], // dip
    [0, 0.42 * H, -0.02 * u], // swing back between the legs… almost
    [0, 0.66 * H, 0.42 * u], // up and out
    [0, 0.7 * H, 0.62 * u], // released
    [0, 0.7 * H, 0.62 * u],
    [0, 0.7 * H, 0.62 * u],
  ];
  out.push({
    name: 'DropAnchor',
    duration: dropT,
    loop: false,
    info: { releaseTime: 1.5, releaseAt: stone[4], throwVelocity: [0, 1.2, 2.6] },
    sample: (t) => {
      const lean = key(dropTimes, [6, 20, 34, 4, -4, 4, 0], t);
      const kn = key(dropTimes, [12, 36, 50, 10, 6, 8, 4], t);
      const { rot, pose } = body(t, { lean, legs: [[16 + kn * 0.5, kn], [-10 + kn * 0.5, kn * 0.9]], head: [key(dropTimes, [10, 10, 0, -6, 12, 14, 0], t), 0] });
      const c = keyV(dropTimes, stone, t);
      const held = anchorHands(c);
      // after the release the hands follow through, then drop to the sides
      const free = key(dropTimes, [0, 0, 0, 0, 0.15, 0.75, 1], t);
      grips(pose, rot, free > 0 ? blendGrips(held, hanging(pose), free) : held);
      return pose;
    },
  });

  /** hauling the anchor rope up hand over hand; the rope comes up over the edge in front, low */
  const haulT = 1.8;
  const ropeLow: V3 = [0, 0.3 * H, 0.42 * u];
  const ropeHigh: V3 = [0, 0.6 * H, 0.1 * u];
  out.push({
    name: 'RaiseAnchor',
    duration: haulT,
    loop: true,
    info: { ropeFrom: ropeLow, ropeEdgeAhead: 0.5 * u },
    sample: (t) => {
      const ph = (TAU * t) / haulT;
      const { rot, pose } = body(t, { lean: 24 - 6 * Math.sin(ph * 2), legs: [[24, 46], [-6, 34]], head: [18, 0] });
      const hand = (s: 1 | -1): Grip => {
        // each hand: grab low and forward, pull up and back, let go and reach again
        const p = ((t / haulT + (s > 0 ? 0 : 0.5)) % 1 + 1) % 1;
        const pull = p < 0.55 ? ease(p / 0.55) : 1 - ease((p - 0.55) / 0.45);
        const back = p < 0.55 ? 0 : Math.sin(((p - 0.55) / 0.45) * Math.PI); // hand clears the rope on the way back
        const at = add(mix(ropeLow, ropeHigh, pull), [s * (0.05 * u + 0.06 * u * back), 0.03 * u * back, -0.02 * u * back]);
        return { side: s, at, axis: norm(sub(ropeLow, ropeHigh)), fingers: [-s * 0.6, 0.2, -0.6], world: true, elbow: [0.6, -1, -0.4] };
      };
      grips(pose, rot, [hand(1), hand(-1)]);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── climbing out of the water
  /**
   * From treading water at the deck's edge onto the deck: hands on the deck, press up, knee up,
   * stand. The origin is where the feet hang at the start; the deck top is `deckAbove` higher, its
   * edge `edgeAhead` in front, and the clip ends standing `travel` away.
   */
  const climbT = 2.8;
  const deck = 0.76 * H;
  const edge = d.chestHD + 0.12 * u;
  const end: V3 = [0, deck, edge + 0.32 * u];
  const climbTimes = [0, 0.5, 1.15, 1.7, 2.2, 2.8];
  const hipTimes = [0, 0.5, 1.15, 1.65, 1.85, 2.2, 2.8];
  const hipsW: V3[] = [
    [0, restHipY, 0],
    [0, restHipY - 0.05 * H, -0.02 * u],
    [0, deck + 0.03 * H, edge - 0.08 * u],
    [0, deck + 0.19 * H, edge - 0.16 * u], // arms straight: hips up past the edge before the knee comes
    [0, deck + 0.13 * H, edge + 0.04 * u],
    [0, deck + restHipY - Math.min(kit.drop(62, 104), kit.drop(70, 102)), edge + 0.22 * u], // crouched on the deck
    [0, deck + restHipY, end[2]],
  ];
  out.push({
    name: 'ClimbOutOfWater',
    duration: climbT,
    loop: false,
    travel: end,
    info: { deckAbove: deck, edgeAhead: edge },
    sample: (t) => {
      const lean = key(climbTimes, [6, 14, 46, 40, 22, 0], t);
      const { rot, pose } = body(t, { lean, head: [key(climbTimes, [-8, -10, 20, 18, 0, 0], t), 0] });
      // the left foot tucks up behind before it swings forward to step onto the deck
      const lTimes = [0, 0.5, 1.15, 1.7, 2.0, 2.3, 2.8];
      const lt = key(lTimes, [6, 0, -24, -34, -22, 62, 2], t);
      const lk = key(lTimes, [24, 12, 30, 72, 125, 104, 4], t);
      // the right knee folds first (shin up behind), then the thigh swings it up onto the deck
      const rTimes = [0, 0.5, 1.15, 1.4, 1.65, 1.95, 2.25, 2.8];
      const rt = key(rTimes, [-8, 0, -20, -24, 55, 62, 70, 2], t);
      const rk = key(rTimes, [30, 14, 26, 115, 150, 155, 102, 4], t);
      [rot.LeftUpperLeg, rot.LeftLowerLeg, rot.LeftFoot] = leg(lt, lk, key(lTimes, [-20, -20, -30, -10, -10, lk - lt, 0], t));
      [rot.RightUpperLeg, rot.RightLowerLeg, rot.RightFoot] = leg(rt, rk, key(rTimes, [-20, -20, -30, -30, -30, -30, rk - rt, 0], t));
      const hp = keyV(hipTimes, hipsW, t);
      pose.hips = [hp[0], hp[1] - restHipY, hp[2]];
      // palms flat on the deck, fingers forward; off the deck as the feet come under
      const onDeck = ([1, -1] as const).map((s) => ({ side: s, at: [s * 0.15 * H, deck + 0.01 * u, edge + 0.1 * u] as V3, world: true, axis: [-s * 0.6, 0.1, 0.8] as V3, fingers: [s * 0.1, -0.2, 1] as V3, elbow: [0.4, 0, -1] as V3 }));
      const off = key(climbTimes, [0, 0, 0, 0, 0.5, 1], t);
      grips(pose, rot, off > 0 ? blendGrips(onDeck, hanging(pose), off) : onDeck);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── lantern
  /**
   * A lantern held up by its bail in the left hand, out in front at shoulder height to light the
   * way. The bail runs across the fist (along the thumb); the lantern hangs `lanternDrop` below.
   */
  const lanternGrip = (pose: Pose, t: number): Grip => {
    const wp = worldPose(sk, pose);
    const sh = wp.pos[sk.index.LeftUpperArm];
    const sway = Math.sin((TAU * t) / 2.2);
    return { side: 1, at: [sh[0] - 0.02 * u + 0.01 * u * sway, sh[1] - 0.06 * u, sh[2] + armReach * 0.86], world: true, axis: [-1, 0, 0], fingers: [0, -0.3, 1], elbow: [0.3, -1, 0] };
  };
  const lantern = (base: Clip, name: string, slow = 1): Clip => ({
    name,
    duration: base.duration * slow,
    loop: true,
    info: { lanternDrop: 0.16 * u, hand: 'left', hangs: 'straight down (world) from Socket_LeftHand_Tool' },
    sample: (t) => {
      const p = base.sample(t / slow);
      const rot: Record<string, Quat> = { ...p.rot };
      rot.Head = qMul(qx(4 * DEG), rot.Head ?? QI);
      const pose: Pose = { ...p, rot };
      grips(pose, rot, [lanternGrip(pose, t)]);
      return pose;
    },
  });
  out.push(lantern(clip('Idle'), 'CarryLantern'), lantern(clip('Walk'), 'CarryLanternWalk', 1.1));

  return out;
}
