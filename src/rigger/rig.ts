/**
 * The auto-rigger: imported GLB + markers → the same GLB, skinned to our humanoid skeleton and
 * carrying all our procedural clips. The file's materials, textures, images and samplers are
 * carried over untouched; only geometry is rewritten (baked into world space, because a skinned
 * mesh's node transform is ignored by the glTF spec) and skin + animations are added.
 */
import { buildClips, type Clip } from '../core/anim';
import { Buf, toGlb, writeAnimations, writeBones } from '../export/gltf';
import { fitSkeleton, type Fitted } from './fit';
import type { Markers } from './markers';
import type { Model } from './model';
import { computeWeights } from './weights';
import { computeRetarget, retargetClip } from './retarget';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ARRAY_BUFFER = 34962;

export interface RigResult {
  fitted: Fitted;
  clips: Clip[];
  glb: Uint8Array;
  warnings: string[];
}

export function rigModel(model: Model, markers: Markers, name = 'Imported'): RigResult {
  const fitted = fitSkeleton(markers, model);
  const sk = fitted.skeleton;
  // clips are written for straight legs and arms along armDir: play them on the model's own pose
  const rt = computeRetarget(sk);
  const clips = buildClips(sk).map((c) => retargetClip(c, sk, rt));
  const { joints, weights } = computeWeights(model.positions, model.triangles, fitted);
  const warnings = [...model.warnings];

  const src = model.gltf;
  const json: any = JSON.parse(JSON.stringify(src.json));
  const bb = new Buf({ bin: src.bin, views: json.bufferViews ?? [], accessors: json.accessors ?? [] });

  json.nodes = [];
  writeBones(json, sk);
  const meshes: any[] = [];
  const meshNodes: number[] = [];
  model.instances.forEach((ins, ii) => {
    const srcMesh = src.json.meshes[ins.mesh];
    const prims: any[] = [];
    model.prims.forEach((mp, pi) => {
      if (mp.inst !== ii) return;
      const p = srcMesh.primitives[mp.prim];
      const off = model.offsets[pi];
      const n = mp.positions.length / 3;
      const attributes: any = { ...p.attributes };
      attributes.POSITION = bb.f32(mp.positions, 'VEC3', ARRAY_BUFFER, true);
      if (mp.normals) attributes.NORMAL = bb.f32(mp.normals, 'VEC3', ARRAY_BUFFER);
      if (mp.tangents) attributes.TANGENT = bb.f32(mp.tangents, 'VEC4', ARRAY_BUFFER);
      // any skinning the file already had is replaced by ours
      for (const k of Object.keys(attributes)) if (/^(JOINTS|WEIGHTS)_/.test(k)) delete attributes[k];
      attributes.JOINTS_0 = bb.u8vec4(joints.subarray(off * 4, (off + n) * 4), ARRAY_BUFFER);
      attributes.WEIGHTS_0 = bb.f32(weights.subarray(off * 4, (off + n) * 4), 'VEC4', ARRAY_BUFFER);
      const prim: any = { ...p, attributes, indices: bb.indices(mp.indices, n), mode: 4 };
      if (mp.targets.length) {
        prim.targets = mp.targets.map((t) => {
          const o: any = {};
          if (t.POSITION) o.POSITION = bb.f32(t.POSITION, 'VEC3', ARRAY_BUFFER, true);
          if (t.NORMAL) o.NORMAL = bb.f32(t.NORMAL, 'VEC3', ARRAY_BUFFER);
          return o;
        });
      } else delete prim.targets;
      prims.push(prim);
    });
    if (!prims.length) return;
    const mesh: any = { name: srcMesh.name ?? `mesh_${ins.mesh}`, primitives: prims };
    // shape keys keep their default weights and names
    if (srcMesh.weights) mesh.weights = srcMesh.weights;
    if (srcMesh.extras) mesh.extras = srcMesh.extras;
    meshes.push(mesh);
    meshNodes.push(json.nodes.length);
    json.nodes.push({ name: src.json.nodes[ins.node].name ?? `${name}_mesh_${ii}`, mesh: meshes.length - 1, skin: 0 });
  });
  json.meshes = meshes;

  const ibm: number[] = [];
  for (const b of sk.bones) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.world[0], -b.world[1], -b.world[2], 1);
  json.skins = [{ name: 'Humanoid', skeleton: 0, joints: sk.bones.map((_, i) => i), inverseBindMatrices: bb.f32(ibm, 'MAT4') }];
  delete json.animations;
  writeAnimations(json, bb, sk, clips);
  delete json.cameras;
  json.scene = 0;
  json.scenes = [
    {
      name,
      nodes: [0, ...meshNodes],
      extras: {
        badcharacters: {
          schema: 'badcharacters/1',
          source: 'auto-rigged import',
          units: 'metres',
          up: '+Y',
          forward: '+Z',
          humanoid: Object.fromEntries(sk.bones.filter((b) => b.name !== 'Root').map((b) => [b.name, b.name])),
          sockets: sk.sockets.map((s) => s.name),
          clips: clips.map((c) => ({ name: c.name, duration: c.duration, loop: c.loop, ...(c.travel ? { travel: c.travel } : {}) })),
          markers,
        },
      },
    },
  ];
  json.asset = { ...json.asset, generator: `BadCharacters auto-rigger (Bad Ideas Works), from ${src.json.asset?.generator ?? 'unknown'}` };
  const bin = bb.concat();
  json.buffers = [{ byteLength: bin.byteLength }];
  json.bufferViews = bb.views;
  json.accessors = bb.accessors;
  return { fitted, clips, glb: toGlb(json, bin), warnings: [...new Set(warnings)] };
}
