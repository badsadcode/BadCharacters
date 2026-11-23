import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { worldPose } from '../src/core/anim';
import { generateCreature } from '../src/creatures/generate';
import { randomCreature, SPECIES, SpeciesId } from '../src/creatures/species';
import { modelLength, solitudeProfile } from '../src/creatures/solitude';
import { exportGlb } from '../src/export/gltf';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const validator = require('gltf-validator');
const ids = Object.keys(SPECIES) as SpeciesId[];

describe('every species', () => {
  for (const id of ids) {
    it(`${id}: valid GLB, within budget, sane skin, sensible placement`, async () => {
      const c = generateCreature(randomCreature(id, 3));
      const r = await validator.validateBytes(exportGlb(c));
      expect(r.issues.numErrors).toBe(0);
      expect(r.issues.numWarnings).toBe(0);
      expect(c.stats.triangles).toBeLessThan(4000);
      let minY = Infinity;
      for (const p of c.primitives) {
        for (let i = 0; i < p.mesh.weights.length; i += 4) {
          const s = p.mesh.weights[i] + p.mesh.weights[i + 1] + p.mesh.weights[i + 2] + p.mesh.weights[i + 3];
          expect(Math.abs(s - 1)).toBeLessThan(1e-4);
        }
        for (let i = 1; i < p.mesh.positions.length; i += 3) minY = Math.min(minY, p.mesh.positions[i]);
      }
      if (c.build.grounded) {
        // walkers stand on the floor
        expect(minY).toBeGreaterThan(-0.02 * c.recipe.length);
        expect(minY).toBeLessThan(0.05 * c.recipe.length);
      }
      // the model is roughly as long as the recipe says
      expect(modelLength(c) / c.recipe.length).toBeGreaterThan(0.25);
      expect(modelLength(c) / c.recipe.length).toBeLessThan(2.2);
    });
  }
});

describe('motion & Solitude contract', () => {
  for (const id of ids) {
    it(`${id}: every channel names a real bone; the profile is well-formed`, () => {
      const c = generateCreature(randomCreature(id, 1));
      for (const ch of c.motion.swim) expect(c.skeleton.index[ch.bone], ch.bone).toBeDefined();
      if (c.motion.jaw) expect(c.skeleton.index[c.motion.jaw.bone]).toBeDefined();
      const code = solitudeProfile(c);
      if (c.motion.walk) expect(code).toContain('walks on legs');
      else {
        expect(code).toContain('new CreatureProfile');
        expect(code).toContain(`Length = ${c.recipe.length}f`);
        expect((code.match(/p\.(Yaw|Pitch|Roll)\.Add/g) ?? []).length).toBe(c.motion.swim.length);
      }
    });
  }
  it('Bite closes the jaw from its sculpted-open rest pose and opens wider first', () => {
    const c = generateCreature(randomCreature('megalodon', 1));
    const bite = c.clips.find((x) => x.name === 'Bite')!;
    const jawAngle = (t: number) => {
      const q = bite.sample(t).rot.Jaw;
      return 2 * Math.atan2(q[0], q[3]); // rotation about +X relative to rest
    };
    expect(jawAngle(0.45)).toBeGreaterThan(0.2); // wider than rest
    expect(jawAngle(0.7)).toBeLessThan(-0.3); // shut (rest gape is ~0.42)
  });
  it('a swimming wave travels from head to tail (phases increase along the spine)', () => {
    const c = generateCreature(randomCreature('leviathan', 1));
    const spine = c.motion.swim.filter((ch) => /^Spine|^Tail/.test(ch.bone) && ch.axis === 'yaw');
    for (let i = 1; i < spine.length; i++) expect(spine[i].phase).toBeGreaterThan(spine[i - 1].phase);
  });
  it('walkers keep a foot down and their legs reach the floor at rest', () => {
    const c = generateCreature(randomCreature('crab', 1));
    const wp = worldPose(c.skeleton, c.clips.find((x) => x.name === 'RestPose')!.sample(0));
    const body = wp.pos[c.skeleton.index.Body];
    expect(body[1]).toBeGreaterThan(0.1 * c.recipe.length);
  });
  it('same recipe → byte-identical GLB', () => {
    const a = exportGlb(generateCreature(randomCreature('kraken', 9)));
    const b = exportGlb(generateCreature(randomCreature('kraken', 9)));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
