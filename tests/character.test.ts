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
    expect(clips.map((c) => c.name)).toEqual(['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Punch', 'RestPose']);
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
    const ask = buildSkeleton(alden);
    const staff = buildParts(alden, ask).parts.find((p) => p.name === 'prop.staff')!;
    const wp = worldPose(ask, buildClips(ask)[0].sample(0));
    const q = wp.rot[ask.index.RightHand];
    const dir = qRotate(q, sub(staff.rings[staff.rings.length - 1].c, staff.rings[0].c));
    const l = Math.hypot(...dir);
    expect(Math.abs(dir[1]) / l).toBeGreaterThan(0.98);
  });
});
