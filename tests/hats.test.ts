import { describe, expect, it } from 'vitest';
import { buildRawParts } from '../src/core/character';
import { Part, ringPoint, Ring } from '../src/core/loft';
import { randomRecipe, StyleId, STYLES } from '../src/core/recipe';
import { buildSkeleton } from '../src/core/skeleton';

/** world-space outline points of a part */
function points(p: Part, n = 32) {
  const out: [number, number, number][] = [];
  for (const r of p.rings)
    for (let k = 0; k < n; k++) {
      const [x, y] = ringPoint(r, (k / n) * Math.PI * 2);
      out.push([r.c[0] + r.p[0] * x + r.q[0] * y, r.c[1] + r.p[1] * x + r.q[1] * y, r.c[2] + r.p[2] * x + r.q[2] * y]);
    }
  return out;
}

/** is world point P inside a vertical (rings along ±Y, XZ cross-sections) part? */
function inside(hat: Ring[], P: [number, number, number]) {
  const rs = [...hat].sort((a, b) => a.c[1] - b.c[1]);
  if (P[1] < rs[0].c[1] || P[1] > rs[rs.length - 1].c[1]) return true; // outside its height band: not its job
  let i = 0;
  while (i < rs.length - 2 && rs[i + 1].c[1] < P[1]) i++;
  const r0 = rs[i];
  const r1 = rs[i + 1];
  const t = (P[1] - r0.c[1]) / Math.max(1e-9, r1.c[1] - r0.c[1]);
  const L = (a: number, b: number) => a + (b - a) * t;
  const a = L(r0.a, r1.a);
  const b = L(r0.b, r1.b);
  const n = L(r0.n, r1.n);
  const cx = L(r0.c[0], r1.c[0]);
  const cz = L(r0.c[2], r1.c[2]);
  return Math.abs((P[0] - cx) / a) ** n + Math.abs((P[2] - cz) / b) ** n <= 1.0001;
}

const HATS: [string, string][] = [
  ['wizard', 'head.cone'],
  ['spacehelm', 'head.glass'],
  ['helmet', 'head.helmet'],
  ['hardhat', 'head.hardhat'],
  ['beanie', 'head.beanie'],
  ['cap', 'head.cap'],
  ['bandana', 'head.bandana'],
  ['conical', 'head.conical'],
  ['pith', 'head.pith'],
];

describe('hats enclose heads (no scalp poking through)', () => {
  for (const style of Object.keys(STYLES) as StyleId[]) {
    for (const [id, partName] of HATS) {
      it(`${style}: ${id}`, () => {
        const rc = randomRecipe(5, style, 'wizard');
        rc.outfit.head = { id, color: '#3355aa', color2: '#ffcc00' };
        const parts = buildRawParts(rc, buildSkeleton(rc));
        const head = parts.find((p) => p.name === 'head')!;
        const hat = parts.find((p) => p.name === partName)!;
        expect(hat, partName).toBeTruthy();
        // ignore the cuff lip rings (they deliberately tuck inward to meet the head)
        const body = hat.rings.filter((r, i, all) => !(i === 0 && all[1] && Math.abs(all[1].c[1] - r.c[1]) < 1e-9) && !(i === all.length - 1 && Math.abs(all[i - 1].c[1] - r.c[1]) < 1e-9));
        const lowest = Math.min(...body.map((r) => r.c[1]));
        const pokes = points(head).filter((P) => P[1] > lowest + 1e-4 && !inside(body, P));
        expect(pokes.length, `${pokes.length} head points outside the ${id}`).toBe(0);
      });
    }
  }
});

describe('skirts, robes and coats hide the legs and trousers under them (rest pose)', () => {
  const cases: [string, string, string][] = [
    ['bottom', 'skirt', 'bottom.skirt'],
    ['top', 'robe', 'top.skirt'],
    ['top', 'tunic', 'top.skirt'],
    ['top', 'coat', 'top.skirt'],
  ];
  for (const style of Object.keys(STYLES) as StyleId[]) {
    for (const [slot, id, partName] of cases) {
      it(`${style}: ${id}`, () => {
        const rc = randomRecipe(9, style, 'casual');
        rc.body.fat = 0.6;
        rc.outfit.bottom = { id: slot === 'bottom' ? 'skirt' : 'pants', color: '#aa3333', color2: '#000000' };
        if (slot === 'top') rc.outfit.top = { id, color: '#3355aa', color2: '#ffcc00' };
        const parts = buildRawParts(rc, buildSkeleton(rc));
        const sk = parts.find((p) => p.name === partName)!;
        const ringsNoLip = sk.rings.slice(0, -1);
        const lowest = Math.min(...ringsNoLip.map((r) => r.c[1]));
        const highest = sk.rings[0].c[1];
        const legs = parts.filter((p) => /^(leg\.|bottom\.leg|bottom\.pelvis)/.test(p.name));
        const pokes = legs.flatMap((p) => points(p, 16)).filter((P) => P[1] > lowest + 1e-4 && P[1] < highest && !inside(ringsNoLip, P));
        expect(pokes.length).toBe(0);
      });
    }
  }
});
