/**
 * Recipe → Character: skeleton + skinned mesh primitives (one per material) + face texture +
 * animation clips + optional fat/muscle morph targets. Pure and deterministic.
 */
import { buildClips, Clip } from './anim';
import { buildBody } from './body';
import { buildClothing } from './clothing';
import { paintFace, Texture } from './face';
import { paintPattern } from './patterns';
import { subSeed } from './rng';
import { appendMesh, computeNormals, emptyMesh, loftPart, MeshData, Part, simplifyRings, unweld } from './loft';
import { cullHidden } from './shell';
import { addPropBones } from './props';
import { CharacterRecipe, GARMENTS, MaterialKind, SlotId, STYLES } from './recipe';
import { buildSkeleton, computeDims, Skeleton } from './skeleton';
import { weaponClips } from './hold';
import { buildWeapon, BuiltWeapon } from '../weapons/badgun';

export interface MaterialDef {
  name: string;
  color: string;
  metallic: number;
  roughness: number;
  /** uses the face texture */
  textured?: boolean;
  /** its own fabric pattern texture */
  texture?: Texture;
  /** pattern id, to pick the texture filter */
  pattern?: string;
  /** emissive map (bioluminescent spots) */
  emissiveTexture?: Texture;
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
  /** the BadGun weapon in the hands, if the recipe has one */
  weapon?: BuiltWeapon;
  stats: { triangles: number; vertices: number; bones: number; parts: number; /** triangles before hidden-layer culling and ring simplification */ unoptimized: number };
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
    skin: { name: 'Skin', color: rc.body.skin, metallic: 0, roughness: STYLES[rc.style]?.gloss ?? 0.75 },
    joint: { name: 'Joints', color: shade(rc.body.skin, 0.72), metallic: 0, roughness: STYLES[rc.style]?.gloss ?? 0.6 },
    face: { name: 'Face', color: '#ffffff', metallic: 0, roughness: 0.75, textured: true },
    visor: { name: 'Visor', color: '#0b0b0d', metallic: 0.2, roughness: 0.6 },
    tusk: { name: 'Tusk', color: '#ece2c6', metallic: 0, roughness: 0.5 },
    tyre: { name: 'Tyre', color: '#1c1c1c', metallic: 0, roughness: 0.85 },
    divglass: { name: 'DiveGlass', color: '#0c1a22', metallic: 0.2, roughness: 0.08, emissive: '#06222c' },
    lamp: { name: 'Lamp', color: '#222222', metallic: 0, roughness: 0.3, emissive: '#fff2c0' },
    rock: { name: 'Rock', color: shade(rc.body.skin, 0.78), metallic: 0, roughness: 0.9 },
    moss: { name: 'Moss', color: '#5f7d3a', metallic: 0, roughness: 0.95 },
    petal: { name: 'Petals', color: '#f4f1e6', metallic: 0, roughness: 0.8 },
    flowercore: { name: 'FlowerCentre', color: '#f2c230', metallic: 0, roughness: 0.7 },
    leaf: { name: 'Leaves', color: '#6fa040', metallic: 0, roughness: 0.85 },
    heart: { name: 'Heartstone', color: '#3a2a10', metallic: 0, roughness: 0.4, emissive: '#ffcf5a' },
    growth: { name: 'Growth', color: mutantGrowth(rc.body.skin), metallic: 0, roughness: 0.6 },
    horn: { name: 'Horn', color: '#d8cfb4', metallic: 0, roughness: 0.55 },
    visorglow: { name: 'VisorGlow', color: '#0a1a22', metallic: 0.3, roughness: 0.2, emissive: rc.outfit.head?.color2 ?? '#00d0ff' },
    armorglow: { name: 'ArmorGlow', color: '#0a1a22', metallic: 0.3, roughness: 0.3, emissive: rc.outfit.armor?.color2 ?? '#00d0ff' },
    glass: { name: 'Glass', color: '#bfe6ff', ...KIND.glass, alpha: 0.28 },
  };
  for (const slot of Object.keys(rc.outfit) as SlotId[]) {
    const g = rc.outfit[slot];
    const kind = GARMENTS[slot][g.id]?.kind ?? 'cloth';
    m[slot] = { name: `${cap(slot)}_${g.id}`, color: g.color, ...KIND[kind] };
    if (g.pattern && g.pattern !== 'solid') {
      m[slot] = { ...m[slot], name: `${m[slot].name}_${g.pattern}`, color: '#ffffff', texture: paintPattern(g.pattern, g.color, g.color2, subSeed(rc.seed, `pattern.${slot}`)), pattern: g.pattern };
    }
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
/** a darker (k < 1) or lighter (k > 1) version of a colour */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')).join('');
}
/** growths: the skin tone, angrier */
function mutantGrowth(skin: string) {
  const n = parseInt(skin.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * [0.78, 0.86, 0.66][i]));
  return '#' + c.map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
}

/** every part, before culling and simplification */
export function buildRawParts(rc: CharacterRecipe, sk: Skeleton): Part[] {
  const body = buildBody(rc, sk);
  const cloth = buildClothing(rc, sk, body);
  return [...Object.values(body), ...cloth];
}

/** geometric tolerance for ring simplification, per detail level (metres per body unit) */
const SIMPLIFY = { low: 0.006, medium: 0.0022, high: 0.0008 } as const;

/**
 * The parts that actually get meshed: hidden stretches culled, redundant rings dropped.
 * `masks` (kept ring indices per part) can be passed in so morph variants share topology.
 */
/** visible joints (mannequin balls, toy pegs) only show where no garment covers that spot of the limb */
const JOINT_SPOTS: Record<string, [string, string]> = {
  neck: ['neck', 'low'],
  shoulder: ['arm', 'shoulder'],
  elbow: ['arm', 'elbow'],
  wrist: ['arm', 'wrist'],
  hip: ['leg', 'top'],
  knee: ['leg', 'knee'],
  ankle: ['leg', 'ankle'],
};
function hideCoveredJoints(parts: Part[]): Part[] {
  const byId = new Map(parts.filter((p) => p.id).map((p) => [p.id!, p]));
  return parts.filter((p) => {
    if (!p.name.startsWith('joint.')) return true;
    const [, spot, side] = p.name.split('.');
    const [limb, tag] = JOINT_SPOTS[spot] ?? [];
    if (!limb) return true;
    const src = limb === 'neck' ? 'neck' : `${limb}.${side === 'Left' ? 'L' : 'R'}`;
    const body = byId.get(src);
    if (!body) return true;
    const k = body.rings.findIndex((r) => r.tag === tag);
    return !parts.some((q) => q.spec && !q.spec.body && q.spec.src === src && q.spec.k0 <= k + 0.3 && q.spec.k1 >= k - 0.3);
  });
}

export function buildParts(rc: CharacterRecipe, sk: Skeleton, masks?: number[][]): { parts: Part[]; masks: number[][] } {
  const parts = cullHidden(hideCoveredJoints(buildRawParts(rc, sk)));
  const tol = SIMPLIFY[rc.mesh.detail] * sk.dims.u * (STYLES[rc.style]?.simplify ?? 1);
  const outMasks: number[][] = [];
  const out = parts.map((p, i) => {
    let keep = masks?.[i];
    if (!keep || keep[keep.length - 1] !== p.rings.length - 1) keep = p.lod === 'box' ? p.rings.map((_, k) => k) : simplifyRings(p.rings, tol);
    outMasks.push(keep);
    return keep.length === p.rings.length ? p : { ...p, rings: keep.map((k) => p.rings[k]), vertexWeights: p.vertexWeights && ((ri: number, xn: number, yn: number, r: Part['rings'][number]) => p.vertexWeights!(keep![ri], xn, yn, r)) };
  });
  return { parts: out, masks: outMasks };
}

/** sides around each ring for a part, from the detail level and the part's size class */
export function sidesFor(p: Part, K: number): number {
  if (p.sides) return p.sides;
  if (p.lod === 'box' || p.section === 'box') return 4;
  if (p.bevel) return 8;
  if (p.lod === 'small') return K >= 20 ? 12 : K >= 12 ? 8 : 6;
  // near-boxy cross-sections: extra sides would only sit on flat faces
  const n = p.rings.reduce((s, r) => s + r.n, 0) / p.rings.length;
  if (n >= 7) return K >= 20 ? 12 : Math.min(K, 8);
  return K;
}

function meshesFor(parts: Part[], K: number, bevel = 0, section?: 'box'): Map<string, MeshData> {
  const by = new Map<string, MeshData>();
  for (const p0 of parts) {
    // Boxy style: every body part, garment and hat gets the bevelled-box profile (props stay round)
    const keepRound = p0.lod === 'box' || /^prop|^glass/.test(p0.material);
    const p = keepRound ? p0 : section ? { ...p0, section } : bevel ? { ...p0, bevel } : p0;
    if (!by.has(p.material)) by.set(p.material, emptyMesh());
    const m = emptyMesh();
    loftPart(p, sidesFor(p, K), m);
    // boxes get hard edges; everything else is smooth within the part
    if (p.lod === 'box' || p.section === 'box') appendMesh(by.get(p.material)!, unweld(m));
    else {
      computeNormals(m);
      appendMesh(by.get(p.material)!, m);
    }
  }
  return by;
}

export function generateCharacter(recipe: CharacterRecipe): Character {
  // a real weapon in the hands replaces the outfit's own hand prop (staff, rifle...)
  const rc: CharacterRecipe = recipe.weapon && recipe.outfit.prop ? { ...recipe, outfit: { ...recipe.outfit, prop: { ...recipe.outfit.prop, id: 'none' } } } : recipe;
  const sk = buildSkeleton(rc);
  addPropBones(rc, sk);
  const K = DETAIL[rc.mesh.detail] ?? 12;
  const { parts, masks } = buildParts(rc, sk);
  const bevel = STYLES[rc.style]?.bevel ?? 0;
  const section = STYLES[rc.style]?.section;
  const by = meshesFor(parts, K, bevel, section);
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
      const vby = meshesFor(buildParts(vr, vsk, masks).parts, K, bevel, section);
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
  const unoptimized = buildRawParts(rc, sk).reduce((s, p) => {
    const k = sidesFor(p, K);
    return s + (p.rings.length - 1) * k * 2 + ((p.capStart ? 1 : 0) + (p.capEnd ? 1 : 0)) * k;
  }, 0);
  const vertices = primitives.reduce((s, p) => s + p.mesh.positions.length / 3, 0);
  let clips = buildClips(sk, { rightHandProp: rc.outfit.prop?.id });
  const weapon = recipe.weapon ? buildWeapon(recipe.weapon) : undefined;
  if (weapon) {
    // the weapon's own aim / ready clips replace the generic ones (same names) or join them
    const wc = weaponClips(sk, clips, weapon.hold);
    const names = new Set(wc.map((c) => c.name));
    const rest = clips.filter((c) => !names.has(c.name) && c.name !== 'RestPose');
    clips = [...rest, ...wc, ...clips.filter((c) => c.name === 'RestPose')];
  }
  return {
    recipe,
    skeleton: sk,
    primitives,
    materials,
    texture,
    clips,
    weapon,
    morphs,
    stats: { triangles, vertices, bones: sk.bones.length, parts: parts.length, unoptimized },
  };
}
