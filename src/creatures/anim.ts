/**
 * Creature clips, baked from the species' motion channels (the same channels the Solitude
 * CreatureProfile snippet uses, so the baked clips and the game's procedural motion agree).
 */
import type { Clip, Pose } from '../core/anim';
import { qMul, qx, qy, qz, Quat, V3, QI } from '../core/math';
import type { Channel, CreatureBuild } from './core';
import { TAU } from './core';

const axisQ = (axis: Channel['axis'], a: number) => (axis === 'yaw' ? qy(a) : axis === 'pitch' ? qx(a) : qz(a));
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const keys = (k: [number, number][], t: number) => {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) return k[i][1] + (k[i + 1][1] - k[i][1]) * ease((t - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return k[k.length - 1][1];
};

export function creatureClips(b: CreatureBuild): Clip[] {
  const m = b.motion;
  const L = b.length;
  const wave = (ph: number, ampK: number, rot: Record<string, Quat>) => {
    for (const c of m.swim) rot[c.bone] = qMul(rot[c.bone] ?? QI, axisQ(c.axis, c.amp * ampK * Math.sin(ph - c.phase)));
    if (m.bodySway) rot[b.moveBone] = qMul(rot[b.moveBone] ?? QI, qy(m.bodySway * ampK * Math.sin(ph + 0.6)));
  };
  /** jaw: angle relative to the sculpted rest gape */
  const jaw = (rot: Record<string, Quat>, angle: number) => {
    if (m.jaw) rot[m.jaw.bone] = qx(angle - m.jaw.rest);
  };
  const cycleClip = (name: string, T: number, ampK: number, jawFn?: (ph: number) => number, bob = 0): Clip => ({
    name,
    duration: T,
    loop: true,
    sample: (t) => {
      const ph = (TAU * t) / T;
      const rot: Record<string, Quat> = {};
      wave(ph, ampK, rot);
      if (m.jaw && jawFn) jaw(rot, jawFn(ph));
      return { rot, hips: [0, bob * L * Math.sin(ph), 0] as V3 };
    },
  });
  const T = 1 / m.cycle;
  const clips: Clip[] = [];
  if (m.walk) {
    clips.push(walkClip(b, 'Walk', 1.0, 1), walkClip(b, 'Run', 0.55, 1.5), walkClip(b, 'Idle', 3, 0.0));
  } else {
    clips.push(
      cycleClip('Swim', T, 1, m.jaw ? (ph) => m.jaw!.rest + 0.04 * Math.sin(ph) : undefined, m.pulse ? 0.03 : 0),
      cycleClip('SwimFast', T * 0.55, 1.35, m.jaw ? (ph) => m.jaw!.rest * 0.7 : undefined, m.pulse ? 0.05 : 0),
      cycleClip('Idle', T * 2.2, 0.3, m.jaw ? (ph) => m.jaw!.rest + 0.06 * Math.sin(ph * 0.5) : undefined, 0.006),
    );
  }
  if (m.jaw) {
    const j = m.jaw;
    clips.push({
      name: 'Bite',
      duration: 1.3,
      loop: false,
      sample: (t) => {
        const open = keys([[0, j.rest], [0.45, j.open], [0.62, j.closed], [0.9, j.closed], [1.3, j.rest]], t);
        const lunge = keys([[0, 0], [0.45, -0.02], [0.62, 0.09], [0.9, 0.05], [1.3, 0]], t);
        const rot: Record<string, Quat> = {};
        wave((TAU * t) / (T * 0.6), 0.6, rot);
        jaw(rot, open);
        rot.Head = qMul(rot.Head ?? QI, qx(-0.12 * keys([[0, 0], [0.45, 1], [0.7, -0.3], [1.3, 0]], t)));
        return { rot, hips: [0, 0, lunge * L] };
      },
    });
  }
  if (m.pulse || m.walk) {
    // grabbers: a fast, exaggerated wave and a lunge toward the target
    clips.push({
      name: 'Attack',
      duration: 1.4,
      loop: false,
      sample: (t) => {
        const reach = keys([[0, 0], [0.5, 1], [0.8, -0.4], [1.4, 0]], t);
        const rot: Record<string, Quat> = {};
        wave((TAU * t) / 0.7, 0.6 + 1.6 * Math.abs(reach), rot);
        if (m.jaw) jaw(rot, keys([[0, m.jaw.rest], [0.5, m.jaw.open], [0.8, m.jaw.closed], [1.4, m.jaw.rest]], t));
        return { rot, hips: [0, 0, 0.06 * L * reach] };
      },
    });
  }
  clips.push({ name: 'RestPose', duration: 1, loop: true, sample: () => ({ rot: {}, hips: [0, 0, 0] }) });
  return clips;
}

/** legged walkers: alternating tripod-ish gait, each leg lifts and swings */
function walkClip(b: CreatureBuild, name: string, T: number, k: number): Clip {
  const w = b.motion.walk!;
  return {
    name,
    duration: T,
    loop: true,
    sample: (t): Pose => {
      const ph = (TAU * t) / T;
      const rot: Record<string, Quat> = {};
      for (const leg of w.legs) {
        const p = ph + leg.phase;
        const lift = Math.max(0, Math.sin(p));
        rot[leg.upper] = qMul(qy(leg.side * w.stride * k * Math.cos(p)), qz(leg.side * 0.35 * k * lift));
        rot[leg.lower] = qz(-leg.side * 0.25 * k * lift);
      }
      for (const c of b.motion.swim) if (!c.bone.startsWith('Leg')) rot[c.bone] = qMul(rot[c.bone] ?? QI, axisQ(c.axis, c.amp * (k || 0.3) * Math.sin(ph * (k ? 2 : 0.5) - c.phase)));
      return { rot, hips: [0, 0.01 * b.length * (k ? Math.abs(Math.sin(ph * 2)) : 0.2 * Math.sin(ph)), 0] };
    },
  };
}
