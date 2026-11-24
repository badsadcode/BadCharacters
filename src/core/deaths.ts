/**
 * Death animations (because games are hard). Each one buckles the knees, tips the body around the
 * feet with gravity speeding it up, bounces a little on impact, and ends lying on the floor with the
 * body's thickness under it, so an engine can hand over to a ragdoll or just leave the body there.
 * None loop. `info.endsLying` says how the body ends up: 'front', 'back' or 'side'.
 */
import { add, cross, DEG, lerp, norm, qAxis, qChain, qFromTo, qMul, Quat, qRotate, qx, qy, qz, V3 } from './math';
import type { Clip, Pose } from './anim';
import type { Skeleton } from './skeleton';

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** gravity: slow start, fast finish */
const fallEase = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x);
const key = (times: number[], vals: number[], t: number, e = ease) => {
  if (t <= times[0]) return vals[0];
  for (let i = 0; i < times.length - 1; i++) if (t <= times[i + 1]) return lerp(vals[i], vals[i + 1], e((t - times[i]) / (times[i + 1] - times[i])));
  return vals[vals.length - 1];
};

export function deathClips(sk: Skeleton): Clip[] {
  const d = sk.dims;
  const restHipY = sk.bones[sk.index.Hips].world[1];
  const thick = Math.max(d.hipHD, d.chestHD) * 0.95;
  const restArm = (s: number): V3 => norm([d.armDir[0] * s, d.armDir[1], 0]);
  /** an arm pointing along D (in the chest's own frame), elbow bent forward by `elbow` degrees */
  const arm = (rot: Record<string, Quat>, s: number, D: V3, elbow: number) => {
    const S = s > 0 ? 'Left' : 'Right';
    const dir = restArm(s);
    rot[`${S}UpperArm`] = qFromTo(dir, norm(D));
    rot[`${S}LowerArm`] = qAxis(norm(cross([0, 0, 1], dir)), -elbow * DEG);
  };
  const legs = (rot: Record<string, Quat>, th: number, kn: number, foot: number, spread = 0) => {
    for (const s of [1, -1]) {
      const S = s > 0 ? 'Left' : 'Right';
      rot[`${S}UpperLeg`] = qChain(qz(s * spread * DEG), qx(-th * DEG));
      rot[`${S}LowerLeg`] = qx(kn * DEG);
      rot[`${S}Foot`] = qx(-foot * DEG);
    }
  };
  /**
   * The whole body tipping over: `tip` rotates the Hips (and everything above and below) about a
   * pivot on the floor; the hips are `h` above the pivot along the body. They never sink into the
   * floor: the lowest they get is the body's thickness.
   */
  const fall = (tip: Quat, h: number, pivot: V3): V3 => {
    const p = add(pivot, qRotate(tip, [0, h, 0]));
    return [p[0], Math.max(p[1], thick) - restHipY, p[2]];
  };

  const out: Clip[] = [];
  type Spec = { name: string; T: number; ends: 'front' | 'back' | 'side'; sample: (t: number) => Pose };
  const add_ = (s: Spec) => out.push({ name: s.name, duration: s.T, loop: false, info: { endsLying: s.ends, bodyThickness: thick }, sample: s.sample });

  // ── forward: hit from behind, arches, buckles, falls on the face
  add_({
    name: 'DeathForward',
    T: 1.7,
    ends: 'front',
    sample: (t) => {
      const a = key([0, 0.25, 1.05, 1.2, 1.35, 1.7], [0, 6, 88, 84, 88, 88], t, fallEase);
      const buckle = key([0, 0.15, 0.55, 1.0, 1.7], [0, 0.2, 0.7, 0.25, 0.1], t);
      const arch = key([0, 0.1, 0.3, 1.0, 1.7], [0, -14, -4, 10, 4], t);
      const rot: Record<string, Quat> = {};
      rot.Hips = qx(a * DEG);
      rot.Spine = qx(arch * DEG);
      rot.Chest = qx((arch * 0.5) * DEG);
      rot.Neck = qx(-a * 0.25 * DEG);
      rot.Head = qChain(qy(key([0, 1.0, 1.4], [0, 0, 70], t) * DEG), qx(-10 * DEG));
      legs(rot, 40 * buckle, 80 * buckle, 30 * buckle + key([0, 1.1, 1.7], [0, 0, 40], t), 4);
      // arms flinch back, then reach forward to break the fall, then lie splayed by the head
      const reach = key([0, 0.12, 0.5, 1.0, 1.7], [0, -1, 0.3, 1, 1], t);
      for (const s of [1, -1]) {
        const D: V3 = reach < 0 ? [s * 0.3, -0.9, -0.4 * -reach] : [s * lerp(0.25, s > 0 ? 0.75 : 0.35, reach), lerp(-0.9, s > 0 ? 0.65 : -0.85, reach), lerp(0, 0.3, reach)];
        arm(rot, s, D, lerp(30, s > 0 ? 25 : 10, Math.abs(reach)));
      }
      const h = restHipY - (thighLenOf(d) * (1 - Math.cos(40 * buckle * DEG)) + 0.05 * restHipY * buckle);
      return { rot, hips: fall(rot.Hips, h, [0, 0, 0]) };
    },
  });

  // ── backward: knocked back, lands on the back
  add_({
    name: 'DeathBackward',
    T: 1.6,
    ends: 'back',
    sample: (t) => {
      const a = key([0, 0.15, 0.95, 1.1, 1.25, 1.6], [0, -8, -88, -83, -88, -88], t, fallEase);
      const buckle = key([0, 0.1, 0.45, 0.9, 1.6], [0, 0.35, 0.8, 0.3, 0.15], t);
      const rot: Record<string, Quat> = {};
      rot.Hips = qx(a * DEG);
      rot.Spine = qx(key([0, 0.1, 0.5, 1.6], [0, 12, 4, -2], t) * DEG);
      rot.Neck = qx(key([0, 0.9, 1.0, 1.2, 1.6], [0, 10, 25, 5, 12], t) * DEG);
      rot.Head = qy(key([0, 1.1, 1.6], [0, 0, -25], t) * DEG);
      legs(rot, 50 * buckle, 90 * buckle, 20 * buckle - key([0, 1.0, 1.6], [0, 0, 50], t), 6 + 8 * buckle);
      // arms fly forward, then fall out to the sides on the floor
      const flop = key([0, 0.15, 0.7, 1.15, 1.6], [0, 1, 0.6, 0, 0], t);
      // from hanging relaxed, the arms fly up and forward, then fall out to the sides
      const start = key([0, 0.12], [0, 1], t);
      for (const s of [1, -1]) {
        const flail: V3 = [s * lerp(1, 0.3, flop), lerp(0.25, -0.3, flop), lerp(-0.15, 0.9, flop)];
        arm(rot, s, [lerp(s * 0.2, flail[0], start), lerp(-0.95, flail[1], start), lerp(0.05, flail[2], start)], lerp(15, 60, flop) * start + 15 * (1 - start));
      }
      const h = restHipY - (thighLenOf(d) * (1 - Math.cos(50 * buckle * DEG)) + 0.06 * restHipY * buckle);
      return { rot, hips: fall(rot.Hips, h, [0, 0, 0]) };
    },
  });

  // ── sideways: the body tips over to one side and rolls a little toward the front
  for (const side of [1, -1] as const) {
    add_({
      name: side > 0 ? 'DeathLeft' : 'DeathRight',
      T: 1.7,
      ends: 'side',
      sample: (t) => {
        const a = key([0, 0.2, 1.05, 1.2, 1.35, 1.7], [0, 5, 86, 82, 86, 86], t, fallEase);
        const roll = key([0, 1.0, 1.7], [0, 0, 22], t);
        const buckle = key([0, 0.15, 0.6, 1.0, 1.7], [0, 0.3, 0.75, 0.4, 0.35], t);
        const rot: Record<string, Quat> = {};
        rot.Hips = qChain(qz(-side * a * DEG), qx(roll * DEG));
        rot.Spine = qz(side * key([0, 0.1, 0.6, 1.7], [0, 12, 4, -6], t) * DEG);
        rot.Neck = qz(side * key([0, 1.0, 1.6], [0, 0, 18], t) * DEG);
        legs(rot, 45 * buckle, 85 * buckle, 30 * buckle, 4);
        // the lower arm ends under / ahead of the body, the upper arm drapes over
        const k = key([0, 0.2, 1.1, 1.7], [0, 0.4, 1, 1], t);
        arm(rot, side, [side * lerp(0.3, 0.5, k), lerp(-0.9, 0.5, k), lerp(0, 0.6, k)], 25);
        arm(rot, -side, [-side * 0.25, lerp(-0.9, -0.6, k), lerp(0, 0.7, k)], lerp(20, 50, k));
        const h = restHipY - (thighLenOf(d) * (1 - Math.cos(45 * buckle * DEG)) + 0.05 * restHipY * buckle);
        return { rot, hips: fall(qz(-side * a * DEG), h, [0, 0, 0]) };
      },
    });
  }

  // ── crumple: knees give way, kneel, slump forward and fall to the side
  const kneel = (thighLenOf(d) + Math.max(d.kneeR, 0.02 * d.H)) - restHipY;
  add_({
    name: 'DeathCrumple',
    T: 2.4,
    ends: 'side',
    sample: (t) => {
      const kn = key([0, 0.15, 0.7, 2.4], [0, 0, 1, 1], t, fallEase);
      const slump = key([0, 0.7, 1.2, 2.4], [0, 0, 1, 1], t);
      const topple = key([0, 1.2, 1.9, 2.05, 2.2, 2.4], [0, 0, 80, 76, 80, 80], t, fallEase);
      const rot: Record<string, Quat> = {};
      rot.Hips = qChain(qz(topple * DEG), qx((10 * slump + 20 * topple / 80) * DEG));
      rot.Spine = qx((30 * slump) * DEG);
      rot.Chest = qx((14 * slump) * DEG);
      rot.Neck = qx((25 * slump) * DEG);
      rot.Head = qChain(qx(15 * slump * DEG), qz(-12 * topple / 80 * DEG));
      // thighs end upright under the hips (kneeling), shins folded back along the floor
      legs(rot, -4 * kn + 30 * (topple / 80), 120 * kn, 60 * kn, 3);
      for (const s of [1, -1]) arm(rot, s, [s * 0.25, -0.95, lerp(0.05, 0.35, slump)], lerp(10, 35, slump));
      const y = lerp(0, kneel, kn);
      const tipped = topple > 0 ? fall(qz(topple * DEG), restHipY + y, [0, 0, 0]) : ([0, y, 0] as V3);
      return { rot, hips: [tipped[0], topple > 0 ? tipped[1] : y, 0.04 * restHipY * slump] };
    },
  });

  // ── headshot: the head snaps back, the body goes rigid and topples backward
  add_({
    name: 'DeathHeadshot',
    T: 1.4,
    ends: 'back',
    sample: (t) => {
      const snap = key([0, 0.05, 0.2, 1.4], [0, 1, 0.6, 0.5], t);
      const a = key([0, 0.15, 0.85, 0.98, 1.1, 1.4], [0, -4, -88, -84, -88, -88], t, fallEase);
      const rot: Record<string, Quat> = {};
      rot.Hips = qx(a * DEG);
      rot.Neck = qx(-28 * snap * DEG);
      rot.Head = qChain(qx(-22 * snap * DEG), qy(key([0, 1.0, 1.4], [0, 0, 30], t) * DEG));
      rot.Spine = qx(-6 * snap * DEG);
      legs(rot, 4, 6 + key([0, 0.85, 1.4], [0, 0, 14], t), 0);
      const limp = key([0, 0.1, 0.9, 1.4], [0, 0.3, 0.6, 1], t);
      for (const s of [1, -1]) arm(rot, s, [s * lerp(0.35, 0.9, limp), lerp(-0.9, 0.15, limp), lerp(0.2, -0.1, limp)], lerp(25, 15, limp));
      return { rot, hips: fall(rot.Hips, restHipY, [0, 0, 0]) };
    },
  });
  return out;
}

const thighLenOf = (d: Skeleton['dims']) => d.hipY - d.kneeY;

// ───────────────────────────────────────────────────────── getting up & hit reactions

/** a key pose for getting up: hips pitch, leg angles per side, spine / neck, arm directions (chest frame) */
interface GK {
  t: number;
  pitch: number;
  l: [number, number];
  r: [number, number];
  spine: number;
  neck: number;
  armL: V3;
  armR: V3;
  elbow: number;
}

/**
 * Getting up from the floor, from the pose the matching death ends in. Hips height comes from the
 * legs every frame: the highest of "on the knees", "on the feet" and "lying" wins, so the body never
 * sinks into the floor or hovers. `feetFrom` pins the feet once they are under the body.
 */
function getUp(sk: Skeleton, name: string, T: number, keys_: GK[], feetFrom: number, prone: boolean): Clip {
  const d = sk.dims;
  const thigh = d.hipY - d.kneeY;
  const shin = d.kneeY - d.ankleY;
  const restHipY = sk.bones[sk.index.Hips].world[1];
  const thick = Math.max(d.hipHD, d.chestHD) * 0.95;
  const kneeR = Math.max(d.kneeR, 0.02 * d.H);
  const ts = keys_.map((k) => k.t);
  const at = (t: number, f: (k: GK) => number) => key(ts, keys_.map(f), t);
  const atV = (t: number, f: (k: GK) => V3): V3 => [0, 1, 2].map((i) => at(t, (k) => f(k)[i])) as V3;
  /** forward reach of the ankle from the hip, for a leg (thigh / knee angles) under hips pitched p */
  const reach = (p: number, th: number, kn: number) => thigh * Math.sin((th - p) * DEG) + shin * Math.sin((th - p - kn) * DEG);
  const restArm = (s: number): V3 => norm([d.armDir[0] * s, d.armDir[1], 0]);
  const pose = (t: number): Pose => {
    const p = at(t, (k) => k.pitch);
    const legs = { l: [at(t, (k) => k.l[0]), at(t, (k) => k.l[1])], r: [at(t, (k) => k.r[0]), at(t, (k) => k.r[1])] };
    const rot: Record<string, Quat> = {};
    rot.Hips = qx(p * DEG);
    rot.Spine = qx(at(t, (k) => k.spine) * DEG);
    rot.Neck = qx(at(t, (k) => k.neck) * DEG);
    let y = thick;
    for (const s of [1, -1]) {
      const S = s > 0 ? 'Left' : 'Right';
      const [th, kn] = s > 0 ? legs.l : legs.r;
      rot[`${S}UpperLeg`] = qChain(qz(s * 4 * DEG), qx(-th * DEG));
      rot[`${S}LowerLeg`] = qx(kn * DEG);
      // a flat foot whenever it can be (it bends to point when the leg lies along the floor)
      const flat = kn - th + p;
      rot[`${S}Foot`] = qx(-Math.max(-60, Math.min(60, flat)) * DEG);
      const thW = th - p;
      const kneeY = kneeR + thigh * Math.cos(thW * DEG);
      const feetY = d.ankleY + thigh * Math.cos(thW * DEG) + shin * Math.cos((thW - kn) * DEG);
      y = Math.max(y, kneeY, feetY);
    }
    for (const s of [1, -1]) {
      const S = s > 0 ? 'Left' : 'Right';
      const D = s > 0 ? atV(t, (k) => k.armL) : atV(t, (k) => k.armR);
      const dir = restArm(s);
      rot[`${S}UpperArm`] = qFromTo(dir, norm(D));
      rot[`${S}LowerArm`] = qAxis(norm(cross([0, 0, 1], dir)), -at(t, (k) => k.elbow) * DEG);
    }
    // once the feet are planted, the hips travel to stand over them
    let z = 0;
    if (t > feetFrom) {
      const r0 = (legsAt: number) => {
        const pp = at(legsAt, (k) => k.pitch);
        return Math.max(reach(pp, at(legsAt, (k) => k.l[0]), at(legsAt, (k) => k.l[1])), reach(pp, at(legsAt, (k) => k.r[0]), at(legsAt, (k) => k.r[1])));
      };
      z = Math.max(0, r0(feetFrom) - r0(t));
    }
    return { rot, hips: [0, y - restHipY, prone ? 0 : z] };
  };
  return { name, duration: T, loop: false, info: { startsLying: prone ? 'front' : 'back' }, sample: pose };
}

export function reactionClips(sk: Skeleton, clips: Clip[]): Clip[] {
  const out: Clip[] = [];
  const hang = (s: number): V3 => [s * 0.15, -1, 0.05];
  // world-down in the chest's frame when the body is pitched p degrees forward
  const down = (s: number, p: number): V3 => [s * 0.15, -Math.cos(p * DEG), Math.sin(p * DEG)];

  out.push(
    getUp(sk, 'GetUpFromBack', 2.5, [
      { t: 0, pitch: -88, l: [0, 6], r: [0, 6], spine: 0, neck: 12, armL: [0.9, 0.2, -0.2], armR: [-0.9, 0.2, -0.2], elbow: 15 },
      { t: 0.7, pitch: -40, l: [48, 10], r: [48, 10], spine: 12, neck: 0, armL: [0.35, -0.8, -0.5], armR: [-0.35, -0.8, -0.5], elbow: 8 },
      { t: 1.2, pitch: -6, l: [134, 150], r: [128, 145], spine: 26, neck: -10, armL: [0.3, -0.45, 0.85], armR: [-0.3, -0.45, 0.85], elbow: 20 },
      { t: 1.8, pitch: 30, l: [112, 118], r: [112, 118], spine: 16, neck: -18, armL: [0.25, -0.55, 0.8], armR: [-0.25, -0.55, 0.8], elbow: 25 },
      { t: 2.5, pitch: 0, l: [0, 3], r: [0, 3], spine: 0, neck: 0, armL: hang(1), armR: hang(-1), elbow: 8 },
    ], 1.2, false),
    getUp(sk, 'GetUpFromFront', 2.7, [
      { t: 0, pitch: 88, l: [0, 4], r: [0, 4], spine: 0, neck: -45, armL: [0.55, 0.25, 0.8], armR: [-0.55, 0.25, 0.8], elbow: 90 },
      { t: 0.65, pitch: 72, l: [72, 92], r: [72, 92], spine: 4, neck: -40, armL: down(1, 72), armR: down(-1, 72), elbow: 4 },
      { t: 1.25, pitch: 0, l: [0, 92], r: [0, 92], spine: 6, neck: -4, armL: [0.25, -0.9, 0.3], armR: [-0.25, -0.9, 0.3], elbow: 20 },
      { t: 1.85, pitch: 6, l: [86, 88], r: [0, 92], spine: 14, neck: -8, armL: [0.3, -0.75, 0.6], armR: [-0.3, -0.85, 0.4], elbow: 25 },
      { t: 2.7, pitch: 0, l: [0, 3], r: [0, 3], spine: 0, neck: 0, armL: hang(1), armR: hang(-1), elbow: 8 },
    ], 99, true),
  );

  // ── hit reactions: an impulse that lands fast and fades; they start and end at Idle
  const idle = clips.find((c) => c.name === 'Idle')!;
  const T = 0.75;
  const impulse = (t: number) => (t < 0.07 ? t / 0.07 : Math.exp(-(t - 0.07) * 6.5) * (1 - Math.max(0, (t - 0.6) / 0.15)));
  const hit = (name: string, f: (rot: Record<string, Quat>, h: number) => V3) =>
    out.push({
      name,
      duration: T,
      loop: false,
      sample: (t) => {
        const b = idle.sample(t % idle.duration);
        const rot: Record<string, Quat> = { ...b.rot };
        const h = Math.max(0, impulse(t));
        const off = f(rot, h);
        return { rot, hips: [b.hips[0] + off[0], b.hips[1] + off[1], b.hips[2] + off[2]] };
      },
    });
  const mul = (rot: Record<string, Quat>, bone: string, q: Quat) => (rot[bone] = qMul(q, rot[bone] ?? qx(0)));
  const u = sk.dims.u;
  hit('HitHeadFront', (rot, h) => {
    mul(rot, 'Neck', qx(-24 * h * DEG));
    mul(rot, 'Head', qx(-18 * h * DEG));
    mul(rot, 'Spine', qx(-7 * h * DEG));
    return [0, -0.006 * u * h, -0.03 * u * h];
  });
  hit('HitHeadBack', (rot, h) => {
    mul(rot, 'Neck', qx(20 * h * DEG));
    mul(rot, 'Head', qx(14 * h * DEG));
    mul(rot, 'Spine', qx(8 * h * DEG));
    return [0, -0.006 * u * h, 0.03 * u * h];
  });
  hit('HitTorsoFront', (rot, h) => {
    mul(rot, 'Spine', qx(16 * h * DEG));
    mul(rot, 'Chest', qx(10 * h * DEG));
    mul(rot, 'Head', qx(-8 * h * DEG));
    for (const s of ['Left', 'Right']) mul(rot, `${s}UpperArm`, qx(-25 * h * DEG));
    for (const s of ['Left', 'Right']) mul(rot, `${s}UpperLeg`, qx(-10 * h * DEG)), mul(rot, `${s}LowerLeg`, qx(16 * h * DEG));
    return [0, -0.02 * u * h, -0.05 * u * h];
  });
  hit('HitTorsoBack', (rot, h) => {
    mul(rot, 'Spine', qx(-14 * h * DEG));
    mul(rot, 'Chest', qx(-8 * h * DEG));
    mul(rot, 'Neck', qx(10 * h * DEG));
    for (const s of ['Left', 'Right']) mul(rot, `${s}UpperArm`, qx(18 * h * DEG));
    return [0, -0.008 * u * h, 0.05 * u * h];
  });
  for (const side of [1, -1] as const) {
    const S = side > 0 ? 'Left' : 'Right';
    hit(`HitArm${S}`, (rot, h) => {
      // the arm is knocked back and out, the torso twists toward it
      mul(rot, `${S}UpperArm`, qChain(qx(30 * h * DEG), qz(side * 12 * h * DEG)));
      mul(rot, `${S}LowerArm`, qAxis([0, 1, 0], side * 30 * h * DEG));
      mul(rot, 'Spine', qy(side * 12 * h * DEG));
      mul(rot, 'Head', qy(side * 15 * h * DEG));
      return [0, 0, 0];
    });
    hit(`HitLeg${S}`, (rot, h) => {
      // the knee buckles, the body drops and tips toward the hurt side
      mul(rot, `${S}UpperLeg`, qx(-14 * h * DEG));
      mul(rot, `${S}LowerLeg`, qx(38 * h * DEG));
      mul(rot, `${S}Foot`, qx(-20 * h * DEG));
      mul(rot, 'Hips', qz(-side * 7 * h * DEG));
      mul(rot, 'Spine', qChain(qx(10 * h * DEG), qz(side * 6 * h * DEG)));
      return [side * 0.02 * u * h, -0.045 * u * h, 0];
    });
  }
  return out;
}
