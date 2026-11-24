import { describe, expect, it } from 'vitest';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { worldPose } from '../src/core/anim';
import { handToolFrame } from '../src/core/hold';
import { qMul, qRotate, V3 } from '../src/core/math';

type WP = ReturnType<typeof worldPose>;
const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('fighting, tools and fishing', () => {
  for (const style of ['realistic', 'chibi', 'blocky', 'voxelslim'] as StyleId[]) {
    const ch = generateCharacter(randomRecipe(8, style, 'athlete', 'human'));
    const sk = ch.skeleton;
    const H = sk.dims.H;
    const clip = (n: string) => ch.clips.find((c) => c.name === n)!;
    /** palm position and tool axis (thumb) of a hand, from the exported tool socket frame */
    const tool = (wp: WP, side: 1 | -1) => {
      const f = handToolFrame(sk, side);
      const i = sk.index[side > 0 ? 'LeftHand' : 'RightHand'];
      return { palm: addV(wp.pos[i], qRotate(wp.rot[i], f.offset)), axis: qRotate(qMul(wp.rot[i], f.rot), [0, 0, 1]) };
    };

    it(`${style}: punches land straight ahead on the centre line, low < mid < high`, () => {
      for (const S of ['Left', 'Right']) {
        const ys = ['Low', 'Mid', 'High'].map((lv) => {
          const wp = worldPose(sk, clip(`Punch${S}${lv}`).sample(0.3));
          const p = tool(wp, S === 'Left' ? 1 : -1).palm;
          expect(Math.abs(p[0]), `${S}${lv} x`).toBeLessThan(0.06 * H);
          expect(p[2], `${S}${lv} reach`).toBeGreaterThan(0.18 * H);
          return p[1];
        });
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
      }
    });

    it(`${style}: kicks rise with the level and the standing foot stays down`, () => {
      for (const S of ['Left', 'Right'] as const) {
        const O = S === 'Left' ? 'Right' : 'Left';
        const ys = ['Low', 'Mid', 'High'].map((lv) => {
          const wp = worldPose(sk, clip(`Kick${S}${lv}`).sample(0.45));
          expect(wp.pos[sk.index[`${O}Foot`]][1]).toBeLessThan(0.08 * H);
          return wp.pos[sk.index[`${S}Foot`]][1];
        });
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
        // a high kick reaches well above the knee of the standing leg (chibis have short legs)
        expect(ys[2]).toBeGreaterThan(sk.dims.hipY * 0.6);
      }
    });

    it(`${style}: two-handed tools have both hands on the same shaft`, () => {
      for (const n of ['StaffThrust', 'StaffSwing', 'StaffOverhead', 'AxeChop', 'ShovelDig', 'FishCast']) {
        const c = clip(n);
        for (let i = 0; i < 10; i++) {
          const wp = worldPose(sk, c.sample((i / 10) * c.duration));
          const r = tool(wp, -1);
          const l = tool(wp, 1).palm;
          // distance from the left palm to the line through the right palm along the right thumb
          const v = subV(l, r.palm);
          const along = v[0] * r.axis[0] + v[1] * r.axis[1] + v[2] * r.axis[2];
          const off = Math.hypot(v[0] - r.axis[0] * along, v[1] - r.axis[1] * along, v[2] - r.axis[2] * along);
          expect(off, `${n} @${i}`).toBeLessThan(0.05 * H);
        }
      }
    });
  }
});
