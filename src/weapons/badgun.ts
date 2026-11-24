/**
 * BadGun (https://github.com/badsadcode/BadGun, vendored as a git submodule) as the studio's
 * weapon source: archetype + style + seed → a procedural, painted weapon GLB whose SOCKET_* nodes
 * tell our characters where their hands, shoulder and eye go.
 */
import { buildManifest, generate, STYLES, toGLB } from '../../vendor/BadGun/src/index';
import { holdFromSockets, WeaponHold } from '../core/hold';
import type { V3 } from '../core/math';

export const WEAPON_ARCHETYPES = ['rifle', 'smg', 'shotgun', 'sniper', 'lmg', 'pistol', 'crossbow'] as const;
export type WeaponArchetype = (typeof WEAPON_ARCHETYPES)[number];
export const WEAPON_STYLES = Object.keys(STYLES);

export interface WeaponRecipe {
  archetype: WeaponArchetype;
  style: string;
  seed: number;
  /** embed the weapon in the exported character GLB (parented to the hand) */
  embed?: boolean;
}

export interface BuiltWeapon {
  recipe: WeaponRecipe;
  glb: Uint8Array;
  hold: WeaponHold;
  name: string;
  /** link back to the BadGun playground for this exact weapon */
  url: string;
}

const cache = new Map<string, BuiltWeapon>();

export function buildWeapon(r: WeaponRecipe): BuiltWeapon {
  const key = `${r.archetype}/${r.style}/${r.seed}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, recipe: r };
  const w = generate({ archetype: r.archetype, style: r.style as Parameters<typeof generate>[0]['style'], seed: r.seed });
  const m = buildManifest(w);
  const built: BuiltWeapon = {
    recipe: r,
    glb: toGLB(w),
    hold: holdFromSockets(m.sockets.map((s) => ({ name: s.name, position: s.position as V3 })), r.archetype),
    name: m.name,
    url: `https://badsadcode.github.io/BadGun/#${encodeURIComponent(JSON.stringify({ archetype: r.archetype, style: r.style, seed: r.seed }))}`,
  };
  if (cache.size > 24) cache.clear();
  cache.set(key, built);
  return built;
}
