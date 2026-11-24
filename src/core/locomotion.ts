/**
 * Directional locomotion: walking backward, strafing (standing and crouched) and turning on the
 * spot. All in place like Walk; the turns end rotated (info.turnDeg) so a controller can rotate
 * the character by the same amount when the clip ends.
 */
import { DEG, qChain, qMul, Quat, qx, qy, qz, QI } from './math';
import type { Clip, Pose } from './anim';
import type { Kit } from './actions';

const TAU = Math.PI * 2;
const pos = (x: number) => Math.max(0, x);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function locomotionClips(kit: Kit): Clip[] {
  const { sk, clips, drop } = kit;
  const d = sk.dims;
  const clip = (n: string) => clips.find((c) => c.name === n)!;
  const idle = clip('Idle');
  const legLen = d.hipY;
  const out: Clip[] = [];

  // ── backward: the forward cycle played in reverse, a touch more upright
  const backward = (src: string, name: string, lean: number): Clip => {
    const c = clip(src);
    return {
      name,
      duration: c.duration * 1.1,
      loop: true,
      sample: (t) => {
        const p = c.sample(c.duration - t / 1.1);
        const rot = { ...p.rot };
        rot.Spine = qMul(qx(lean * DEG), rot.Spine ?? QI);
        return { ...p, rot };
      },
    };
  };
  out.push(backward('Walk', 'WalkBackward', -4), backward('CrouchWalk', 'CrouchWalkBackward', -3));

  // ── strafing: the leading leg steps out to the side, the other follows
  const strafe = (dir: 1 | -1, crouched: boolean): Clip => {
    const T = clip('Walk').duration * (crouched ? 1.25 : 0.95);
    const baseTh = crouched ? 48 : 3;
    const baseKn = crouched ? 82 : 6;
    return {
      name: `${crouched ? 'Crouch' : ''}Strafe${dir > 0 ? 'Left' : 'Right'}`,
      duration: T,
      loop: true,
      sample: (t) => {
        const ph = (TAU * t) / T;
        const b = idle.sample(t % idle.duration);
        const rot: Record<string, Quat> = { ...b.rot };
        for (const s of [1, -1]) {
          const S = s > 0 ? 'Left' : 'Right';
          const lead = s === dir;
          const lift = pos(Math.sin(ph + (lead ? 0 : Math.PI)));
          // out to the side while the foot is up, back under the hip while it's down
          const abd = s * (lead ? 4 + 13 * lift : 2 + 5 * lift) * (crouched ? 0.8 : 1);
          const th = baseTh + 12 * lift;
          const kn = baseKn + 28 * lift;
          rot[`${S}UpperLeg`] = qChain(qz(abd * DEG), qx(-th * DEG));
          rot[`${S}LowerLeg`] = qx(kn * DEG);
          rot[`${S}Foot`] = qx(-(kn - th) * DEG);
        }
        rot.Hips = qz(dir * 3 * Math.sin(ph) * DEG);
        if (crouched) {
          rot.Spine = qMul(qx(22 * DEG), rot.Spine ?? QI);
          rot.Head = qMul(qx(-20 * DEG), rot.Head ?? QI);
        }
        const hy = -drop(baseTh, baseKn) + 0.012 * legLen * Math.cos(2 * ph);
        return { rot, hips: [dir * 0.035 * legLen * Math.sin(ph), hy, crouched ? -0.2 * (d.hipY - d.kneeY) : 0] };
      },
    };
  };
  out.push(strafe(1, false), strafe(-1, false), strafe(1, true), strafe(-1, true));

  // ── turning on the spot: the hips turn, each foot stays planted until its own little step
  const turn = (name: string, deg: number, T: number): Clip => ({
    name,
    duration: T,
    loop: false,
    info: { turnDeg: deg },
    sample: (t) => {
      const k = ease(t / T);
      const yaw = deg * k;
      const b = idle.sample(t % idle.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      rot.Hips = qy(yaw * DEG);
      // the head leads the turn
      rot.Head = qMul(qy(deg * 0.18 * Math.sin(Math.PI * Math.min(1, k * 1.3)) * DEG), rot.Head ?? QI);
      // the inside foot steps first, then the outside one
      const first = deg > 0 ? 1 : -1;
      for (const s of [1, -1]) {
        const S = s > 0 ? 'Left' : 'Right';
        const [a, b2] = s === first ? [0.1, 0.55] : [0.45, 0.95];
        const u = ease((t / T - a) / (b2 - a));
        const footYaw = deg * u; // where this foot points in the world
        const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, (t / T - a) / (b2 - a))));
        rot[`${S}UpperLeg`] = qChain(qy((footYaw - yaw) * DEG), qx(-(4 + 18 * lift) * DEG));
        rot[`${S}LowerLeg`] = qx((6 + 36 * lift) * DEG);
        rot[`${S}Foot`] = qx(-(2 + 18 * lift) * DEG);
      }
      const p: Pose = { rot, hips: [0, b.hips[1] - 0.008 * legLen * Math.sin(Math.PI * k), 0] };
      return p;
    },
  });
  out.push(turn('TurnLeft90', 90, 1.0), turn('TurnRight90', -90, 1.0), turn('Turn180', 180, 1.5));
  return out;
}
