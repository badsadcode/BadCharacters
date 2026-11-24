/**
 * Our procedural clips are written for a canonical rest pose: legs straight down, each arm along
 * `dims.armDir`. An imported model is posed however its artist posed it (A-pose with the legs a
 * bit apart, slightly bent elbows...). Retargeting puts every limb in the canonical direction
 * first and plays the clip on top, so a walk is a walk and not a wide-legged waddle.
 *
 * With identity bone rests, a bone's world rotation is the product of local rotations down the
 * chain. For each bone we pick an alignment A_b (world rotation from the model's rest direction to
 * the canonical one) and play local = A_parent⁻¹ · C_b · A_b, so the world rotation becomes
 * C_chain · A_b: "straighten, then animate".
 */
import { norm, qFromTo, qMul, QI, Quat, sub, V3 } from '../core/math';
import type { Clip, Pose } from '../core/anim';
import type { Skeleton } from '../core/skeleton';

export interface Retarget {
  /** world alignment per bone (missing = identity) */
  align: Record<string, Quat>;
  /** how much the hips rise once the legs are straight (straight legs are longer than splayed ones) */
  raise: number;
}

const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function computeRetarget(sk: Skeleton): Retarget {
  const W = (n: string) => sk.bones[sk.index[n]].world;
  const align: Record<string, Quat> = {};
  const down: V3 = [0, -1, 0];
  let raise = 0;
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    // legs: thigh and shin straight down; feet keep their modelled orientation (soles stay flat)
    const hip = W(`${side}UpperLeg`);
    const knee = W(`${side}LowerLeg`);
    const ankle = W(`${side}Foot`);
    align[`${side}UpperLeg`] = qFromTo(norm(sub(knee, hip)), down);
    align[`${side}LowerLeg`] = qFromTo(norm(sub(ankle, knee)), down);
    const straight = Math.hypot(...sub(knee, hip)) + Math.hypot(...sub(ankle, knee));
    raise += (straight - (hip[1] - ankle[1])) / 2;
    // arms: upper arm and forearm along the canonical arm direction; the hand follows the forearm
    const canon: V3 = norm([sk.dims.armDir[0] * s, sk.dims.armDir[1], 0]);
    const sh = W(`${side}UpperArm`);
    const el = W(`${side}LowerArm`);
    const wr = W(`${side}Hand`);
    align[`${side}UpperArm`] = qFromTo(norm(sub(el, sh)), canon);
    align[`${side}LowerArm`] = qFromTo(norm(sub(wr, el)), canon);
    align[`${side}Hand`] = align[`${side}LowerArm`];
    align[`${side}ThumbProximal`] = align[`${side}LowerArm`];
  }
  return { align, raise };
}

/** play `clip` on the model's own rest pose (RestPose itself stays the bind pose) */
export function retargetClip(clip: Clip, sk: Skeleton, rt: Retarget): Clip {
  if (clip.name === 'RestPose') return clip;
  const A = (name: string) => rt.align[name] ?? QI;
  return {
    ...clip,
    sample: (t) => {
      const p = clip.sample(t);
      const rot: Pose['rot'] = {};
      for (const b of sk.bones) {
        const parent = b.parent >= 0 ? sk.bones[b.parent].name : null;
        const Ap = parent ? A(parent) : QI;
        const Ab = A(b.name);
        const C = p.rot[b.name] ?? QI;
        if (Ab === QI && Ap === QI) {
          if (p.rot[b.name]) rot[b.name] = C;
          continue;
        }
        rot[b.name] = qMul(qMul(inv(Ap), C), Ab);
      }
      return { ...p, rot, hips: [p.hips[0], p.hips[1] + rt.raise, p.hips[2]] };
    },
  };
}
