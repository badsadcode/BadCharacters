/**
 * Creature core: the shared vocabulary for every non-humanoid body plan.
 *
 * Conventions (same as the humanoids, and the same as Solitude's Swimmer):
 *   metres, +Y up, the creature faces +Z, its left is +X.
 *   Every bone's rest rotation is identity, so a bone's local rotation is "rotation away from
 *   rest, in world axes". Swimmers are centred on the origin; walkers stand on y = 0.
 *
 * Motion is described ONCE per species as Solitude-style channels (which bone waves about which
 * axis, how much, at what phase). That one description bakes the GLB clips AND writes the C#
 * CreatureProfile snippet, so the two can never drift apart.
 */
import type { Bone } from '../core/skeleton';
import type { Part, Ring, Weights } from '../core/loft';
import { add, qRotate, Quat, sub, V3 } from '../core/math';

/** yaw = about +Y (side to side), pitch = about +X (up/down), roll = about +Z (banking) */
export type Axis = 'yaw' | 'pitch' | 'roll';

export interface Channel {
  bone: string;
  axis: Axis;
  /** radians */
  amp: number;
  /** radians of the swim cycle */
  phase: number;
  /** Solitude: extra yaw per unit of turn rate (steering) */
  curl?: number;
}

export interface Motion {
  /** cycles per second while cruising */
  cycle: number;
  swim: Channel[];
  /** jaw bone and its ABSOLUTE open / closed angles (pitch about +X, radians, positive opens); the mesh is sculpted at `rest` */
  jaw?: { bone: string; rest: number; open: number; closed: number };
  /** whole-body heading sway (serpents) */
  bodySway?: number;
  /** a walking gait instead of swimming (legged plans) */
  walk?: { legs: { upper: string; lower: string; side: 1 | -1; phase: number }[]; stride: number };
  /** jellies: bell pulse instead of a wave */
  pulse?: { bell: string; tentacles: string[][] };
  /** Solitude temperament hint */
  temperament: 'Grazer' | 'Apex';
}

export interface CreatureBuild {
  bones: Bone[];
  index: Record<string, number>;
  parts: Part[];
  motion: Motion;
  /** bone that carries root motion / bobbing (translation channel) */
  moveBone: string;
  /** model length along Z (for scaling in engines) */
  length: number;
  /** does it stand on the floor (walkers) or float centred (swimmers)? */
  grounded: boolean;
}

/** a little skeleton builder: bones are added in parent-before-child order */
export class Rig {
  bones: Bone[] = [];
  index: Record<string, number> = {};
  add(name: string, parent: string | null, world: V3) {
    this.index[name] = this.bones.length;
    this.bones.push({ name, parent: parent === null ? -1 : this.index[parent], world });
    return name;
  }
  w(...pairs: [string, number][]): Weights {
    return pairs.filter(([, x]) => x > 1e-4).map(([n, x]) => [this.index[n], x]);
  }
}

/**
 * Smooth skin weights along a chain. `joints` are [bone, t] where t is where that bone's region
 * starts along the body (0 = snout). Each region belongs to its bone; weights blend linearly
 * between neighbouring region centres, so the body bends as one surface.
 */
export function chainWeights(rig: Rig, joints: [string, number][], t: number): Weights {
  const js = [...joints].sort((a, b) => a[1] - b[1]);
  const centres = js.map(([, s], i) => (s + (i + 1 < js.length ? js[i + 1][1] : Math.max(s + 0.1, 1))) / 2);
  if (t <= centres[0]) return rig.w([js[0][0], 1]);
  for (let i = 0; i < js.length - 1; i++) {
    if (t <= centres[i + 1]) {
      const f = (t - centres[i]) / (centres[i + 1] - centres[i]);
      return rig.w([js[i][0], 1 - f], [js[i + 1][0], f]);
    }
  }
  return rig.w([js[js.length - 1][0], 1]);
}

/** rigidly rotate a ring about a pivot (used to sculpt jaws open, curl tentacles…) */
export function rotateRing(r: Ring, pivot: V3, q: Quat): Ring {
  return { ...r, c: add(pivot, qRotate(q, sub(r.c, pivot))), p: qRotate(q, r.p), q: qRotate(q, r.q), d: qRotate(q, r.d) };
}

export const TAU = Math.PI * 2;
