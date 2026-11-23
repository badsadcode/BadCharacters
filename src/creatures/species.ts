/**
 * The bestiary: every species is a body-plan spec plus default colours and size, tuned against
 * Tom's abyss sheets. A recipe can override size, colours and the mods (gape, teeth, fins, glow).
 */
import type { CreatureBuild } from './core';
import { buildFish, FishSpec } from './fish';
import { buildLegged, buildRay, buildTentacled } from './plans';
import type { CreatureRecipe } from './generate';

export type Plan = 'fish' | 'tentacled' | 'legged' | 'ray';

export interface Species {
  label: string;
  blurb: string;
  plan: Plan;
  length: [number, number];
  colors: CreatureRecipe['colors'];
  mods: CreatureRecipe['mods'];
  grooves?: boolean;
  bands?: number;
  build: (rc: CreatureRecipe) => CreatureBuild;
}

const deep = { mouth: '#4a1420', eye: '#f2e27a', glow: '#58e1ff', fin: '#6a4a6a' };

/** apply the recipe's mods to a fish spec */
function fish(rc: CreatureRecipe, s: Omit<FishSpec, 'length'>): CreatureBuild {
  const k = rc.mods;
  const scaleFin = <T extends { h?: number; len?: number }>(f: T): T => ({ ...f, ...(f.h !== undefined ? { h: f.h * k.fins } : {}), ...(f.len !== undefined ? { len: f.len * k.fins } : {}) });
  return buildFish({
    ...s,
    length: rc.length,
    mouth: { ...s.mouth, gape: s.mouth.gape * k.gape, tooth: s.mouth.tooth * k.teeth },
    dorsal: s.dorsal?.map(scaleFin),
    spines: s.spines && { ...s.spines, h: s.spines.h * k.fins },
    pectoral: s.pectoral && { ...s.pectoral, len: s.pectoral.len * k.fins },
    caudal: { ...s.caudal, size: s.caudal.size * Math.sqrt(k.fins) },
    frill: s.frill && { ...s.frill, r: s.frill.r * k.fins },
  });
}

const baseMods = (o: Partial<CreatureRecipe['mods']> = {}): CreatureRecipe['mods'] => ({ gape: 1, teeth: 1, fins: 1, glow: 0, blotch: 0.4, scars: false, ...o });

export const SPECIES = {
  megalodon: {
    label: 'Megalodon',
    blurb: 'An abyssal variant of the shark you were already afraid of.',
    plan: 'fish',
    length: [14, 18],
    colors: { base: '#5a6278', belly: '#cfc6c0', accent: '#7a2a36', ...deep, fin: '#5a5a70' },
    mods: baseMods({ scars: true, blotch: 0.35 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.07, 0.06], [0.08, 0.15, 0.13], [0.22, 0.2, 0.17], [0.4, 0.21, 0.17], [0.65, 0.15, 0.11], [0.88, 0.07, 0.05], [1, 0.045, 0.03]],
        n: 2.6,
        segments: 4,
        mouth: { end: 0.2, gape: 0.42, line: 0.38, teeth: 9, tooth: 0.024 },
        eyes: { t: 0.1, up: 0.32, size: 0.008 },
        dorsal: [{ t: 0.4, h: 0.14, len: 0.12, sweep: 0.75 }, { t: 0.78, h: 0.035, len: 0.03, sweep: 0.8 }],
        pectoral: { t: 0.3, len: 0.2, chord: 0.09, down: 0.55, back: 0.55 },
        pelvic: { t: 0.66, len: 0.05, chord: 0.035 },
        anal: { t: 0.8, h: 0.03, len: 0.03, sweep: 0.8 },
        caudal: { kind: 'shark', size: 0.24 },
        gills: 5,
        swim: 'fish',
        cycle: 0.35,
        temperament: 'Apex',
      }),
  },
  leviathan: {
    label: 'Leviathan',
    blurb: 'Gigantic. Has never once been described as "a bit long".',
    plan: 'fish',
    length: [35, 45],
    colors: { base: '#3e4566', belly: '#7a7a96', accent: '#5a3a6a', ...deep, eye: '#7ff0ff', fin: '#4a4a6e' },
    mods: baseMods({ blotch: 0.25 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.025, 0.02], [0.05, 0.055, 0.045], [0.12, 0.07, 0.06], [0.3, 0.075, 0.065], [0.6, 0.06, 0.05], [0.85, 0.035, 0.03], [1, 0.012, 0.01]],
        n: 2.8,
        segments: 9,
        mouth: { end: 0.1, gape: 0.6, line: 0.42, teeth: 7, tooth: 0.011 },
        eyes: { t: 0.055, up: 0.45, size: 0.004 },
        spines: { from: 0.16, to: 0.88, count: 9, h: 0.028, sweep: 1.1 },
        pectoral: { t: 0.19, len: 0.09, chord: 0.04, down: 0.6, back: 0.8 },
        caudal: { kind: 'fork', size: 0.07 },
        swim: 'serpent',
        cycle: 0.18,
        temperament: 'Apex',
      }),
  },
  angler: {
    label: 'Angler',
    blurb: 'Lights the way. Specifically, the way into its mouth.',
    plan: 'fish',
    length: [1.2, 2.5],
    colors: { base: '#5a3236', belly: '#7a5050', accent: '#3a1e24', ...deep, glow: '#ffe27a', fin: '#6a3a3e' },
    mods: baseMods({ blotch: 0.5 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.3, 0.28], [0.12, 0.5, 0.42], [0.32, 0.52, 0.44], [0.6, 0.36, 0.3], [0.85, 0.16, 0.13], [1, 0.09, 0.07]],
        n: 2.4,
        sag: 0.02,
        segments: 3,
        mouth: { end: 0.32, gape: 0.55, line: 0.42, teeth: 6, tooth: 0.09 },
        eyes: { t: 0.18, up: 0.62, size: 0.025 },
        spines: { from: 0.35, to: 0.65, count: 4, h: 0.1, sweep: 0.6 },
        pectoral: { t: 0.5, len: 0.18, chord: 0.12, down: 0.3, back: 0.5 },
        caudal: { kind: 'paddle', size: 0.28 },
        lure: { len: 0.5 },
        swim: 'fish',
        cycle: 0.5,
        temperament: 'Apex',
      }),
  },
  viperfish: {
    label: 'Viperfish',
    blurb: 'Teeth so long it cannot close its mouth. It has made peace with this.',
    plan: 'fish',
    length: [2, 4],
    colors: { base: '#4a3e66', belly: '#7a6a90', accent: '#6a3a5a', ...deep, eye: '#8ff4ff', fin: '#5a4a72' },
    mods: baseMods({ blotch: 0.3 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.04, 0.035], [0.08, 0.1, 0.08], [0.2, 0.12, 0.09], [0.5, 0.1, 0.07], [0.85, 0.05, 0.035], [1, 0.03, 0.02]],
        n: 2.6,
        segments: 5,
        mouth: { end: 0.16, gape: 0.5, line: 0.4, teeth: 6, tooth: 0.05 },
        eyes: { t: 0.08, up: 0.4, size: 0.014 },
        spines: { from: 0.2, to: 0.9, count: 10, h: 0.045, sweep: 0.9 },
        pectoral: { t: 0.24, len: 0.1, chord: 0.05, down: 0.4, back: 0.8 },
        caudal: { kind: 'fork', size: 0.13 },
        swim: 'serpent',
        cycle: 0.6,
        temperament: 'Apex',
      }),
  },
  gulper: {
    label: 'Gulper',
    blurb: 'Is mostly mouth. Would like to be entirely mouth.',
    plan: 'fish',
    length: [1.5, 3],
    colors: { base: '#5a3e58', belly: '#7a6074', accent: '#3a2236', ...deep, fin: '#6a4a66' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.36, 0.34], [0.15, 0.48, 0.44], [0.32, 0.42, 0.38], [0.55, 0.22, 0.18], [0.8, 0.1, 0.08], [1, 0.05, 0.04]],
        n: 2.4,
        segments: 4,
        mouth: { end: 0.38, gape: 0.75, line: 0.45, teeth: 5, tooth: 0.04 },
        eyes: { t: 0.1, up: 0.75, size: 0.018 },
        dorsal: [{ t: 0.5, h: 0.12, len: 0.12, sweep: 0.7 }],
        pectoral: { t: 0.45, len: 0.14, chord: 0.08, down: 0.3, back: 0.6 },
        caudal: { kind: 'fork', size: 0.2 },
        swim: 'fish',
        cycle: 0.45,
        temperament: 'Apex',
      }),
  },
  devourer: {
    label: 'Frilled devourer',
    blurb: 'Opens its frill when it is pleased to see you. It is always pleased to see you.',
    plan: 'fish',
    length: [3, 6],
    colors: { base: '#5a3a46', belly: '#8a6a70', accent: '#8a2a30', ...deep, fin: '#7a3a46' },
    mods: baseMods({ blotch: 0.45 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.1, 0.09], [0.12, 0.22, 0.2], [0.3, 0.24, 0.2], [0.6, 0.18, 0.14], [0.88, 0.09, 0.07], [1, 0.05, 0.04]],
        n: 2.5,
        segments: 4,
        mouth: { end: 0.2, gape: 0.5, line: 0.4, teeth: 7, tooth: 0.035 },
        eyes: { t: 0.08, up: 0.45, size: 0.012 },
        spines: { from: 0.35, to: 0.8, count: 6, h: 0.07, sweep: 0.7 },
        caudal: { kind: 'fork', size: 0.18 },
        frill: { r: 0.22, blades: 13 },
        swim: 'fish',
        cycle: 0.5,
        temperament: 'Apex',
      }),
  },
  whale: {
    label: 'Abyssal whale',
    blurb: 'Non-aggressive. Seventy metres of not-your-problem.',
    plan: 'fish',
    length: [40, 70],
    colors: { base: '#2e3a56', belly: '#8a8ea0', accent: '#24304a', ...deep, glow: '#4fe6ff', fin: '#2e3a56' },
    mods: baseMods({ glow: 0.8, blotch: 0.3 }),
    grooves: true,
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.07, 0.08], [0.1, 0.16, 0.17], [0.3, 0.2, 0.2], [0.55, 0.17, 0.16], [0.8, 0.08, 0.07], [1, 0.035, 0.03]],
        n: 2.3,
        segments: 4,
        mouth: { end: 0.26, gape: 0.04, line: 0.3, teeth: 0, tooth: 0 },
        eyes: { t: 0.24, up: 0.05, size: 0.005 },
        dorsal: [{ t: 0.72, h: 0.03, len: 0.06, sweep: 1 }],
        pectoral: { t: 0.32, len: 0.26, chord: 0.06, down: 0.5, back: 0.5 },
        caudal: { kind: 'fluke', size: 0.15 },
        swim: 'whale',
        cycle: 0.07,
        temperament: 'Grazer',
      }),
  },
  lamprey: {
    label: 'Abyssal lamprey',
    blurb: 'A mouth on a tube. The tube is optional.',
    plan: 'fish',
    length: [2, 4],
    colors: { base: '#5a4a6a', belly: '#8a7a90', accent: '#4a3050', ...deep, fin: '#5a4a6a' },
    mods: baseMods({ blotch: 0.3 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.11, 0.11], [0.06, 0.1, 0.1], [0.4, 0.085, 0.085], [0.8, 0.05, 0.05], [1, 0.02, 0.02]],
        n: 2.3,
        segments: 7,
        mouth: { end: 0.06, gape: 0, line: 0.5, teeth: 14, tooth: 0.028, round: true },
        eyes: { t: 0.1, up: 0.5, size: 0.008 },
        caudal: { kind: 'paddle', size: 0.07 },
        swim: 'serpent',
        cycle: 0.5,
        temperament: 'Apex',
      }),
  },
  brineworm: {
    label: 'Brine worm',
    blurb: 'Segmented, toothed, and absolutely not a sandworm, legally speaking.',
    plan: 'fish',
    length: [4, 9],
    colors: { base: '#7a6a6a', belly: '#a09090', accent: '#5a3a3a', ...deep, fin: '#7a6a6a' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.17, 0.17], [0.08, 0.16, 0.16], [0.5, 0.14, 0.14], [0.85, 0.09, 0.09], [1, 0.04, 0.04]],
        n: 3.2,
        segments: 7,
        rings: [11, 0.1],
        mouth: { end: 0.06, gape: 0, line: 0.5, teeth: 16, tooth: 0.035, round: true },
        eyes: { t: 0.1, up: 0.5, size: 0 },
        caudal: { kind: 'none', size: 0 },
        swim: 'serpent',
        cycle: 0.35,
        temperament: 'Apex',
      }),
  },
  kraken: {
    label: 'Kraken',
    blurb: 'Eight arms, two glowing eyes, zero interest in your shipping schedule.',
    plan: 'tentacled',
    length: [12, 25],
    colors: { base: '#7a3a4e', belly: '#9a5a6a', accent: '#5a2236', ...deep, fin: '#7a3a4e' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) => buildTentacled({ length: rc.length, body: { shape: 'octo', h: 0.32, r: 0.11 }, arms: { count: 8, len: 0.62 * rc.mods.fins, r: 0.032, segments: 4, down: 0.45, curl: 0.35, suckers: true, flat: 0.8 }, eyes: { kind: 'pair', size: 0.012 }, cycle: 0.25, temperament: 'Apex' }),
  },
  jelly: {
    label: 'Deep jelly',
    blurb: 'Pretty, glowing, and full of opinions about touching.',
    plan: 'tentacled',
    length: [1, 3],
    colors: { base: '#6a5aa8', belly: '#8a7ac8', accent: '#4a3a8a', ...deep, glow: '#ff4fc8', fin: '#6a5aa8' },
    mods: baseMods({ blotch: 0.2 }),
    build: (rc) => buildTentacled({ length: rc.length, body: { shape: 'bell', h: 0.32, r: 0.3 }, arms: { count: 6, len: 0.55 * rc.mods.fins, r: 0.04, segments: 3, down: 0.95, curl: 0.05 }, filaments: { count: 10, len: 0.8 }, eyes: { kind: 'none', size: 0 }, translucent: true, core: true, cycle: 0.45, temperament: 'Grazer' }),
  },
  jellybeast: {
    label: 'Jelly beast',
    blurb: 'A jellyfish that went to the gym with the mutant.',
    plan: 'tentacled',
    length: [4, 8],
    colors: { base: '#5a3aa8', belly: '#7a5ac8', accent: '#3a2a7a', ...deep, glow: '#b07aff', fin: '#5a3aa8' },
    mods: baseMods({ blotch: 0.25 }),
    build: (rc) => buildTentacled({ length: rc.length, body: { shape: 'bell', h: 0.3, r: 0.24 }, arms: { count: 8, len: 0.7 * rc.mods.fins, r: 0.05, segments: 4, down: 0.9, curl: 0.15 }, eyes: { kind: 'none', size: 0 }, translucent: true, core: true, cycle: 0.35, temperament: 'Apex' }),
  },
  observer: {
    label: 'Observer',
    blurb: 'It does not attack. It just watches. Forever.',
    plan: 'tentacled',
    length: [2, 4],
    colors: { base: '#6a5a6a', belly: '#8a7a8a', accent: '#4a3a4a', ...deep, eye: '#ff8a1a', fin: '#6a5a6a' },
    mods: baseMods({ blotch: 0.3 }),
    build: (rc) => buildTentacled({ length: rc.length, body: { shape: 'orb', h: 0.32, r: 0.16 }, arms: { count: 4, len: 0.7 * rc.mods.fins, r: 0.025, segments: 3, down: 0.9, curl: 0.05 }, eyes: { kind: 'cyclops', size: 0.1 }, cycle: 0.3, temperament: 'Grazer' }),
  },
  crab: {
    label: 'Abyssal crab',
    blurb: 'Sideways is just forwards with ambition.',
    plan: 'legged',
    length: [1, 3],
    colors: { base: '#7a6a72', belly: '#9a8a90', accent: '#5a3a44', ...deep, fin: '#7a6a72' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) => buildLegged({ length: rc.length, body: { shape: 'crab', w: 0.55, h: 0.22 }, legs: { pairs: 4, len: 0.7 * rc.mods.fins, r: 0.025, height: 0.28 }, fangs: Math.round(4 * rc.mods.teeth), eyes: { size: 0.018 }, cycle: 1, temperament: 'Apex' }),
  },
  isopod: {
    label: 'Giant isopod',
    blurb: 'A woodlouse the size of a dog. Mostly harmless. Mostly.',
    plan: 'legged',
    length: [0.8, 2.5],
    colors: { base: '#6a6090', belly: '#8a80a8', accent: '#4a4070', ...deep, fin: '#6a6090' },
    mods: baseMods({ blotch: 0.2 }),
    build: (rc) => buildLegged({ length: rc.length, body: { shape: 'isopod', w: 0.42, h: 0.22, plates: 7 }, legs: { pairs: 7, len: 0.24 * rc.mods.fins, r: 0.012, height: 0.1 }, eyes: { size: 0.014 }, antennae: true, cycle: 1.4, temperament: 'Grazer' }),
  },
  hatcher: {
    label: 'Hatcher',
    blurb: 'Carries its eggs on its back. Do not ask what hatches.',
    plan: 'legged',
    length: [1.5, 3],
    colors: { base: '#5a5262', belly: '#7a7282', accent: '#3a3242', ...deep, glow: '#ffa63a', fin: '#5a5262' },
    mods: baseMods({ blotch: 0.3 }),
    build: (rc) => buildLegged({ length: rc.length, body: { shape: 'spider', w: 0.36, h: 0.24 }, legs: { pairs: 4, len: 0.85 * rc.mods.fins, r: 0.018, height: 0.38 }, fangs: 2, eyes: { size: 0.014 }, eggs: 9, cycle: 0.9, temperament: 'Apex' }),
  },
  riftray: {
    label: 'Rift ray',
    blurb: 'Glides over the trench like a sheet of the night sky.',
    plan: 'ray',
    length: [4, 9],
    colors: { base: '#2e4a5e', belly: '#7a8a98', accent: '#244050', ...deep, glow: '#4fe6ff', fin: '#2e4a5e' },
    mods: baseMods({ glow: 0.9, blotch: 0.25 }),
    build: (rc) => buildRay({ length: rc.length, span: 1.0 * rc.mods.fins, tail: 0.9, eyes: { size: 0.012 }, cycle: 0.22, temperament: 'Grazer' }),
  },
  lanternskate: {
    label: 'Lantern skate',
    blurb: 'Brings its own mood lighting.',
    plan: 'ray',
    length: [1.5, 3],
    colors: { base: '#5a4e5e', belly: '#8a7e8a', accent: '#3a2e3e', ...deep, glow: '#ffb24a', fin: '#5a4e5e' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) => buildRay({ length: rc.length, span: 0.85 * rc.mods.fins, tail: 0.5, lanterns: 3, eyes: { size: 0.016 }, cycle: 0.35, temperament: 'Grazer' }),
  },
  siphoner: {
    label: 'Siphoner',
    blurb: 'Drinks the sea through a fringed straw. Occasionally drinks divers.',
    plan: 'fish',
    length: [2, 5],
    colors: { base: '#6a4a70', belly: '#8a6a90', accent: '#4a2a50', ...deep, fin: '#6a4a70' },
    mods: baseMods({ blotch: 0.35 }),
    build: (rc) =>
      fish(rc, {
        profile: [[0, 0.1, 0.1], [0.08, 0.08, 0.08], [0.2, 0.12, 0.12], [0.45, 0.2, 0.18], [0.75, 0.13, 0.11], [1, 0.05, 0.04]],
        n: 2.5,
        segments: 4,
        mouth: { end: 0.06, gape: 0, line: 0.5, teeth: 10, tooth: 0.03, round: true },
        eyes: { t: 0.32, up: 0.5, size: 0.012 },
        dorsal: [{ t: 0.5, h: 0.08, len: 0.1, sweep: 0.8 }],
        pectoral: { t: 0.42, len: 0.12, chord: 0.07, down: 0.4, back: 0.6 },
        caudal: { kind: 'paddle', size: 0.16 },
        swim: 'fish',
        cycle: 0.5,
        temperament: 'Apex',
      }),
  },
} satisfies Record<string, Species>;

export type SpeciesId = keyof typeof SPECIES;

export function randomCreature(species: SpeciesId, seed: number): CreatureRecipe {
  const sp: Species = SPECIES[species];
  const f = ((seed * 9301 + 49297) % 233280) / 233280;
  return {
    version: 1,
    kind: 'creature',
    name: sp.label,
    species,
    seed,
    length: Math.round((sp.length[0] + (sp.length[1] - sp.length[0]) * f) * 10) / 10,
    colors: { ...sp.colors },
    mods: { ...sp.mods },
    mesh: { detail: 'medium', shading: 'flat' },
  };
}
