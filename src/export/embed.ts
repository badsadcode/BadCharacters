/**
 * Merge one GLB into another glTF being written: every node, mesh, material, texture, image,
 * sampler, accessor and animation of the guest is appended with its indices remapped, and the
 * guest's scene is parented (through one container node with the given transform) to a node of
 * the host. Used to put a BadGun weapon in a character's hand: a rigid attachment, no skinning.
 */
import type { Buf } from './gltf';
import { parseGlb } from '../rigger/glb';
import type { Quat, V3 } from '../core/math';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function embedGlb(json: any, bb: Buf, guestBytes: Uint8Array, parentNode: number, frame: { t: V3; r: Quat }, opts: { name: string; animPrefix: string }): number {
  const g = parseGlb(guestBytes);
  const gj = g.json;
  const base = bb.raw(g.bin);
  const viewOff = bb.views.length;
  for (const v of gj.bufferViews ?? []) bb.views.push({ ...v, buffer: 0, byteOffset: base + (v.byteOffset ?? 0) });
  const accOff = bb.accessors.length;
  for (const a of gj.accessors ?? []) bb.accessors.push({ ...a, ...(a.bufferView !== undefined ? { bufferView: a.bufferView + viewOff } : {}) });

  const list = (k: string) => (json[k] ??= []);
  const sampOff = list('samplers').length;
  list('samplers').push(...(gj.samplers ?? []));
  const imgOff = list('images').length;
  list('images').push(...(gj.images ?? []).map((im: any) => ({ ...im, ...(im.bufferView !== undefined ? { bufferView: im.bufferView + viewOff } : {}) })));
  const texOff = list('textures').length;
  list('textures').push(...(gj.textures ?? []).map((t: any) => ({ ...t, ...(t.sampler !== undefined ? { sampler: t.sampler + sampOff } : {}), ...(t.source !== undefined ? { source: t.source + imgOff } : {}) })));
  // texture references live in any "...Texture" object (baseColorTexture, normalTexture, in extensions too)
  const remapTex = (o: any): any => {
    if (Array.isArray(o)) return o.map(remapTex);
    if (!o || typeof o !== 'object') return o;
    const out: any = {};
    for (const [k, v] of Object.entries(o)) out[k] = /Texture$/.test(k) && v && typeof v === 'object' && 'index' in (v as any) ? { ...remapTex(v), index: (v as any).index + texOff } : remapTex(v);
    return out;
  };
  const matOff = list('materials').length;
  list('materials').push(...(gj.materials ?? []).map(remapTex));
  const meshOff = list('meshes').length;
  list('meshes').push(
    ...(gj.meshes ?? []).map((m: any) => ({
      ...m,
      primitives: m.primitives.map((p: any) => ({
        ...p,
        attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, (v as number) + accOff])),
        ...(p.indices !== undefined ? { indices: p.indices + accOff } : {}),
        ...(p.material !== undefined ? { material: p.material + matOff } : {}),
        ...(p.targets ? { targets: p.targets.map((t: any) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v as number) + accOff]))) } : {}),
      })),
    })),
  );
  const nodeOff = list('nodes').length;
  list('nodes').push(
    ...(gj.nodes ?? []).map((n: any) => ({
      ...n,
      ...(n.mesh !== undefined ? { mesh: n.mesh + meshOff } : {}),
      ...(n.children ? { children: n.children.map((c: number) => c + nodeOff) } : {}),
    })),
  );
  const roots: number[] = gj.scenes?.[gj.scene ?? 0]?.nodes ?? [];
  const holder = json.nodes.length;
  json.nodes.push({ name: opts.name, translation: frame.t, rotation: frame.r, children: roots.map((r) => r + nodeOff), extras: { badcharacters: { attachment: true } } });
  (json.nodes[parentNode].children ??= []).push(holder);
  for (const a of gj.animations ?? []) {
    list('animations').push({
      ...a,
      name: `${opts.animPrefix}${a.name}`,
      samplers: a.samplers.map((sm: any) => ({ ...sm, input: sm.input + accOff, output: sm.output + accOff })),
      channels: a.channels.map((c: any) => ({ ...c, target: { ...c.target, node: c.target.node + nodeOff } })),
    });
  }
  for (const k of ['images', 'textures', 'samplers', 'animations']) if (json[k] && !json[k].length) delete json[k];
  const ext = new Set([...(json.extensionsUsed ?? []), ...(gj.extensionsUsed ?? [])]);
  if (ext.size) json.extensionsUsed = [...ext];
  const req = new Set([...(json.extensionsRequired ?? []), ...(gj.extensionsRequired ?? [])]);
  if (req.size) json.extensionsRequired = [...req];
  return holder;
}
