/**
 * Factions: a recipe for a whole group, not a single look. A faction says which garments, colours,
 * camo and hair its members may have, which roles it fields (each with its own kit and BadGun
 * weapon), and the spread of bodies. Every member is different but clearly belongs; style, race
 * and every slider stay free to change.
 *
 * Uniforms are generic, period-plausible kit: no insignia, flags or unit markings.
 */
import { CharacterRecipe, Opt, randomOutfit, randomRecipe, SlotId, StyleId, Theme, THEMES } from './recipe';
import type { RaceId } from './races';
import { Rng, subSeed } from './rng';
import type { WeaponArchetype } from '../weapons/badgun';

export interface FactionRole {
  id: string;
  label: string;
  /** how often this role turns up in a squad */
  weight: number;
  /** slot pools that replace the faction's for this role */
  slots?: Partial<Record<SlotId, Opt>>;
  /** BadGun weapon types for this role (none = empty hands) */
  weapons?: WeaponArchetype[];
}

export interface Faction {
  label: string;
  blurb: string;
  /** look: a theme to start from, plus overrides */
  base: string;
  slots?: Partial<Record<SlotId, Opt>>;
  palette?: string[];
  accents?: string[];
  slotPalette?: Theme['slotPalette'];
  patterns?: Theme['patterns'];
  skins?: string[];
  /** hair (and beard) colours */
  hairColors?: string[];
  /** chance a member is a woman */
  women: number;
  height?: [number, number];
  /** BadGun styles their weapons are drawn from */
  weaponStyles: string[];
  roles: FactionRole[];
}

const OLIVE = ['#4e5a34', '#55603a', '#5d6640', '#4a5236'];
const HAIR_MIL: Opt = { none: 2, short: 5, messy: 1 };

export const FACTIONS: Record<string, Faction> = {
  vc: {
    label: 'Viet Cong guerrillas',
    blurb: 'Black cotton, conical hats, sandals, chest rigs. Lightly equipped, mixed men and women.',
    base: 'vietnam',
    slots: {
      hair: { short: 4, messy: 1, ponytail: 1, none: 1 },
      head: { conical: 4, none: 2, bandana: 1, boonie: 1 },
      mask: { none: 1 },
      top: { longsleeve: 4, tee: 1 },
      bottom: { pants: 4, shorts: 1 },
      legs: { none: 1 },
      feet: { sandals: 5, none: 1 },
      hands: { none: 1 },
      armor: { chestrig: 3, bandolier: 1, none: 2 },
      belt: { belt: 2, utility: 1, none: 1 },
      back: { none: 3, backpack: 1 },
      neck: { scarf: 2, none: 2 },
      prop: { none: 1 },
    },
    palette: ['#1d1d22', '#23242b', '#2a2930', '#2f3038', '#3a3328'],
    accents: ['#7a6a4a', '#5d5a3c', '#3a3a2a', '#8a7a55'],
    slotPalette: { head: ['#d8c58a', '#cdb878', '#c2ad6c'], feet: ['#2a2420', '#3a2e24'], neck: ['#4a5a7a', '#5a4a3a', '#2f4a3a'] },
    patterns: { neck: { plaid: 2, solid: 1 } },
    skins: ['#e8b896', '#d29b74', '#c99c74', '#b57b55'],
    hairColors: ['#141010', '#1e1611', '#2a1d14'],
    women: 0.35,
    height: [1.55, 1.72],
    weaponStyles: ['vietnam', 'ww2'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 6, weapons: ['rifle'] },
      { id: 'gunner', label: 'Machine gunner', weight: 1, weapons: ['lmg'], slots: { armor: { bandolier: 1 } } },
      { id: 'scout', label: 'Scout', weight: 2, weapons: ['smg'], slots: { head: { none: 2, bandana: 1 }, back: { none: 1 } } },
      { id: 'cadre', label: 'Cadre', weight: 1, weapons: ['pistol'], slots: { head: { boonie: 1, none: 1 }, top: { fatigues: 1, longsleeve: 1 } } },
    ],
  },
  nva: {
    label: 'North Vietnamese Army',
    blurb: 'Regular infantry: pith helmets, green fatigues, chest rigs and rucksacks.',
    base: 'vietnam',
    slots: {
      hair: HAIR_MIL,
      head: { pith: 5, none: 1 },
      mask: { none: 1 },
      top: { fatigues: 4, longsleeve: 1 },
      bottom: { pants: 3, cargo: 1 },
      legs: { none: 1 },
      feet: { sandals: 2, jungle: 2 },
      hands: { none: 1 },
      armor: { chestrig: 4, webbing: 1 },
      belt: { utility: 2, belt: 1 },
      back: { backpack: 3, none: 1 },
      neck: { none: 1 },
      prop: { none: 1 },
    },
    palette: ['#59633f', '#4f5a38', '#5f6a44', '#6a6e4a'],
    accents: ['#3e4a2c', '#6b5a3a', '#2f3a22'],
    slotPalette: { head: ['#6a6e4a', '#77754d', '#5f6a44'], feet: ['#2a2420', '#3a3a30'] },
    // plain cloth: no camo
    patterns: {},
    skins: ['#e8b896', '#d29b74', '#c99c74', '#b57b55'],
    hairColors: ['#141010', '#1e1611', '#2a1d14'],
    women: 0.1,
    height: [1.58, 1.75],
    weaponStyles: ['vietnam', 'ww2'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 6, weapons: ['rifle'] },
      { id: 'gunner', label: 'Machine gunner', weight: 1, weapons: ['lmg'] },
      { id: 'radio', label: 'Radio operator', weight: 1, weapons: ['smg'], slots: { back: { radio: 1 } } },
      { id: 'officer', label: 'Officer', weight: 1, weapons: ['pistol'], slots: { armor: { none: 1 }, back: { none: 1 } } },
    ],
  },
  usmc_vn: {
    label: 'US Marines (Vietnam era)',
    blurb: 'M1 helmets with camo covers, flak vests, jungle boots, ALICE packs.',
    base: 'vietnam',
    slots: {
      hair: { short: 4, none: 1 },
      head: { m1: 6, boonie: 1 },
      mask: { none: 1 },
      top: { fatigues: 5, tee: 1 },
      bottom: { cargo: 3, pants: 1 },
      legs: { none: 1 },
      feet: { jungle: 1 },
      hands: { none: 1 },
      armor: { flak: 5, bandolier: 1 },
      belt: { utility: 1 },
      back: { alice: 3, none: 1 },
      neck: { none: 4, scarf: 1 },
      prop: { none: 1 },
    },
    palette: OLIVE,
    accents: ['#2f3a22', '#6b5a3a', '#3e4a2c'],
    patterns: { head: { erdl: 3, solid: 1 }, top: { solid: 4, erdl: 1 }, bottom: { solid: 4, erdl: 1 } },
    women: 0,
    height: [1.68, 1.9],
    weaponStyles: ['vietnam'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 6, weapons: ['rifle'] },
      { id: 'gunner', label: 'Machine gunner', weight: 1, weapons: ['lmg'], slots: { armor: { bandolier: 1, flak: 1 } } },
      { id: 'radio', label: 'Radio operator', weight: 1, weapons: ['rifle'], slots: { back: { radio: 1 } } },
      { id: 'pointman', label: 'Point man', weight: 1, weapons: ['shotgun'], slots: { head: { boonie: 1 } } },
      { id: 'corpsman', label: 'Corpsman', weight: 1, weapons: ['pistol'], slots: { back: { backpack: 1 } } },
    ],
  },
  usmc_modern: {
    label: 'US Marines (modern)',
    blurb: 'Digital camo, plate carriers, modern helmets, assault packs.',
    base: 'modern',
    slots: {
      hair: { short: 4, none: 2 },
      head: { modern: 6, patrol: 1, boonie: 1 },
      mask: { none: 4, goggles: 1, shemagh: 1 },
      top: { combat: 1 },
      bottom: { cargo: 1 },
      legs: { kneepads: 2, none: 1 },
      feet: { hikers: 2, boots: 1 },
      hands: { gloves: 2, none: 1 },
      armor: { platecarrier: 5, chestrig: 1 },
      belt: { utility: 1 },
      back: { assault: 2, none: 1 },
      neck: { none: 1 },
      prop: { none: 1 },
    },
    palette: ['#7d7458', '#8a8060', '#6e6a4e', '#5d6448'],
    accents: ['#4a4636', '#a89a72', '#3e4a2c'],
    patterns: { top: { digital: 4, solid: 1 }, bottom: { digital: 4, solid: 1 }, head: { digital: 2, solid: 1 } },
    women: 0.15,
    height: [1.62, 1.92],
    weaponStyles: ['modern'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 5, weapons: ['rifle'] },
      { id: 'autorifle', label: 'Automatic rifleman', weight: 2, weapons: ['lmg'] },
      { id: 'marksman', label: 'Designated marksman', weight: 1, weapons: ['sniper'], slots: { head: { boonie: 1, modern: 1 } } },
      { id: 'breacher', label: 'Breacher', weight: 1, weapons: ['shotgun'] },
      { id: 'leader', label: 'Squad leader', weight: 1, weapons: ['rifle', 'pistol'], slots: { back: { radio: 1, assault: 1 } } },
    ],
  },
  ww2_us: {
    label: 'US Army (WWII)',
    blurb: 'M1 helmets, field jackets, webbing, leggings.',
    base: 'ww2',
    slots: {
      hair: HAIR_MIL,
      head: { m1: 6, sidecap: 1 },
      mask: { none: 1 },
      top: { fieldjacket: 4, longsleeve: 1 },
      bottom: { pants: 3, cargo: 1 },
      legs: { gaiters: 3, none: 1 },
      feet: { boots: 1 },
      hands: { none: 1 },
      armor: { webbing: 4, bandolier: 1 },
      belt: { utility: 2, belt: 1 },
      back: { backpack: 2, none: 1 },
      neck: { none: 4, scarf: 1 },
      prop: { none: 1 },
    },
    palette: ['#5f5a3e', '#6a6446', '#55503a', '#706a4c'],
    accents: ['#3a3628', '#8a7a55', '#4a4434'],
    women: 0,
    height: [1.65, 1.88],
    weaponStyles: ['ww2'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 6, weapons: ['rifle'] },
      { id: 'gunner', label: 'Machine gunner', weight: 1, weapons: ['lmg'] },
      { id: 'sergeant', label: 'Sergeant', weight: 1, weapons: ['smg'] },
      { id: 'officer', label: 'Officer', weight: 1, weapons: ['pistol'], slots: { head: { m1: 2, peaked: 1 } } },
    ],
  },
  resistance: {
    label: 'Resistance fighters (WWII)',
    blurb: 'Civilian clothes, berets and caps, scarves, whatever weapons came in the drop.',
    base: 'casual',
    slots: {
      hair: { short: 4, messy: 2, long: 1, bun: 1 },
      head: { beret: 3, cap: 2, none: 2 },
      mask: { none: 1 },
      top: { jacket: 3, coat: 2, longsleeve: 2 },
      bottom: { pants: 4, breeches: 1 },
      legs: { none: 1 },
      feet: { boots: 3, tallboots: 1 },
      hands: { none: 2, gloves: 1 },
      armor: { none: 3, bandolier: 1 },
      belt: { belt: 2, none: 1 },
      back: { none: 2, backpack: 1 },
      neck: { scarf: 3, none: 1 },
      prop: { none: 1 },
    },
    palette: ['#3a3530', '#4a4038', '#2e3238', '#5a4a3a', '#3e3a2e'],
    accents: ['#8a2a2a', '#c8b890', '#2a3a5a', '#6a5a3a'],
    women: 0.4,
    weaponStyles: ['ww2'],
    roles: [
      { id: 'fighter', label: 'Fighter', weight: 5, weapons: ['smg', 'rifle'] },
      { id: 'sniper', label: 'Sharpshooter', weight: 1, weapons: ['sniper'] },
      { id: 'courier', label: 'Courier', weight: 2, weapons: ['pistol'], slots: { armor: { none: 1 }, back: { backpack: 1 } } },
    ],
  },
  ww1_british: {
    label: 'British infantry (WWI)',
    blurb: 'Brodie helmets, service tunics, breeches and puttees.',
    base: 'ww1',
    slots: {
      hair: HAIR_MIL,
      head: { brodie: 6, peaked: 1 },
      mask: { none: 5, gasmask: 1 },
      top: { tunicww1: 1 },
      bottom: { breeches: 1 },
      legs: { puttees: 1 },
      feet: { boots: 1 },
      hands: { none: 1 },
      armor: { webbing: 4, bandolier: 1 },
      belt: { belt: 1 },
      back: { ww1pack: 3, none: 1 },
      neck: { none: 1 },
      prop: { none: 1 },
    },
    palette: ['#7a6a48', '#6e6040', '#84744e'],
    accents: ['#4a4030', '#8a7a55', '#5a4a34'],
    women: 0,
    height: [1.62, 1.82],
    weaponStyles: ['ww1'],
    roles: [
      { id: 'rifleman', label: 'Rifleman', weight: 7, weapons: ['rifle'] },
      { id: 'gunner', label: 'Lewis gunner', weight: 1, weapons: ['lmg'] },
      { id: 'officer', label: 'Officer', weight: 1, weapons: ['pistol'], slots: { head: { peaked: 1 }, armor: { none: 1 }, back: { none: 1 } } },
    ],
  },
  raiders: {
    label: 'Wasteland raiders',
    blurb: 'Scrap armour, mohawks, goggles, whatever still shoots.',
    base: 'raider',
    women: 0.4,
    weaponStyles: ['scrap'],
    roles: [
      { id: 'raider', label: 'Raider', weight: 5, weapons: ['rifle', 'shotgun', 'smg'] },
      { id: 'boss', label: 'Warboss', weight: 1, weapons: ['lmg'], slots: { armor: { scrap: 1 } } },
      { id: 'scav', label: 'Scavenger', weight: 2, weapons: ['pistol', 'crossbow'] },
    ],
  },
  orbital: {
    label: 'Orbital infantry',
    blurb: 'Future soldiers: visor helmets, exo armour, energy weapons.',
    base: 'future',
    women: 0.4,
    weaponStyles: ['scifi', 'cyber'],
    roles: [
      { id: 'trooper', label: 'Trooper', weight: 5, weapons: ['rifle'] },
      { id: 'heavy', label: 'Heavy', weight: 1, weapons: ['lmg'], slots: { armor: { exo: 1 } } },
      { id: 'sniper', label: 'Sniper', weight: 1, weapons: ['sniper'] },
      { id: 'pilot', label: 'Pilot', weight: 1, weapons: ['pistol'], slots: { back: { jetpack: 1 } } },
    ],
  },
  knights: {
    label: 'Order of knights',
    blurb: 'Plate, great helms and tabards; crossbowmen at the back.',
    base: 'knight',
    women: 0.2,
    weaponStyles: ['fantasy'],
    roles: [
      { id: 'knight', label: 'Knight', weight: 4 },
      { id: 'crossbowman', label: 'Crossbowman', weight: 2, weapons: ['crossbow'], slots: { head: { helmet: 1, hood: 1 }, armor: { chestplate: 1 } } },
    ],
  },
  horde: {
    label: 'Zombie horde',
    blurb: 'Torn clothes from every walk of (former) life.',
    base: 'zombie',
    women: 0.5,
    weaponStyles: [],
    roles: [{ id: 'walker', label: 'Walker', weight: 1 }],
  },
};

const pickWeighted = <T extends { weight: number }>(r: Rng, list: T[]): T => {
  let x = r.next() * list.reduce((s, i) => s + i.weight, 0);
  for (const i of list) if ((x -= i.weight) <= 0) return i;
  return list[list.length - 1];
};

/**
 * One member of a faction. Style and race are yours; outfit, colours, body spread, role and weapon
 * come from the faction. Pass `role` to force one ('any' or unset = rolled by weight).
 */
export function factionMember(seed: number, factionId: string, style: StyleId, race: RaceId = 'human', role?: string): CharacterRecipe {
  const f = FACTIONS[factionId];
  if (!f) throw new Error(`no faction "${factionId}"`);
  const r = new Rng(subSeed(seed, `faction.${factionId}`));
  const ro = role && role !== 'any' ? (f.roles.find((x) => x.id === role) ?? f.roles[0]) : pickWeighted(r, f.roles);
  const rc = randomRecipe(seed, style, f.base, race);
  const base = THEMES[f.base];
  const theme: Theme = {
    ...base,
    slots: { ...base.slots, ...f.slots, ...ro.slots },
    palette: f.palette ?? base.palette,
    accents: f.accents ?? base.accents,
    slotPalette: { ...base.slotPalette, ...f.slotPalette },
    patterns: f.patterns ?? base.patterns,
  };
  rc.outfit = randomOutfit(seed, theme);
  // bodies: who serves, how tall, which skin tones (other races keep their own skin)
  const woman = r.chance(f.women);
  rc.body.gender = Math.round((woman ? 0.78 + 0.2 * r.next() : 0.2 * r.next()) * 1000) / 1000;
  if (f.height) rc.body.height = Math.round((f.height[0] + (f.height[1] - f.height[0]) * r.next() - (woman ? 0.06 : 0)) * rc.body.height / 1.75 * 1000) / 1000;
  if (f.skins && race === 'human') rc.body.skin = r.pick(f.skins);
  if (woman) rc.outfit.beard = { ...rc.outfit.beard, id: 'none' };
  if (f.hairColors) {
    const hc = r.pick(f.hairColors);
    for (const slot of ['hair', 'beard'] as const) rc.outfit[slot] = { ...rc.outfit[slot], color: hc, color2: hc };
    rc.face.browColor = hc;
  }
  const weapons = ro.weapons ?? [];
  if (weapons.length && f.weaponStyles.length) rc.weapon = { archetype: r.pick(weapons), style: r.pick(f.weaponStyles), seed: 1 + Math.floor(r.next() * 9999) };
  else delete rc.weapon;
  rc.faction = { id: factionId, role: ro.id };
  rc.name = `${ro.label} ${rc.name.split(' ')[1] ?? rc.name}`;
  return rc;
}

/** a squad: `n` members with consecutive seeds, every role represented before repeats where possible */
export function factionSquad(seed: number, factionId: string, style: StyleId, n = 6, race: RaceId = 'human'): CharacterRecipe[] {
  const f = FACTIONS[factionId];
  const roles = [...f.roles].sort((a, b) => b.weight - a.weight);
  return Array.from({ length: n }, (_, i) => factionMember(seed + i * 101, factionId, style, race, i < roles.length && i > 0 ? roles[i].id : undefined));
}
