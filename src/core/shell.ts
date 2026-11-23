/**
 * Shells and hidden-layer culling.
 *
 * A shell is a slice of some source part's rings, inflated outward. Every shell remembers how it
 * was made (its `spec`), and so does every body part. That lets us answer one question precisely:
 * "is this stretch of this part completely wrapped by something further out?" If yes, it is
 * invisible from every angle in every pose (the outer layer copies the same rings and the same
 * skin weights, so it moves with it), and we delete it.
 *
 * Typical savings: legs under trousers, feet in boots, hands in gloves, torso under a shirt,
 * a shirt under a chestplate, the top of a head under hair.
 */
import { inflateRing, Part, Ring, sliceRings } from './loft';

export interface ShellOpts {
  material: string;
  inflate: number;
  /** extra inflate added linearly toward the end (bell sleeves, flared trousers) */
  flare?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** close an open end against the body with an inward lip so you never see inside */
  cuffStart?: boolean;
  cuffEnd?: boolean;
  /** make the cross-section boxier (armour); negative = rounder */
  nBoost?: number;
  lod?: Part['lod'];
  /** torn hem depth in metres (no inward lip at a torn end) */
  ragged?: number;
}

export interface ShellSpec {
  /** id of the body part whose rings this is cut from */
  src: string;
  rings: Ring[];
  k0: number;
  k1: number;
  o: ShellOpts;
  /** flare progress at k0 / k1 (so a trimmed piece keeps its share of the flare) */
  f0?: number;
  f1?: number;
  /** body parts are spec'd too, with inflate 0 */
  body?: boolean;
}

export function shell(name: string, src: Part | { id?: string; rings: Ring[]; lod?: Part['lod'] }, k0: number, k1: number, o: ShellOpts, f0 = 0, f1 = 1): Part {
  const rings = sliceRings(src.rings, k0, k1);
  const N = rings.length;
  const flare = o.flare ?? 0;
  // flare is distributed by ring index along the ORIGINAL slice, so trimming doesn't restart it
  const ks = [k0, ...Array.from({ length: Math.max(0, N - 2) }, (_, i) => Math.floor(k0) + 1 + i), k1];
  const fAt = (i: number) => (N > 1 ? f0 + ((f1 - f0) * (ks[i] - k0)) / Math.max(1e-9, k1 - k0) : f0);
  let out: Ring[] = rings.map((r, i) => inflateRing(r, o.inflate + flare * fAt(i), { n: r.n + (o.nBoost ?? 0) }));
  const lip = (r: Ring): Ring => ({ ...r, a: Math.max(r.a - o.inflate * 0.85 - flare, r.a * 0.5), b: Math.max(r.b - o.inflate * 0.85 - flare, r.b * 0.5) });
  if (o.cuffStart && !o.ragged) out = [lip(out[0]), ...out];
  if (o.cuffEnd && !o.ragged) out = [...out, lip(out[out.length - 1])];
  // a shell is never finer than what it wraps (gloves on 8-sided hands get 8 sides)
  const part: Part = { name, material: o.material, rings: out, capStart: o.capStart, capEnd: o.capEnd, lod: o.lod ?? src.lod };
  if (o.ragged) part.ragged = { start: o.cuffStart ? o.ragged : 0, end: o.cuffEnd ? o.ragged : 0, seed: (name.length * 7919 + Math.round(k0 * 1000)) % 997 };
  if (src.id) part.spec = { src: src.id, rings: src.rings, k0, k1, o, f0, f1 };
  return part;
}

/** register a body part for culling */
export function bodySpec(id: string, p: Part): Part {
  p.id = id;
  p.spec = { src: id, rings: p.rings, k0: 0, k1: p.rings.length - 1, o: { material: p.material, inflate: 0, capStart: p.capStart, capEnd: p.capEnd }, body: true };
  return p;
}

const OPAQUE_EXCLUDE = new Set(['glass']);
/** how far (in ring units) a cut edge must stay tucked under the covering layer */
export const CULL_MARGIN = 0.25;

/** Remove every stretch of every part that is fully wrapped by a thicker layer of the same source. */
export function cullHidden(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const s = p.spec;
    if (!s) {
      out.push(p);
      continue;
    }
    const mine = s.o.inflate + Math.max(0, s.o.flare ?? 0);
    const cover: [number, number][] = [];
    for (const q of parts) {
      const t = q.spec;
      if (q === p || !t || t.src !== s.src || t.body) continue;
      if (OPAQUE_EXCLUDE.has(q.material) || (t.o.nBoost ?? 0) < 0) continue;
      if (t.o.inflate + Math.min(0, t.o.flare ?? 0) <= mine + 1e-4) continue;
      // torn hems leave a bigger safety margin, so the jagged edge never reveals a culled gap
      const rag = t.o.ragged ? 0.6 : 0;
      cover.push([t.k0 + (t.o.cuffStart ? rag : 0), t.k1 - (t.o.cuffEnd ? rag : 0)]);
    }
    if (!cover.length) {
      out.push(p);
      continue;
    }
    // union, then shrink inward so cut edges stay tucked under the cover
    cover.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const c of cover) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1] + 0.05) last[1] = Math.max(last[1], c[1]);
      else merged.push([...c]);
    }
    const hidden = merged
      .map(([a, b]): [number, number] => [a <= s.k0 + 1e-6 ? -Infinity : a + CULL_MARGIN, b >= s.k1 - 1e-6 ? Infinity : b - CULL_MARGIN])
      .filter(([a, b]) => b - a > 0.05);
    // visible = [k0, k1] minus hidden
    const vis: [number, number][] = [];
    let cur = s.k0;
    for (const [a, b] of hidden) {
      if (a > cur) vis.push([cur, Math.min(a, s.k1)]);
      cur = Math.max(cur, b);
      if (cur >= s.k1) break;
    }
    if (cur < s.k1) vis.push([cur, s.k1]);
    const pieces = vis.filter(([a, b]) => b - a > 0.08);
    if (pieces.length === 1 && pieces[0][0] === s.k0 && pieces[0][1] === s.k1) {
      out.push(p);
      continue;
    }
    pieces.forEach(([a, b], i) => {
      const atStart = a === s.k0;
      const atEnd = b === s.k1;
      const name = pieces.length > 1 ? `${p.name}#${i}` : p.name;
      if (s.body) {
        out.push({ ...p, name, rings: sliceRings(s.rings, a, b), capStart: atStart && p.capStart, capEnd: atEnd && p.capEnd, spec: undefined });
      } else {
        const span = Math.max(1e-9, s.k1 - s.k0);
        const f0 = (s.f0 ?? 0) + ((s.f1 ?? 1) - (s.f0 ?? 0)) * ((a - s.k0) / span);
        const f1 = (s.f0 ?? 0) + ((s.f1 ?? 1) - (s.f0 ?? 0)) * ((b - s.k0) / span);
        const o: ShellOpts = { ...s.o, capStart: atStart && s.o.capStart, cuffStart: atStart && s.o.cuffStart, capEnd: atEnd && s.o.capEnd, cuffEnd: atEnd && s.o.cuffEnd };
        const piece = shell(name, { rings: s.rings, lod: p.lod }, a, b, { ...o, lod: p.lod }, f0, f1);
        out.push({ ...piece, vertexWeights: p.vertexWeights });
      }
    });
  }
  return out;
}
