/**
 * Hand-tuned signature characters. Each is just a recipe: load it, tweak it, export it.
 */
import { CharacterRecipe, randomRecipe, StyleId } from './recipe';

type Patch = { id?: string; style: StyleId; theme: string; seed: number; name: string; body?: Partial<CharacterRecipe['body']>; face?: Partial<CharacterRecipe['face']>; outfit?: Partial<Record<keyof CharacterRecipe['outfit'], [string, string, string]>> };

function make(p: Patch): CharacterRecipe {
  const r = randomRecipe(p.seed, p.style, p.theme);
  r.name = p.name;
  Object.assign(r.body, p.body ?? {});
  Object.assign(r.face, p.face ?? {});
  for (const [slot, [id, color, color2]] of Object.entries(p.outfit ?? {})) r.outfit[slot as keyof CharacterRecipe['outfit']] = { id, color, color2 };
  return r;
}

export const PRESETS: { id: string; label: string; blurb: string; recipe: () => CharacterRecipe }[] = [
  {
    id: 'alden',
    label: 'Alden Wayfarer',
    blurb: 'The First Explorer of Thornwake. He went first because somebody had to.',
    recipe: () =>
      make({
        id: 'alden', style: 'blocky', theme: 'explorer', seed: 1001, name: 'Alden Wayfarer',
        body: { height: 1.82, gender: 0.05, muscle: 0.35, fat: 0.08, skin: '#e8b896', headScale: 1.04, roundness: 0.14, legLength: 0.1 },
        face: { eyes: 'square', iris: '#2a1d14', mouth: 'line', brows: 'thick', browColor: '#4a2f1b', blush: false, nose: true, ears: false },
        outfit: {
          hair: ['messy', '#4a2f1b', '#4a2f1b'], beard: ['full', '#4a2f1b', '#4a2f1b'], head: ['none', '#000000', '#000000'],
          top: ['tee', '#2f6f73', '#2f6f73'], bottom: ['pants', '#5a3d26', '#3b2818'], feet: ['hikers', '#5b3a22', '#2e2016'],
          hands: ['none', '#000000', '#000000'], armor: ['none', '#000000', '#000000'], belt: ['belt', '#3a2716', '#d4a62a'],
          back: ['rucksack', '#6b4425', '#c9b48a'], neck: ['none', '#000000', '#000000'], prop: ['staff', '#6e4a2a', '#4a3020'],
        },
      }),
  },
  {
    id: 'mannequin',
    label: 'Mannequin',
    blurb: 'The plain, bald base body. Bring your own wardrobe.',
    recipe: () => make({ style: 'stylized', theme: 'base', seed: 7, name: 'Base Mannequin', body: { gender: 0.5, muscle: 0.3, fat: 0.2, skin: '#d29b74' }, face: { eyes: 'dot', mouth: 'line' } }),
  },
  {
    id: 'sir',
    label: 'Sir Clanksalot',
    blurb: 'Full plate. Hears you coming from three villages away.',
    recipe: () => make({ style: 'heroic', theme: 'knight', seed: 3, name: 'Sir Clanksalot' }),
  },
  {
    id: 'pip',
    label: 'Pip the Apprentice',
    blurb: 'Chibi wizard. Mostly hat.',
    recipe: () => make({ style: 'chibi', theme: 'wizard', seed: 5, name: 'Pip the Apprentice' }),
  },
];
