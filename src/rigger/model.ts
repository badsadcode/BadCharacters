/**
 * An imported model, flattened into world space and normalised to our conventions:
 * metres, +Y up, facing +Z, feet on y = 0, centred on the origin.
 */
import { dir3, Gltf, I4, M4, meshInstances, mul4, normalMatrix, parseGlb, point, readAccessor, trs } from './glb';
import type { V3 } from '../core/math';

export interface ModelOptions {
  /** desired height in metres (unset = keep the file's size) */
  height?: number;
  /** turn the model about +Y so it faces +Z (degrees, multiples of 90) */
  yaw?: number;
}

export interface ModelPrim {
  /** mesh-instance index and primitive index in the source file */
  inst: number;
  mesh: number;
  prim: number;
  positions: Float64Array;
  normals?: Float64Array;
  tangents?: Float64Array;
  indices: Uint32Array;
  /** morph targets (shape keys): position / normal deltas, transformed like the mesh */
  targets: { POSITION?: Float64Array; NORMAL?: Float64Array }[];
}

export interface Model {
  gltf: Gltf;
  instances: ReturnType<typeof meshInstances>;
  prims: ModelPrim[];
  /** every vertex of every primitive, concatenated */
  positions: Float64Array;
  /** triangles over `positions` */
  triangles: Uint32Array;
  /** primitive p's vertices start at offsets[p] in `positions` */
  offsets: number[];
  height: number;
  /** the original height in file units, before scaling */
  sourceHeight: number;
  warnings: string[];
}

export function loadModel(bytes: Uint8Array, opts: ModelOptions = {}): Model {
  const gltf = parseGlb(bytes);
  const warnings: string[] = [];
  if (gltf.json.skins?.length) warnings.push('the file already had a skeleton; it was replaced');
  if (gltf.json.animations?.length) warnings.push('the file had animations; they were replaced by ours');
  const instances = meshInstances(gltf);
  if (!instances.length) throw new Error('no meshes found in this GLB');
  const yaw = ((opts.yaw ?? 0) * Math.PI) / 180;
  const turn = trs([0, 0, 0], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);

  // pass 1: world positions after the turn, to measure the model
  type Raw = { inst: number; mesh: number; prim: number; m: M4 };
  const raws: Raw[] = [];
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  instances.forEach((ins, ii) => {
    const mesh = gltf.json.meshes[ins.mesh];
    const m = mul4(turn, ins.world);
    mesh.primitives.forEach((p: { mode?: number; attributes: Record<string, number> }, pi: number) => {
      if ((p.mode ?? 4) !== 4) {
        warnings.push(`skipped a non-triangle primitive in mesh "${mesh.name ?? ins.mesh}"`);
        return;
      }
      raws.push({ inst: ii, mesh: ins.mesh, prim: pi, m });
      const pos = readAccessor(gltf, p.attributes.POSITION).data;
      for (let i = 0; i < pos.length; i += 3) {
        const w = point(m, pos, i);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], w[k]);
          hi[k] = Math.max(hi[k], w[k]);
        }
      }
    });
  });
  const sourceHeight = hi[1] - lo[1];
  if (!(sourceHeight > 0)) throw new Error('the model has no height');
  const s = opts.height ? opts.height / sourceHeight : 1;
  // centre on x/z, feet on the floor, then scale
  const fit = mul4(trs([0, 0, 0], [0, 0, 0, 1], [s, s, s]), trs([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]));

  // pass 2: final geometry
  const prims: ModelPrim[] = [];
  for (const r of raws) {
    const p = gltf.json.meshes[r.mesh].primitives[r.prim];
    const m = mul4(fit, r.m);
    const nm = normalMatrix(m);
    const src = readAccessor(gltf, p.attributes.POSITION).data;
    const positions = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 3) positions.set(point(m, src, i), i);
    let normals: Float64Array | undefined;
    if (p.attributes.NORMAL !== undefined) {
      const n = readAccessor(gltf, p.attributes.NORMAL).data;
      normals = new Float64Array(n.length);
      for (let i = 0; i < n.length; i += 3) normals.set(dir3(nm, n, i), i);
    }
    let tangents: Float64Array | undefined;
    if (p.attributes.TANGENT !== undefined) {
      const t = readAccessor(gltf, p.attributes.TANGENT).data;
      tangents = new Float64Array(t.length);
      // tangents follow the surface like positions (linear part), keep their handedness sign
      const lin = [...m.slice(0, 3), ...m.slice(4, 7), ...m.slice(8, 11)];
      for (let i = 0; i < t.length; i += 4) {
        tangents.set(dir3(lin, t, i), i);
        tangents[i + 3] = t[i + 3] * Math.sign(det3(lin) || 1);
      }
    }
    // morph target deltas are directions: linear part only (no translation); normal deltas use the normal matrix, unnormalised
    const lin3 = (v: ArrayLike<number>, i: number): [number, number, number] => [
      m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2],
      m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2],
      m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2],
    ];
    const nrm3 = (v: ArrayLike<number>, i: number): [number, number, number] => [
      nm[0] * v[i] + nm[3] * v[i + 1] + nm[6] * v[i + 2],
      nm[1] * v[i] + nm[4] * v[i + 1] + nm[7] * v[i + 2],
      nm[2] * v[i] + nm[5] * v[i + 1] + nm[8] * v[i + 2],
    ];
    const targets = ((p as { targets?: Record<string, number>[] }).targets ?? []).map((t) => {
      const out: { POSITION?: Float64Array; NORMAL?: Float64Array } = {};
      for (const [key, fn] of [['POSITION', lin3], ['NORMAL', nrm3]] as const) {
        if (t[key] === undefined) continue;
        const d = readAccessor(gltf, t[key]).data;
        const o = new Float64Array(d.length);
        for (let i = 0; i < d.length; i += 3) o.set(fn(d, i), i);
        out[key] = o;
      }
      return out;
    });
    const count = src.length / 3;
    const indices = p.indices !== undefined ? Uint32Array.from(readAccessor(gltf, p.indices).data) : Uint32Array.from({ length: count }, (_, i) => i);
    // a mirrored transform flips triangle winding; flip it back so faces stay outward
    if (det3([...m.slice(0, 3), ...m.slice(4, 7), ...m.slice(8, 11)]) < 0) {
      for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
    prims.push({ inst: r.inst, mesh: r.mesh, prim: r.prim, positions, normals, tangents, indices, targets });
  }
  const offsets: number[] = [];
  let total = 0;
  let tris = 0;
  for (const p of prims) {
    offsets.push(total);
    total += p.positions.length / 3;
    tris += p.indices.length;
  }
  const positions = new Float64Array(total * 3);
  const triangles = new Uint32Array(tris);
  let t = 0;
  prims.forEach((p, i) => {
    positions.set(p.positions, offsets[i] * 3);
    for (const k of p.indices) triangles[t++] = k + offsets[i];
  });
  return { gltf, instances, prims, positions, triangles, offsets, height: sourceHeight * s, sourceHeight, warnings };
}

const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4]);

export { I4 };
