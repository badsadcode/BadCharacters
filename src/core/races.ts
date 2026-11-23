/**
 * Races (from the Thornwake race reference sheets) and fine proportion sliders.
 *
 * A race is a set of multipliers on top of a style, so "goblin" works in every style: a faceted
 * goblin, a blocky goblin, a chibi goblin (which is mostly ears). Styles decide how a character
 * is drawn; races decide what it is.
 */

export type EarShape = 'round' | 'pointed' | 'elf' | 'wide' | 'bat';
export type RaceId = 'human' | 'orc' | 'elf' | 'dwarf' | 'hobbit' | 'goblin' | 'gremlin';

export interface Race {
  label: string;
  blurb: string;
  /** typical height range for an adult (metres, realistic style) */
  height: [number, number];
  /** multiplies the style's heads-tall (lower = bigger head relative to body) */
  headsTall: number;
  headW: number;
  torso: number;
  arm: number;
  leg: number;
  /** leg / arm length as a fraction of the body, relative to human */
  legFrac: number;
  armFrac: number;
  shoulders: number;
  hand: number;
  foot: number;
  neckLen: number;
  neckThick: number;
  jaw: number;
  nose: number;
  ears: EarShape;
  earScale: number;
  tusks?: boolean;
  /** added to the random muscle / fat / belly rolls */
  muscle: number;
  fat: number;
  belly: number;
  /** default posture, 0 upright … 1 hunched */
  hunch: number;
  /** relative size of eyes and mouth on the face texture */
  face: number;
  skins: string[];
}

export const RACES: Record<RaceId, Race> = {
  human: {
    label: 'Human', blurb: 'The baseline. Surprisingly versatile.',
    height: [1.6, 1.92], headsTall: 1, headW: 1, torso: 1, arm: 1, leg: 1, legFrac: 1, armFrac: 1, shoulders: 1, hand: 1, foot: 1,
    neckLen: 1, neckThick: 1, jaw: 1, nose: 1, ears: 'round', earScale: 1, muscle: 0, fat: 0, belly: 0, hunch: 0, face: 1,
    skins: ['#f3d2b8', '#e8b896', '#d29b74', '#b57b55', '#8d5a3b', '#6b4029', '#4a2c1d'],
  },
  orc: {
    label: 'Orc', blurb: 'Two metres of shoulders. Tusks optional, attitude not.',
    height: [1.95, 2.25], headsTall: 1.12, headW: 1.08, torso: 1.04, arm: 1.32, leg: 1.22, legFrac: 0.97, armFrac: 1.04, shoulders: 1.42, hand: 1.25, foot: 1.15,
    neckLen: 0.55, neckThick: 1.55, jaw: 1.25, nose: 1.3, ears: 'pointed', earScale: 1.1, tusks: true, muscle: 0.45, fat: 0.05, belly: 0, hunch: 0.25, face: 0.95,
    skins: ['#7d8a4e', '#6f7d45', '#8a9455', '#5e6b3c', '#9aa06a', '#7a8560'],
  },
  elf: {
    label: 'Elf', blurb: 'Tall, slender, judgemental about your posture.',
    height: [1.8, 2.0], headsTall: 1.08, headW: 0.94, torso: 0.86, arm: 0.84, leg: 0.88, legFrac: 1.05, armFrac: 1.03, shoulders: 0.92, hand: 0.95, foot: 0.95,
    neckLen: 1.25, neckThick: 0.85, jaw: 0.9, nose: 0.85, ears: 'elf', earScale: 1.3, muscle: -0.1, fat: -0.25, belly: 0, hunch: -0.1, face: 1,
    skins: ['#f6dcc6', '#ecc8a8', '#d9b08c', '#c9a27a', '#e6d3c0', '#b98a66'],
  },
  dwarf: {
    label: 'Dwarf', blurb: 'Four and a half heads tall, of which all are stubborn.',
    height: [1.25, 1.45], headsTall: 0.62, headW: 1.05, torso: 1.5, arm: 1.42, leg: 1.48, legFrac: 0.78, armFrac: 0.96, shoulders: 1.22, hand: 1.35, foot: 1.2,
    neckLen: 0.35, neckThick: 1.5, jaw: 1.15, nose: 1.35, ears: 'round', earScale: 1.1, muscle: 0.3, fat: 0.15, belly: 0.5, hunch: 0.1, face: 1,
    skins: ['#e8b896', '#d29b74', '#c58a63', '#b57b55', '#f0c8a8', '#8d5a3b'],
  },
  hobbit: {
    label: 'Hobbit', blurb: 'Short, round, big feet, second breakfast.',
    height: [1.0, 1.2], headsTall: 0.72, headW: 1.02, torso: 1.15, arm: 1.05, leg: 1.15, legFrac: 0.86, armFrac: 1, shoulders: 1, hand: 1.1, foot: 1.6,
    neckLen: 0.6, neckThick: 1.1, jaw: 1, nose: 1.1, ears: 'pointed', earScale: 0.75, muscle: 0, fat: 0.25, belly: 0.35, hunch: 0, face: 1.1,
    skins: ['#f3d2b8', '#e8b896', '#d29b74', '#c58a63', '#b57b55'],
  },
  goblin: {
    label: 'Goblin', blurb: 'Big head, bigger ears, the longest arms in the business.',
    height: [1.0, 1.25], headsTall: 0.5, headW: 1.15, torso: 0.95, arm: 1.05, leg: 1.02, legFrac: 0.95, armFrac: 1.16, shoulders: 0.9, hand: 1.5, foot: 1.5,
    neckLen: 0.8, neckThick: 0.75, jaw: 0.85, nose: 1.6, ears: 'wide', earScale: 1.6, muscle: -0.2, fat: -0.2, belly: 0, hunch: 0.45, face: 1.25,
    skins: ['#a7a95a', '#9a9c50', '#b4b46a', '#8c9046', '#b8a65e', '#9fa86a'],
  },
  gremlin: {
    label: 'Gremlin', blurb: 'Do not feed after midnight. Do not let it near the wiring.',
    height: [0.8, 1.0], headsTall: 0.48, headW: 1.1, torso: 0.92, arm: 1.0, leg: 1.0, legFrac: 0.96, armFrac: 1.2, shoulders: 0.88, hand: 1.6, foot: 1.4,
    neckLen: 0.9, neckThick: 0.7, jaw: 0.8, nose: 1.2, ears: 'bat', earScale: 2.1, muscle: -0.15, fat: -0.25, belly: 0, hunch: 0.55, face: 1.3,
    skins: ['#c58a63', '#b07a58', '#8f8a62', '#a39070', '#7f8a6a', '#b59a7a'],
  },
};

/** Fine proportion sliders, all -1 … 1, 0 = the race/style default. */
export const SHAPE_SLIDERS = [
  ['shoulders', 'Shoulders'],
  ['chest', 'Chest / bust'],
  ['waist', 'Waist'],
  ['hips', 'Hips'],
  ['belly', 'Belly'],
  ['armLength', 'Arm length'],
  ['armThickness', 'Arm thickness'],
  ['legThickness', 'Leg thickness'],
  ['neckLength', 'Neck length'],
  ['neckThickness', 'Neck thickness'],
  ['headWidth', 'Head width'],
  ['headDepth', 'Head depth'],
  ['jaw', 'Jaw'],
  ['handSize', 'Hand size'],
  ['footSize', 'Foot size'],
  ['earSize', 'Ear size'],
  ['noseSize', 'Nose size'],
  ['eyeSize', 'Eye size'],
  ['eyeSpacing', 'Eye spacing'],
  ['mouthWidth', 'Mouth width'],
  ['posture', 'Posture (hunch)'],
] as const;
export type ShapeKey = (typeof SHAPE_SLIDERS)[number][0];
export type Shape = Partial<Record<ShapeKey, number>>;

/** slider value, clamped, with an optional race default added (posture) */
export const sv = (s: Shape | undefined, k: ShapeKey) => Math.max(-1, Math.min(1, s?.[k] ?? 0));
