/**
 * mulberry32: a tiny, fast, seedable PRNG. The whole state is one uint32, so it can live inside
 * plain game state and be compared with a deep-equal in tests.
 */
export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Advances the state in place and returns a float in [0, 1). */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Float in [min, max). */
export function nextRange(rng: RngState, min: number, max: number): number {
  return min + (max - min) * nextFloat(rng);
}
