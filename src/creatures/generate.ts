/**
 * CreatureRecipe → Creature: skeleton, skinned mesh, skin + glow textures, baked clips and the
 * motion description (for the Solitude CreatureProfile snippet). The output has the same shape as
 * a humanoid Character, so the same GLB writer and viewer handle both.
 */
import type { Character, MaterialDef, Primitive } from '../core/character';
import { sidesFor } from '../core/character';
import { appendMesh, computeNormals, emptyMesh, loftPart, MeshData, unweld } from '../core/loft';
import { subSeed } from '../core/rng';
import type { Skeleton } from '../core/skeleton';
import { creatureClips } from './anim';
import type { CreatureBuild, Motion } from './core';
import { Species, SPECIES, SpeciesId } from './species';
import { paintCreatureSkin, paintGlowSpots } from './texture';

export interface CreatureRecipe {
  version: 1;
  kind: 'creature';
  name: string;
  species: SpeciesId;
  seed: number;
  /** metres, snout to tail (or bell to tentacle tip) */
  length: number;
  colors: { base: string; belly: string; accent: string; fin: string; eye: string; glow: string; mouth: string };
  mods: {
    /** multiplies the rest gape */
    gape: number;
    /** multiplies tooth size */
    teeth: number;
    /** multiplies fin size */
    fins: number;
    /** 0 … 1 bioluminescent spots */
    glow: number;
    /** 0 … 1 accent blotches */
    blotch: number;
    scars: boolean;
  };
  mesh: { detail: 'low' | 'medium' | 'high'; shading: 'smooth' | 'flat' };
}

export interface Creature extends Omit<Character, 'recipe'> {
  kind: 'creature';
  recipe: CreatureRecipe;
  build: CreatureBuild;
  motion: Motion;
}

const DETAIL = { low: 6, medium: 8, high: 12 } as const;

export function generateCreature(rc: CreatureRecipe): Creature {
  const sp: Species = SPECIES[rc.species];
  const build = sp.build(rc);
  const K = DETAIL[rc.mesh.detail] ?? 8;

  const by = new Map<string, MeshData>();
  for (const p of build.parts) {
    if (!by.has(p.material)) by.set(p.material, emptyMesh());
    const m = emptyMesh();
    loftPart(p, sidesFor(p, K), m);
    if (rc.mesh.shading === 'flat' || p.lod === 'box' || p.sides === 4) appendMesh(by.get(p.material)!, unweld(m));
    else {
      computeNormals(m);
      appendMesh(by.get(p.material)!, m);
    }
  }
  const primitives: Primitive[] = [...by.entries()].map(([material, mesh]) => ({ material, mesh }));

  const c = rc.colors;
  const skinTex = paintCreatureSkin({ base: c.base, belly: c.belly, accent: c.accent, blotch: rc.mods.blotch, scars: rc.mods.scars, grooves: sp.grooves, bands: sp.bands, seed: subSeed(rc.seed, 'skin') });
  const glowTex = rc.mods.glow > 0.01 ? paintGlowSpots(c.glow, rc.mods.glow, subSeed(rc.seed, 'glow')) : undefined;
  const materials: Record<string, MaterialDef> = {
    skin: { name: 'Skin', color: '#ffffff', metallic: 0, roughness: 0.62, texture: skinTex, pattern: 'creature', emissiveTexture: glowTex },
    fin: { name: 'Fins', color: '#ffffff', metallic: 0, roughness: 0.62, texture: paintCreatureSkin({ base: c.fin, belly: c.fin, accent: c.accent, blotch: rc.mods.blotch * 0.6, seed: subSeed(rc.seed, 'fin') }), pattern: 'creature' },
    frill: { name: 'Frill', color: c.accent, metallic: 0, roughness: 0.6 },
    mouth: { name: 'Mouth', color: c.mouth, metallic: 0, roughness: 0.55 },
    teeth: { name: 'Teeth', color: '#e8dfc4', metallic: 0, roughness: 0.4 },
    eye: { name: 'Eyes', color: '#111111', metallic: 0, roughness: 0.3, emissive: c.eye },
    glow: { name: 'Glow', color: '#111111', metallic: 0, roughness: 0.3, emissive: c.glow },
    suckers: { name: 'Suckers', color: '#d8c8c0', metallic: 0, roughness: 0.6 },
    bell: { name: 'Bell', color: c.base, metallic: 0, roughness: 0.2, alpha: 0.55, emissive: c.base },
    eyeball: { name: 'Eyeball', color: '#e9e2cf', metallic: 0, roughness: 0.25 },
    iris: { name: 'Iris', color: '#111111', metallic: 0, roughness: 0.3, emissive: c.eye },
    pupil: { name: 'Pupil', color: '#050505', metallic: 0, roughness: 0.2 },
    egg: { name: 'Eggs', color: '#5a3010', metallic: 0, roughness: 0.4, emissive: c.glow },
  };

  const skeleton: Skeleton = { bones: build.bones, index: build.index, sockets: [], dims: {} as Skeleton['dims'], moveBone: build.moveBone };
  const clips = creatureClips(build);
  const triangles = primitives.reduce((s, p) => s + p.mesh.indices.length / 3, 0);
  const vertices = primitives.reduce((s, p) => s + p.mesh.positions.length / 3, 0);
  return {
    kind: 'creature',
    recipe: rc,
    build,
    motion: build.motion,
    skeleton,
    primitives,
    materials,
    texture: skinTex,
    clips,
    morphs: [],
    stats: { triangles, vertices, bones: build.bones.length, parts: build.parts.length, unoptimized: triangles },
  };
}
