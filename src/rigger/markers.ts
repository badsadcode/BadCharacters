/**
 * Rigging markers (Mixamo style): a handful of joint positions the person drags onto the model.
 * `autoMarkers` makes the first guess by slicing the mesh horizontally and reading the islands
 * (two legs below the crotch, the narrowest neck, arms splitting off the torso at the armpits).
 *
 * Conventions: the model faces +Z, the character's LEFT is +X, feet on y = 0.
 */
import type { V3 } from '../core/math';

export const MARKER_IDS = [
  'chin', 'neck', 'groin',
  'shoulder.L', 'elbow.L', 'wrist.L', 'knee.L', 'ankle.L', 'toes.L',
  'shoulder.R', 'elbow.R', 'wrist.R', 'knee.R', 'ankle.R', 'toes.R',
] as const;
export type MarkerId = (typeof MARKER_IDS)[number];
export type Markers = Record<MarkerId, V3>;

export const MARKER_LABELS: Record<MarkerId, string> = {
  chin: 'Chin', neck: 'Base of neck', groin: 'Groin',
  'shoulder.L': 'Left shoulder', 'elbow.L': 'Left elbow', 'wrist.L': 'Left wrist', 'knee.L': 'Left knee', 'ankle.L': 'Left ankle', 'toes.L': 'Left ball of foot',
  'shoulder.R': 'Right shoulder', 'elbow.R': 'Right elbow', 'wrist.R': 'Right wrist', 'knee.R': 'Right knee', 'ankle.R': 'Right ankle', 'toes.R': 'Right ball of foot',
};

/** the marker on the other side (centre markers mirror onto themselves) */
export function mirrorOf(id: MarkerId): MarkerId {
  if (id.endsWith('.L')) return id.replace('.L', '.R') as MarkerId;
  if (id.endsWith('.R')) return id.replace('.R', '.L') as MarkerId;
  return id;
}

/** move one marker and keep the model symmetric: its twin goes to the mirrored spot */
export function moveMirrored(m: Markers, id: MarkerId, p: V3): Markers {
  const out = { ...m, [id]: p };
  const twin = mirrorOf(id);
  out[twin] = twin === id ? [0, p[1], p[2]] : [-p[0], p[1], p[2]];
  if (twin === id) out[id] = [0, p[1], p[2]];
  return out;
}

interface Island {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** vertex ids welded by position (UV seams and split normals become one vertex) */
export function weldIds(pos: ArrayLike<number>, H: number): Uint32Array {
  const q = 1e-5 * Math.max(H, 1e-6);
  const map = new Map<string, number>();
  const ids = new Uint32Array(pos.length / 3);
  for (let i = 0; i < ids.length; i++) {
    const key = `${Math.round(pos[i * 3] / q)},${Math.round(pos[i * 3 + 1] / q)},${Math.round(pos[i * 3 + 2] / q)}`;
    let id = map.get(key);
    if (id === undefined) map.set(key, (id = map.size));
    ids[i] = id;
  }
  return ids;
}

/**
 * Cross-section of the mesh at y = h: every triangle crossing the plane contributes a segment;
 * segments sharing a mesh edge belong to the same loop. Loops whose x-ranges overlap (an outfit
 * shell over a leg) merge into one island.
 */
export function slice(pos: ArrayLike<number>, tris: ArrayLike<number>, weld: Uint32Array, h: number, merge = true): Island[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const pts = new Map<string, [number, number]>();
  for (let t = 0; t < tris.length; t += 3) {
    const keys: string[] = [];
    for (let e = 0; e < 3; e++) {
      const ia = tris[t + e];
      const ib = tris[t + ((e + 1) % 3)];
      const a = ia * 3;
      const b = ib * 3;
      const ya = pos[a + 1];
      const yb = pos[b + 1];
      if (ya === yb || (ya - h) * (yb - h) > 0) continue;
      const wa = weld[ia];
      const wb = weld[ib];
      const key = wa < wb ? `${wa}_${wb}` : `${wb}_${wa}`;
      if (!pts.has(key)) {
        const k = (h - ya) / (yb - ya);
        pts.set(key, [pos[a] + (pos[b] - pos[a]) * k, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * k]);
        parent.set(key, key);
      }
      keys.push(key);
    }
    for (let i = 1; i < keys.length; i++) {
      const ra = find(keys[0]);
      const rb = find(keys[i]);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const groups = new Map<string, Island>();
  for (const [key, [x, z]] of pts) {
    const r = find(key);
    const g = groups.get(r);
    if (!g) groups.set(r, { x0: x, x1: x, z0: z, z1: z });
    else {
      g.x0 = Math.min(g.x0, x);
      g.x1 = Math.max(g.x1, x);
      g.z0 = Math.min(g.z0, z);
      g.z1 = Math.max(g.z1, z);
    }
  }
  const list = [...groups.values()].sort((p, q) => p.x0 - q.x0);
  if (!merge) return list;
  const out: Island[] = [];
  for (const i of list) {
    const last = out[out.length - 1];
    if (last && i.x0 <= last.x1) {
      last.x1 = Math.max(last.x1, i.x1);
      last.z0 = Math.min(last.z0, i.z0);
      last.z1 = Math.max(last.z1, i.z1);
    } else out.push({ ...i });
  }
  return out;
}

const mid = (i: Island) => (i.x0 + i.x1) / 2;
const zMid = (i: Island) => (i.z0 + i.z1) / 2;
/** a loop that sits ON the centre line, not a wide trouser leg that just grazes it */
const containsCentre = (i: Island) => i.x0 < 0 && i.x1 > 0 && Math.abs(i.x0 + i.x1) < 0.35 * (i.x1 - i.x0);

export function autoMarkers(pos: ArrayLike<number>, tris: ArrayLike<number>): Markers {
  let H = 0;
  for (let i = 1; i < pos.length; i += 3) H = Math.max(H, pos[i]);
  const weld = weldIds(pos, H);
  const at = (y: number) => slice(pos, tris, weld, y * H);
  const centre = (isl: Island[]) => isl.find((i) => containsCentre(i));

  // ── crotch: the lowest slice where the body covers x = 0 (below it, two separate legs)
  // (single loops only: two flared trouser legs overlapping in x are still two legs)
  let groinY = 0.47;
  for (let y = 0.25; y < 0.7; y += 0.004) {
    if (slice(pos, tris, weld, y * H, false).some(containsCentre)) {
      groinY = y;
      break;
    }
  }
  // ── neck: the narrowest centre island in the upper body
  let neckY = 0.85;
  let best = Infinity;
  for (let y = 0.74; y < 0.95; y += 0.004) {
    const c = centre(at(y));
    if (!c) continue;
    const w = c.x1 - c.x0;
    if (w < best) {
      best = w;
      neckY = y;
    }
  }
  const neckW = best === Infinity ? 0.06 * H : best;
  // ── armpits: going down from the neck, where the arms split off the torso
  let armpitY = neckY - 0.08;
  let torsoHW = 0.12 * H;
  for (let y = neckY - 0.03; y > groinY; y -= 0.004) {
    const isl = at(y);
    const c = centre(isl);
    if (!c) continue;
    if (isl.some((i) => i.x0 > c.x1) && isl.some((i) => i.x1 < c.x0)) {
      armpitY = y;
      torsoHW = Math.min(-c.x0, c.x1);
      break;
    }
  }
  const neckBaseY = Math.min(neckY - 0.02, armpitY + 0.6 * (neckY - armpitY));
  const chinY = neckY + 0.35 * (1 - neckY) * 0.5;
  const shoulderY = armpitY + 0.75 * (neckBaseY - armpitY);
  const neckSlice = centre(at(neckBaseY));
  const neckZ = neckSlice ? zMid(neckSlice) : 0;
  const groinSlice = centre(at(groinY + 0.01));
  const groinZ = groinSlice ? zMid(groinSlice) : 0;

  const m: Partial<Markers> = {
    chin: [0, chinY * H, neckZ + neckW * 0.3],
    neck: [0, neckBaseY * H, neckZ],
    groin: [0, groinY * H, groinZ],
  };

  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    // fingertip: the most outward point below the shoulders
    let tip: V3 = [s * 0.4 * H, 0.5 * H, 0];
    let far = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      if (y > shoulderY * H || y < 0.15 * H) continue;
      const x = s * pos[i];
      if (x > far) {
        far = x;
        tip = [pos[i], y, pos[i + 2]];
      }
    }
    const sh: V3 = [s * torsoHW * 1.02, shoulderY * H, neckZ];
    const armLen = Math.hypot(tip[0] - sh[0], tip[1] - sh[1], tip[2] - sh[2]);
    const handLen = Math.min(0.11 * H, armLen * 0.25);
    const along = (t: number): V3 => [sh[0] + (tip[0] - sh[0]) * t, sh[1] + (tip[1] - sh[1]) * t, sh[2] + (tip[2] - sh[2]) * t];
    const wristT = (armLen - handLen) / armLen;
    m[`shoulder.${k}`] = sh;
    m[`elbow.${k}`] = along(wristT * 0.53);
    m[`wrist.${k}`] = along(wristT);

    // legs: the island on this side at knee and ankle height
    const legAt = (y: number): Island | undefined => at(y).filter((i) => s * mid(i) > 0 && s * mid(i) < 0.3 * H).sort((a, b) => Math.abs(mid(a)) - Math.abs(mid(b)))[0];
    const kneeY = groinY * 0.6;
    const ankleY = Math.max(0.04, groinY * 0.11);
    const kn = legAt(kneeY);
    const an = legAt(ankleY);
    // the ankle's depth from a slice just above the foot (lower down the slice runs through heel and toes)
    const shin = legAt(ankleY * 2);
    m[`knee.${k}`] = [kn ? mid(kn) : s * 0.09 * H, kneeY * H, kn ? zMid(kn) : 0];
    const ax = an ? mid(an) : s * 0.09 * H;
    const az = shin ? zMid(shin) : an ? zMid(an) : 0;
    m[`ankle.${k}`] = [ax, ankleY * H, az];
    // ball of the foot: 70 % of the way from the ankle to the toe tip, low
    let toeZ = az + 0.1 * H;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] < ankleY * H * 1.5 && s * pos[i] > 0 && Math.abs(pos[i] - ax) < 0.08 * H) toeZ = Math.max(toeZ, pos[i + 2]);
    }
    m[`toes.${k}`] = [ax, ankleY * H * 0.4, az + (toeZ - az) * 0.7];
  }
  return m as Markers;
}
