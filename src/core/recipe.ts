/**
 * A CharacterRecipe is the complete, editable description of a character. Everything the
 * generator builds is a pure function of the recipe, so a saved .badchar.json always rebuilds
 * the exact same mesh, rig and animations.
 */
import { Rng, subSeed } from './rng';
import { RaceId, RACES, Shape } from './races';
import type { PatternId } from './patterns';

// ─────────────────────────────────────────────────────────────── styles ──
export type StyleId = 'blocky' | 'boxy' | 'chibi' | 'stylized' | 'faceted' | 'realistic' | 'heroic' | 'stocky' | 'voxel' | 'voxelslim' | 'mannequin' | 'figure';

export interface Style {
  label: string;
  blurb: string;
  /** total height measured in head-heights */
  headsTall: number;
  /** head half-width / half-depth as a fraction of head height */
  headW: number;
  headD: number;
  /** limb thickness multipliers */
  arm: number;
  leg: number;
  /** torso width multiplier */
  torso: number;
  /** 0 = uniform Minecraft-style limbs, 1 = full anatomical taper */
  definition: number;
  /** leg length as a fraction of the body below the neck */
  legFrac: number;
  /** arm length (shoulder → fingertip) as a fraction of the body below the neck */
  armFrac: number;
  /** neck length as a fraction of head height */
  neck: number;
  hand: number;
  foot: number;
  /** default roundness 0 (boxy) … 1 (round) */
  roundness: number;
  /** eye line height on the head, 0 = chin, 1 = crown */
  eyeLine: number;
  /** relative size of facial features */
  faceScale: number;
  /** bevelled-box cross-sections (chamfer as a fraction of the smaller half-extent) */
  bevel?: number;
  /** 0 … 1: how strongly a race's bulk multiplies this style's thickness (unset = fully, the original behaviour) */
  raceBlend?: number;
  /** visible joints: wooden ball joints or toy peg joints */
  joints?: 'ball' | 'peg';
  /** skin roughness override (glossy plastic) */
  gloss?: number;
  /** default shading for new characters in this style */
  shading?: 'smooth' | 'flat';
  /** cross-section override: 'box' = plain rectangles everywhere (simplest shapes) */
  section?: 'box';
  /** multiplies the ring-simplification tolerance (fewer rings = simpler blocks) */
  simplify?: number;
  /** one clean taper per limb segment instead of the anatomical knee/calf/ankle profile */
  straightLimbs?: boolean;
}

export const STYLES: Record<StyleId, Style> = {
  blocky: {
    label: 'Blocky',
    blurb: 'Advanced voxel hero: chunky limbs, cube head, but with knees and elbows',
    headsTall: 4.4, headW: 0.48, headD: 0.48, arm: 1.75, leg: 1.65, torso: 1.3, definition: 0.15,
    legFrac: 0.55, armFrac: 0.5, neck: 0.06, hand: 1.05, foot: 1.0, roundness: 0.12, eyeLine: 0.44, faceScale: 1.25,
  },
  boxy: {
    label: 'Boxy',
    blurb: "Noor's style: rectangular anatomy, bevelled edges, real joints, not a Minecraft clone",
    headsTall: 6.2, headW: 0.43, headD: 0.46, arm: 1.3, leg: 1.22, torso: 1.15, definition: 0.55,
    legFrac: 0.56, armFrac: 0.48, neck: 0.14, hand: 1.15, foot: 1.15, roundness: 0.05, eyeLine: 0.46, faceScale: 1.1, bevel: 0.2,
  },
  chibi: {
    label: 'Chibi',
    blurb: 'Big head, tiny body, maximum cute',
    headsTall: 2.8, headW: 0.47, headD: 0.45, arm: 1.6, leg: 1.55, torso: 1.25, definition: 0.3,
    legFrac: 0.44, armFrac: 0.44, neck: 0.05, hand: 1.15, foot: 1.15, roundness: 0.6, eyeLine: 0.38, faceScale: 1.4,
  },
  stylized: {
    label: 'Stylized',
    blurb: 'Classic low-poly game proportions',
    headsTall: 6, headW: 0.38, headD: 0.43, arm: 1.2, leg: 1.12, torso: 1.08, definition: 0.7,
    legFrac: 0.57, armFrac: 0.48, neck: 0.18, hand: 1.1, foot: 1.05, roundness: 0.45, eyeLine: 0.45, faceScale: 1.1,
  },
  faceted: {
    label: 'Faceted',
    blurb: 'Flat-shaded low-poly, like the Thornwake race sheets',
    headsTall: 7.0, headW: 0.34, headD: 0.42, arm: 1.05, leg: 1.03, torso: 1.03, definition: 1,
    legFrac: 0.59, armFrac: 0.47, neck: 0.25, hand: 1.05, foot: 1.05, roundness: 0.5, eyeLine: 0.48, faceScale: 1.05,
  },
  realistic: {
    label: 'Realistic',
    blurb: 'Human proportions, low-poly finish',
    headsTall: 7.3, headW: 0.33, headD: 0.42, arm: 1, leg: 1, torso: 1, definition: 1,
    legFrac: 0.6, armFrac: 0.46, neck: 0.27, hand: 1, foot: 1, roundness: 0.62, eyeLine: 0.48, faceScale: 1,
  },
  heroic: {
    label: 'Heroic',
    blurb: 'Eight heads tall, broad shoulders, comic-book confidence',
    headsTall: 8, headW: 0.33, headD: 0.42, arm: 1.08, leg: 1.04, torso: 1.07, definition: 1,
    legFrac: 0.62, armFrac: 0.47, neck: 0.3, hand: 1, foot: 1, roundness: 0.55, eyeLine: 0.48, faceScale: 1,
  },
  stocky: {
    label: 'Stocky',
    blurb: 'Dwarves, brawlers and fridges with legs',
    headsTall: 4.6, headW: 0.42, headD: 0.46, arm: 1.5, leg: 1.5, torso: 1.4, definition: 0.6,
    legFrac: 0.44, armFrac: 0.48, neck: 0.08, hand: 1.2, foot: 1.15, roundness: 0.4, eyeLine: 0.47, faceScale: 1.1,
  },
  // ── slimmer, cleaner silhouettes (added later; the styles above are unchanged) ──
  voxel: {
    label: 'Voxel',
    blurb: 'Pure cubes, crisp edges, slim uniform limbs. Bends at knees and elbows.',
    headsTall: 5.2, headW: 0.46, headD: 0.46, arm: 1.12, leg: 1.12, torso: 1.02, definition: 0.12,
    legFrac: 0.54, armFrac: 0.48, neck: 0.06, hand: 1.0, foot: 1.0, roundness: 0, eyeLine: 0.45, faceScale: 1.2,
    section: 'box', simplify: 4, raceBlend: 0.4, shading: 'flat', straightLimbs: true,
  },
  voxelslim: {
    label: 'Voxel Slim',
    blurb: 'Realistic proportions built from slim rectangular blocks. Clean silhouettes for every race.',
    headsTall: 6.8, headW: 0.37, headD: 0.42, arm: 0.95, leg: 0.95, torso: 0.95, definition: 0.5,
    legFrac: 0.58, armFrac: 0.47, neck: 0.16, hand: 1.0, foot: 1.0, roundness: 0, eyeLine: 0.47, faceScale: 1.05,
    section: 'box', simplify: 3, raceBlend: 0.35, shading: 'flat', straightLimbs: true,
  },
  mannequin: {
    label: 'Mannequin',
    blurb: 'A wooden posing doll with ball joints at every bend.',
    headsTall: 7.2, headW: 0.34, headD: 0.42, arm: 0.86, leg: 0.9, torso: 0.92, definition: 1,
    legFrac: 0.6, armFrac: 0.47, neck: 0.3, hand: 0.95, foot: 0.95, roundness: 0.8, eyeLine: 0.48, faceScale: 0.9,
    raceBlend: 0.45, joints: 'ball', shading: 'smooth', simplify: 5, straightLimbs: true,
  },
  figure: {
    label: 'Action Figure',
    blurb: 'Glossy toy plastic with peg joints. Batteries not included.',
    headsTall: 6.4, headW: 0.38, headD: 0.42, arm: 1.0, leg: 1.0, torso: 1.0, definition: 0.85,
    legFrac: 0.57, armFrac: 0.48, neck: 0.18, hand: 1.1, foot: 1.05, roundness: 0.4, eyeLine: 0.47, faceScale: 1.1,
    raceBlend: 0.45, joints: 'peg', gloss: 0.32, shading: 'smooth', straightLimbs: true,
  },
};

// ───────────────────────────────────────────────────────────── garments ──
export type SlotId = 'hair' | 'beard' | 'head' | 'mask' | 'top' | 'bottom' | 'legs' | 'feet' | 'hands' | 'armor' | 'belt' | 'back' | 'neck' | 'prop';
export const SLOTS: SlotId[] = ['hair', 'beard', 'head', 'mask', 'top', 'bottom', 'legs', 'feet', 'hands', 'armor', 'belt', 'back', 'neck', 'prop'];

/** face gear that covers the nose (the modelled nose is skipped under it) */
export const COVERS_NOSE = new Set(['gasmask', 'respirator', 'shemagh', 'bandanamask']);

export type MaterialKind = 'cloth' | 'leather' | 'metal' | 'plastic' | 'rubber';

export const GARMENTS: Record<SlotId, Record<string, { label: string; kind: MaterialKind }>> = {
  // hair and beards are opt-in extras: the base brief is "bald, no facial hair"
  hair: {
    none: { label: 'Bald (none)', kind: 'cloth' },
    short: { label: 'Voxel short', kind: 'cloth' },
    messy: { label: 'Voxel messy', kind: 'cloth' },
    long: { label: 'Voxel long', kind: 'cloth' },
    mohawk: { label: 'Mohawk', kind: 'cloth' },
    bun: { label: 'Top knot', kind: 'cloth' },
    ponytail: { label: 'Ponytail', kind: 'cloth' },
  },
  beard: {
    none: { label: 'Clean (none)', kind: 'cloth' },
    stubble: { label: 'Stubble (texture)', kind: 'cloth' },
    full: { label: 'Full beard', kind: 'cloth' },
    goatee: { label: 'Goatee', kind: 'cloth' },
    mustache: { label: 'Mustache', kind: 'cloth' },
  },
  head: {
    none: { label: 'Bald (none)', kind: 'cloth' },
    beanie: { label: 'Beanie', kind: 'cloth' },
    cap: { label: 'Baseball cap', kind: 'cloth' },
    headband: { label: 'Headband', kind: 'cloth' },
    bandana: { label: 'Bandana', kind: 'cloth' },
    helmet: { label: 'Combat helmet', kind: 'plastic' },
    hardhat: { label: 'Hard hat', kind: 'plastic' },
    wizard: { label: 'Wizard hat', kind: 'cloth' },
    greathelm: { label: 'Great helm', kind: 'metal' },
    crown: { label: 'Crown', kind: 'metal' },
    spacehelm: { label: 'Space helmet', kind: 'plastic' },
    brodie: { label: 'Brodie helmet (WWI)', kind: 'metal' },
    stahlhelm: { label: 'Stahlhelm (WWI/WWII)', kind: 'metal' },
    m1: { label: 'M1 helmet (WWII/Vietnam)', kind: 'plastic' },
    modern: { label: 'Modern helmet + NVG mount', kind: 'plastic' },
    visorhelm: { label: 'Future visor helmet', kind: 'plastic' },
    beret: { label: 'Beret', kind: 'cloth' },
    boonie: { label: 'Boonie hat', kind: 'cloth' },
    patrol: { label: 'Patrol cap', kind: 'cloth' },
    sidecap: { label: 'Side cap', kind: 'cloth' },
    peaked: { label: 'Peaked officer cap', kind: 'cloth' },
    ushanka: { label: 'Ushanka', kind: 'cloth' },
    hood: { label: 'Hood', kind: 'cloth' },
    divehelm: { label: 'Brass diving helmet', kind: 'metal' },
    divedome: { label: 'Sci-fi dive dome', kind: 'plastic' },
  },
  // (called 'mask', not 'face': 'face' is the face-texture material)
  mask: {
    none: { label: 'None', kind: 'cloth' },
    gasmask: { label: 'Gas mask', kind: 'rubber' },
    respirator: { label: 'Respirator', kind: 'rubber' },
    goggles: { label: 'Goggles', kind: 'rubber' },
    shemagh: { label: 'Shemagh', kind: 'cloth' },
    bandanamask: { label: 'Bandana mask', kind: 'cloth' },
    divemask: { label: 'Dive mask + snorkel', kind: 'rubber' },
  },
  top: {
    none: { label: 'None', kind: 'cloth' },
    bra: { label: 'Sports top', kind: 'cloth' },
    tank: { label: 'Tank top', kind: 'cloth' },
    tee: { label: 'T-shirt', kind: 'cloth' },
    longsleeve: { label: 'Long sleeve', kind: 'cloth' },
    tunic: { label: 'Tunic', kind: 'cloth' },
    robe: { label: 'Robe', kind: 'cloth' },
    coat: { label: 'Long coat', kind: 'leather' },
    suit: { label: 'Bodysuit top', kind: 'rubber' },
    tunicww1: { label: 'Service tunic (WWI)', kind: 'cloth' },
    fieldjacket: { label: 'Field jacket (WWII)', kind: 'cloth' },
    fatigues: { label: 'Fatigues (Vietnam)', kind: 'cloth' },
    combat: { label: 'Combat shirt (modern)', kind: 'cloth' },
    hoodie: { label: 'Hoodie', kind: 'cloth' },
    jacket: { label: 'Leather jacket', kind: 'leather' },
    drysuit: { label: 'Canvas dive suit', kind: 'cloth' },
    wetsuit: { label: 'Wetsuit', kind: 'rubber' },
  },
  bottom: {
    none: { label: 'None', kind: 'cloth' },
    briefs: { label: 'Briefs', kind: 'cloth' },
    shorts: { label: 'Shorts', kind: 'cloth' },
    pants: { label: 'Trousers', kind: 'cloth' },
    skirt: { label: 'Skirt', kind: 'cloth' },
    suit: { label: 'Bodysuit legs', kind: 'rubber' },
    breeches: { label: 'Breeches (WWI)', kind: 'cloth' },
    cargo: { label: 'Cargo trousers', kind: 'cloth' },
    drysuit: { label: 'Canvas dive suit legs', kind: 'cloth' },
    wetsuit: { label: 'Wetsuit legs', kind: 'rubber' },
  },
  legs: {
    none: { label: 'None', kind: 'cloth' },
    puttees: { label: 'Puttees', kind: 'cloth' },
    kneepads: { label: 'Knee pads', kind: 'plastic' },
    gaiters: { label: 'Gaiters', kind: 'cloth' },
  },
  feet: {
    none: { label: 'Barefoot', kind: 'cloth' },
    sneakers: { label: 'Sneakers', kind: 'rubber' },
    boots: { label: 'Boots', kind: 'leather' },
    tallboots: { label: 'Tall boots', kind: 'leather' },
    hikers: { label: 'Hiking boots', kind: 'leather' },
    jungle: { label: 'Jungle boots', kind: 'leather' },
    leadboots: { label: 'Weighted diving boots', kind: 'metal' },
    fins: { label: 'Dive fins', kind: 'rubber' },
    sabatons: { label: 'Armored boots', kind: 'metal' },
  },
  hands: {
    none: { label: 'Bare hands', kind: 'cloth' },
    gloves: { label: 'Gloves', kind: 'leather' },
    gauntlets: { label: 'Gauntlets', kind: 'metal' },
  },
  armor: {
    none: { label: 'None', kind: 'cloth' },
    vest: { label: 'Tactical vest', kind: 'cloth' },
    hivis: { label: 'Hi-vis vest', kind: 'plastic' },
    chestplate: { label: 'Chestplate', kind: 'metal' },
    plate: { label: 'Full plate', kind: 'metal' },
    webbing: { label: 'Webbing (WWI/WWII)', kind: 'cloth' },
    bandolier: { label: 'Bandolier', kind: 'leather' },
    flak: { label: 'Flak vest (Vietnam)', kind: 'cloth' },
    chestrig: { label: 'Chest rig', kind: 'cloth' },
    platecarrier: { label: 'Plate carrier (modern)', kind: 'cloth' },
    exo: { label: 'Exo armour (future)', kind: 'plastic' },
    scrap: { label: 'Scrap armour (wasteland)', kind: 'metal' },
    corselet: { label: 'Diving corselet (brass)', kind: 'metal' },
    bcd: { label: 'Scuba BCD vest', kind: 'rubber' },
    hardsuit: { label: 'Deep-sea hard suit', kind: 'plastic' },
  },
  belt: {
    none: { label: 'None', kind: 'leather' },
    belt: { label: 'Belt', kind: 'leather' },
    sash: { label: 'Sash', kind: 'cloth' },
    utility: { label: 'Utility belt + canteen', kind: 'cloth' },
    weights: { label: 'Dive weight belt', kind: 'rubber' },
  },
  back: {
    none: { label: 'None', kind: 'cloth' },
    backpack: { label: 'Backpack', kind: 'cloth' },
    rucksack: { label: 'Explorer rucksack', kind: 'leather' },
    jetpack: { label: 'Jetpack', kind: 'metal' },
    quiver: { label: 'Quiver', kind: 'leather' },
    ww1pack: { label: 'Pack + greatcoat roll (WWI)', kind: 'cloth' },
    alice: { label: 'ALICE pack (Vietnam)', kind: 'cloth' },
    assault: { label: 'Assault pack (modern)', kind: 'cloth' },
    radio: { label: 'Field radio', kind: 'plastic' },
    scubatank: { label: 'Scuba tank', kind: 'metal' },
    rebreather: { label: 'Rebreather pack', kind: 'plastic' },
    airhose: { label: 'Diver air hose', kind: 'rubber' },
    cape: { label: 'Cape', kind: 'cloth' },
  },
  neck: {
    none: { label: 'None', kind: 'cloth' },
    scarf: { label: 'Scarf', kind: 'cloth' },
    furcollar: { label: 'Fur collar', kind: 'cloth' },
  },
  prop: {
    none: { label: 'Empty hands', kind: 'cloth' },
    staff: { label: 'Walking staff', kind: 'leather' },
    bow: { label: 'Bow', kind: 'leather' },
    crossbow: { label: 'Crossbow', kind: 'leather' },
    rifle: { label: 'Rifle (preview)', kind: 'metal' },
  },
};

export const HAIR_COLORS = ['#3b2414', '#4a2f1b', '#5a3a22', '#1e1611', '#8a5a2b', '#b07a3a', '#d8b46a', '#8c8c8c', '#a33b1f'];

export interface Garment {
  id: string;
  color: string;
  /** trim / accent colour (soles, stripes, buckles, visors) */
  color2: string;
  /** fabric pattern (camo etc.) using color + color2; default solid */
  pattern?: PatternId;
  /** torn, jagged hems (survivors, zombies) */
  torn?: boolean;
}

// ──────────────────────────────────────────────────────────────── themes ──
type Opt = Partial<Record<string, number>>;
interface Theme {
  label: string;
  genre: string;
  slots: Partial<Record<SlotId, Opt>>;
  palette: string[];
  accents: string[];
  skins?: string[];
  /** fixed colours for specific slots (signature looks) */
  fixed?: Partial<Record<SlotId, [string, string]>>;
  /** fabric pattern weights per slot (camo!) */
  patterns?: Partial<Record<SlotId, Partial<Record<PatternId, number>>>>;
  /** palette per slot, overriding `palette` */
  slotPalette?: Partial<Record<SlotId, string[]>>;
  /** chance that each garment is torn */
  torn?: number;
  /** face overrides for the theme (zombies) */
  face?: Partial<FaceParams>;
}

export const SKIN_TONES = ['#f3d2b8', '#e8b896', '#d29b74', '#b57b55', '#8d5a3b', '#6b4029', '#4a2c1d'];

export const THEMES: Record<string, Theme> = {
  retrodiver: {
    label: 'Hard-hat diver',
    genre: 'Retro deep-sea diving (Mark V)',
    slots: {
      head: { divehelm: 1 },
      top: { drysuit: 1 },
      bottom: { drysuit: 1 },
      feet: { leadboots: 1 },
      hands: { gloves: 1 },
      armor: { corselet: 1 },
      belt: { weights: 1 },
      back: { airhose: 1 },
    },
    palette: ['#8a7a5a', '#7a6e52', '#6a6250'],
    accents: ['#3a3a3a', '#2a2a2a'],
    slotPalette: { head: ['#b8863a', '#c4943e', '#a87a32'], armor: ['#b8863a', '#c4943e'], feet: ['#5a5a5a'], hands: ['#4a3a2a'], back: ['#2a2a2a'] },
    fixed: { head: ['#b8863a', '#8a5a22'], armor: ['#b8863a', '#8a5a22'] },
  },
  scuba: {
    label: 'Scuba diver',
    genre: 'Modern recreational / technical diving',
    slots: {
      mask: { divemask: 1 },
      top: { wetsuit: 1 },
      bottom: { wetsuit: 1 },
      feet: { fins: 1 },
      hands: { gloves: 2, none: 1 },
      armor: { bcd: 1 },
      belt: { weights: 1 },
      back: { scubatank: 1 },
    },
    palette: ['#1e2328', '#22303c', '#2a2a30'],
    accents: ['#e8c21a', '#2fa8d8', '#e8541a', '#d8d8d8'],
    slotPalette: { back: ['#e8c21a', '#c8ccd0', '#d84a2a'], feet: ['#1e2328'], mask: ['#1e2328'] },
  },
  deepsuit: {
    label: 'Deep-sea hard suit',
    genre: 'Sci-fi diving (Solitude!)',
    slots: {
      head: { divedome: 1 },
      top: { suit: 1 },
      bottom: { suit: 1 },
      feet: { sabatons: 1 },
      hands: { gauntlets: 1 },
      armor: { hardsuit: 1 },
      back: { rebreather: 1 },
    },
    palette: ['#3a4048', '#d8dde3', '#c8a83a', '#2c3a4a', '#4a4f58'],
    accents: ['#00d0ff', '#ffb000', '#a6ff00'],
  },
  party: {
    label: 'Adventuring party',
    genre: 'Fantasy adventure (cloaks, hoods and fur)',
    slots: {
      hair: { none: 2, ponytail: 2, messy: 1 },
      head: { none: 3, hood: 2, wizard: 1 },
      top: { tunic: 3, longsleeve: 2, coat: 1 },
      bottom: { pants: 1 },
      feet: { boots: 2, tallboots: 1 },
      hands: { gloves: 1, none: 2 },
      belt: { belt: 2, sash: 1 },
      back: { cape: 3, rucksack: 1, quiver: 1 },
      neck: { none: 2, furcollar: 1, scarf: 1 },
      prop: { none: 2, staff: 1, bow: 1 },
    },
    palette: ['#2f6f4a', '#7a2a2a', '#3a4a7a', '#6a4a2a', '#5a3a6a', '#7a6a4a'],
    accents: ['#d4a62a', '#c8b48a', '#3a2716'],
    slotPalette: { neck: ['#d8c8a8', '#8a6a4a', '#e8e0d0'], hair: ['#a33b1f', '#d8b46a', '#3b2414'] },
  },
  ww1: {
    label: 'WWI soldier',
    genre: 'Great War trenches (1914-1918)',
    slots: {
      head: { brodie: 3, stahlhelm: 2, peaked: 1, sidecap: 1 },
      mask: { none: 4, gasmask: 1 },
      top: { tunicww1: 1 },
      bottom: { breeches: 2, pants: 1 },
      legs: { puttees: 3, none: 1 },
      feet: { boots: 1 },
      armor: { webbing: 3, bandolier: 1 },
      back: { ww1pack: 3, none: 1 },
      prop: { rifle: 1 },
    },
    palette: ['#7a6e4e', '#6f6a4c', '#5e6450', '#7d8597', '#8a7d5a'],
    accents: ['#5a4a32', '#3e3a2c', '#8a7a52'],
    slotPalette: { head: ['#5f6248', '#6a6a52', '#585c4a'], armor: ['#8a7a52', '#7a6a46'], back: ['#7a6e4e', '#6a6044'] },
  },
  ww2: {
    label: 'WWII soldier',
    genre: 'Second World War (1939-1945)',
    slots: {
      head: { m1: 3, stahlhelm: 2, sidecap: 1, beret: 1 },
      top: { fieldjacket: 2, fatigues: 1 },
      bottom: { pants: 3, cargo: 1 },
      legs: { gaiters: 2, none: 2 },
      feet: { boots: 1 },
      hands: { none: 3, gloves: 1 },
      armor: { webbing: 3, none: 1 },
      belt: { utility: 1 },
      back: { ww1pack: 1, assault: 1, radio: 1, none: 2 },
      prop: { rifle: 1 },
    },
    palette: ['#5b5a3c', '#6b6b47', '#7a7350', '#55594c', '#6e6a58'],
    accents: ['#8a7f62', '#3a3a2e', '#a39a7a'],
    patterns: { top: { solid: 5, splinter: 1, erdl: 1 }, head: { solid: 6, erdl: 1 } },
  },
  vietnam: {
    label: 'Vietnam-era soldier',
    genre: 'Jungle warfare (1960s-70s)',
    slots: {
      head: { m1: 3, boonie: 3, none: 1 },
      mask: { none: 6, bandanamask: 1 },
      top: { fatigues: 3, tee: 1 },
      bottom: { cargo: 2, pants: 1 },
      feet: { jungle: 1 },
      armor: { flak: 2, bandolier: 1, webbing: 1, none: 1 },
      belt: { utility: 1 },
      back: { alice: 2, radio: 1, none: 1 },
      neck: { none: 3, scarf: 1 },
      prop: { rifle: 1 },
    },
    palette: ['#4e5a34', '#55603a', '#5d6640', '#4a5236'],
    accents: ['#2f3a22', '#6b5a3a', '#3e4a2c'],
    patterns: { top: { solid: 3, tiger: 2, erdl: 2 }, bottom: { solid: 3, tiger: 2, erdl: 2 }, head: { solid: 2, tiger: 2, erdl: 2 } },
  },
  modern: {
    label: 'Modern soldier',
    genre: 'Contemporary military sim',
    slots: {
      head: { modern: 4, patrol: 1, boonie: 1 },
      mask: { none: 3, goggles: 2, shemagh: 1 },
      top: { combat: 3, fatigues: 1 },
      bottom: { cargo: 3, pants: 1 },
      legs: { kneepads: 3, none: 1 },
      feet: { boots: 1 },
      hands: { gloves: 4, none: 1 },
      armor: { platecarrier: 4, chestrig: 2 },
      belt: { utility: 1 },
      back: { assault: 3, radio: 1, none: 1 },
      prop: { rifle: 1 },
    },
    palette: ['#7a7356', '#6b6b4e', '#8f8466', '#5b6150', '#a89a78'],
    accents: ['#3a3a30', '#5a5444', '#2a2c28'],
    patterns: { top: { digital: 2, woodland: 2, desert: 2, flecktarn: 1, solid: 1 }, bottom: { digital: 2, woodland: 2, desert: 2, flecktarn: 1, solid: 1 }, head: { solid: 3, digital: 1 } },
  },
  future: {
    label: 'Future soldier',
    genre: 'Sci-fi military',
    slots: {
      head: { visorhelm: 4, none: 1 },
      top: { suit: 1 },
      bottom: { suit: 1 },
      feet: { boots: 1 },
      hands: { gauntlets: 1, gloves: 1 },
      armor: { exo: 4, platecarrier: 1 },
      back: { jetpack: 1, assault: 1, none: 1 },
      prop: { rifle: 1 },
    },
    palette: ['#2b2f36', '#3a4048', '#d8dde3', '#4a5a4a', '#2c3a4a'],
    accents: ['#00d0ff', '#ff6a00', '#a6ff00', '#ff2e88'],
    patterns: { top: { solid: 3, urban: 1, digital: 1 } },
  },

  explorer: {
    label: 'Explorer',
    genre: 'Voxel adventure (Alden Wayfarer look)',
    slots: {
      hair: { short: 2, messy: 3 },
      beard: { full: 3, stubble: 1, mustache: 1 },
      top: { tee: 1 },
      bottom: { pants: 1 },
      feet: { hikers: 1 },
      belt: { belt: 1 },
      back: { rucksack: 1 },
      prop: { staff: 2, none: 1 },
    },
    palette: ['#2f6f73', '#3a7a6f', '#2c5f6e', '#4a6e4a'],
    accents: ['#d4a62a'],
    fixed: {
      bottom: ['#5a3d26', '#3b2818'],
      feet: ['#5b3a22', '#2e2016'],
      belt: ['#3a2716', '#d4a62a'],
      back: ['#6b4425', '#c9b48a'],
      prop: ['#6e4a2a', '#4a3020'],
    },
  },
  base: {
    label: 'Base body',
    genre: 'Mannequin for your own clothing',
    slots: { bottom: { briefs: 1 } },
    palette: ['#3b3f46', '#f1efe9', '#2c4a6e'],
    accents: ['#cfcfcf'],
  },
  casual: {
    label: 'Casual',
    genre: 'Modern / life sim',
    slots: {
      head: { none: 5, cap: 2, beanie: 2 },
      top: { tee: 4, longsleeve: 2, tank: 1 },
      bottom: { pants: 4, shorts: 2, skirt: 1 },
      feet: { sneakers: 4, boots: 1 },
      back: { none: 5, backpack: 1 },
      neck: { none: 6, scarf: 1 },
    },
    palette: ['#c0392b', '#2e86c1', '#f4d03f', '#7d3c98', '#1e8449', '#e67e22', '#ecf0f1', '#34495e', '#d98880', '#5d6d7e'],
    accents: ['#f5f5f5', '#222222', '#d0d3d4'],
  },
  peasant: {
    label: 'Villager',
    genre: 'Fantasy / RPG townsfolk',
    slots: {
      head: { none: 4, bandana: 1, beanie: 1 },
      top: { tunic: 4, longsleeve: 2 },
      prop: { none: 3, bow: 1, crossbow: 1 },
      bottom: { pants: 3, skirt: 1 },
      feet: { boots: 3, none: 1 },
      belt: { belt: 3, sash: 1 },
      back: { none: 4, quiver: 1 },
    },
    palette: ['#8b6b4a', '#6e7f4e', '#a3906b', '#7b4b3a', '#5b6a7a', '#b9a37e', '#4f5d3a'],
    accents: ['#4a3423', '#c2a878', '#2f2a24'],
  },
  knight: {
    label: 'Knight',
    genre: 'Fantasy / medieval combat',
    slots: {
      head: { greathelm: 2, none: 1 },
      top: { tunic: 1, longsleeve: 1 },
      bottom: { pants: 1 },
      feet: { sabatons: 1 },
      hands: { gauntlets: 1 },
      armor: { plate: 2, chestplate: 1 },
      belt: { belt: 1 },
    },
    palette: ['#8d2b2b', '#2b4a8d', '#2f6b3a', '#6b4a8d', '#b08a2e'],
    accents: ['#b8bcc2', '#9a9fa6', '#c9a74a'],
  },
  wizard: {
    label: 'Wizard',
    genre: 'Fantasy / spellcaster',
    slots: {
      head: { wizard: 4, none: 1 },
      top: { robe: 1 },
      bottom: { pants: 1 },
      feet: { boots: 1 },
      belt: { sash: 2, belt: 1 },
      neck: { none: 2, scarf: 1 },
    },
    palette: ['#3b2a7a', '#7a2a5c', '#1f4f6e', '#5a1f1f', '#2e5a3a', '#4a4a52'],
    accents: ['#d4af37', '#c0c0c0', '#e0d7c0'],
  },
  soldier: {
    label: 'Soldier',
    genre: 'Military shooter',
    slots: {
      head: { helmet: 4, beanie: 1, none: 1 },
      top: { longsleeve: 3, tee: 1 },
      bottom: { pants: 1 },
      feet: { boots: 1 },
      hands: { gloves: 2, none: 1 },
      armor: { vest: 1 },
      belt: { belt: 1 },
      back: { backpack: 2, none: 1 },
    },
    palette: ['#4b5320', '#6b6b47', '#8a7f62', '#3d4a3a', '#5a5f5c'],
    accents: ['#2b2b26', '#3a3a32', '#1f1f1c'],
  },
  scifi: {
    label: 'Sci-fi',
    genre: 'Space / cyberpunk',
    slots: {
      head: { none: 3, spacehelm: 2 },
      top: { suit: 1 },
      bottom: { suit: 1 },
      feet: { boots: 2, sneakers: 1 },
      hands: { gloves: 1 },
      belt: { belt: 1, none: 1 },
      back: { none: 2, jetpack: 1 },
    },
    palette: ['#e8eaed', '#1d2b3a', '#26292e', '#3a6ea5', '#8b2635', '#2f4f4f'],
    accents: ['#00d0ff', '#ff6a00', '#a6ff00', '#ff2e88'],
  },
  worker: {
    label: 'Worker',
    genre: 'Construction / simulation',
    slots: {
      head: { hardhat: 4, none: 1 },
      top: { tee: 2, longsleeve: 2 },
      bottom: { pants: 1 },
      feet: { boots: 1 },
      hands: { gloves: 2, none: 1 },
      armor: { hivis: 1 },
      belt: { belt: 1 },
    },
    palette: ['#2e4a6e', '#5d6d7e', '#7b5e3a', '#3b3b3b', '#9aa3ab'],
    accents: ['#f2c200', '#ff7a00', '#c8ff00'],
  },
  athlete: {
    label: 'Athlete',
    genre: 'Sports / party games',
    slots: {
      head: { none: 2, headband: 2, cap: 1 },
      top: { tank: 2, tee: 1, bra: 1 },
      bottom: { shorts: 1 },
      feet: { sneakers: 1 },
    },
    palette: ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#ecf0f1', '#1abc9c'],
    accents: ['#ffffff', '#111111'],
  },
  pirate: {
    label: 'Pirate',
    genre: 'Swashbuckling adventure',
    slots: {
      head: { bandana: 3, none: 1 },
      top: { longsleeve: 2, tunic: 1, coat: 2 },
      bottom: { pants: 2, shorts: 1 },
      feet: { tallboots: 2, boots: 1, none: 1 },
      belt: { sash: 2, belt: 1 },
    },
    palette: ['#f0e6d2', '#8b1e1e', '#1e2a4a', '#3a2a1a', '#6b4a2a', '#2a4a3a'],
    accents: ['#c9a227', '#2a1a10', '#8b1e1e'],
  },
  zombie: {
    label: 'Zombie',
    genre: 'Horror / survival',
    slots: {
      head: { none: 1 },
      top: { tee: 2, longsleeve: 1, tank: 1, fieldjacket: 1, hoodie: 1 },
      bottom: { pants: 2, shorts: 1, cargo: 1 },
      feet: { none: 2, sneakers: 1, boots: 1 },
    },
    palette: ['#4a4a3a', '#5a3a3a', '#3a4a5a', '#6a5a4a', '#454545'],
    accents: ['#2a2a22', '#3a2a22'],
    skins: ['#8fa37a', '#9aa58c', '#7f9474', '#a3a890', '#879e88'],
    patterns: { top: { bloody: 3, grime: 2 }, bottom: { grime: 3, bloody: 1 } },
    torn: 0.85,
    face: { eyes: 'zombie', mouth: 'teeth', scars: true, blush: false, brows: 'none' },
  },
  survivor: {
    label: 'Survivor',
    genre: 'Survival / open world',
    slots: {
      head: { none: 3, beanie: 2, cap: 1, bandana: 1, boonie: 1 },
      mask: { none: 5, respirator: 1, bandanamask: 1, goggles: 1 },
      top: { hoodie: 3, jacket: 2, longsleeve: 2, fieldjacket: 1 },
      bottom: { cargo: 3, pants: 2 },
      legs: { none: 4, kneepads: 1 },
      feet: { boots: 3, hikers: 2, sneakers: 1 },
      hands: { gloves: 2, none: 1 },
      belt: { utility: 2, belt: 1 },
      back: { rucksack: 2, backpack: 2, assault: 1 },
      prop: { none: 2, crossbow: 1, bow: 1, rifle: 1 },
    },
    palette: ['#5a5a4a', '#6a4a3a', '#3e4a52', '#4a5a3a', '#7a6a52', '#2f3236', '#7a3a2a'],
    accents: ['#2a2a22', '#8a7a5a', '#c9b48a'],
    patterns: { top: { solid: 2, grime: 3, patched: 1 }, bottom: { solid: 1, grime: 3, patched: 1 } },
    torn: 0.25,
  },
  raider: {
    label: 'Wasteland raider',
    genre: 'Post-apocalyptic',
    slots: {
      hair: { none: 2, mohawk: 2 },
      mask: { gasmask: 2, goggles: 2, respirator: 1, none: 1 },
      top: { jacket: 3, tank: 2, none: 1 },
      bottom: { cargo: 2, pants: 2 },
      feet: { boots: 2, tallboots: 1 },
      hands: { gloves: 2, none: 1 },
      armor: { scrap: 4, bandolier: 1 },
      belt: { utility: 1, belt: 1 },
      back: { none: 2, rucksack: 1 },
      prop: { none: 1, crossbow: 1, rifle: 1 },
    },
    palette: ['#3a2a22', '#5a3a2a', '#2f2f2f', '#6a5a4a', '#4a3a2a'],
    accents: ['#c96a1a', '#b8a24a', '#8a8a8a', '#a33b1f'],
    patterns: { top: { grime: 3, solid: 1 }, bottom: { grime: 3, patched: 1 } },
    torn: 0.5,
  },
  mutant: {
    label: 'Mutant',
    genre: 'Post-apocalyptic horror',
    slots: {
      top: { none: 2, tank: 1, tee: 1 },
      bottom: { pants: 2, shorts: 1, cargo: 1 },
      feet: { none: 3, boots: 1 },
      belt: { none: 2, belt: 1 },
    },
    palette: ['#4a4a3a', '#5a4a3a', '#3a3a3a'],
    accents: ['#2a2a22'],
    patterns: { top: { grime: 2, bloody: 1 }, bottom: { grime: 2, bloody: 1 } },
    torn: 0.9,
    face: { scars: true, brows: 'none' },
  },
};

// ─────────────────────────────────────────────────────────────── recipe ──
export type EyeStyle = 'square' | 'dot' | 'round' | 'tall' | 'sleepy' | 'wide' | 'zombie' | 'triple';
export type MouthStyle = 'line' | 'smile' | 'grin' | 'open' | 'frown' | 'small' | 'teeth';
export type BrowStyle = 'none' | 'thin' | 'thick' | 'angry';
export const EYE_STYLES: EyeStyle[] = ['square', 'dot', 'round', 'tall', 'sleepy', 'wide', 'zombie', 'triple'];
export const MOUTH_STYLES: MouthStyle[] = ['line', 'smile', 'grin', 'open', 'frown', 'small', 'teeth'];
export const BROW_STYLES: BrowStyle[] = ['none', 'thin', 'thick', 'angry'];

export interface BodyParams {
  /** metres, floor to crown */
  height: number;
  /** 0 = masculine build … 1 = feminine build (a continuous slider, not a switch) */
  gender: number;
  muscle: number;
  fat: number;
  /** multiplier on the style's head size */
  headScale: number;
  /** 0 = boxy … 1 = round */
  roundness: number;
  /** -1 … 1 shorter / longer legs */
  legLength: number;
  skin: string;
  /** Thornwake races; defaults to human */
  race?: RaceId;
  /** fine proportion sliders, -1 … 1 each (see races.ts SHAPE_SLIDERS) */
  shape?: Shape;
}

export interface FaceParams {
  eyes: EyeStyle;
  iris: string;
  mouth: MouthStyle;
  brows: BrowStyle;
  browColor: string;
  blush: boolean;
  /** modelled nose and ears (the rest of the face is texture) */
  nose: boolean;
  ears: boolean;
  /** stitches, scars and grime painted on the face */
  scars?: boolean;
}

export interface CharacterRecipe {
  version: 1;
  name: string;
  seed: number;
  style: StyleId;
  theme: string;
  body: BodyParams;
  face: FaceParams;
  outfit: Record<SlotId, Garment>;
  rig: { restPose: 'T' | 'A' };
  mesh: {
    detail: 'low' | 'medium' | 'high';
    shading: 'smooth' | 'flat';
    morphs: boolean;
    /** include hand props (staff, bow, crossbow) in the exported mesh. Off by default:
     *  the animations never need them, and most games bring their own weapons. */
    exportProps?: boolean;
  };
}

const IRIS = ['#3b2a1a', '#4a6fa5', '#3f7a4a', '#6b4a2a', '#2a2a2a', '#7a8a9a', '#5a3a6a'];
const BROW_COLORS = ['#2a1d14', '#4a3222', '#6b4a2a', '#1a1a1a', '#8a6a3a', '#a0522d'];
const FIRST = ['Bram', 'Ada', 'Kit', 'Mira', 'Otto', 'Juno', 'Rex', 'Ivy', 'Hugo', 'Nell', 'Tor', 'Zia', 'Gus', 'Lena', 'Pip', 'Wren', 'Olaf', 'Suki', 'Dax', 'Maud'];
const LAST = ['Badly', 'Pixel', 'Blockwood', 'Quadsworth', 'Lowpoly', 'Vertex', 'Rigsby', 'Skinner', 'Bonebridge', 'Elbows', 'Kneecap', 'Mesh'];

export function randomBody(seed: number, style: StyleId, theme: string, raceId: RaceId = 'human'): BodyParams {
  const r = new Rng(subSeed(seed, 'body'));
  const st = STYLES[style];
  const race = RACES[raceId] ?? RACES.human;
  const gender = r.chance(0.5) ? r.range(0, 0.25) : r.range(0.75, 1);
  const th = THEMES[theme] ?? THEMES.casual;
  const skins = th.skins ?? race.skins ?? SKIN_TONES;
  const heroic = style === 'heroic';
  const rs = (race.height[0] + race.height[1]) / 2 / 1.76;
  return {
    race: raceId,
    shape: {},
    height: round(r.range(race.height[0], race.height[1]) - gender * 0.1 * rs + ((style === 'stocky' ? -0.35 : 0) + (style === 'chibi' ? -0.5 : 0)) * rs, 3),
    gender: round(gender, 3),
    muscle: round(clamp01((heroic ? r.range(0.55, 1) : r.range(0, 0.7) ** 1.3) + race.muscle), 3),
    fat: round(clamp01((heroic ? r.range(0, 0.2) : r.range(0, 0.75) ** 1.6) + race.fat), 3),
    headScale: round(r.range(0.94, 1.06), 3),
    roundness: round(clamp01(st.roundness + r.range(-0.12, 0.12) - (race.rocky ? 0.25 : 0)), 3),
    legLength: round(r.range(-0.4, 0.4), 3),
    skin: r.pick(skins),
  };
}

export function randomFace(seed: number, style: StyleId): FaceParams {
  const r = new Rng(subSeed(seed, 'face'));
  const blocky = style === 'blocky';
  return {
    eyes: blocky ? r.pick(['square', 'square', 'dot', 'wide'] as EyeStyle[]) : style === 'chibi' ? r.pick(['tall', 'round', 'tall'] as EyeStyle[]) : r.pick(EYE_STYLES.slice(0, 6)),
    iris: r.pick(IRIS),
    mouth: r.pick(MOUTH_STYLES.slice(0, 6)),
    // the brief asked for no hair: brows are an opt-in extra, off by default
    brows: 'none',
    browColor: r.pick(BROW_COLORS),
    blush: style === 'chibi' ? r.chance(0.7) : r.chance(0.15),
    nose: !blocky && r.chance(0.8),
    ears: !blocky && style !== 'chibi',
  };
}

export function randomOutfit(seed: number, theme: string): Record<SlotId, Garment> {
  const th = THEMES[theme] ?? THEMES.casual;
  const out = {} as Record<SlotId, Garment>;
  for (const slot of SLOTS) {
    const r = new Rng(subSeed(seed, `outfit.${slot}`));
    const table = th.slots[slot];
    const id = table ? r.weighted(table as Record<string, number>) : 'none';
    let color = r.pick(th.slotPalette?.[slot] ?? th.palette);
    let color2 = r.pick(th.accents);
    if (slot === 'hair' || slot === 'beard') color = color2 = new Rng(subSeed(seed, 'hairColor')).pick(HAIR_COLORS);
    if (slot === 'prop') [color, color2] = [r.pick(['#6e4a2a', '#5a3c22', '#7a5532']), r.pick(['#3a2a1a', '#d8cfb8', '#555a60'])];
    if (th.fixed?.[slot]) [color, color2] = th.fixed[slot]!;
    if (GARMENTS[slot][id]?.kind === 'metal' && theme === 'knight') color = r.pick(th.accents.slice(0, 2));
    if (slot === 'armor' && id === 'hivis') color = r.pick(th.accents);
    if (slot === 'head' && id === 'hardhat') color = r.pick(['#f2c200', '#ffffff', '#ff7a00', '#2e86c1']);
    const pw = th.patterns?.[slot];
    const pattern = pw ? (r.weighted(pw as Record<string, number>) as PatternId) : undefined;
    const torn = (th.torn ?? 0) > 0 && r.chance(th.torn ?? 0);
    const gg = pattern && pattern !== 'solid' ? { id, color, color2: pattern === 'snow' ? color2 : r.pick(th.palette.filter((c) => c !== color).concat(color2)), pattern } : { id, color, color2 };
    out[slot] = torn ? { ...gg, torn } : gg;
  }
  return out;
}

export function randomName(seed: number): string {
  const r = new Rng(subSeed(seed, 'name'));
  return `${r.pick(FIRST)} ${r.pick(LAST)}`;
}

/** perceived brightness 0…255 */
const luma = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

export function randomRecipe(seed: number, style: StyleId = 'blocky', theme = 'casual', race: RaceId = 'human'): CharacterRecipe {
  const outfit = randomOutfit(seed, theme);
  const face = randomFace(seed, style);
  const body = randomBody(seed, style, theme, race);
  if (RACES[race].ears !== 'round') face.ears = true;
  Object.assign(face, THEMES[theme]?.face ?? {});
  if (race === 'mutant') {
    const mr = new Rng(subSeed(seed, 'mutant'));
    face.scars = true;
    if (mr.chance(0.4)) face.eyes = 'triple';
  }
  if (race !== 'human' && style !== 'blocky') face.nose = true;
  // hair that matches the skin reads as a bald lump: push it lighter or darker
  if (Math.abs(luma(outfit.hair.color) - luma(body.skin)) < 45) {
    const alt = HAIR_COLORS.filter((c) => Math.abs(luma(c) - luma(body.skin)) >= 60);
    const c = alt[seed % alt.length] ?? '#1e1611';
    for (const slot of ['hair', 'beard'] as const) outfit[slot] = { ...outfit[slot], color: c, color2: c };
  }
  if (outfit.hair.id !== 'none' || outfit.beard.id !== 'none') {
    // hairy characters get matching brows and a proper nose
    face.brows = 'thick';
    face.browColor = outfit.hair.id !== 'none' ? outfit.hair.color : outfit.beard.color;
    face.nose = true;
  }
  return {
    version: 1,
    name: randomName(seed),
    seed,
    style,
    theme,
    body,
    face,
    outfit,
    rig: { restPose: 'T' },
    mesh: STYLES[style].shading ? { detail: 'medium', shading: STYLES[style].shading!, morphs: true } : style === 'faceted' || style === 'boxy' ? { detail: style === 'boxy' ? 'medium' : 'low', shading: 'flat', morphs: true } : { detail: 'medium', shading: 'smooth', morphs: true },
  };
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}
export function round(x: number, d = 4) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
