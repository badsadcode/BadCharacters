import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildClips, worldPose } from '../src/core/anim';
import { buildParts, generateCharacter } from '../src/core/character';
import { emptyMesh, loftPart } from '../src/core/loft';
import { qRotate, sub } from '../src/core/math';
import { PRESETS } from '../src/core/presets';
import { randomRecipe, StyleId, STYLES, THEMES } from '../src/core/recipe';
import { buildSkeleton } from '../src/core/skeleton';
import { exportGlb } from '../src/export/gltf';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const validator = require('gltf-validator');

const styles = Object.keys(STYLES) as StyleId[];
const themes = Object.keys(THEMES);

describe('every style × every theme', () => {
  for (const style of styles) {
    for (const [ti, theme] of themes.entries()) {
      it(`${style} / ${theme}: valid glTF, sane skin, feet on the floor`, async () => {
        const rc = randomRecipe(500 + ti, style, theme);
        if (ti % 3 === 0) rc.mesh.shading = 'flat';
        if (ti % 4 === 1) rc.rig.restPose = 'A';
        const ch = generateCharacter(rc);
        const glb = exportGlb(ch);
        const report = await validator.validateBytes(glb);
        const errors = report.issues.messages.filter((m: { severity: number }) => m.severity === 0);
        expect(errors, JSON.stringify(errors.slice(0, 3))).toHaveLength(0);
        expect(report.issues.numWarnings).toBe(0);

        let minY = Infinity;
        for (const p of ch.primitives) {
          const m = p.mesh;
          for (let i = 0; i < m.weights.length; i += 4) {
            const s = m.weights[i] + m.weights[i + 1] + m.weights[i + 2] + m.weights[i + 3];
            expect(Math.abs(s - 1)).toBeLessThan(1e-4);
          }
          for (const j of m.joints) expect(j).toBeLessThan(ch.skeleton.bones.length);
          for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
        }
        expect(minY).toBeGreaterThan(-0.001); // nothing below the floor
        expect(minY).toBeLessThan(0.02); // …and nobody hovers
        // polygon budget (medium detail, any outfit)
        expect(ch.stats.triangles).toBeLessThan(rc.mesh.detail === 'medium' ? 5000 : 8000);
      });
    }
  }
});

describe('polygon budget', () => {
  const tris = (rc: ReturnType<typeof randomRecipe>) => generateCharacter(rc).stats.triangles;
  it('the bald base body is under 2,600 triangles at medium detail in every style', () => {
    for (const style of styles) expect(tris(randomRecipe(1, style, 'base')), style).toBeLessThan(2600);
  });
  it('low detail stays under 3,000 triangles even in full plate', () => {
    for (const style of styles) {
      const rc = randomRecipe(3, style, 'knight');
      rc.mesh.detail = 'low';
      expect(tris(rc), style).toBeLessThan(3000);
    }
  });
  it('Alden is under 3,000 triangles', () => {
    expect(tris(PRESETS.find((p) => p.id === 'alden')!.recipe())).toBeLessThan(3000);
  });
  it('culling removes body hidden under clothes but never a visible bald head', () => {
    const rc = randomRecipe(8, 'realistic', 'soldier');
    rc.outfit.hands = { id: 'gloves', color: '#333333', color2: '#222222' };
    const names = buildParts(rc, buildSkeleton(rc)).parts.map((p) => p.name);
    expect(names).not.toContain('foot'); // inside boots
    expect(names).not.toContain('hand'); // inside gloves
    expect(names.some((n) => n.startsWith('head'))).toBe(true);
  });
});

describe('determinism', () => {
  it('same recipe → byte-identical GLB', () => {
    const a = exportGlb(generateCharacter(randomRecipe(77, 'stylized', 'pirate')));
    const b = exportGlb(generateCharacter(randomRecipe(77, 'stylized', 'pirate')));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it('re-rolling the outfit never changes the body', () => {
    const a = randomRecipe(9, 'realistic', 'casual');
    const b = randomRecipe(9, 'realistic', 'soldier');
    expect(b.body.height).toBe(a.body.height);
    expect(b.body.gender).toBe(a.body.gender);
  });
});

describe('body', () => {
  it('head reaches the requested height', () => {
    for (const style of styles) {
      const rc = randomRecipe(3, style, 'base');
      const ch = generateCharacter(rc);
      const face = ch.primitives.find((p) => p.material === 'face')!.mesh;
      let maxY = 0;
      for (let i = 1; i < face.positions.length; i += 3) maxY = Math.max(maxY, face.positions[i]);
      expect(Math.abs(maxY - rc.body.height) / rc.body.height).toBeLessThan(0.01);
    }
  });
  it('every closed body part faces outward (positive volume)', () => {
    const rc = randomRecipe(5, 'realistic', 'base');
    const sk = buildSkeleton(rc);
    for (const part of buildParts(rc, sk).parts) {
      if (!part.capStart || !part.capEnd) continue;
      const m = emptyMesh();
      loftPart(part, 12, m);
      let vol = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => m.indices[t + k] * 3);
        const P = (i: number) => [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
        const [p, q, r] = [P(a), P(b), P(c)];
        vol += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
      }
      expect(vol, part.name).toBeGreaterThan(0);
    }
  });
  it('fat and muscle sliders are exported as morph targets', () => {
    const rc = randomRecipe(11, 'realistic', 'casual');
    rc.body.fat = 0.4;
    rc.body.muscle = 0.4;
    expect(generateCharacter(rc).morphs.map((m) => m.name)).toEqual(['Fat+', 'Fat-', 'Muscle+', 'Muscle-']);
  });
});

describe('animation', () => {
  const rc = randomRecipe(26, 'realistic', 'athlete');
  const sk = buildSkeleton(rc);
  const clips = buildClips(sk);
  const clip = (n: string) => clips.find((c) => c.name === n)!;

  it('ships the standard clip set', () => {
    expect(clips.map((c) => c.name)).toEqual([
      'Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Punch', 'Crouch', 'CrouchWalk', 'ClimbUp', 'ClimbDown', 'ClimbLeft', 'ClimbRight',
      'LadderUp', 'LadderDown', 'Swim', 'Craft', 'BowShoot', 'CrossbowShoot', 'RestPose',
    ]);
  });
  it('a punch goes forward, not sideways', () => {
    const wp = worldPose(sk, clip('Punch').sample(0.35));
    const hand = wp.pos[sk.index.RightHand];
    const shoulder = wp.pos[sk.index.RightUpperArm];
    expect(hand[2] - shoulder[2]).toBeGreaterThan(0.6 * (sk.dims.upperArmLen + sk.dims.foreArmLen));
  });
  it('walking swings the legs in opposite directions', () => {
    const wp = worldPose(sk, clip('Walk').sample(clip('Walk').duration / 4));
    const l = wp.pos[sk.index.LeftFoot][2];
    const r = wp.pos[sk.index.RightFoot][2];
    expect(Math.sign(l)).not.toBe(Math.sign(r));
    expect(Math.abs(l - r)).toBeGreaterThan(0.2 * sk.dims.hipY);
  });
  it('knees bend backwards (feet go behind the knee, not in front)', () => {
    const wp = worldPose(sk, clip('Run').sample(0));
    for (const s of ['Left', 'Right']) {
      const knee = wp.pos[sk.index[`${s}LowerLeg`]];
      const ankle = wp.pos[sk.index[`${s}Foot`]];
      const hip = wp.pos[sk.index[`${s}UpperLeg`]];
      // in the side (YZ) plane, a backward knee bend makes thigh × shin negative
      const thigh = sub(knee, hip);
      const shin = sub(ankle, knee);
      expect(thigh[2] * shin[1] - thigh[1] * shin[2]).toBeLessThanOrEqual(1e-6);
    }
  });
  it("Alden's staff stands upright in Idle", () => {
    const alden = PRESETS.find((p) => p.id === 'alden')!.recipe();
    alden.mesh.exportProps = true;
    const ask = buildSkeleton(alden);
    const staff = buildParts(alden, ask).parts.find((p) => p.name === 'prop.staff')!;
    const wp = worldPose(ask, buildClips(ask)[0].sample(0));
    const q = wp.rot[ask.index.RightHand];
    const dir = qRotate(q, sub(staff.rings[staff.rings.length - 1].c, staff.rings[0].c));
    const l = Math.hypot(...dir);
    expect(Math.abs(dir[1]) / l).toBeGreaterThan(0.98);
  });
});

describe('new animation set', () => {
  const rc = randomRecipe(14, 'stylized', 'peasant');
  const sk = buildSkeleton(rc);
  const clips = buildClips(sk);
  const clip = (n: string) => clips.find((c) => c.name === n)!;

  it('Crouch keeps both feet planted on the floor (no hovering, no sinking)', () => {
    for (const t of [0, 0.6, 1.3, 2]) {
      const wp = worldPose(sk, clip('Crouch').sample(t));
      for (const s of ['Left', 'Right']) {
        const y = wp.pos[sk.index[`${s}Foot`]][1];
        expect(Math.abs(y - sk.dims.ankleY), `${s} ankle at t=${t}`).toBeLessThan(0.05 * sk.dims.hipY);
      }
    }
  });
  it('CrouchWalk: one foot is always on the ground', () => {
    const c = clip('CrouchWalk');
    for (let i = 0; i < 12; i++) {
      const wp = worldPose(sk, c.sample((i / 12) * c.duration));
      const low = Math.min(wp.pos[sk.index.LeftFoot][1], wp.pos[sk.index.RightFoot][1]);
      expect(Math.abs(low - sk.dims.ankleY)).toBeLessThan(0.03 * sk.dims.hipY);
    }
  });
  it('ClimbDown is ClimbUp played backwards (and so is LadderDown)', () => {
    for (const [up, down] of [['ClimbUp', 'ClimbDown'], ['LadderUp', 'LadderDown']]) {
      const T = clip(up).duration;
      for (const t of [0.1, 0.5, 0.9]) expect(clip(down).sample(t * T).rot).toEqual(clip(up).sample(T - t * T).rot);
    }
  });
  it('Swim: the body is horizontal', () => {
    const wp = worldPose(sk, clip('Swim').sample(0.4));
    const hips = wp.pos[sk.index.Hips];
    const head = wp.pos[sk.index.Head];
    expect(Math.abs(head[1] - hips[1])).toBeLessThan(0.35 * Math.abs(head[2] - hips[2]));
  });
  it('the bow string follows the drawing hand at full draw', () => {
    const brc = { ...rc, mesh: { ...rc.mesh, exportProps: true }, outfit: { ...rc.outfit, prop: { id: 'bow', color: '#6e4a2a', color2: '#ffffff' } } };
    const ch = generateCharacter(brc);
    const bsk = ch.skeleton;
    expect(bsk.index.BowString).toBeDefined();
    const pose = ch.clips.find((c) => c.name === 'BowShoot')!.sample(1.4);
    const wp = worldPose(bsk, pose);
    const s = wp.pos[bsk.index.BowString];
    const rh = wp.pos[bsk.index.RightHand];
    expect(Math.hypot(s[0] - rh[0], s[1] - rh[1], s[2] - rh[2])).toBeLessThan(bsk.dims.handLen);
    // …and the GLB with the extra bone still validates
    return validator.validateBytes(exportGlb(ch)).then((r: { issues: { numErrors: number; numWarnings: number } }) => {
      expect(r.issues.numErrors).toBe(0);
      expect(r.issues.numWarnings).toBe(0);
    });
  });
});

describe('races', () => {
  const races = ['human', 'orc', 'elf', 'dwarf', 'hobbit', 'goblin', 'gremlin'] as const;
  for (const race of races) {
    for (const style of ['faceted', 'blocky', 'chibi', 'heroic'] as StyleId[]) {
      it(`${race} / ${style}: valid, on the floor, within budget, height as rolled`, async () => {
        const rc = randomRecipe(77, style, 'peasant', race);
        // bare head, so the scalp isn't culled under a hat and the height check is meaningful
        rc.outfit.head = { id: 'none', color: '#000000', color2: '#000000' };
        const ch = generateCharacter(rc);
        const report = await validator.validateBytes(exportGlb(ch));
        expect(report.issues.numErrors).toBe(0);
        expect(report.issues.numWarnings).toBe(0);
        let minY = Infinity;
        for (const p of ch.primitives) for (let i = 1; i < p.mesh.positions.length; i += 3) minY = Math.min(minY, p.mesh.positions[i]);
        expect(minY).toBeGreaterThan(-0.001);
        expect(minY).toBeLessThan(0.02);
        expect(ch.stats.triangles).toBeLessThan(5000);
        const face = ch.primitives.find((p) => p.material === 'face')!.mesh;
        let maxY = 0;
        for (let i = 1; i < face.positions.length; i += 3) maxY = Math.max(maxY, face.positions[i]);
        expect(Math.abs(maxY - rc.body.height) / rc.body.height).toBeLessThan(0.01);
      });
    }
  }
  it('orcs are taller than humans are taller than dwarves are taller than gremlins', () => {
    const h = (r: (typeof races)[number]) => randomRecipe(5, 'faceted', 'base', r).body.height;
    expect(h('orc')).toBeGreaterThan(h('human'));
    expect(h('human')).toBeGreaterThan(h('dwarf'));
    expect(h('dwarf')).toBeGreaterThan(h('gremlin'));
  });
  it('every proportion slider at both extremes still builds a valid character', async () => {
    for (const v of [-1, 1]) {
      const rc = randomRecipe(3, 'stylized', 'casual');
      rc.body.shape = Object.fromEntries(['shoulders', 'chest', 'waist', 'hips', 'belly', 'armLength', 'armThickness', 'legThickness', 'neckLength', 'neckThickness', 'headWidth', 'headDepth', 'jaw', 'handSize', 'footSize', 'earSize', 'noseSize', 'eyeSize', 'eyeSpacing', 'mouthWidth', 'posture'].map((k) => [k, v]));
      const report = await validator.validateBytes(exportGlb(generateCharacter(rc)));
      expect(report.issues.numErrors).toBe(0);
    }
  });
});

describe('props export toggle', () => {
  it('weapons are NOT exported by default, but their animations are', () => {
    const rc = randomRecipe(10, 'stylized', 'peasant');
    rc.outfit.prop = { id: 'bow', color: '#6e4a2a', color2: '#ffffff' };
    const ch = generateCharacter(rc);
    expect(ch.primitives.some((p) => p.material.startsWith('prop'))).toBe(false);
    expect(ch.skeleton.index.BowString).toBeUndefined();
    expect(ch.clips.map((c) => c.name)).toContain('BowShoot');
    rc.mesh.exportProps = true;
    expect(generateCharacter(rc).primitives.some((p) => p.material.startsWith('prop'))).toBe(true);
  });
});

describe('fabric patterns', () => {
  it('every pattern exports a valid textured GLB', async () => {
    const pats = ['woodland', 'desert', 'tiger', 'erdl', 'flecktarn', 'digital', 'urban', 'splinter', 'snow', 'plaid', 'stripes', 'grime'] as const;
    const rc = randomRecipe(4, 'stylized', 'soldier');
    pats.forEach((p, i) => {
      const slot = (['top', 'bottom', 'armor', 'head', 'back', 'hands'] as const)[i % 6];
      rc.outfit[slot] = { ...rc.outfit[slot], pattern: p };
    });
    const ch = generateCharacter(rc);
    const r = await validator.validateBytes(exportGlb(ch));
    expect(r.issues.numErrors).toBe(0);
    expect(r.issues.numWarnings).toBe(0);
  });
});
