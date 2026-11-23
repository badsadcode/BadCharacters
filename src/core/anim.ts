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
import { cross, DEG, norm, qAxis, qChain, qFromTo, qMul, qRotate, qx, qy, qz, QI, Quat, V3 } from './math';
import type { Skeleton } from './skeleton';

export interface Pose {
  rot: Record<string, Quat>;
  /** offset of the hips from their rest position (metres) */
  hips: V3;
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

export function buildClips(sk: Skeleton): Clip[] {
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
    const a = (p: number, s: number) => arm(s, hang + 4, -armAmp * sin(p), elbowBase + 10 * pos(-sin(p)));
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

  const tpose: Clip = {
    name: 'RestPose',
    duration: 1,
    loop: true,
    sample: () => ({ rot: {}, hips: [0, 0, 0] }),
  };

  return [idle, walk, run, jump, wave, punch, tpose];
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

export { qMul };
