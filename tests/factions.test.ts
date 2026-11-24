import { describe, expect, it } from 'vitest';
import { FACTIONS, factionMember, factionSquad } from '../src/core/factions';
import { THEMES } from '../src/core/recipe';
import { generateCharacter } from '../src/core/character';
import { exportGlb } from '../src/export/gltf';

describe('factions', () => {
  for (const [id, f] of Object.entries(FACTIONS)) {
    it(`${id}: members wear only the faction's kit, roles carry their weapons`, () => {
      const base = THEMES[f.base];
      for (let seed = 1; seed <= 12; seed++) {
        const rc = factionMember(seed, id, 'realistic');
        expect(rc.faction?.id).toBe(id);
        const role = f.roles.find((r) => r.id === rc.faction!.role)!;
        for (const [slot, g] of Object.entries(rc.outfit)) {
          if (slot === 'hair' || slot === 'beard') continue;
          const pool = role.slots?.[slot as keyof typeof role.slots] ?? f.slots?.[slot as keyof typeof f.slots] ?? base.slots[slot as keyof typeof base.slots];
          if (pool) expect(Object.keys(pool), `${slot}=${g.id}`).toContain(g.id);
        }
        if (role.weapons?.length && f.weaponStyles.length) expect(role.weapons).toContain(rc.weapon!.archetype);
        else expect(rc.weapon).toBeUndefined();
      }
    });
  }
  it('a squad keeps the chosen style and builds valid characters', () => {
    const squad = factionSquad(3, 'vc', 'voxel', 4);
    for (const rc of squad) {
      expect(rc.style).toBe('voxel');
      expect(exportGlb(generateCharacter(rc)).length).toBeGreaterThan(1000);
    }
    expect(new Set(squad.map((r) => r.faction!.role)).size).toBeGreaterThan(1);
  });
});
