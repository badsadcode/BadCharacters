/**
 * Death animations (because games are hard). Each one buckles the knees, tips the body around the
 * feet with gravity speeding it up, bounces a little on impact, and ends lying on the floor with the
 * body's thickness under it, so an engine can hand over to a ragdoll or just leave the body there.
 * None loop. `info.endsLying` says how the body ends up: 'front', 'back' or 'side'.
 */
import { add, cross, DEG, lerp, norm, qAxis, qChain, qFromTo, Quat, qRotate, qx, qy, qz, V3 } from './math';
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
