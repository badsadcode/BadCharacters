/**
 * Minimal glTF 2.0 / GLB reader for the auto-rigger. It only needs to *read* geometry (positions,
 * normals, tangents, indices) and node transforms; everything else in the file (materials,
 * textures, images, extensions) is carried through untouched by the writer in rig.ts.
 */
import type { V3 } from '../core/math';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Gltf {
  json: any;
  bin: Uint8Array;
}

export function parseGlb(bytes: Uint8Array): Gltf {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file (only binary .glb is supported, not .gltf)');
  const total = dv.getUint32(8, true);
  let o = 12;
  let json: any = null;
  let bin = new Uint8Array(0);
  while (o < total) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const chunk = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk.slice();
    o += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  if ((json.buffers ?? []).some((b: any, i: number) => i > 0 || b.uri)) throw new Error('GLB references external buffers; export it as a single self-contained .glb');
  return { json, bin };
}

const COMPONENTS: Record<number, [number, (dv: DataView, o: number) => number, number]> = {
  5120: [1, (dv, o) => dv.getInt8(o), 127],
  5121: [1, (dv, o) => dv.getUint8(o), 255],
  5122: [2, (dv, o) => dv.getInt16(o, true), 32767],
  5123: [2, (dv, o) => dv.getUint16(o, true), 65535],
  5125: [4, (dv, o) => dv.getUint32(o, true), 4294967295],
  5126: [4, (dv, o) => dv.getFloat32(o, true), 1],
};
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** read an accessor as plain numbers (normalized integers become 0…1 / -1…1) */
export function readAccessor(g: Gltf, index: number): { data: Float64Array; size: number; count: number } {
  const a = g.json.accessors[index];
  if (a.sparse) throw new Error('sparse accessors are not supported');
  const size = SIZES[a.type];
  const [bytes, get, max] = COMPONENTS[a.componentType];
  const out = new Float64Array(a.count * size);
  if (a.bufferView === undefined) return { data: out, size, count: a.count };
  const bv = g.json.bufferViews[a.bufferView];
  const stride = bv.byteStride || bytes * size;
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < size; k++) {
      let v = get(dv, base + i * stride + k * bytes);
      if (a.normalized) v = a.componentType === 5120 || a.componentType === 5122 ? Math.max(v / max, -1) : v / max;
      out[i * size + k] = v;
    }
  }
  return { data: out, size, count: a.count };
}

// ───────────────────────────────────────────────────────────── matrices (column-major, like glTF)
export type M4 = number[];
export const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export function trs(t: V3 = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: V3 = [1, 1, 1]): M4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
export const point = (m: M4, p: ArrayLike<number>, o = 0): V3 => [
  m[0] * p[o] + m[4] * p[o + 1] + m[8] * p[o + 2] + m[12],
  m[1] * p[o] + m[5] * p[o + 1] + m[9] * p[o + 2] + m[13],
  m[2] * p[o] + m[6] * p[o + 1] + m[10] * p[o + 2] + m[14],
];
/** inverse-transpose of the upper 3×3 (for normals), as a column-major 3×3 */
export function normalMatrix(m: M4): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // cofactor matrix / det == inverse transpose
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}
export const dir3 = (n: number[], v: ArrayLike<number>, o = 0): V3 => {
  const x = n[0] * v[o] + n[3] * v[o + 1] + n[6] * v[o + 2];
  const y = n[1] * v[o] + n[4] * v[o + 1] + n[7] * v[o + 2];
  const z = n[2] * v[o] + n[5] * v[o + 1] + n[8] * v[o + 2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

export interface MeshInstance {
  node: number;
  mesh: number;
  /** node world matrix */
  world: M4;
}

/** every mesh node in the default scene, with its world matrix */
export function meshInstances(g: Gltf): MeshInstance[] {
  const out: MeshInstance[] = [];
  const scene = g.json.scenes?.[g.json.scene ?? 0] ?? { nodes: (g.json.nodes ?? []).map((_: unknown, i: number) => i) };
  const walk = (ni: number, parent: M4) => {
    const n = g.json.nodes[ni];
    const local = n.matrix ? [...n.matrix] : trs(n.translation, n.rotation, n.scale);
    const world = mul4(parent, local);
    if (n.mesh !== undefined) out.push({ node: ni, mesh: n.mesh, world });
    for (const c of n.children ?? []) walk(c, world);
  };
  for (const r of scene.nodes ?? []) walk(r, I4());
  return out;
}
