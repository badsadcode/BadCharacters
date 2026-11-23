/**
 * Procedural animation clips. Each clip is a function of time → local bone rotations (+ a hips
 * offset), sampled into keyframes at export. Because every bone's rest rotation is identity,
 * "local rotation" here is simply "rotation relative to the rest pose, in the parent's frame".
 *
 * Axis cheat sheet (character faces +Z, left is +X):
 *   legs:  qx(-a) swings a leg forward, qx(+a) bends a knee, qx(-a) lifts the toes
 *   spine: qx(+a) leans forward, qy twists, qz tilts sideways
 *   arms:  see armPose()
 */
import { cross, DEG, lerp, norm, qAxis, qChain, qFromTo, qMul, qRotate, qx, qy, qz, QI, Quat, V3 } from './math';
import type { Skeleton } from './skeleton';

export interface Pose {
  rot: Record<string, Quat>;
  /** offset of the hips from their rest position (metres) */
  hips: V3;
  /** local translations for extra prop bones (e.g. the bow string) */
  trans?: Record<string, V3>;
}

export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  sample: (t: number) => Pose;
}

const sin = Math.sin;
const cos = Math.cos;
const pos = (x: number) => Math.max(0, x);
const TAU = Math.PI * 2;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** piecewise-linear keyframes, smoothed: k = [[t, value], ...] */
const keys = (k: [number, number][], t: number) => {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    const [t0, v0] = k[i];
    const [t1, v1] = k[i + 1];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
  }
  return k[k.length - 1][1];
};

export interface ClipOptions {
  /** something long in the right hand (a staff): keep that arm calm so it stays upright */
  rightHandProp?: string;
}

export function buildClips(sk: Skeleton, opts: ClipOptions = {}): Clip[] {
  const holding = !!opts.rightHandProp && opts.rightHandProp !== 'none';
  const d = sk.dims;
  const restElev = Math.atan2(d.armDir[1], d.armDir[0]) / DEG; // 0 for T-pose, -38 for A-pose
  const legLen = d.hipY;
  const stride = Math.sqrt(legLen / 0.9); // longer legs → slower, longer strides
  const chunky = d.headH / d.H > 0.2; // big-headed styles get bouncier motion
  // hanging arms must clear the widest part of the torso (bellies, chunky styles)
  const bodyHW = Math.max(d.waistHW + d.belly * 0.4, d.hipHW, d.chestHW * 0.92);
  const clear = Math.atan2(bodyHW + d.foreArmR * 1.15 - d.shoulderX, d.upperArmLen + d.foreArmLen) / DEG;
  const hang = -90 + Math.max(9, clear + 3);

  /**
   * Arm pose for side s (+1 left, -1 right).
   * elev: degrees above horizontal (-80 ≈ hanging), swing: degrees forward,
   * elbow: degrees of forward bend, twist: degrees of external rotation.
   */
  const arm = (s: number, elev: number, swing: number, elbow: number, twist = 0): [Quat, Quat] => {
    const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
    const lift = qz(s * (elev - restElev) * DEG);
    const tw = qAxis(dir, -s * twist * DEG);
    const upper = qChain(qx(-swing * DEG), lift, tw);
    const elbowAxis = cross([0, 0, 1], dir);
    const lower = qAxis(elbowAxis, -elbow * DEG);
    return [upper, lower];
  };
  /** arm pointing along world direction D (for side s), elbow bend, and twist about the arm (deg) */
  const armTo = (s: number, D: V3, elbow: number, twist = 0): [Quat, Quat] => {
    const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
    const upper = qMul(qFromTo(dir, norm(D)), qAxis(dir, -s * twist * DEG));
    const lower = qAxis(cross([0, 0, 1], dir), -elbow * DEG);
    return [upper, lower];
  };
  const leg = (thigh: number, knee: number, foot: number): [Quat, Quat, Quat] => [qx(-thigh * DEG), qx(knee * DEG), qx(-foot * DEG)];

  const setArms = (rot: Record<string, Quat>, l: [Quat, Quat], r: [Quat, Quat]) => {
    rot.LeftUpperArm = l[0];
    rot.LeftLowerArm = l[1];
    rot.RightUpperArm = r[0];
    rot.RightLowerArm = r[1];
  };
  const setLegs = (rot: Record<string, Quat>, l: [Quat, Quat, Quat], r: [Quat, Quat, Quat]) => {
    [rot.LeftUpperLeg, rot.LeftLowerLeg, rot.LeftFoot] = l;
    [rot.RightUpperLeg, rot.RightLowerLeg, rot.RightFoot] = r;
  };

  /** gait shared by walk and run */
  const gait = (ph: number, thighAmp: number, kneeAmp: number, armAmp: number, elbowBase: number, lean: number, bob: number) => {
    const rot: Record<string, Quat> = {};
    const L = (p: number) => {
      const th = thighAmp * sin(p);
      const swingPhase = pos(cos(p + 0.35));
      const knee = 6 + kneeAmp * swingPhase ** 1.6 + 8 * pos(sin(p - 0.6)) * (thighAmp / 25);
      const foot = th - knee + (-14 * pos(sin(p)) + 16 * pos(-sin(p + 0.4))) * (thighAmp / 25);
      return leg(th, knee, -foot);
    };
    setLegs(rot, L(ph), L(ph + Math.PI));
    const a = (p: number, s: number) =>
      holding && s < 0
        ? arm(s, hang + 2, -Math.min(armAmp, 14) * 0.5 * sin(p), 8) // staff hand: small, straight swing
        : arm(s, hang + 4, -armAmp * sin(p), elbowBase + 10 * pos(-sin(p)));
    setArms(rot, a(ph, 1), a(ph + Math.PI, -1));
    rot.Hips = qChain(qy(6 * sin(ph) * DEG), qz(2.5 * sin(ph) * DEG));
    rot.Spine = qChain(qx(lean * 0.5 * DEG), qy(-4 * sin(ph) * DEG));
    rot.Chest = qChain(qx(lean * 0.5 * DEG), qy(-4 * sin(ph) * DEG));
    rot.Neck = qy(2 * sin(ph) * DEG);
    rot.Head = qx(-lean * 0.6 * DEG);
    return { rot, hips: [0, -bob * legLen * (0.5 + 0.5 * cos(2 * ph)), 0] as V3 };
  };

  const idle: Clip = {
    name: 'Idle',
    duration: 3,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / 3;
      const rot: Record<string, Quat> = {};
      setArms(rot, arm(1, hang + 1.5 * sin(ph), 3 + 2 * sin(ph), 8 + 2 * sin(ph)), arm(-1, hang + 1.5 * sin(ph + 0.4), 3 + 2 * sin(ph + 0.4), 8 + 2 * sin(ph + 0.5)));
      setLegs(rot, leg(2, 3, 1), leg(-1, 2, 1));
      rot.Hips = qz(1.2 * sin(ph) * DEG);
      rot.Spine = qx(1 * sin(ph * 2) * DEG);
      rot.Chest = qx(-1.5 * sin(ph * 2) * DEG);
      rot.UpperChest = qx(-0.8 * sin(ph * 2) * DEG);
      rot.Neck = qy(4 * sin(ph * 0.5) * DEG);
      rot.Head = qChain(qy(6 * sin(ph) * DEG), qx(2 * sin(ph * 2 + 1) * DEG));
      return { rot, hips: [0, -0.004 * legLen * (1 + sin(ph * 2)), 0] };
    },
  };

  const walkT = 1.05 * stride;
  const walk: Clip = {
    name: 'Walk',
    duration: walkT,
    loop: true,
    sample: (t) => gait((TAU * t) / walkT, 24, 52, 20, 12, 3, chunky ? 0.035 : 0.022),
  };

  const runT = 0.68 * stride;
  const run: Clip = {
    name: 'Run',
    duration: runT,
    loop: true,
    sample: (t) => {
      const p = gait((TAU * t) / runT, 38, 95, 38, 75, 12, chunky ? 0.06 : 0.045);
      p.hips[1] += 0.03 * legLen;
      return p;
    },
  };

  const jump: Clip = {
    name: 'Jump',
    duration: 1.3,
    loop: false,
    sample: (t) => {
      // crouch → launch → tuck → land → recover
      const crouch = keys([[0, 0], [0.25, 1], [0.38, 0.1], [0.5, 0], [0.9, 0], [1.02, 0.8], [1.3, 0]], t);
      const air = keys([[0, 0], [0.32, 0], [0.42, 0.75], [0.62, 1], [0.82, 0.75], [0.95, 0], [1.3, 0]], t);
      const tuck = keys([[0, 0], [0.4, 0], [0.6, 1], [0.85, 0.2], [1.3, 0]], t);
      const reach = keys([[0, 0], [0.25, -1], [0.4, 1], [0.7, 0.7], [0.95, -0.3], [1.3, 0]], t);
      const rot: Record<string, Quat> = {};
      const th = 55 * crouch + 45 * tuck;
      const kn = 95 * crouch + 75 * tuck;
      setLegs(rot, leg(th, kn, -(th - kn)), leg(th, kn, -(th - kn)));
      setArms(rot, arm(1, hang + 8 + 70 * pos(reach), -30 * Math.min(0, reach) + 25 * pos(reach), 20 + 20 * crouch), arm(-1, hang + 8 + 70 * pos(reach), -30 * Math.min(0, reach) + 25 * pos(reach), 20 + 20 * crouch));
      rot.Spine = qx((18 * crouch + 8 * tuck) * DEG);
      rot.Chest = qx(8 * crouch * DEG);
      rot.Head = qx(-14 * crouch * DEG);
      const drop = (1 - cos(th * DEG)) * (d.hipY - d.kneeY) + (1 - cos((kn - th) * DEG)) * (d.kneeY - d.ankleY) * 0.9;
      return { rot, hips: [0, -drop + air * 0.45 * legLen, 0] };
    },
  };

  const wave: Clip = {
    name: 'Wave',
    duration: 2,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / 0.5;
      const rot: Record<string, Quat> = {};
      setArms(rot, arm(1, hang, 4, 10), armTo(-1, [-0.95, 0.3, 0.12], 55 + 20 * sin(ph), 80));
      setLegs(rot, leg(1, 2, 1), leg(1, 2, 1));
      rot.Spine = qz(3 * DEG);
      rot.Head = qChain(qz(-6 * DEG), qy(-8 * DEG));
      rot.Hips = qz(-2 * DEG);
      return { rot, hips: [0, 0, 0] };
    },
  };

  const punch: Clip = {
    name: 'Punch',
    duration: 0.9,
    loop: true,
    sample: (t) => {
      const hit = keys([[0, 0], [0.12, -0.3], [0.28, 1], [0.45, 1], [0.9, 0]], t);
      const rot: Record<string, Quat> = {};
      const guard = (s: number, ext: number): [Quat, Quat] => {
        const D: V3 = [s * (0.35 - 0.3 * ext), -0.75 + 0.75 * ext, 0.55 + 0.45 * ext];
        return armTo(s, D, 125 - 120 * ext, 70 * (1 - ext));
      };
      setArms(rot, guard(1, 0), guard(-1, pos(hit)));
      setLegs(rot, leg(16, 24, 6), leg(-14, 18, -6));
      rot.Hips = qy((6 + 10 * hit) * DEG);
      rot.Spine = qChain(qy(6 * hit * DEG), qx(8 * DEG));
      rot.Chest = qy(8 * hit * DEG);
      rot.Head = qy(-(14 + 22 * hit) * DEG);
      return { rot, hips: [0, -0.05 * legLen, 0.02 * hit * legLen] };
    },
  };


  // ───────────────────────────────────────────────────── crouching & climbing
  const thighLen = d.hipY - d.kneeY;
  const shinLen = d.kneeY - d.ankleY;
  /** hip drop and foot reach for a leg pose with a flat foot */
  const plant = (th: number, kn: number) => ({
    drop: thighLen * (1 - cos(th * DEG)) + shinLen * (1 - cos((kn - th) * DEG)),
    dz: thighLen * sin(th * DEG) - shinLen * sin((kn - th) * DEG),
  });
  const flatLeg = (th: number, kn: number, extraToe = 0) => leg(th, kn, kn - th + extraToe);

  const crouch: Clip = {
    name: 'Crouch',
    duration: 2.5,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / 2.5;
      const th = 78 + 1.5 * sin(ph * 2);
      const kn = 118 + 2 * sin(ph * 2);
      const rot: Record<string, Quat> = {};
      setLegs(rot, flatLeg(th, kn), flatLeg(th - 4, kn - 6));
      setArms(rot, arm(1, hang + 18, 38, 55 + 3 * sin(ph)), arm(-1, hang + 18, 38, 55 + 3 * sin(ph + 0.5)));
      rot.Spine = qx((22 + 1.5 * sin(ph * 2)) * DEG);
      rot.Chest = qx(8 * DEG);
      rot.Head = qChain(qx(-24 * DEG), qy(10 * sin(ph * 0.5) * DEG));
      const pl = plant(th, kn);
      return { rot, hips: [0, -pl.drop, -pl.dz * 0.9] };
    },
  };

  const cwT = 1.35 * stride;
  const crouchWalk: Clip = {
    name: 'CrouchWalk',
    duration: cwT,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / cwT;
      const rot: Record<string, Quat> = {};
      const L = (p: number) => {
        const th = 62 + 22 * sin(p);
        const kn = 100 + 38 * pos(cos(p + 0.35)) ** 1.5;
        return { th, kn, q: flatLeg(th, kn, -8 * pos(sin(p))) };
      };
      const l = L(ph);
      const r = L(ph + Math.PI);
      setLegs(rot, l.q, r.q);
      setArms(rot, arm(1, hang + 14, 30 - 12 * sin(ph), 50), arm(-1, hang + 14, 30 + 12 * sin(ph), 50));
      rot.Spine = qx(24 * DEG);
      rot.Chest = qChain(qx(8 * DEG), qy(-5 * sin(ph) * DEG));
      rot.Head = qx(-26 * DEG);
      rot.Hips = qy(5 * sin(ph) * DEG);
      // the grounded foot is the one with the most reach (least drop)
      const drop = Math.min(plant(l.th, l.kn).drop, plant(r.th, r.kn).drop);
      return { rot, hips: [0, -drop, -0.25 * thighLen] };
    },
  };

  /** wall climb, facing the wall (+Z). Played backwards it is a climb down. */
  const climbT = 1.6;
  const climbPose = (t: number): Pose => {
    const ph = (TAU * t) / climbT;
    const rot: Record<string, Quat> = {};
    const hand = (s: number, p: number): [Quat, Quat] => {
      const up = 0.5 + 0.5 * sin(p);
      return armTo(s, [s * 0.28, lerp(0.35, 1, up), lerp(0.75, 0.32, up)], lerp(105, 28, up));
    };
    setArms(rot, hand(1, ph), hand(-1, ph + Math.PI));
    const foot = (p: number) => {
      const up = 0.5 + 0.5 * sin(p);
      const th = lerp(8, 78, up);
      const kn = lerp(14, 108, up);
      return leg(th, kn, kn - th - 12);
    };
    setLegs(rot, foot(ph + Math.PI), foot(ph));
    rot.Hips = qz(4 * sin(ph) * DEG);
    rot.Spine = qx(6 * DEG);
    rot.Head = qx(-18 * DEG);
    return { rot, hips: [0, 0.035 * legLen * sin(2 * ph), 0.04 * legLen] };
  };
  const climbUp: Clip = { name: 'ClimbUp', duration: climbT, loop: true, sample: climbPose };
  const climbDown: Clip = { name: 'ClimbDown', duration: climbT, loop: true, sample: (t) => climbPose(climbT - t) };

  /** sideways shimmy along a ledge; dir +1 = to the character's left (+X) */
  const shimmyT = 1.4;
  const shimmy = (dir: number) => (t: number): Pose => {
    const ph = (TAU * t) / shimmyT;
    const rot: Record<string, Quat> = {};
    const hand = (s: number) => {
      const lead = s === dir ? 0 : Math.PI;
      const reach = sin(ph + lead);
      return armTo(s, [s * 0.32 + dir * 0.14 * reach, 0.95, 0.38], 32 + 14 * pos(-reach));
    };
    setArms(rot, hand(1), hand(-1));
    const step = (s: number) => {
      const lead = s === dir ? 0 : Math.PI;
      const lift = pos(sin(ph + lead));
      const abd = s * (4 + 12 * lift * (s === dir ? 1 : 0.4));
      const th = 18 + 30 * lift;
      const kn = 26 + 40 * lift;
      return [qChain(qz(abd * DEG), qx(-th * DEG)), qx(kn * DEG), qx(-(kn - th - 10) * DEG)] as [Quat, Quat, Quat];
    };
    setLegs(rot, step(1), step(-1));
    rot.Hips = qz(dir * 4 * sin(ph) * DEG);
    rot.Spine = qx(5 * DEG);
    rot.Head = qChain(qx(-12 * DEG), qy(dir * 20 * DEG));
    return { rot, hips: [dir * 0.025 * legLen * sin(ph), 0.02 * legLen * sin(2 * ph), 0.04 * legLen] };
  };
  const climbLeft: Clip = { name: 'ClimbLeft', duration: shimmyT, loop: true, sample: shimmy(1) };
  const climbRight: Clip = { name: 'ClimbRight', duration: shimmyT, loop: true, sample: shimmy(-1) };

  /** ladder: hands closer together on the rungs, knees higher. Backwards = down. */
  const ladderT = 1.2;
  const ladderPose = (t: number): Pose => {
    const ph = (TAU * t) / ladderT;
    const rot: Record<string, Quat> = {};
    const hand = (s: number, p: number) => {
      const up = 0.5 + 0.5 * sin(p);
      return armTo(s, [s * 0.14, lerp(0.05, 0.85, up), 0.75], lerp(78, 22, up));
    };
    setArms(rot, hand(1, ph), hand(-1, ph + Math.PI));
    const foot = (p: number) => {
      const up = 0.5 + 0.5 * sin(p);
      const th = lerp(4, 72, up);
      const kn = lerp(8, 100, up);
      return leg(th, kn, kn - th);
    };
    setLegs(rot, foot(ph + Math.PI), foot(ph));
    rot.Head = qx(-8 * DEG);
    return { rot, hips: [0, 0.03 * legLen * sin(2 * ph), 0.03 * legLen] };
  };
  const ladderUp: Clip = { name: 'LadderUp', duration: ladderT, loop: true, sample: ladderPose };
  const ladderDown: Clip = { name: 'LadderDown', duration: ladderT, loop: true, sample: (t) => ladderPose(ladderT - t) };

  // ───────────────────────────────────────────────────────────── swimming
  const swimT = 1.7;
  const swim: Clip = {
    name: 'Swim',
    duration: swimT,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / swimT;
      const rot: Record<string, Quat> = {};
      // body horizontal: everything below is in the body's own frame (up = forward through the water)
      rot.Hips = qx(80 * DEG);
      const stroke = (s: number, p: number): [Quat, Quat] => {
        const th = ((p % TAU) + TAU) % TAU; // 0 = overhead, pull through the water (+Z body = down), recover over the top
        const recovering = th > Math.PI;
        return armTo(s, [s * 0.18, cos(th), sin(th) * 0.9], recovering ? 70 : 18);
      };
      setArms(rot, stroke(1, ph), stroke(-1, ph + Math.PI));
      const kick = (p: number) => leg(12 * sin(p), 14 + 12 * pos(sin(p + 1)), -45);
      setLegs(rot, kick(3 * ph), kick(3 * ph + Math.PI));
      rot.Spine = qy(18 * sin(ph) * DEG); // body roll
      rot.Neck = qChain(qx(-40 * DEG), qy(-25 * pos(sin(ph)) ** 3 * DEG)); // look ahead, breathe to the side
      rot.Head = qx(-25 * DEG);
      return { rot, hips: [0, -0.15 * legLen, 0] };
    },
  };

  // ───────────────────────────────────────────────────────────── crafting
  const craft: Clip = {
    name: 'Craft',
    duration: 1.1,
    loop: true,
    sample: (t) => {
      const h = keys([[0, 0], [0.45, 1], [0.6, -0.12], [0.72, 0], [1.1, 0]], t);
      const rot: Record<string, Quat> = {};
      setArms(rot, armTo(1, [0.28, -0.45, 0.85], 78), armTo(-1, [-0.32, -0.5 + 0.95 * h, 0.8 - 0.25 * h], 72 + 38 * h, 20));
      setLegs(rot, flatLeg(10, 16), flatLeg(6, 12));
      rot.Spine = qx(14 * DEG);
      rot.Chest = qChain(qx(6 * DEG), qy(-4 * h * DEG));
      rot.Head = qx(22 * DEG);
      return { rot, hips: [0, -plant(10, 16).drop, 0] };
    },
  };

  // ──────────────────────────────────────────────────────────────── archery
  // the torso turns 24° to the right so the bow arm leads; arm directions are in the chest frame
  const twist = 24;
  const aimLocal: V3 = [sin(twist * DEG), 0.08, cos(twist * DEG)];
  const bowT = 2.4;
  const bowPose = (t: number): Pose => {
    const g = keys([[0, 0], [0.35, 0], [1.15, 1], [1.6, 1], [1.64, 0.7], [1.95, 0.15], [2.4, 0]], t);
    const raise = keys([[0, 0.6], [0.35, 1], [2.0, 1], [2.4, 0.6]], t);
    const rot: Record<string, Quat> = {};
    const bowArm = armTo(1, [aimLocal[0], aimLocal[1] - 0.5 * (1 - raise), aimLocal[2]], 6);
    const relaxed: V3 = [aimLocal[0] - 0.1, aimLocal[1] - 0.5 * (1 - raise), aimLocal[2]];
    const drawn: V3 = [-0.9, 0.16, -0.25];
    const D: V3 = [lerp(relaxed[0], drawn[0], g), lerp(relaxed[1], drawn[1], g), lerp(relaxed[2], drawn[2], g)];
    setArms(rot, bowArm, armTo(-1, D, lerp(20, 150, g), lerp(0, 60, g)));
    setLegs(rot, flatLeg(8, 12), flatLeg(-6, 8));
    rot.Spine = qy((-twist / 2) * DEG);
    rot.Chest = qy((-twist / 2) * DEG);
    rot.Head = qy(twist * DEG);
    const pose: Pose = { rot, hips: [0, -plant(8, 12).drop, 0] };
    if (sk.index.BowString !== undefined) {
      // the string's middle follows the drawing hand's grip (in LeftHand's frame)
      const wp = worldPose(sk, pose);
      const ri = sk.index.RightHand;
      const li = sk.index.LeftHand;
      const grip = add3(wp.pos[ri], qRotate(wp.rot[ri], [-d.armDir[0] * d.handLen * 0.5, d.armDir[1] * d.handLen * 0.5, 0]));
      const ql = wp.rot[li];
      pose.trans = { BowString: qRotate([-ql[0], -ql[1], -ql[2], ql[3]], [grip[0] - wp.pos[li][0], grip[1] - wp.pos[li][1], grip[2] - wp.pos[li][2]]) };
    }
    return pose;
  };
  const bowShoot: Clip = { name: 'BowShoot', duration: bowT, loop: true, sample: bowPose };

  const xbowT = 2.6;
  const xbowPose = (t: number): Pose => {
    const recoil = keys([[0, 0], [0.5, 0], [0.56, 1], [0.85, 0], [2.6, 0]], t);
    const lower = keys([[0, 0], [0.9, 0], [1.2, 1], [2.1, 1], [2.45, 0], [2.6, 0]], t);
    const rot: Record<string, Quat> = {};
    const tilt = -0.55 * lower + 0.12 * recoil;
    setArms(rot, armTo(1, [0.2, 0.21 + tilt, 1], 22 + 10 * lower), armTo(-1, [-0.5, -0.62 + tilt * 0.6, 0.6], 122 - 10 * lower, 25));
    setLegs(rot, flatLeg(10, 14), flatLeg(-8, 10));
    rot.Spine = qChain(qx((4 + 6 * lower) * DEG), qy(-8 * DEG));
    rot.Chest = qx(-5 * recoil * DEG);
    rot.Head = qChain(qy(6 * DEG), qx((8 + 18 * lower) * DEG));
    return { rot, hips: [0, -plant(10, 14).drop, -0.01 * recoil * legLen] };
  };
  const crossbowShoot: Clip = { name: 'CrossbowShoot', duration: xbowT, loop: true, sample: xbowPose };

  const extra = [crouch, crouchWalk, climbUp, climbDown, climbLeft, climbRight, ladderUp, ladderDown, swim, craft, bowShoot, crossbowShoot];

  const tpose: Clip = {
    name: 'RestPose',
    duration: 1,
    loop: true,
    sample: () => ({ rot: {}, hips: [0, 0, 0] }),
  };

  return [idle, walk, run, jump, wave, punch, ...extra, tpose];
}

/** fill missing bones with identity so channels are complete */
export function fullPose(sk: Skeleton, p: Pose): Record<string, Quat> {
  const out: Record<string, Quat> = {};
  for (const b of sk.bones) out[b.name] = p.rot[b.name] ?? QI;
  return out;
}

/** forward kinematics: world position + rotation of every bone for a pose */
export function worldPose(sk: Skeleton, p: Pose): { pos: V3[]; rot: Quat[] } {
  const pos: V3[] = [];
  const rot: Quat[] = [];
  sk.bones.forEach((b, i) => {
    const parentW: V3 = b.parent >= 0 ? sk.bones[b.parent].world : [0, 0, 0];
    let t: V3 = [b.world[0] - parentW[0], b.world[1] - parentW[1], b.world[2] - parentW[2]];
    if (b.name === 'Hips') t = [t[0] + p.hips[0], t[1] + p.hips[1], t[2] + p.hips[2]];
    if (p.trans?.[b.name]) t = p.trans[b.name];
    const lq = p.rot[b.name] ?? QI;
    if (b.parent < 0) {
      pos.push(t);
      rot.push(lq);
    } else {
      const P = pos[b.parent];
      const r = qRotate(rot[b.parent], t);
      pos.push([P[0] + r[0], P[1] + r[1], P[2] + r[2]]);
      rot.push(qMul(rot[b.parent], lq));
    }
    void i;
  });
  return { pos, rot };
}

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export { qMul };
