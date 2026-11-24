import { describe, expect, it } from 'vitest';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { worldPose } from '../src/core/anim';
import { clipCategory } from '../src/core/categories';
import { V3 } from '../src/core/math';

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('river work', () => {
  for (const style of ['realistic', 'chibi', 'blocky', 'brick'] as StyleId[]) {
    const ch = generateCharacter(randomRecipe(11, style, 'athlete', 'human'));
    const sk = ch.skeleton;
    const H = sk.dims.H;
    const clip = (n: string) => ch.clips.find((c) => c.name === n)!;

    it(`${style}: all river clips sample to finite poses`, () => {
      for (const n of ['SweepOar', 'SweepOarHold', 'PoleRaft', 'DropAnchor', 'RaiseAnchor', 'ClimbOutOfWater', 'CarryLantern', 'CarryLanternWalk']) {
        const c = clip(n);
        for (let i = 0; i <= 12; i++) {
          const wp = worldPose(sk, c.sample((i / 12) * c.duration));
          for (const p of wp.pos) for (const v of p) expect(Number.isFinite(v), n).toBe(true);
        }
      }
    });

    it(`${style}: the oar hands stay on the handle and the oar swings`, () => {
      const c = clip('SweepOar');
      const xs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const wp = worldPose(sk, c.sample((i / 12) * c.duration));
        const l = wp.pos[sk.index.LeftHand];
        const r = wp.pos[sk.index.RightHand];
        // both hands up in front of the body, near each other on the shaft
        expect(l[2]).toBeGreaterThan(0);
        expect(r[2]).toBeGreaterThan(0);
        expect(dist(l, r)).toBeLessThan(0.4 * H);
        xs.push(r[0]);
      }
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.1 * H);
    });

    it(`${style}: climbing out ends standing on the deck, and no foot passes through it`, () => {
      const c = clip('ClimbOutOfWater');
      const deck = c.info!.deckAbove as number;
      const edge = c.info!.edgeAhead as number;
      const rest = worldPose(sk, clip('RestPose').sample(0));
      for (let i = 0; i <= 20; i++) {
        const wp = worldPose(sk, c.sample((i / 20) * c.duration));
        for (const s of ['Left', 'Right']) {
          for (const b of [`${s}Foot`, `${s}LowerLeg`]) {
            const p = wp.pos[sk.index[b]];
            // over the deck (beyond the edge) nothing goes below its top
            if (p[2] > edge + 0.05 * H) expect(p[1], `${b} @${i}`).toBeGreaterThan(deck - 0.03 * H);
          }
        }
      }
      const end = worldPose(sk, c.sample(c.duration));
      const t = c.travel as V3;
      for (const s of ['Left', 'Right']) {
        const f = end.pos[sk.index[`${s}Foot`]];
        const r = rest.pos[sk.index[`${s}Foot`]];
        expect(Math.abs(f[1] - (r[1] + deck))).toBeLessThan(0.03 * H);
        expect(Math.abs(f[2] - (r[2] + t[2]))).toBeLessThan(0.04 * H);
      }
      expect(t[1]).toBeCloseTo(deck);
    });

    it(`${style}: the lantern is held up in front`, () => {
      for (const n of ['CarryLantern', 'CarryLanternWalk']) {
        const c = clip(n);
        const wp = worldPose(sk, c.sample(c.duration * 0.4));
        const h = wp.pos[sk.index.LeftHand];
        const sh = wp.pos[sk.index.LeftUpperArm];
        expect(h[2] - sh[2], n).toBeGreaterThan(0.12 * H);
        expect(h[1], n).toBeGreaterThan(sh[1] - 0.15 * H);
      }
    });
  }

  it('categories and layers', () => {
    expect(clipCategory('SweepOar')).toBe('boat');
    expect(clipCategory('RaiseAnchor')).toBe('boat');
    expect(clipCategory('ClimbOutOfWater')).toBe('traverse');
    expect(clipCategory('CarryLantern')).toBe('carry');
    const ch = generateCharacter({ ...randomRecipe(3, 'realistic', 'athlete', 'human'), mesh: { ...randomRecipe(3, 'realistic', 'athlete', 'human').mesh, upperLayers: true } });
    expect(ch.clips.some((c) => c.name === 'Upper_CarryLantern')).toBe(true);
  });
});
