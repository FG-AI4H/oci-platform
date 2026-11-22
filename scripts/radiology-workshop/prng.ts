/**
 * Seeded pseudo-random numbers for the workshop content (#644). Not
 * cryptographic and not meant to be: the point is that the same seed gives
 * the same selection and the same teaching files on every machine.
 */

/** Mulberry32, the generator the synthetic chest X-ray fixture already uses. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator for one named purpose, derived from the base seed with FNV-1a.
 * Each stratum and each file draws from its own stream, so adding a stratum
 * or changing one quota does not reshuffle the others.
 */
export function streamFor(seed: number, purpose: string): () => number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const ch of purpose) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

/** Fisher-Yates shuffle of a copy. The input order must itself be deterministic. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length > 0) {
    const [picked] = pool.splice(Math.floor(rand() * pool.length), 1);
    if (picked !== undefined) out.push(picked);
  }
  return out;
}

/**
 * Split `total` across weighted parts by largest remainder, so the parts are
 * whole numbers that add up to `total` exactly. Ties go to the earlier part.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  const leftover = total - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, index) => ({ index, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, leftover)
    .map((p) => p.index);
  return floors.map((f, index) => f + (byRemainder.includes(index) ? 1 : 0));
}
