import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomRecipe, StyleId } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { exportGlb } from '../src/export/gltf';
import { worldPose } from '../src/core/anim';
import { handWeaponFrame } from '../src/core/hold';
import { qMul, qRotate, V3 } from '../src/core/math';
import { parseGlb } from '../src/rigger/glb';
import { WEAPON_ARCHETYPES, WeaponArchetype } from '../src/weapons/badgun';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require('gltf-validator');

/* eslint-disable @typescript-eslint/no-explicit-any */
function armed(style: StyleId, archetype: WeaponArchetype, embed = false, weaponStyle = 'modern') {
  const rc = randomRecipe(3, style, 'soldier', 'human');
  rc.weapon = { archetype, style: weaponStyle, seed: 2, embed };
  return generateCharacter(rc);
}

/**
 * Over a clip: how far the support hand's palm is from the weapon's handguard line (the support
 * point, or anywhere behind it along the barrel down to the magazine), and how well the gun points
 * forward. Uses only the exported skeleton + the weapon frame on the hand.
 */
function holdQuality(ch: ReturnType<typeof generateCharacter>, clipName: string) {
  const sk = ch.skeleton;
  const fr = handWeaponFrame(sk, -1);
  const frL = handWeaponFrame(sk, 1);
  const h = ch.weapon!.hold;
  const c = ch.clips.find((x) => x.name === clipName)!;
  let worst = 0;
  let fwd = 1;
  for (let i = 0; i < 12; i++) {
    const wp = worldPose(sk, c.sample((i / 12) * c.duration));
    const rh = sk.index.RightHand;
    const lh = sk.index.LeftHand;
    const gRot = qMul(wp.rot[rh], fr.rot);
    const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const gPos = add(wp.pos[rh], qRotate(wp.rot[rh], fr.offset));
    fwd = Math.min(fwd, qRotate(gRot, [0, 0, 1])[2]);
    if (!h.support) continue;
    const axis = qRotate(gRot, [0, 0, 1]);
    const sp = add(gPos, qRotate(gRot, h.support));
    const palm = add(wp.pos[lh], qRotate(wp.rot[lh], frL.offset.map((v) => v * 0.8) as V3));
    const off: V3 = [palm[0] - sp[0], palm[1] - sp[1], palm[2] - sp[2]];
    // sliding back along the handguard is allowed (shorter arms grip closer)
    let along = off[0] * axis[0] + off[1] * axis[1] + off[2] * axis[2];
    along = h.kind === 'long' ? Math.max(Math.min(0, -(h.support[2] - 0.11)), Math.min(0, along)) : 0;
    worst = Math.max(worst, Math.hypot(off[0] - axis[0] * along, off[1] - axis[1] * along, off[2] - axis[2] * along));
  }
  return { worst, fwd };
}

describe('BadGun weapons in the hands', () => {
  for (const a of WEAPON_ARCHETYPES) {
    it(`${a}: both hands on the weapon, aimed forward`, () => {
      const ch = armed('realistic', a);
      const aim = a === 'pistol' ? 'PistolAim' : 'RifleAim';
      const ready = a === 'pistol' ? 'PistolReady' : 'RifleReady';
      const walk = a === 'pistol' ? 'PistolReadyWalk' : 'RifleReadyWalk';
      const run = a === 'pistol' ? 'PistolRun' : 'RifleRun';
      for (const n of [aim, ready, walk, run]) expect(ch.clips.some((c) => c.name === n), n).toBe(true);
      expect(holdQuality(ch, run).worst).toBeLessThan(0.04);
      if (a === 'pistol') {
        expect(ch.clips.some((c) => c.name === 'PistolSprint')).toBe(true);
      } else {
        for (const n of ['RifleSprint', 'RifleCrawl']) expect(holdQuality(ch, n).worst, n).toBeLessThan(0.04);
      }
      const q = holdQuality(ch, aim);
      expect(q.worst).toBeLessThan(0.025);
      expect(q.fwd).toBeGreaterThan(0.97);
      expect(holdQuality(ch, ready).worst).toBeLessThan(0.025);
      expect(holdQuality(ch, walk).worst).toBeLessThan(0.04);
    });
  }

  for (const st of ['chibi', 'blocky', 'stylized', 'voxelslim', 'brick', 'segments'] as StyleId[]) {
    it(`${st}: a rifle still fits (short and long arms)`, () => {
      const q = holdQuality(armed(st, 'rifle'), 'RifleAim');
      expect(q.worst).toBeLessThan(0.07);
      expect(q.fwd).toBeGreaterThan(0.97);
    });
  }

  it('embeds the weapon under the right hand, validator-clean, with its own clips as Weapon_*', async () => {
    const glb = exportGlb(armed('realistic', 'rifle', true, 'steampunk'));
    const report = await validator.validateBytes(glb);
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
    const g = parseGlb(glb);
    const hand = g.json.nodes.findIndex((n: any) => n.name === 'RightHand');
    const holder = g.json.nodes.findIndex((n: any) => n.name?.startsWith('Weapon_'));
    expect(g.json.nodes[hand].children).toContain(holder);
    expect(g.json.animations.some((a: any) => a.name === 'Weapon_Fire')).toBe(true);
    expect(g.json.scenes[0].extras.badcharacters.weapon.badgun).toEqual({ archetype: 'rifle', style: 'steampunk', seed: 2, embed: true });
  });

  it('without "export", only the sockets and the fitted clips go in the GLB', () => {
    const g = parseGlb(exportGlb(armed('realistic', 'pistol', false)));
    expect(g.json.nodes.some((n: any) => n.name?.startsWith('Weapon_'))).toBe(false);
    expect(g.json.animations.some((a: any) => a.name === 'PistolAim')).toBe(true);
    const sock = g.json.nodes.find((n: any) => n.name === 'Socket_RightHand_Weapon');
    expect(sock.rotation).toHaveLength(4);
  });

  it('a character without a weapon has no weapon clips and keeps its own hand prop', () => {
    const rc = randomRecipe(3, 'realistic', 'soldier', 'human');
    const ch = generateCharacter(rc);
    expect(ch.weapon).toBeUndefined();
    expect(ch.clips.some((c) => c.name.startsWith('Pistol'))).toBe(false);
    expect(ch.recipe.weapon).toBeUndefined();
  });
});
