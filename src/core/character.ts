/**
 * Recipe → Character: skeleton + skinned mesh primitives (one per material) + face texture +
 * animation clips + optional fat/muscle morph targets. Pure and deterministic.
 */
import { buildClips, Clip } from './anim';
import { buildBody } from './body';
import { buildClothing } from './clothing';
import { paintFace, Texture } from './face';
import { computeNormals, emptyMesh, loftPart, MeshData, Part, unweld } from './loft';
import { CharacterRecipe, GARMENTS, MaterialKind, SlotId } from './recipe';
import { buildSkeleton, computeDims, Skeleton } from './skeleton';

export interface MaterialDef {
  name: string;
  color: string;
  metallic: number;
  roughness: number;
  /** uses the face texture */
  textured?: boolean;
  alpha?: number;
  emissive?: string;
}

export interface MorphTarget {
  name: string;
  /** per primitive: position deltas, normal deltas */
  deltas: { positions: number[]; normals: number[] }[];
}

export interface Primitive {
  material: string;
  mesh: MeshData;
}

export interface Character {
  recipe: CharacterRecipe;
  skeleton: Skeleton;
  primitives: Primitive[];
  materials: Record<string, MaterialDef>;
  texture: Texture;
  clips: Clip[];
  morphs: MorphTarget[];
  stats: { triangles: number; vertices: number; bones: number; parts: number };
}

const KIND: Record<MaterialKind | 'glass', { metallic: number; roughness: number }> = {
  cloth: { metallic: 0, roughness: 0.92 },
  leather: { metallic: 0, roughness: 0.62 },
  metal: { metallic: 0.85, roughness: 0.38 },
  plastic: { metallic: 0, roughness: 0.45 },
  rubber: { metallic: 0, roughness: 0.7 },
  glass: { metallic: 0, roughness: 0.08 },
};

export const DETAIL = { low: 8, medium: 12, high: 20 } as const;

function materialsFor(rc: CharacterRecipe): Record<string, MaterialDef> {
  const m: Record<string, MaterialDef> = {
    skin: { name: 'Skin', color: rc.body.skin, metallic: 0, roughness: 0.75 },
    face: { name: 'Face', color: '#ffffff', metallic: 0, roughness: 0.75, textured: true },
    visor: { name: 'Visor', color: '#0b0b0d', metallic: 0.2, roughness: 0.6 },
    glass: { name: 'Glass', color: '#bfe6ff', ...KIND.glass, alpha: 0.28 },
  };
  for (const slot of Object.keys(rc.outfit) as SlotId[]) {
    const g = rc.outfit[slot];
    const kind = GARMENTS[slot][g.id]?.kind ?? 'cloth';
    m[slot] = { name: `${cap(slot)}_${g.id}`, color: g.color, ...KIND[kind] };
    const accentKind: MaterialKind = kind === 'metal' ? 'metal' : slot === 'feet' ? 'rubber' : kind;
    m[`${slot}.2`] = { name: `${cap(slot)}_${g.id}_accent`, color: g.color2, ...KIND[accentKind] };
    if (slot === 'armor' && g.id === 'hivis') m[`${slot}.2`].roughness = 0.25;
    if (rc.theme === 'scifi' && slot === 'top') m[`${slot}.2`].emissive = g.color2;
  }
  m.hair = { name: 'Hair', color: rc.outfit.hair.color, metallic: 0, roughness: 0.9 };
  m.beard = { name: 'Beard', color: rc.outfit.beard.color, metallic: 0, roughness: 0.9 };
  m.prop = { name: `Prop_${rc.outfit.prop.id}`, color: rc.outfit.prop.color, metallic: 0, roughness: 0.7 };
  m['prop.2'] = { name: `Prop_${rc.outfit.prop.id}_wrap`, color: rc.outfit.prop.color2, metallic: 0, roughness: 0.8 };
  return m;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function buildParts(rc: CharacterRecipe, sk: Skeleton): Part[] {
  const body = buildBody(rc, sk);
  const cloth = buildClothing(rc, sk, body);
  return [...Object.values(body), ...cloth];
}

function meshesFor(parts: Part[], K: number): Map<string, MeshData> {
  const by = new Map<string, MeshData>();
  for (const p of parts) {
    if (!by.has(p.material)) by.set(p.material, emptyMesh());
    loftPart(p, K, by.get(p.material)!);
  }
  for (const m of by.values()) computeNormals(m);
  return by;
}

export function generateCharacter(rc: CharacterRecipe): Character {
  const sk = buildSkeleton(rc);
  const K = DETAIL[rc.mesh.detail] ?? 12;
  const parts = buildParts(rc, sk);
  const by = meshesFor(parts, K);
  const order = [...by.keys()];

  // morph targets: rebuild with fat/muscle pushed to the extremes, on the SAME skeleton
  let morphs: MorphTarget[] = [];
  if (rc.mesh.morphs) {
    const variants: [string, Partial<CharacterRecipe['body']>][] = [
      ['Fat+', { fat: 1 }],
      ['Fat-', { fat: 0 }],
      ['Muscle+', { muscle: 1 }],
      ['Muscle-', { muscle: 0 }],
    ];
    for (const [name, patch] of variants) {
      const vr: CharacterRecipe = { ...rc, body: { ...rc.body, ...patch } };
      const vsk: Skeleton = { ...sk, dims: { ...computeDims(vr), armDir: sk.dims.armDir } };
      const vby = meshesFor(buildParts(vr, vsk), K);
      const deltas = order.map((mat) => {
        const a = by.get(mat)!;
        const b = vby.get(mat);
        if (!b || b.positions.length !== a.positions.length) return null;
        return { positions: b.positions.map((x, i) => x - a.positions[i]), normals: b.normals.map((x, i) => x - a.normals[i]) };
      });
      if (deltas.every(Boolean)) morphs.push({ name, deltas: deltas as MorphTarget['deltas'] });
    }
    // drop targets that do nothing (e.g. Fat+ on an already maximally fat character)
    morphs = morphs.filter((m) => m.deltas.some((d) => d.positions.some((x) => Math.abs(x) > 1e-5)));
  }

  let primitives: Primitive[] = order.map((material) => ({ material, mesh: by.get(material)! }));
  if (rc.mesh.shading === 'flat') {
    // faceted look: unweld; morph deltas are unwelded the same way
    primitives = primitives.map((p, pi) => {
      const flat = unweld(p.mesh);
      for (const mt of morphs) {
        const src = mt.deltas[pi];
        const pos: number[] = [];
        const nrm: number[] = [];
        for (const i of p.mesh.indices) {
          pos.push(src.positions[i * 3], src.positions[i * 3 + 1], src.positions[i * 3 + 2]);
          nrm.push(0, 0, 0);
        }
        mt.deltas[pi] = { positions: pos, normals: nrm };
      }
      return { material: p.material, mesh: flat };
    });
  }

  const materials = materialsFor(rc);
  const body = buildBody(rc, sk);
  const texture = paintFace(rc.face, rc.body.skin, sk.dims, body.head, rc.outfit.beard);
  const triangles = primitives.reduce((s, p) => s + p.mesh.indices.length / 3, 0);
  const vertices = primitives.reduce((s, p) => s + p.mesh.positions.length / 3, 0);
  return {
    recipe: rc,
    skeleton: sk,
    primitives,
    materials,
    texture,
    clips: buildClips(sk),
    morphs,
    stats: { triangles, vertices, bones: sk.bones.length, parts: parts.length },
  };
}
