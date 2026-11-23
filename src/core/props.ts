/**
 * Hand props, modelled in the pose where they are USED and mapped back into the holding
 * bone's rest frame. That way a bow is perfectly vertical at full draw and a crossbow's stock
 * sits on the shoulder while aiming, without any per-engine fiddling.
 *
 * The bow string is the one non-rigid bit: its middle is skinned to an extra `BowString` bone
 * (child of LeftHand) that the BowShoot clip moves to the drawing hand.
 */
import { buildClips, worldPose } from './anim';
import { limbFrame, weightsOf } from './body';
import { Part, ring, Ring, Weights } from './loft';
import { add, cross, dot, norm, qRotate, Quat, scale, sub, V3 } from './math';
import type { CharacterRecipe } from './recipe';
import type { Skeleton } from './skeleton';

const qInv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** world pose of the skeleton at time t of a clip */
function poseAt(sk: Skeleton, clip: string, t: number) {
  const c = buildClips(sk).find((x) => x.name === clip)!;
  return worldPose(sk, c.sample(t));
}

/** maps world points (in that pose) into the rest frame of `bone` */
function restMapper(sk: Skeleton, wp: ReturnType<typeof worldPose>, bone: string) {
  const i = sk.index[bone];
  const q = wp.rot[i];
  const inv = qInv(q);
  const rest = sk.bones[i].world;
  return (P: V3): V3 => add(rest, qRotate(inv, sub(P, wp.pos[i])));
}

/** the grip point of a hand (middle of the fist) in a pose */
export function gripWorld(sk: Skeleton, wp: ReturnType<typeof worldPose>, side: 'Left' | 'Right'): V3 {
  const i = sk.index[`${side}Hand`];
  const s = side === 'Left' ? 1 : -1;
  const d = sk.dims;
  const off: V3 = [d.armDir[0] * s * d.handLen * 0.5, d.armDir[1] * d.handLen * 0.5, 0];
  return add(wp.pos[i], qRotate(wp.rot[i], off));
}

/** a tube along a polyline of world points, rings perpendicular to the path */
function path(name: string, material: string, pts: V3[], radii: number[], up: V3, w: Weights[] | Weights, n = 2.4, depth = 1): Part {
  const rings: Ring[] = pts.map((P, i) => {
    const tan = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const { p, q } = limbFrame(tan, up);
    const ww = Array.isArray(w[0]) && Array.isArray((w as Weights[])[0][0]) ? (w as Weights[])[i] : (w as Weights);
    return ring(P, p, q, radii[i], radii[i] * depth, n, ww);
  });
  return { name, material, rings, capStart: true, capEnd: true, lod: 'small' };
}

/** BowString bone: added to the skeleton when the character carries a bow */
export function addPropBones(rc: CharacterRecipe, sk: Skeleton) {
  if (!rc.mesh.exportProps || rc.outfit.prop?.id !== 'bow' || sk.index.BowString !== undefined) return;
  const b = bowFrame(sk);
  sk.index.BowString = sk.bones.length;
  sk.bones.push({ name: 'BowString', parent: sk.index.LeftHand, world: b.toRest(b.stringMid) });
}

function bowFrame(sk: Skeleton) {
  const wp = poseAt(sk, 'BowShoot', 0.3); // bow raised, string not yet drawn
  const G = gripWorld(sk, wp, 'Left');
  const li = sk.index.LeftHand;
  const F = norm(qRotate(wp.rot[li], [sk.dims.armDir[0], sk.dims.armDir[1], 0]));
  const U = norm(sub([0, 1, 0], scale(F, dot([0, 1, 0], F))));
  const Lh = 0.62 * sk.dims.u;
  const back = 0.15 * Lh;
  return { G, F, U, Lh, back, stringMid: add(G, scale(F, -back * 1.05)), toRest: restMapper(sk, wp, 'LeftHand') };
}

export function buildProps(rc: CharacterRecipe, sk: Skeleton): Part[] {
  if (!rc.mesh.exportProps) return [];
  const id = rc.outfit.prop?.id;
  addPropBones(rc, sk);
  const d = sk.dims;
  if (id === 'bow') {
    const b = bowFrame(sk);
    const W = (n: string) => weightsOf(sk, [n, 1]);
    // limb: recurve-ish arc, tips bending back toward the archer
    const ts = [-1, -0.7, -0.35, 0, 0.35, 0.7, 1];
    const pts = ts.map((t) => b.toRest(add(b.G, add(scale(b.U, t * b.Lh), scale(b.F, -b.back * t * t)))));
    const radii = ts.map((t) => (0.016 - 0.009 * Math.abs(t)) * d.u * 1.2);
    const upRest = b.toRest(add(b.G, b.F));
    const fwdRest = norm(sub(upRest, b.toRest(b.G)));
    const parts: Part[] = [path('prop.bow', 'prop', pts, radii, fwdRest, W('LeftHand'), 2.4, 1.6)];
    // string: tip → BowString bone → tip, blended linearly so it stays straight
    const top = b.toRest(add(b.G, add(scale(b.U, b.Lh), scale(b.F, -b.back))));
    const bot = b.toRest(add(b.G, add(scale(b.U, -b.Lh), scale(b.F, -b.back))));
    const mid = sk.bones[sk.index.BowString].world;
    const lerpP = (a: V3, c: V3, t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    const sr = 0.0025 * d.u + 0.001;
    for (const [nm, tip] of [['prop.string.top', top], ['prop.string.bot', bot]] as const) {
      const ws: Weights[] = [W('LeftHand'), [[sk.index.LeftHand, 0.5], [sk.index.BowString, 0.5]], W('BowString')];
      parts.push(path(nm, 'prop.2', [tip, lerpP(tip, mid, 0.5), mid], [sr, sr, sr], fwdRest, ws, 2));
    }
    // grip wrap
    parts.push(path('prop.grip', 'prop.2', [b.toRest(add(b.G, scale(b.U, -0.12 * b.Lh))), b.toRest(add(b.G, scale(b.U, 0.12 * b.Lh)))], [0.02 * d.u, 0.02 * d.u], fwdRest, W('LeftHand'), 2.4, 1.3));
    return parts;
  }
  if (id === 'rifle') {
    const wp = poseAt(sk, 'RifleAim', 0);
    const R = gripWorld(sk, wp, 'Right');
    const Lg = gripWorld(sk, wp, 'Left');
    const F = norm(sub(Lg, R));
    const U = norm(sub([0, 1, 0], scale(F, dot([0, 1, 0], F))));
    const toRest = restMapper(sk, wp, 'RightHand');
    const W = weightsOf(sk, ['RightHand', 1]);
    const L = Math.max(0.5 * d.u, Math.hypot(...sub(Lg, R)) * 1.7);
    const at = (f: number, u = 0) => toRest(add(R, add(scale(F, f * L), scale(U, u * L))));
    const upRest = norm(sub(at(0, 1), at(0, 0)));
    const w = 0.028 * d.u;
    return [
      path('prop.stock', 'prop', [at(-0.4, -0.05), at(-0.12, 0.02), at(0.05, 0.05)], [w * 1.4, w, w * 0.9], upRest, W, 6, 1.6),
      path('prop.receiver', 'prop.2', [at(0.02, 0.06), at(0.38, 0.06)], [w, w], upRest, W, 6, 1.3),
      path('prop.handguard', 'prop', [at(0.38, 0.055), at(0.72, 0.055)], [w * 0.8, w * 0.75], upRest, W, 5, 1.2),
      path('prop.barrel', 'prop.2', [at(0.7, 0.07), at(1.05, 0.07)], [w * 0.3, w * 0.3], upRest, W, 2.2),
      path('prop.mag', 'prop.2', [at(0.25, 0.02), at(0.29, -0.16)], [w * 0.5, w * 0.5], upRest, W, 6, 2),
    ];
  }
  if (id === 'crossbow') {
    const wp = poseAt(sk, 'CrossbowShoot', 0.3);
    const R = gripWorld(sk, wp, 'Right');
    const Lg = gripWorld(sk, wp, 'Left');
    const F = norm(sub(Lg, R));
    const U = norm(sub([0, 1, 0], scale(F, dot([0, 1, 0], F))));
    const S = norm(cross(U, F));
    const toRest = restMapper(sk, wp, 'RightHand');
    const W = weightsOf(sk, ['RightHand', 1]);
    const L = Math.max(0.45 * d.u, Math.hypot(...sub(Lg, R)) * 1.6);
    const at = (f: number, u = 0, s = 0) => toRest(add(R, add(scale(F, f * L), add(scale(U, u * L), scale(S, s * L)))));
    const upRest = norm(sub(at(0, 1), at(0, 0)));
    const sideRest = norm(sub(at(0, 0, 1), at(0, 0)));
    const sw = 0.03 * d.u;
    const parts: Part[] = [
      path('prop.stock', 'prop', [at(-0.42, -0.02), at(-0.1, 0.03), at(0.62, 0.05), at(0.68, 0.05)], [sw * 1.3, sw, sw * 0.9, sw * 0.7], upRest, W, 6, 1.4),
      path('prop.trigger', 'prop.2', [at(-0.02, 0.0), at(0.04, -0.09)], [sw * 0.5, sw * 0.4], sideRest, W, 4),
    ];
    // prod (the bow part), swept back at the tips, and a cocked string
    const prod = [-1, -0.5, 0, 0.5, 1].map((t) => at(0.6 - 0.08 * t * t, 0.06, t * 0.42));
    parts.push(path('prop.prod', 'prop.2', prod, [sw * 0.4, sw * 0.6, sw * 0.7, sw * 0.6, sw * 0.4], upRest, W, 2.6, 1.6));
    const nut = at(0.18, 0.06);
    const sr = 0.0025 * d.u + 0.001;
    parts.push(path('prop.xstring.l', 'prop.2', [prod[0], nut], [sr, sr], upRest, W, 2));
    parts.push(path('prop.xstring.r', 'prop.2', [prod[4], nut], [sr, sr], upRest, W, 2));
    return parts;
  }
  return [];
}
