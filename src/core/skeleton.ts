/**
 * Proportions → skeleton. All landmark maths lives here so body, clothing, rig and animation
 * agree on where every joint is.
 *
 * Conventions (documented in docs/RIG.md):
 *  - metres, +Y up, character faces +Z, character's LEFT is +X, feet on y = 0
 *  - every bone's rest rotation is identity; bones are pure translations from their parent
 *  - bone names are Unity HumanBodyBones names, so humanoid auto-mapping works out of the box
 */
import { add, clamp, lerp, norm, scale, V3 } from './math';
import { CharacterRecipe, STYLES } from './recipe';
import { EarShape, RACES, sv } from './races';
import { Rng, subSeed } from './rng';

export interface Bone {
  name: string;
  parent: number; // -1 for root
  /** rest position in world space */
  world: V3;
}

export interface Socket {
  name: string;
  bone: string;
  world: V3;
}

/** Every number the mesh builders need, in metres. */
export interface Dims {
  H: number;
  u: number; // body unit (1 ≈ a realistic 1.8 m adult)
  headH: number;
  headHW: number;
  headHD: number;
  chinY: number;
  neckBaseY: number;
  neckR: number;
  hipY: number;
  torsoLen: number;
  shoulderY: number;
  shoulderX: number;
  shoulderHW: number;
  chestHW: number;
  chestHD: number;
  waistHW: number;
  waistHD: number;
  hipHW: number;
  hipHD: number;
  belly: number;
  breast: number;
  pecs: number;
  butt: number;
  hipJX: number;
  kneeY: number;
  ankleY: number;
  thighR: number;
  midThighR: number;
  kneeR: number;
  calfR: number;
  ankleR: number;
  footLen: number;
  footHW: number;
  armDir: V3; // rest direction of the LEFT arm
  upperArmLen: number;
  foreArmLen: number;
  handLen: number;
  handHW: number;
  handHT: number;
  deltR: number;
  upperArmR: number;
  elbowR: number;
  foreArmR: number;
  wristR: number;
  /** superellipse exponent: 2 = ellipse, big = box */
  n: number;
  eyeLine: number;
  faceScale: number;
  /** race & fine-slider extras */
  jaw: number;
  ears: EarShape;
  earScale: number;
  noseScale: number;
  tusks: boolean;
  hunch: number;
  eyeSize: number;
  eyeSpacing: number;
  mouthWidth: number;
  /** per-side arm bulk (mutants: one arm went to the gym) */
  armL: number;
  armR: number;
  mutant: boolean;
}

export interface Skeleton {
  bones: Bone[];
  sockets: Socket[];
  dims: Dims;
  index: Record<string, number>;
  /** bone carrying the Pose.hips translation (default 'Hips'; creatures use 'Body') */
  moveBone?: string;
}

export function computeDims(rc: CharacterRecipe): Dims {
  const st = STYLES[rc.style];
  const b = rc.body;
  const g = clamp(b.gender);
  const m = clamp(b.muscle);
  const f = clamp(b.fat);
  const H = b.height;
  const race = RACES[b.race ?? 'human'] ?? RACES.human;
  const sh = b.shape;
  const k = (key: Parameters<typeof sv>[1], amt: number) => 1 + amt * sv(sh, key);
  const headH = (H / (st.headsTall * race.headsTall)) * b.headScale;
  const neckLen = st.neck * headH * race.neckLen * k('neckLength', 0.6);
  const chinY = H - headH;
  const neckBaseY = chinY - neckLen;
  const bodyRest = neckBaseY;
  const u = bodyRest / 1.49;
  const legLen = bodyRest * Math.min(0.72, st.legFrac * race.legFrac) * (1 + 0.08 * b.legLength);
  const hipY = legLen;
  const torsoLen = neckBaseY - hipY;
  const T = st.torso * race.torso;
  const L = st.leg * race.leg * k('legThickness', 0.25);
  const A = st.arm * race.arm * k('armThickness', 0.25);
  // `def` flattens anatomical taper toward the limb's average for blocky styles
  const def = (avg: number, x: number) => lerp(avg, x, st.definition);

  const chestHW = u * T * (lerp(0.165, 0.145, g) + 0.02 * m + 0.03 * f) * k('shoulders', 0.1) * Math.sqrt(race.shoulders);
  const chestHD = u * T * (lerp(0.105, 0.092, g) + 0.02 * m + 0.03 * f) * lerp(1, 0.85, 1 - st.definition) * k('chest', 0.08);
  const waistHW = u * T * (def(0.15, lerp(0.135, 0.112, g)) + 0.004 * m + 0.075 * f) * k('waist', 0.2);
  const waistHD = u * T * (lerp(0.088, 0.08, g) + 0.004 * m + 0.07 * f) * lerp(1, 0.85, 1 - st.definition) * k('waist', 0.15);
  let hipHW = u * T * (def(0.155, lerp(0.148, 0.172, g)) + 0.035 * f) * k('hips', 0.2);
  const hipHD = u * T * (lerp(0.098, 0.108, g) + 0.035 * f) * lerp(1, 0.85, 1 - st.definition) * k('hips', 0.12);
  const shoulderHW = u * T * (lerp(0.19, 0.162, g) + 0.025 * m + 0.015 * f) * race.shoulders * k('shoulders', 0.22);

  const thighR = u * L * (def(0.07, 0.082) + 0.018 * m + 0.035 * f + 0.008 * g);
  const hipJX = Math.max(hipHW - thighR + 0.006 * u, thighR * 0.96);
  hipHW = Math.max(hipHW, hipJX + thighR - 0.004 * u);

  const ankleY = 0.075 * legLen;
  const kneeY = ankleY + (hipY - ankleY) * 0.48;
  const legAvg = 0.06;

  const armLen = bodyRest * st.armFrac * race.armFrac * k('armLength', 0.15);
  const deltR = u * A * (def(0.047, 0.056) + 0.024 * m + 0.018 * f - 0.006 * g);
  const restAngle = rc.rig.restPose === 'A' ? -38 : 0;
  const armDir = norm([Math.cos((restAngle * Math.PI) / 180), Math.sin((restAngle * Math.PI) / 180), 0]);
  const handK = race.hand * k('handSize', 0.3);
  const handLen = armLen * 0.25 * st.hand * Math.max(1, Math.sqrt(A) * 0.85) * handK;
  const roundness = clamp(b.roundness + 0.15 * f);

  return {
    H,
    u,
    headH,
    headHW: headH * st.headW * lerp(1, 0.95, g) * (1 + 0.08 * f) * race.headW * k('headWidth', 0.2),
    headHD: headH * st.headD * k('headDepth', 0.2),
    chinY,
    neckBaseY,
    neckR: Math.min(headH * st.headW * 0.6 * race.headW, u * (lerp(0.058, 0.046, g) + 0.018 * m + 0.016 * f) * Math.sqrt(T) * race.neckThick * k('neckThickness', 0.3)),
    hipY,
    torsoLen,
    shoulderY: neckBaseY - 0.1 * torsoLen,
    shoulderX: Math.max(shoulderHW - deltR * 0.55, chestHW * 0.75),
    shoulderHW,
    chestHW,
    chestHD,
    waistHW,
    waistHD,
    hipHW,
    hipHD,
    belly: Math.max(0, u * T * (0.075 * f ** 1.2 + 0.05 * race.belly + 0.05 * sv(sh, 'belly'))),
    breast: Math.max(0, u * T * g * (0.032 + 0.03 * f) * Math.min(1, 0.4 + st.definition) * k('chest', 0.8)),
    pecs: Math.max(0, u * T * m * (1 - g) * 0.02 * k('chest', 0.8)),
    butt: u * T * (0.012 + 0.018 * g + 0.02 * f) * st.definition,
    hipJX,
    kneeY,
    ankleY,
    thighR,
    midThighR: u * L * (def(legAvg, 0.07) + 0.02 * m + 0.03 * f + 0.006 * g),
    kneeR: u * L * (def(legAvg, 0.047) + 0.006 * m + 0.012 * f),
    calfR: u * L * (def(legAvg, 0.055) + 0.014 * m + 0.014 * f),
    ankleR: u * L * (def(legAvg, 0.034) + 0.004 * m + 0.006 * f),
    footLen: u * 0.27 * st.foot * lerp(1, 0.92, g) * Math.max(1, L * 0.85) * race.foot * k('footSize', 0.3),
    footHW: u * 0.27 * st.foot * 0.2 * Math.max(1, L * 0.9) * Math.sqrt(race.foot) * k('footSize', 0.2),
    armDir,
    upperArmLen: (armLen - handLen) * 0.53,
    foreArmLen: (armLen - handLen) * 0.47,
    handLen,
    handHW: Math.max(handLen * 0.27, u * A * (def(0.042, 0.029) + 0.004 * m) * 1.3 * handK),
    handHT: Math.max(handLen * 0.11, u * A * (def(0.042, 0.029) + 0.004 * m) * 0.75 * Math.sqrt(handK)),
    deltR,
    upperArmR: u * A * (def(0.042, 0.046) + 0.02 * m + 0.02 * f - 0.005 * g),
    elbowR: u * A * (def(0.042, 0.036) + 0.006 * m + 0.01 * f),
    foreArmR: u * A * (def(0.042, 0.042) + 0.012 * m + 0.01 * f - 0.004 * g),
    wristR: u * A * (def(0.042, 0.029) + 0.004 * m + 0.004 * f),
    n: lerp(10, 2.2, roundness),
    eyeLine: st.eyeLine,
    faceScale: st.faceScale * race.face,
    jaw: race.jaw * k('jaw', 0.2),
    ears: race.ears,
    earScale: race.earScale * k('earSize', 0.5),
    noseScale: race.nose * k('noseSize', 0.5),
    tusks: !!race.tusks,
    hunch: Math.max(-0.3, Math.min(1, race.hunch + 0.6 * sv(sh, 'posture'))),
    eyeSize: k('eyeSize', 0.45),
    eyeSpacing: k('eyeSpacing', 0.3),
    mouthWidth: k('mouthWidth', 0.4),
    ...mutantArms(rc, !!race.mutant),
    mutant: !!race.mutant,
  };
}

export const BONE_NAMES = [
  'Root', 'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'LeftThumbProximal',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand', 'RightThumbProximal',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export function buildSkeleton(rc: CharacterRecipe): Skeleton {
  const d = computeDims(rc);
  const bones: Bone[] = [];
  const index: Record<string, number> = {};
  const add_ = (name: BoneName, parent: BoneName | null, world: V3) => {
    index[name] = bones.length;
    bones.push({ name, parent: parent ? index[parent] : -1, world });
  };
  const tl = d.torsoLen;
  add_('Root', null, [0, 0, 0]);
  add_('Hips', 'Root', [0, d.hipY, 0]);
  add_('Spine', 'Hips', [0, d.hipY + 0.2 * tl, 0]);
  add_('Chest', 'Spine', [0, d.hipY + 0.45 * tl, 0]);
  add_('UpperChest', 'Chest', [0, d.hipY + 0.7 * tl, 0]);
  add_('Neck', 'UpperChest', [0, d.neckBaseY - 0.02 * tl, -0.1 * d.chestHD]);
  add_('Head', 'Neck', [0, d.chinY + 0.12 * d.headH, -0.15 * d.headHD]);
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'Left' : 'Right';
    const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
    const sh: V3 = [s * d.shoulderX, d.shoulderY, 0];
    const el = add(sh, scale(dir, d.upperArmLen));
    const wr = add(el, scale(dir, d.foreArmLen));
    add_(`${side}Shoulder` as BoneName, 'UpperChest', [s * Math.min(0.03 * d.u, d.shoulderX * 0.3), d.shoulderY + 0.02 * tl, 0]);
    add_(`${side}UpperArm` as BoneName, `${side}Shoulder` as BoneName, sh);
    add_(`${side}LowerArm` as BoneName, `${side}UpperArm` as BoneName, el);
    add_(`${side}Hand` as BoneName, `${side}LowerArm` as BoneName, wr);
    add_(`${side}ThumbProximal` as BoneName, `${side}Hand` as BoneName, add(add(wr, scale(dir, d.handLen * 0.2)), [0, 0, d.handHW * 0.75]));
  }
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'Left' : 'Right';
    const x = s * d.hipJX;
    add_(`${side}UpperLeg` as BoneName, 'Hips', [x, d.hipY, 0]);
    add_(`${side}LowerLeg` as BoneName, `${side}UpperLeg` as BoneName, [x, d.kneeY, 0]);
    add_(`${side}Foot` as BoneName, `${side}LowerLeg` as BoneName, [x, d.ankleY, 0]);
    add_(`${side}Toes` as BoneName, `${side}Foot` as BoneName, [x, d.ankleY * 0.35, d.footLen * 0.52]);
  }

  const sockets: Socket[] = [
    { name: 'Socket_HeadTop', bone: 'Head', world: [0, d.H, 0] },
    { name: 'Socket_Back', bone: 'UpperChest', world: [0, d.hipY + 0.62 * tl, -d.chestHD * 1.05] },
  ];
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'Left' : 'Right';
    const wr = bones[index[`${side}Hand`]].world;
    const dir: V3 = [d.armDir[0] * s, d.armDir[1], 0];
    sockets.push({ name: `Socket_${side}Hand`, bone: `${side}Hand`, world: add(wr, scale(dir, d.handLen * 0.5)) });
    sockets.push({ name: `Socket_${side}Hip`, bone: 'Hips', world: [s * d.hipHW * 1.05, d.hipY + 0.05 * tl, 0] });
  }
  return { bones, sockets, dims: d, index };
}

function mutantArms(rc: CharacterRecipe, mutant: boolean) {
  if (!mutant) return { armL: 1, armR: 1 };
  const r = new Rng(subSeed(rc.seed, 'mutant.arm'));
  const big = 1.45 + r.next() * 0.45;
  return r.chance(0.5) ? { armL: big, armR: 0.92 } : { armL: 0.92, armR: big };
}
