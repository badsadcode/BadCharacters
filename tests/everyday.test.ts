import { describe, expect, it } from 'vitest';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { worldPose } from '../src/core/anim';
import { handToolFrame } from '../src/core/hold';
import { qRotate, V3 } from '../src/core/math';
import { exportGlb } from '../src/export/gltf';
import { parseGlb } from '../src/rigger/glb';

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('everyday life', () => {
  for (const style of ['realistic', 'chibi', 'blocky', 'stylized'] as StyleId[]) {
    const ch = generateCharacter(randomRecipe(8, style, 'athlete', 'human'));
    const sk = ch.skeleton;
    const H = sk.dims.H;
    const clip = (n: string) => ch.clips.find((c) => c.name === n)!;
    const palm = (wp: ReturnType<typeof worldPose>, side: 1 | -1): V3 => {
      const i = sk.index[side > 0 ? 'LeftHand' : 'RightHand'];
      const o = qRotate(wp.rot[i], handToolFrame(sk, side).offset);
      return [wp.pos[i][0] + o[0], wp.pos[i][1] + o[1], wp.pos[i][2] + o[2]];
    };
    const restFeet = worldPose(sk, clip('RestPose').sample(0));

    it(`${style}: SitDown keeps the feet planted and lands on the documented seat`, () => {
      const c = clip('SitDown');
      for (let i = 0; i <= 10; i++) {
        const wp = worldPose(sk, c.sample((i / 10) * c.duration));
        for (const s of ['Left', 'Right']) {
          const f = wp.pos[sk.index[`${s}Foot`]];
          const r = restFeet.pos[sk.index[`${s}Foot`]];
          expect(Math.abs(f[1] - r[1]), `y @${i}`).toBeLessThan(0.03 * H);
          expect(Math.abs(f[2] - r[2]), `z @${i}`).toBeLessThan(0.04 * H);
        }
      }
      const end = worldPose(sk, c.sample(c.duration));
      const hips = end.pos[sk.index.Hips];
      expect(Math.abs(hips[1] - 0.6 * sk.dims.hipHD - (c.info!.seatHeight as number))).toBeLessThan(0.01 * H);
      expect(Math.abs(hips[2] - (c.info!.seatCentreZ as number))).toBeLessThan(0.01 * H);
      // StandUp ends where SitDown started
      const su = worldPose(sk, clip('StandUp').sample(clip('StandUp').duration));
      expect(Math.abs(su.pos[sk.index.Head][1] - worldPose(sk, c.sample(0)).pos[sk.index.Head][1])).toBeLessThan(1e-6);
    });

    it(`${style}: food and drink reach the mouth`, () => {
      for (const [n, t] of [['SitEat', 1.35], ['SitDrink', 1.5], ['Eat', 1.6], ['Drink', 1.6]] as [string, number][]) {
        const wp = worldPose(sk, clip(n).sample(t));
        const head = wp.pos[sk.index.Head];
        const p = palm(wp, -1);
        // the hand is up by the face, in front of it (big-headed styles have the mouth further out)
        expect(Math.hypot(p[0] - head[0], p[1] - head[1], p[2] - head[2]), n).toBeLessThan(0.07 * H + 0.8 * sk.dims.headH);
        expect(p[2] - head[2], n).toBeGreaterThan(0);
      }
    });

    it(`${style}: cross-legged on the floor, and sleeping flat on the back`, () => {
      const g = worldPose(sk, clip('SitGround').sample(1));
      const kneeGap = g.pos[sk.index.LeftLowerLeg][0] - g.pos[sk.index.RightLowerLeg][0];
      expect(kneeGap).toBeGreaterThan(0.25 * H);
      for (const s of ['Left', 'Right']) {
        expect(g.pos[sk.index[`${s}LowerLeg`]][1]).toBeLessThan(0.08 * H);
        expect(g.pos[sk.index[`${s}Foot`]][1]).toBeGreaterThan(-0.02 * H);
      }
      const z = worldPose(sk, clip('Sleep').sample(1));
      for (const b of ['Hips', 'UpperChest', 'Head', 'LeftFoot', 'RightFoot']) expect(z.pos[sk.index[b]][1], b).toBeLessThan(0.15 * H);
    });
  }

  it('clip props (seat height, table height, door, wheel) are exported in the animation extras', () => {
    const g = parseGlb(exportGlb(generateCharacter(randomRecipe(3, 'realistic', 'casual', 'human'))));
    const a = (n: string) => g.json.animations.find((x: any) => x.name === n);
    expect(a('SitIdle').extras.props.seatHeight).toBeGreaterThan(0.2);
    expect(a('SitEat').extras.props.tableHeight).toBeGreaterThan(a('SitEat').extras.props.seatHeight);
    expect(a('OpenDoor').extras.props.handleHeight).toBeGreaterThan(0.5);
    expect(a('DriveCar').extras.props.wheelRadius).toBeGreaterThan(0.1);
  });
});

describe('death animations', () => {
  for (const style of ['realistic', 'chibi', 'blocky'] as StyleId[]) {
    const ch = generateCharacter(randomRecipe(8, style, 'athlete', 'human'));
    const sk = ch.skeleton;
    const H = sk.dims.H;
    for (const n of ['DeathForward', 'DeathBackward', 'DeathLeft', 'DeathRight', 'DeathCrumple', 'DeathHeadshot']) {
      it(`${style}: ${n} starts standing, ends lying flat, never through the floor`, () => {
        const c = ch.clips.find((x) => x.name === n)!;
        expect(c.loop).toBe(false);
        const start = worldPose(sk, c.sample(0));
        expect(start.pos[sk.index.Head][1]).toBeGreaterThan(0.95 * sk.bones[sk.index.Head].world[1]);
        for (let i = 0; i <= 16; i++) {
          const wp = worldPose(sk, c.sample((i / 16) * c.duration));
          expect(wp.pos[sk.index.Hips][1], `hips @${i}`).toBeGreaterThan(0.02 * H);
        }
        const end = worldPose(sk, c.sample(c.duration));
        for (const b of ['Hips', 'UpperChest', 'Head']) expect(end.pos[sk.index[b]][1], b).toBeLessThan(0.2 * H);
      });
    }
  }
});
