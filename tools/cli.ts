/**
 * CLI: npm run cli -- export <style> <theme> <seed> [outDir]
 *      npm run cli -- samples [outDir]      (one GLB per style × a few themes)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCharacter } from '../src/core/character';
import { randomRecipe, StyleId, STYLES, THEMES } from '../src/core/recipe';
import { exportGlb } from '../src/export/gltf';

const [cmd = 'samples', ...args] = process.argv.slice(2);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function exportOne(style: StyleId, theme: string, seed: number, dir: string) {
  const rc = randomRecipe(seed, style, theme);
  const ch = generateCharacter(rc);
  const glb = exportGlb(ch);
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${style}_${theme}_${seed}_${slug(rc.name)}`);
  writeFileSync(`${base}.glb`, glb);
  writeFileSync(`${base}.badchar.json`, JSON.stringify(rc, null, 2));
  console.log(`${base}.glb  ${(glb.length / 1024).toFixed(0)} KB  ${ch.stats.triangles} tris  ${ch.stats.bones} bones  ${ch.morphs.length} morphs`);
}

if (cmd === 'export') {
  const [style = 'blocky', theme = 'casual', seed = '1', dir = 'out'] = args;
  exportOne(style as StyleId, theme, Number(seed), dir);
} else {
  const dir = args[0] ?? 'out/samples';
  const themes = Object.keys(THEMES);
  let i = 0;
  for (const style of Object.keys(STYLES) as StyleId[]) for (const theme of [themes[i++ % themes.length], themes[(i * 3) % themes.length]]) exportOne(style, theme, 100 + i, dir);
}
