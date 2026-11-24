import { describe, expect, it } from 'vitest';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { worldPose } from '../src/core/anim';
import { qRotate, V3 } from '../src/core/math';

/** palm centre: a little past the wrist along the hand */
function palm(ch: ReturnType<typeof generateCharacter>, wp: ReturnType<typeof worldPose>, side: 'Left' | 'Right'): V3 {
  const sk = ch.skeleton;
  const i = sk.index[`${side}Hand`];
  const s = side === 'Left' ? 1 : -1;
  const d = sk.dims;
  const off = qRotate(wp.rot[i], [d.armDir[0] * s * d.handLen * 0.4, d.armDir[1] * d.handLen * 0.4, 0]);
  return [wp.pos[i][0] + off[0], wp.pos[i][1] + off[1], wp.pos[i][2] + off[2]];
}

describe('crawling, carrying, doors', () => {
  for (const style of ['realistic', 'chibi', 'blocky', 'stylized'] as StyleId[]) {
    const ch = generateCharacter(randomRecipe(8, style, 'athlete', 'human'));
    const sk = ch.skeleton;
    const H = sk.dims.H;
    const clip = (n: string) => ch.clips.find((c) => c.name === n)!;
    const each = (n: string, f: (wp: ReturnType<typeof worldPose>) => void) => {
      const c = clip(n);
      for (let i = 0; i < 12; i++) f(worldPose(sk, c.sample((i / 12) * c.duration)));
    };

    it(`${style}: Crawl puts hands and knees on the floor`, () => {
      each('Crawl', (wp) => {
        for (const s of ['Left', 'Right'] as const) {
          expect(palm(ch, wp, s)[1]).toBeLessThan(0.06 * H);
          expect(palm(ch, wp, s)[1]).toBeGreaterThan(-0.01 * H);
          expect(wp.pos[sk.index[`${s}LowerLeg`]][1]).toBeLessThan(0.07 * H);
        }
        // the body is up off the floor, not lying in it
        expect(wp.pos[sk.index.Hips][1]).toBeGreaterThan(0.15 * H);
      });
    });

    it(`${style}: CrawlProne stays flat (hips, shoulders and feet near the floor)`, () => {
      each('CrawlProne', (wp) => {
        expect(wp.pos[sk.index.Hips][1]).toBeLessThan(0.1 * H);
        expect(wp.pos[sk.index.UpperChest][1]).toBeLessThan(0.14 * H);
        for (const s of ['Left', 'Right']) expect(wp.pos[sk.index[`${s}Foot`]][1]).toBeLessThan(0.08 * H);
      });
    });

    it(`${style}: CarryBox holds a box with both hands, level and in front`, () => {
      each('CarryBoxWalk', (wp) => {
        const l = palm(ch, wp, 'Left');
        const r = palm(ch, wp, 'Right');
        expect(Math.abs(l[1] - r[1])).toBeLessThan(0.03 * H);
        expect(l[0] - r[0]).toBeGreaterThan(0.15 * sk.dims.u);
        expect(Math.min(l[2], r[2])).toBeGreaterThan(wp.pos[sk.index.UpperChest][2] + 0.05 * sk.dims.u);
      });
    });

    it(`${style}: OpenDoor reaches the handle and CloseDoor is its mirror in time`, () => {
      const o = clip('OpenDoor');
      const c = clip('CloseDoor');
      expect(o.loop).toBe(false);
      // at the moment of pressing the handle the hand is at handle height, out in front
      const wp = worldPose(sk, o.sample(0.6));
      const p = palm(ch, wp, 'Right');
      expect(Math.abs(p[1] - 0.56 * H)).toBeLessThan(0.05 * H);
      expect(p[2]).toBeGreaterThan(0.3 * sk.dims.u);
      const a = worldPose(sk, c.sample(c.duration - 0.6));
      expect(Math.hypot(...[0, 1, 2].map((k) => a.pos[sk.index.RightHand][k] - wp.pos[sk.index.RightHand][k]))).toBeLessThan(1e-6);
    });
  }
});
