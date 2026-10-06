/**
 * Maps are made from a number. Everything is turned around the centre (180 degrees) so both sides get the
 * same ground, and a flood fill proves every base can be reached from every other before a map is accepted.
 * Uses only whole-number arithmetic and the engine's seeded RNG, so a seed gives the same map everywhere.
 */
import { createRng, nextFloat, type RngState } from '../../engine/core/rng';
import { MAP } from './config';
import type { Vec } from './types';

export interface BaseSite {
  /** The hub's centre (a whole number: the hub is 4 x 4, so its centre sits on a cell corner). */
  x: number;
  y: number;
  /** 0 or 1 for a starting base, -1 for an expansion. */
  start: number;
}

export interface ResourceSpot {
  type: 'minerals' | 'geyser';
  /** The cell the resource sits on (a geyser is 3 x 3 around its cell). */
  x: number;
  y: number;
  base: number;
}

export interface GameMap {
  seed: number;
  size: number;
  /** 1 where the ground cannot be walked: the border and rock. */
  rock: Uint8Array;
  bases: BaseSite[];
  resources: ResourceSpot[];
  /** Which try of the generator this map came from (0 = the first). */
  attempt: number;
}

const S = MAP.size;
const mix = (seed: number, attempt: number): number => (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;

/** A whole number in [lo, hi]. */
const pickInt = (rng: RngState, lo: number, hi: number): number => lo + Math.min(hi - lo, Math.floor(nextFloat(rng) * (hi - lo + 1)));

/** A small, fixed jumble from the cell and the seed, for ragged rock edges. */
function jitter(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(seed | 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The six base sites for the player in the south-west, and what grows around each (hub centres). */
const WEST_BASES: readonly { x: number; y: number; geysers: number }[] = [
  { x: 14, y: 80, geysers: 2 },
  { x: 14, y: 48, geysers: 1 },
  { x: 14, y: 16, geysers: 1 },
];

function resourcesFor(base: number, hub: { x: number; y: number }, geysers: number): ResourceSpot[] {
  const out: ResourceSpot[] = [];
  const west = hub.x < S / 2;
  for (let k = 0; k < 8; k++) {
    const gap = 5 - Math.floor(Math.abs(k - 3.5) * 0.6);
    const x = west ? hub.x - 3 - gap : hub.x + 2 + gap;
    out.push({ type: 'minerals', x, y: hub.y - 4 + k, base });
  }
  out.push({ type: 'geyser', x: hub.x, y: hub.y - 8, base });
  if (geysers > 1) out.push({ type: 'geyser', x: hub.x, y: hub.y + 8, base });
  return out;
}

/** Rotates a cell about the centre of the map. */
const turn = (v: number): number => S - 1 - v;

interface Layout {
  bases: BaseSite[];
  resources: ResourceSpot[];
}

function layoutBases(): Layout {
  const bases: BaseSite[] = [];
  const resources: ResourceSpot[] = [];
  const add = (site: { x: number; y: number; geysers: number }, start: number): void => {
    const a = bases.length;
    bases.push({ x: site.x, y: site.y, start });
    bases.push({ x: S - site.x, y: S - site.y, start: start < 0 ? -1 : 1 });
    const own = resourcesFor(a, site, site.geysers);
    resources.push(...own);
    // The other side's resources are exactly these, turned half way round.
    resources.push(...own.map((r) => ({ type: r.type, x: turn(r.x), y: turn(r.y), base: a + 1 })));
  };
  // Index 0 and 1 are the two starts; the rest alternate between the sides.
  add(WEST_BASES[0]!, 0);
  for (const site of WEST_BASES.slice(1)) add(site, -1);
  return { bases, resources };
}

function paintRock(rock: Uint8Array, cx: number, cy: number, radius: number, seed: number): void {
  for (let y = Math.floor(cy - radius - 2); y <= Math.ceil(cy + radius + 2); y++) {
    for (let x = Math.floor(cx - radius - 2); x <= Math.ceil(cx + radius + 2); x++) {
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      const reach = radius + jitter(x, y, seed) * 1.6 - 0.8;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < reach * reach) {
        rock[y * S + x] = 1;
        rock[turn(y) * S + turn(x)] = 1;
      }
    }
  }
}

/** A long thin ridge with one gap in it, so there are chokepoints. */
function paintRidge(rock: Uint8Array, rng: RngState): void {
  const horizontal = nextFloat(rng) < 0.5;
  const length = pickInt(rng, 12, 22);
  const thick = pickInt(rng, 2, 3);
  const a = pickInt(rng, 10, S - 10 - length);
  const b = pickInt(rng, 10, S - 10 - thick);
  const gapAt = pickInt(rng, 3, length - 6);
  for (let i = 0; i < length; i++) {
    if (i >= gapAt && i < gapAt + 4) continue;
    for (let t = 0; t < thick; t++) {
      const x = horizontal ? a + i : b + t;
      const y = horizontal ? b + t : a + i;
      rock[y * S + x] = 1;
      rock[turn(y) * S + turn(x)] = 1;
    }
  }
}

function clearAround(rock: Uint8Array, cx: number, cy: number, radius: number): void {
  for (let y = Math.max(0, cy - radius); y <= Math.min(S - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(S - 1, cx + radius); x++) {
      // Measured from the cell's middle to the hub's centre (a cell corner), which is the same after turning the map round.
      if ((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) <= radius * radius) rock[y * S + x] = 0;
    }
  }
}

/** Are all the bases reachable from the first, on foot? (8 directions, no cutting corners.) */
function connected(rock: Uint8Array, bases: readonly BaseSite[]): boolean {
  const seen = new Uint8Array(S * S);
  const first = bases[0]!;
  const startCell = (first.y + 1) * S + first.x;
  if (rock[startCell] === 1) return false;
  const stack = [startCell];
  seen[startCell] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    const x = c % S;
    const y = (c - x) / S;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const n = ny * S + nx;
        if (seen[n] === 1 || rock[n] === 1) continue;
        if (dx !== 0 && dy !== 0 && (rock[y * S + nx] === 1 || rock[ny * S + x] === 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return bases.every((b) => seen[(b.y + 1) * S + b.x] === 1);
}

function build(seed: number, attempt: number, calm: boolean): GameMap {
  const rng = createRng(mix(seed, attempt));
  const { bases, resources } = layoutBases();
  const rock = new Uint8Array(S * S);

  if (!calm) {
    const blobs = pickInt(rng, 18, 26);
    for (let i = 0; i < blobs; i++) paintRock(rock, pickInt(rng, 6, S - 7), pickInt(rng, 6, S - 7), 1.8 + nextFloat(rng) * 3.2, mix(seed, i + 100));
    const ridges = pickInt(rng, 2, 4);
    for (let i = 0; i < ridges; i++) paintRidge(rock, rng);
  }

  // Clear room around every base and its resources, then close in the border.
  for (const base of bases) clearAround(rock, base.x, base.y, MAP.clearRadius);
  for (const r of resources) rock[r.y * S + r.x] = 0;
  for (let i = 0; i < S; i++) {
    for (let t = 0; t < MAP.border; t++) {
      rock[t * S + i] = 1;
      rock[(S - 1 - t) * S + i] = 1;
      rock[i * S + t] = 1;
      rock[i * S + (S - 1 - t)] = 1;
    }
  }

  // Turn the map over in the other direction half the time, so the start is not always the south-west.
  const flip = nextFloat(rng) < 0.5;
  if (flip) {
    const flipped = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) flipped[(S - 1 - y) * S + x] = rock[y * S + x] ?? 0;
    flipped.forEach((v, i) => (rock[i] = v));
    for (const b of bases) b.y = S - b.y;
    for (const r of resources) r.y = S - 1 - r.y;
  }

  return { seed, size: S, rock, bases, resources, attempt };
}

/** The map for a seed. Always valid: if the rocks cut a base off, another arrangement is tried, and in the end an open field. */
export function generateMap(seed: number): GameMap {
  for (let attempt = 0; attempt < MAP.attempts; attempt++) {
    const map = build(seed, attempt, false);
    if (connected(map.rock, map.bases)) return map;
  }
  return build(seed, MAP.attempts, true);
}

/** The cell a point is in. */
export const cellOf = (v: number): number => Math.floor(v);

export const cellCentre = (cell: number): number => cell + 0.5;

export type { Vec };
