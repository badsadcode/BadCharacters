/**
 * Self-contained glTF 2.0 / GLB writer for a Character: one skinned mesh (a primitive per
 * material), a humanoid skeleton, attachment sockets, morph targets, an embedded pixel-art face
 * texture and baked animation clips. No three.js in between: what the model says is what lands
 * in the file.
 */
import { fullPose } from '../core/anim';
import type { Character } from '../core/character';
import { encodePng, hexRgb } from '../core/face';
import { sub } from '../core/math';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
export const FPS = 30;
/** keyframe reduction tolerances: 0.15° for rotations, 0.5 mm for translations */
const ROT_TOL = (0.15 * Math.PI) / 180;
const POS_TOL = 0.0005;

/**
 * Greedy keyframe reduction: drop every key that linear interpolation between its kept
 * neighbours reproduces within tolerance. First and last keys always stay (loops stay seamless).
 */
export function reduceKeys(times: number[], v: number[], stride: number, tol: number, quat: boolean): number[] {
  const n = times.length;
  if (n <= 2) return [...Array(n).keys()];
  const err = (a: number, b: number, i: number) => {
    const t = (times[i] - times[a]) / (times[b] - times[a]);
    if (quat) {
      // angle between the interpolated (nlerp) and the true rotation
      const q = [0, 1, 2, 3].map((k) => v[a * 4 + k] + (v[b * 4 + k] - v[a * 4 + k]) * t);
      const l = Math.hypot(...q) || 1;
      let d = 0;
      for (let k = 0; k < 4; k++) d += (q[k] / l) * v[i * 4 + k];
      return 2 * Math.acos(Math.min(1, Math.abs(d)));
    }
    let e = 0;
    for (let k = 0; k < stride; k++) e = Math.max(e, Math.abs(v[a * stride + k] + (v[b * stride + k] - v[a * stride + k]) * t - v[i * stride + k]));
    return e;
  };
  const keep = [0];
  let a = 0;
  while (a < n - 1) {
    let b = a + 1;
    while (b + 1 < n) {
      let ok = true;
      for (let i = a + 1; i <= b; i++) if (err(a, b + 1, i) > tol) { ok = false; break; }
      if (!ok) break;
      b++;
    }
    keep.push(b);
    a = b;
  }
  return keep;
}

interface Acc {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  normalized?: boolean;
}

class Buf {
  chunks: Uint8Array[] = [];
  length = 0;
  views: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  accessors: Acc[] = [];

  view(bytes: Uint8Array, target?: number) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    return this.views.length - 1;
  }
  f32(data: ArrayLike<number>, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', target?: number, minmax = false) {
    const arr = Float32Array.from(data);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc: Acc = { bufferView: this.view(new Uint8Array(arr.buffer), target), componentType: FLOAT, count: arr.length / n, type };
    if (minmax) {
      const mn = new Array(n).fill(Infinity);
      const mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        mn[i % n] = Math.min(mn[i % n], arr[i]);
        mx[i % n] = Math.max(mx[i % n], arr[i]);
      }
      acc.min = mn;
      acc.max = mx;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  u8vec4(data: ArrayLike<number>, target?: number) {
    const arr = Uint8Array.from(data);
    this.accessors.push({ bufferView: this.view(arr, target), componentType: 5121, count: arr.length / 4, type: 'VEC4' });
    return this.accessors.length - 1;
  }
  indices(data: ArrayLike<number>, vertexCount: number) {
    const big = vertexCount > 65535;
    const arr = big ? Uint32Array.from(data) : Uint16Array.from(data);
    this.accessors.push({ bufferView: this.view(new Uint8Array(arr.buffer), ELEMENT_ARRAY_BUFFER), componentType: big ? 5125 : 5123, count: arr.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }
  concat() {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}

/** sRGB hex → linear RGB for baseColorFactor */
function linear(hex: string): [number, number, number] {
  return hexRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface GltfOptions {
  animations?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildGltf(ch: Character, opts: GltfOptions = {}): { json: any; bin: Uint8Array } {
  const sk = ch.skeleton;
  const bb = new Buf();
  const json: any = {
    asset: { version: '2.0', generator: 'BadCharacters glTF writer (Bad Ideas Works)' },
    scene: 0,
    scenes: [{ name: ch.recipe.name, nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    skins: [],
  };

  // ── bones (node index == bone index)
  sk.bones.forEach((b) => {
    const parent = b.parent >= 0 ? sk.bones[b.parent].world : [0, 0, 0];
    const t = sub(b.world, parent as [number, number, number]).map(r6);
    const node: any = { name: b.name };
    if (t.some((x) => x !== 0)) node.translation = t;
    json.nodes.push(node);
    if (b.parent >= 0) (json.nodes[b.parent].children ??= []).push(json.nodes.length - 1);
  });
  json.scenes[0].nodes.push(0);

  // ── sockets (plain child nodes, not skin joints)
  for (const s of ch.skeleton.sockets) {
    const bi = sk.index[s.bone];
    const idx = json.nodes.length;
    json.nodes.push({ name: s.name, translation: sub(s.world, sk.bones[bi].world).map(r6), extras: { badcharacters: { socket: true } } });
    (json.nodes[bi].children ??= []).push(idx);
  }

  // ── materials
  const matIndex = new Map<string, number>();
  let textureUsed = false;
  for (const p of ch.primitives) {
    if (matIndex.has(p.material)) continue;
    const m = ch.materials[p.material] ?? { name: p.material, color: '#ff00ff', metallic: 0, roughness: 1 };
    const gm: any = {
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [...linear(m.color), m.alpha ?? 1], metallicFactor: m.metallic, roughnessFactor: m.roughness },
    };
    if (m.textured) {
      gm.pbrMetallicRoughness.baseColorTexture = { index: 0 };
      textureUsed = true;
    }
    if (m.alpha !== undefined) {
      gm.alphaMode = 'BLEND';
      gm.doubleSided = true;
    }
    if (m.emissive) gm.emissiveFactor = linear(m.emissive);
    matIndex.set(p.material, json.materials.length);
    json.materials.push(gm);
  }
  if (textureUsed) {
    const png = encodePng(ch.texture);
    json.images = [{ name: 'Face', mimeType: 'image/png', bufferView: bb.view(png) }];
    // NEAREST: crisp pixel-art face. Repeat horizontally (it wraps around the head).
    json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 33071 }];
    json.textures = [{ sampler: 0, source: 0 }];
  }

  // ── skinned mesh
  const prims = ch.primitives.map((p, pi) => {
    const m = p.mesh;
    const n = m.positions.length / 3;
    const prim: any = {
      attributes: {
        POSITION: bb.f32(m.positions, 'VEC3', ARRAY_BUFFER, true),
        NORMAL: bb.f32(m.normals, 'VEC3', ARRAY_BUFFER),
        TEXCOORD_0: bb.f32(m.uvs, 'VEC2', ARRAY_BUFFER),
        JOINTS_0: bb.u8vec4(m.joints, ARRAY_BUFFER),
        WEIGHTS_0: bb.f32(m.weights, 'VEC4', ARRAY_BUFFER),
      },
      indices: bb.indices(m.indices, n),
      material: matIndex.get(p.material),
      mode: 4,
    };
    if (ch.morphs.length) {
      prim.targets = ch.morphs.map((mt) => ({
        POSITION: bb.f32(mt.deltas[pi].positions, 'VEC3', ARRAY_BUFFER, true),
        NORMAL: bb.f32(mt.deltas[pi].normals, 'VEC3', ARRAY_BUFFER),
      }));
    }
    return prim;
  });
  const mesh: any = { name: `${ch.recipe.name}_mesh`, primitives: prims };
  if (ch.morphs.length) {
    mesh.weights = ch.morphs.map(() => 0);
    mesh.extras = { targetNames: ch.morphs.map((m) => m.name) };
  }
  json.meshes.push(mesh);

  const ibm: number[] = [];
  for (const b of sk.bones) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(-b.world[0]), r6(-b.world[1]), r6(-b.world[2]), 1);
  json.skins.push({ name: 'Humanoid', skeleton: 0, joints: sk.bones.map((_, i) => i), inverseBindMatrices: bb.f32(ibm, 'MAT4') });
  const meshNode = json.nodes.length;
  // skinned mesh nodes live at the scene root: their own transform is ignored per spec
  json.nodes.push({ name: ch.recipe.name.replace(/\s+/g, '_'), mesh: 0, skin: 0 });
  json.scenes[0].nodes.push(meshNode);

  // ── animations
  if (opts.animations ?? true) {
    json.animations = [];
    const hipsRest = sk.bones[sk.index.Hips].world;
    for (const clip of ch.clips) {
      const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
      const times: number[] = [];
      const poses = [];
      for (let f = 0; f < frames; f++) {
        const t = (f / (frames - 1)) * clip.duration;
        times.push(t);
        poses.push(clip.sample(t));
      }
      const samplers: any[] = [];
      const channels: any[] = [];
      const inputs = new Map<string, number>();
      /** write one channel with redundant keys removed (shared time accessors where possible) */
      const channel = (node: number, path: 'rotation' | 'translation', values: number[], stride: number) => {
        const keep = reduceKeys(times, values, stride, path === 'rotation' ? ROT_TOL : POS_TOL, path === 'rotation');
        const key = keep.join(',');
        if (!inputs.has(key)) inputs.set(key, bb.f32(keep.map((i) => times[i]), 'SCALAR', undefined, true));
        const out: number[] = [];
        for (const i of keep) for (let k = 0; k < stride; k++) out.push(values[i * stride + k]);
        samplers.push({ input: inputs.get(key)!, output: bb.f32(out, stride === 4 ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node, path } });
      };
      const full = poses.map((p) => fullPose(sk, p));
      for (const b of sk.bones) {
        if (b.name === 'Root') continue;
        const out: number[] = [];
        for (const fp of full) out.push(...fp[b.name]);
        channel(sk.index[b.name], 'rotation', out, 4);
      }
      const tr: number[] = [];
      for (const p of poses) tr.push(hipsRest[0] + p.hips[0], hipsRest[1] + p.hips[1], hipsRest[2] + p.hips[2]);
      channel(sk.index.Hips, 'translation', tr, 3);
      // extra prop bones (BowString) get a translation track in EVERY clip, so switching clips
      // in an engine always puts them back where they belong
      for (const b of sk.bones) {
        if (b.name !== 'BowString') continue;
        const rest = sub(b.world, sk.bones[b.parent].world);
        const out: number[] = [];
        for (const p of poses) out.push(...(p.trans?.[b.name] ?? rest));
        channel(sk.index[b.name], 'translation', out, 3);
      }
      json.animations.push({ name: clip.name, samplers, channels, extras: { loop: clip.loop } });
    }
  }

  json.scenes[0].extras = {
    badcharacters: {
      schema: 'badcharacters/1',
      units: 'metres',
      up: '+Y',
      forward: '+Z',
      restPose: ch.recipe.rig.restPose === 'A' ? 'A-pose' : 'T-pose',
      humanoid: Object.fromEntries(sk.bones.filter((b) => b.name !== 'Root' && b.name !== 'BowString').map((b) => [b.name, b.name])),
      propBones: sk.bones.filter((b) => b.name === 'BowString').map((b) => b.name),
      sockets: ch.skeleton.sockets.map((s) => s.name),
      morphTargets: ch.morphs.map((m) => m.name),
      clips: ch.clips.map((c) => ({ name: c.name, duration: c.duration, loop: c.loop })),
      recipe: ch.recipe,
    },
  };

  const bin = bb.concat();
  json.buffers = [{ byteLength: bin.byteLength }];
  json.bufferViews = bb.views;
  json.accessors = bb.accessors;
  return { json, bin };
}

export function toGlb(json: any, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const p = new Uint8Array(jsonBytes.length + jpad);
    p.set(jsonBytes);
    p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(bin, o + 8);
  return out;
}

export function exportGlb(ch: Character, opts: GltfOptions = {}): Uint8Array {
  const { json, bin } = buildGltf(ch, opts);
  return toGlb(json, bin);
}
