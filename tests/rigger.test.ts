import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { buildGltf, toGlb } from '../src/export/gltf';
import { loadModel } from '../src/rigger/model';
import { autoMarkers, MARKER_IDS, moveMirrored } from '../src/rigger/markers';
import { rigModel } from '../src/rigger/rig';
import { parseGlb, readAccessor } from '../src/rigger/glb';
import type { RaceId } from '../src/core/races';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require('gltf-validator');

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One of our own characters with its skeleton stripped off: a plain static GLB, like something
 * from Blender. Returns it plus the generator's own dominant bone per vertex as ground truth.
 */
function unrigged(style: StyleId, theme: string, race: RaceId, pose: 'A' | 'T', wrap?: { scale: number; yaw: number }) {
  const rc = randomRecipe(11, style, theme, race);
  rc.rig.restPose = pose;
  const ch = generateCharacter(rc);
  const { json, bin } = buildGltf(ch, { animations: false });
  const g = { json, bin };
  const truth: number[] = [];
  for (const p of json.meshes[0].primitives) {
    const J = readAccessor(g, p.attributes.JOINTS_0).data;
    const W = readAccessor(g, p.attributes.WEIGHTS_0).data;
    for (let i = 0; i < J.length; i += 4) {
      let b = 0;
      for (let k = 1; k < 4; k++) if (W[i + k] > W[i + b]) b = k;
      let bone = J[i + b];
      if (ch.skeleton.bones[bone].name.includes('Thumb')) bone = ch.skeleton.bones[bone].parent; // we skin thumbs to the hand
      truth.push(bone);
    }
    delete p.attributes.JOINTS_0;
    delete p.attributes.WEIGHTS_0;
  }
  delete json.skins;
  const meshNode = json.nodes.findIndex((n: any) => n.mesh !== undefined);
  delete json.nodes[meshNode].skin;
  if (wrap) {
    // put the mesh under a parent with odd units and a turn, the way exporters often do
    const parent = json.nodes.length;
    const a = (wrap.yaw * Math.PI) / 180;
    json.nodes.push({ name: 'Armature_ish', children: [meshNode], scale: [wrap.scale, wrap.scale, wrap.scale], rotation: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] });
    json.scenes[0].nodes = json.scenes[0].nodes.filter((n: number) => n !== meshNode).concat(parent);
  }
  return { ch, glb: toGlb(json, bin), truth };
}

function dominant(glb: Uint8Array): number[] {
  const g = parseGlb(glb);
  const out: number[] = [];
  for (const p of g.json.meshes[0].primitives) {
    const J = readAccessor(g, p.attributes.JOINTS_0).data;
    const W = readAccessor(g, p.attributes.WEIGHTS_0).data;
    for (let i = 0; i < J.length; i += 4) {
      let b = 0;
      for (let k = 1; k < 4; k++) if (W[i + k] > W[i + b]) b = k;
      out.push(J[i + b]);
    }
  }
  return out;
}

describe('auto-rigger', () => {
  const cases: [StyleId, string, RaceId, 'A' | 'T', number][] = [
    ['realistic', 'athlete', 'human', 'A', 0.95],
    ['realistic', 'athlete', 'human', 'T', 0.93],
    ['blocky', 'athlete', 'human', 'A', 0.93],
    ['chibi', 'athlete', 'human', 'A', 0.88],
    ['stylized', 'explorer', 'elf', 'T', 0.92],
    ['heroic', 'knight', 'orc', 'A', 0.92],
  ];
  for (const [style, theme, race, pose, min] of cases) {
    it(`${style} ${race} (${pose}-pose): skins like the generator would, validator-clean, all clips`, async () => {
      const { ch, glb, truth } = unrigged(style, theme, race, pose);
      const model = loadModel(glb);
      const r = rigModel(model, autoMarkers(model.positions, model.triangles));
      // dominant bone is the generator's, or its parent / child (where blends legitimately differ)
      const got = dominant(r.glb);
      const bones = ch.skeleton.bones;
      let ok = 0;
      for (let i = 0; i < truth.length; i++) if (got[i] === truth[i] || bones[got[i]].parent === truth[i] || bones[truth[i]].parent === got[i]) ok++;
      expect(ok / truth.length).toBeGreaterThan(min);
      const report = await validator.validateBytes(r.glb);
      expect(report.issues.numErrors).toBe(0);
      const g = parseGlb(r.glb);
      expect(g.json.animations.map((a: any) => a.name)).toEqual(ch.clips.map((c) => c.name));
      // weights: 4 per vertex, summing to 1, only real joints
      for (const p of g.json.meshes[0].primitives) {
        const W = readAccessor(g, p.attributes.WEIGHTS_0).data;
        const J = readAccessor(g, p.attributes.JOINTS_0).data;
        for (let i = 0; i < W.length; i += 4) expect(Math.abs(W[i] + W[i + 1] + W[i + 2] + W[i + 3] - 1)).toBeLessThan(1e-5);
        for (const j of J) expect(j).toBeLessThan(g.json.skins[0].joints.length);
      }
    });
  }

  it('keeps the original materials, textures and images byte for byte', () => {
    const { glb } = unrigged('stylized', 'explorer', 'human', 'A');
    const src = parseGlb(glb);
    const model = loadModel(glb);
    const out = parseGlb(rigModel(model, autoMarkers(model.positions, model.triangles)).glb);
    expect(out.json.materials).toEqual(src.json.materials);
    expect(out.json.textures).toEqual(src.json.textures);
    expect(out.json.images.length).toBe(src.json.images.length);
    src.json.images.forEach((im: any, i: number) => {
      const a = src.json.bufferViews[im.bufferView];
      const b = out.json.bufferViews[out.json.images[i].bufferView];
      expect(Buffer.from(out.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength)).equals(Buffer.from(src.bin.subarray(a.byteOffset, a.byteOffset + a.byteLength)))).toBe(true);
    });
  });

  it('carries morph targets (shape keys) through, transformed with the mesh', () => {
    const { glb } = unrigged('realistic', 'athlete', 'human', 'A', { scale: 100, yaw: 0 });
    const src = parseGlb(glb);
    const model = loadModel(glb, { height: 1.8 });
    const out = parseGlb(rigModel(model, autoMarkers(model.positions, model.triangles)).glb);
    const names = src.json.meshes[0].extras.targetNames;
    expect(out.json.meshes[0].extras.targetNames).toEqual(names);
    expect(out.json.meshes[0].primitives[0].targets.length).toBe(names.length);
    // deltas scale with the mesh: the file was in centimetres (×100), we brought it back to metres
    const a = readAccessor(src, src.json.meshes[0].primitives[0].targets[0].POSITION).data;
    const b = readAccessor(out, out.json.meshes[0].primitives[0].targets[0].POSITION).data;
    const k = model.height / model.sourceHeight;
    let maxA = 0;
    let err = 0;
    for (let i = 0; i < a.length; i++) {
      maxA = Math.max(maxA, Math.abs(a[i]));
      err = Math.max(err, Math.abs(b[i] - a[i] * 100 * k));
    }
    expect(maxA).toBeGreaterThan(0);
    expect(err).toBeLessThan(1e-4);
  });

  it('handles centimetre units and a model facing away (node transforms baked in)', () => {
    const { glb, truth, ch } = unrigged('realistic', 'athlete', 'human', 'A', { scale: 100, yaw: 180 });
    const model = loadModel(glb, { yaw: 180, height: 1.8 });
    expect(model.height).toBeCloseTo(1.8, 5);
    let minY = Infinity;
    for (let i = 1; i < model.positions.length; i += 3) minY = Math.min(minY, model.positions[i]);
    expect(minY).toBeCloseTo(0, 5);
    const mk = autoMarkers(model.positions, model.triangles);
    // facing +Z again: the character's left hand is on +X, the toes point forward
    expect(mk['wrist.L'][0]).toBeGreaterThan(0.2);
    expect(mk['toes.L'][2]).toBeGreaterThan(mk['ankle.L'][2]);
    const got = dominant(rigModel(model, mk).glb);
    const bones = ch.skeleton.bones;
    let ok = 0;
    for (let i = 0; i < truth.length; i++) if (got[i] === truth[i] || bones[got[i]].parent === truth[i] || bones[truth[i]].parent === got[i]) ok++;
    expect(ok / truth.length).toBeGreaterThan(0.95);
  });

  it('places the markers near the true joints', () => {
    const { ch, glb } = unrigged('realistic', 'athlete', 'human', 'A');
    const model = loadModel(glb);
    const mk = autoMarkers(model.positions, model.triangles);
    const W = (n: string) => ch.skeleton.bones[ch.skeleton.index[n]].world;
    const H = model.height;
    const pairs: [string, string][] = [
      ['shoulder.L', 'LeftUpperArm'], ['elbow.L', 'LeftLowerArm'], ['wrist.L', 'LeftHand'],
      ['knee.L', 'LeftLowerLeg'], ['ankle.L', 'LeftFoot'], ['knee.R', 'RightLowerLeg'], ['wrist.R', 'RightHand'],
    ];
    for (const [m, b] of pairs) {
      const p = mk[m as keyof typeof mk];
      const q = W(b);
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / H, `${m}`).toBeLessThan(0.06);
    }
    expect(Math.abs(mk.groin[1] - (W('Hips')[1] - 0.045 * H)) / H).toBeLessThan(0.05);
  });

  it('mirrors marker moves and keeps centre markers on the centre line', () => {
    const { glb } = unrigged('realistic', 'athlete', 'human', 'A');
    const model = loadModel(glb);
    const mk = autoMarkers(model.positions, model.triangles);
    const moved = moveMirrored(mk, 'elbow.L', [0.4, 1.1, 0.05]);
    expect(moved['elbow.R']).toEqual([-0.4, 1.1, 0.05]);
    const c = moveMirrored(mk, 'chin', [0.1, 1.6, 0.02]);
    expect(c.chin[0]).toBe(0);
    expect(MARKER_IDS.every((id) => moved[id].every(Number.isFinite))).toBe(true);
  });

  it('rejects things that are not a GLB', () => {
    expect(() => loadModel(new TextEncoder().encode('{"asset":{"version":"2.0"}}'))).toThrow(/GLB/);
  });
});
