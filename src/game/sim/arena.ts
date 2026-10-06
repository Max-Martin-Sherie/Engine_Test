/**
 * The arena. It is a *heightfield*: a grid of one-metre cells, each a solid column from the ground up to some height.
 * Low columns are steps and crates (walked or jumped onto), tall ones are walls. Because everything is a column from the
 * ground, movement, shots and navigation are all simple grid questions.
 *
 * Arenas are made from a number. Everything is mirrored left-right and top-bottom so every spawn gets the same view,
 * and a flood fill proves all of it can be walked to (anything walled in is filled solid). Uses only the engine's
 * seeded RNG, so a seed is the same arena everywhere.
 */
import { createRng, nextFloat, type RngState } from '../../engine/core/rng';
import { ACTOR, ARENA } from './config';
import type { PickupKind } from './types';

export interface Rect {
  /** Cell coordinates of the corner, and the size in cells; `h` is the height in metres. */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface Spawn {
  x: number;
  z: number;
  /** Looking at the middle of the arena. */
  yaw: number;
  /** 0 on the west side, 1 on the east: where a team starts. */
  team: number;
}

export interface PickupSpot {
  kind: PickupKind;
  x: number;
  z: number;
}

export interface Arena {
  seed: number;
  size: number;
  /** Column heights, row by row (`z * size + x`). */
  heights: Float32Array;
  /** The columns as merged blocks, for drawing. */
  rects: Rect[];
  spawns: Spawn[];
  pickups: PickupSpot[];
  /** Places bots like to walk to. */
  waypoints: { x: number; z: number }[];
  /** Which try of the generator this came from (0 = the first). */
  attempt: number;
}

const S = ARENA.size;
const H = S / 2;
const mix = (seed: number, attempt: number): number => (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
const pickInt = (rng: RngState, lo: number, hi: number): number => lo + Math.min(hi - lo, Math.floor(nextFloat(rng) * (hi - lo + 1)));
const chance = (rng: RngState, p: number): boolean => nextFloat(rng) < p;

/** The column height under a point (anywhere off the arena is the tall outer wall). */
export function heightAt(arena: Arena, x: number, z: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= arena.size || cz >= arena.size) return ARENA.wall;
  return arena.heights[cz * arena.size + cx] ?? ARENA.wall;
}

export const cellHeight = (arena: Arena, cx: number, cz: number): number =>
  cx < 0 || cz < 0 || cx >= arena.size || cz >= arena.size ? ARENA.wall : (arena.heights[cz * arena.size + cx] ?? ARENA.wall);

/** Can a walker go from one cell straight to a neighbouring one? (Not too high, not too big a step.) */
export function stepOk(arena: Arena, ax: number, az: number, bx: number, bz: number): boolean {
  const a = cellHeight(arena, ax, az);
  const b = cellHeight(arena, bx, bz);
  return a <= ARENA.maxFloor && b <= ARENA.maxFloor && Math.abs(a - b) <= ACTOR.step + 1e-6;
}

// ---- generating --------------------------------------------------------------------------------------------------

function build(seed: number, attempt: number, calm: boolean): Arena {
  const rng = createRng(mix(seed, attempt));
  const h = new Float32Array(S * S);
  const keep = new Uint8Array(S * S);

  const mirrors = (x: number, z: number): [number, number][] => [
    [x, z],
    [S - 1 - x, z],
    [x, S - 1 - z],
    [S - 1 - x, S - 1 - z],
  ];
  const put = (x: number, z: number, height: number): void => {
    for (const [mx, mz] of mirrors(x, z)) {
      if (mx < 1 || mz < 1 || mx >= S - 1 || mz >= S - 1) continue;
      const i = mz * S + mx;
      if (keep[i] === 1) continue;
      if (height > (h[i] ?? 0)) h[i] = height;
    }
  };
  const box = (x0: number, z0: number, w: number, d: number, height: number): void => {
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) put(x, z, height);
  };
  const reserve = (cx: number, cz: number, radius: number): void => {
    for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x + 0.5 - cx) * (x + 0.5 - cx) + (z + 0.5 - cz) * (z + 0.5 - cz) > radius * radius) continue;
        for (const [mx, mz] of mirrors(x, z)) if (mx >= 0 && mz >= 0 && mx < S && mz < S) keep[mz * S + mx] = 1;
      }
    }
  };

  // Where people start (one quarter; the others are its mirrors), and where the goodies lie.
  const spawnCells: [number, number][] = [
    [5, 5],
    [13, 4],
    [4, 14],
  ];
  const jit = (): number => pickInt(rng, -1, 1);
  const spots: PickupSpot[] = [];
  const quarterSpots: [PickupKind, number, number][] = [
    ['health', 11 + jit(), 11 + jit()],
    ['ammo', 18 + jit(), 9 + jit()],
    ['armor', 9 + jit(), 18 + jit()],
    ['shotgun', 16 + jit(), 16 + jit()],
  ];
  const axisSpots: [PickupKind, number, number][] = [
    ['rail', S / 2, 6 + jit()],
    ['rocket', 6 + jit(), S / 2],
  ];
  for (const [kind, x, z] of quarterSpots) for (const [mx, mz] of mirrors(x, z)) spots.push({ kind, x: mx + 0.5, z: mz + 0.5 });
  // The two guns on the middle lines: one on each side of the arena along that line.
  const [rail, rocket] = axisSpots;
  if (rail !== undefined) {
    spots.push({ kind: rail[0], x: S / 2, z: rail[2] + 0.5 }, { kind: rail[0], x: S / 2, z: S - (rail[2] + 0.5) });
  }
  if (rocket !== undefined) {
    spots.push({ kind: rocket[0], x: rocket[1] + 0.5, z: S / 2 }, { kind: rocket[0], x: S - (rocket[1] + 0.5), z: S / 2 });
  }
  for (const [x, z] of spawnCells) reserve(x + 0.5, z + 0.5, 2.6);
  for (const s of spots) reserve(s.x, s.z, 1.3);

  if (!calm) {
    // The middle: a stepped pyramid to fight over.
    for (let ring = 0; ring < 3; ring++) {
      const lo = 20 + ring;
      box(lo, lo, 8 - ring * 2, 8 - ring * 2, 0.5 * (ring + 1));
    }

    // Long walls with doorways, some tall and some low.
    const walls = pickInt(rng, 3, 4);
    for (let i = 0; i < walls; i++) {
      const horizontal = chance(rng, 0.5);
      const length = pickInt(rng, 6, 11);
      const thick = chance(rng, 0.7) ? 1 : 2;
      const a = pickInt(rng, 3, H - length - 1);
      const b = pickInt(rng, 3, H - 4);
      const height = chance(rng, 0.65) ? ARENA.wall : 1.5;
      const gapAt = pickInt(rng, 2, Math.max(2, length - 5));
      const gapLen = pickInt(rng, 2, 3);
      for (let k = 0; k < length; k++) {
        if (k >= gapAt && k < gapAt + gapLen) continue;
        for (let t = 0; t < thick; t++) put(horizontal ? a + k : b + t, horizontal ? b + t : a + k, height);
      }
    }

    // Pillars.
    const pillars = pickInt(rng, 4, 6);
    for (let i = 0; i < pillars; i++) {
      const size = chance(rng, 0.4) ? 2 : 1;
      box(pickInt(rng, 3, H - 3), pickInt(rng, 3, H - 3), size, size, chance(rng, 0.7) ? ARENA.wall : 2);
    }

    // Crates to hide behind and hop over.
    const crates = pickInt(rng, 8, 12);
    for (let i = 0; i < crates; i++) {
      const w = pickInt(rng, 1, 2);
      const d = pickInt(rng, 1, 2);
      box(pickInt(rng, 3, H - 3), pickInt(rng, 3, H - 3), w, d, chance(rng, 0.55) ? 1 : 0.5);
    }

    // A raised platform with steps up to it, to shoot from.
    const px = pickInt(rng, 6, H - 8);
    const pz = pickInt(rng, 6, H - 8);
    box(px, pz, 4, 4, 1.5);
    box(px - 1, pz, 1, 4, 1);
    box(px - 2, pz, 1, 4, 0.5);
    box(px, pz + 4, 4, 1, 1);
    box(px, pz + 5, 4, 1, 0.5);
  }

  // The outer wall.
  for (let i = 0; i < S; i++) {
    h[i] = ARENA.wall;
    h[(S - 1) * S + i] = ARENA.wall;
    h[i * S] = ARENA.wall;
    h[i * S + S - 1] = ARENA.wall;
  }

  // Anything a walker cannot reach (walled in) is filled solid, so there are no hidden pockets.
  const arena: Arena = { seed, size: S, heights: h, rects: [], spawns: [], pickups: spots, waypoints: [], attempt };
  const first = spawnCells[0]!;
  const reached = flood(arena, first[0], first[1]);
  let open = 0;
  for (let i = 0; i < S * S; i++) {
    if ((h[i] ?? 0) <= ARENA.maxFloor) {
      if (reached[i] === 1) open += 1;
      else h[i] = ARENA.wall;
    }
  }
  const walkable = open / (S * S);
  if (walkable < ARENA.minOpen) return { ...arena, attempt: -1 };
  // Every start and every goody must be somewhere a person can walk to.
  const reachable = (x: number, z: number): boolean => reached[Math.floor(z) * S + Math.floor(x)] === 1;
  for (const [cx, cz] of spawnCells) for (const [mx, mz] of mirrors(cx, cz)) if (!reachable(mx + 0.5, mz + 0.5)) return { ...arena, attempt: -1 };
  for (const s of spots) if (!reachable(s.x, s.z)) return { ...arena, attempt: -1 };

  // Spawns, facing the middle, and the places bots like to go.
  for (const [cx, cz] of spawnCells) {
    for (const [mx, mz] of mirrors(cx, cz)) {
      const x = mx + 0.5;
      const z = mz + 0.5;
      arena.spawns.push({ x, z, yaw: Math.atan2(x - S / 2, z - S / 2), team: x < S / 2 ? 0 : 1 });
    }
  }
  arena.waypoints = [...arena.spawns.map((s) => ({ x: s.x, z: s.z })), ...spots.map((s) => ({ x: s.x, z: s.z }))];
  for (let i = 0; i < 6; i++) {
    const x = pickInt(rng, 3, H - 2);
    const z = pickInt(rng, 3, H - 2);
    for (const [mx, mz] of mirrors(x, z)) if ((h[mz * S + mx] ?? ARENA.wall) <= ARENA.maxFloor && reached[mz * S + mx] === 1) arena.waypoints.push({ x: mx + 0.5, z: mz + 0.5 });
  }
  arena.rects = mergeRects(h);
  return arena;
}

/** Which cells can be walked to from a start cell. */
export function flood(arena: Arena, sx: number, sz: number): Uint8Array {
  const seen = new Uint8Array(arena.size * arena.size);
  const stack = [sz * arena.size + sx];
  seen[stack[0]!] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    const x = c % arena.size;
    const z = (c - x) / arena.size;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= arena.size || nz >= arena.size) continue;
      const n = nz * arena.size + nx;
      if (seen[n] === 1 || !stepOk(arena, x, z, nx, nz)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

/** Merges neighbouring columns of the same height into blocks (far fewer things to draw). */
export function mergeRects(heights: Float32Array): Rect[] {
  const rects: Rect[] = [];
  const used = new Uint8Array(S * S);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const height = heights[i] ?? 0;
      if (used[i] === 1 || height <= 0.01) continue;
      let w = 1;
      while (x + w < S && used[z * S + x + w] !== 1 && heights[z * S + x + w] === height) w += 1;
      let d = 1;
      grow: while (z + d < S) {
        for (let k = 0; k < w; k++) if (used[(z + d) * S + x + k] === 1 || heights[(z + d) * S + x + k] !== height) break grow;
        d += 1;
      }
      for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used[(z + dz) * S + x + dx] = 1;
      rects.push({ x, z, w, d, h: height });
    }
  }
  return rects;
}

/** The arena for a seed. Always valid: if a layout is too cramped, the next try is used, and in the end a plain one. */
export function generateArena(seed: number): Arena {
  for (let attempt = 0; attempt < ARENA.attempts; attempt++) {
    const arena = build(seed, attempt, false);
    if (arena.attempt >= 0) return arena;
  }
  return build(seed, ARENA.attempts, true);
}

// ---- walking the arena (for the bots) ----------------------------------------------------------------------------

const SQRT2 = 1.4142135623730951;
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** A* over the cells, with reusable buffers. Routes come out as world points, straightened where a walker can go straight. */
export class NavGrid {
  private readonly arena: Arena;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Uint8Array;
  private heapKeys: Float32Array;
  private heapNodes: Int32Array;
  private heapSize = 0;
  private generation = 0;

  constructor(arena: Arena) {
    this.arena = arena;
    const n = arena.size * arena.size;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.heapKeys = new Float32Array(n * 3);
    this.heapNodes = new Int32Array(n * 3);
  }

  private push(key: number, node: number): void {
    let i = this.heapSize++;
    this.heapKeys[i] = key;
    this.heapNodes[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.heapKeys[p] ?? 0) <= key) break;
      this.heapKeys[i] = this.heapKeys[p] ?? 0;
      this.heapNodes[i] = this.heapNodes[p] ?? 0;
      i = p;
    }
    this.heapKeys[i] = key;
    this.heapNodes[i] = node;
  }

  private pop(): number {
    const top = this.heapNodes[0] ?? 0;
    const key = this.heapKeys[--this.heapSize] ?? 0;
    const node = this.heapNodes[this.heapSize] ?? 0;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.heapSize) break;
      if (c + 1 < this.heapSize && (this.heapKeys[c + 1] ?? 0) < (this.heapKeys[c] ?? 0)) c += 1;
      if ((this.heapKeys[c] ?? 0) >= key) break;
      this.heapKeys[i] = this.heapKeys[c] ?? 0;
      this.heapNodes[i] = this.heapNodes[c] ?? 0;
      i = c;
    }
    this.heapKeys[i] = key;
    this.heapNodes[i] = node;
    return top;
  }

  /** Can a walker go in a straight line between two points, never meeting a wall or a ledge too high to step? */
  lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1e-6) return true;
    const ux = dx / dist;
    const uz = dz / dist;
    const r = 0.34;
    let prev = heightAt(this.arena, x0, z0);
    for (let t = 0.25; t <= dist + 0.001; t += 0.25) {
      const x = x0 + ux * Math.min(t, dist);
      const z = z0 + uz * Math.min(t, dist);
      // The middle must be a step or less from the last spot; the body's edges must not meet anything taller.
      const here = heightAt(this.arena, x, z);
      if (here > ARENA.maxFloor || Math.abs(here - prev) > ACTOR.step + 1e-6) return false;
      for (const side of [1, -1]) {
        const edge = heightAt(this.arena, x - uz * r * side, z + ux * r * side);
        if (edge > ARENA.maxFloor || edge > here + ACTOR.step + 1e-6) return false;
      }
      prev = here;
    }
    return true;
  }

  /** The nearest walkable cell to a point (itself if it is walkable). */
  nearestWalkable(x: number, z: number): { cx: number; cz: number } | null {
    const cx0 = Math.floor(x);
    const cz0 = Math.floor(z);
    for (let r = 0; r < 6; r++) {
      let best: { cx: number; cz: number } | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (cellHeight(this.arena, cx0 + dx, cz0 + dz) > ARENA.maxFloor) continue;
          const d = (cx0 + dx + 0.5 - x) ** 2 + (cz0 + dz + 0.5 - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { cx: cx0 + dx, cz: cz0 + dz };
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** A route from one point to another as x, z pairs (not including the start), or null if there is none. */
  find(sx: number, sz: number, gx: number, gz: number): number[] | null {
    const size = this.arena.size;
    const start = this.nearestWalkable(sx, sz);
    const goal = this.nearestWalkable(gx, gz);
    if (start === null || goal === null) return null;
    const s = start.cz * size + start.cx;
    const t = goal.cz * size + goal.cx;
    if (s === t) return [gx, gz];
    this.generation += 1;
    const gen = this.generation;
    this.heapSize = 0;
    this.g[s] = 0;
    this.parent[s] = -1;
    this.stamp[s] = gen;
    this.closed[s] = 0;
    const heuristic = (cx: number, cz: number): number => {
      const dx = Math.abs(cx - goal.cx);
      const dz = Math.abs(cz - goal.cz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    this.push(heuristic(start.cx, start.cz), s);
    let found = false;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.stamp[cur] === gen && this.closed[cur] === 1) continue;
      this.closed[cur] = 1;
      if (cur === t) {
        found = true;
        break;
      }
      const cx = cur % size;
      const cz = (cur - cx) / size;
      const gCur = this.g[cur] ?? 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + (NX[k] ?? 0);
        const nz = cz + (NZ[k] ?? 0);
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (!stepOk(this.arena, cx, cz, nx, nz)) continue;
        const diagonal = k >= 4;
        // No cutting a corner: both cells beside a diagonal step must be open too, and no taller than either end
        // (the body is wider than a point and would catch on them).
        if (diagonal) {
          const top = Math.max(cellHeight(this.arena, cx, cz), cellHeight(this.arena, nx, nz)) + 1e-6;
          if (!stepOk(this.arena, cx, cz, nx, cz) || !stepOk(this.arena, cx, cz, cx, nz)) continue;
          if (cellHeight(this.arena, nx, cz) > top || cellHeight(this.arena, cx, nz) > top) continue;
        }
        const n = nz * size + nx;
        if (this.stamp[n] === gen && this.closed[n] === 1) continue;
        const cost = gCur + (diagonal ? SQRT2 : 1);
        if (this.stamp[n] !== gen || cost < (this.g[n] ?? Infinity)) {
          this.stamp[n] = gen;
          this.closed[n] = 0;
          this.g[n] = cost;
          this.parent[n] = cur;
          this.push(cost + heuristic(nx, nz), n);
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = t; c !== -1 && c !== undefined; c = this.parent[c] ?? -1) cells.push(c);
    cells.reverse();
    // Straighten: keep a waypoint only where going straight would fail.
    const points: number[] = [];
    let ax = sx;
    let az = sz;
    let i = 1;
    while (i < cells.length) {
      let j = cells.length - 1;
      for (; j > i; j--) {
        const c = cells[j]!;
        if (this.lineClear(ax, az, (c % size) + 0.5, Math.floor(c / size) + 0.5)) break;
      }
      const c = cells[j]!;
      ax = (c % size) + 0.5;
      az = Math.floor(c / size) + 0.5;
      points.push(ax, az);
      i = j + 1;
    }
    // End exactly where asked if that spot is as walkable as the cell.
    if (points.length >= 2 && cellHeight(this.arena, Math.floor(gx), Math.floor(gz)) <= ARENA.maxFloor) {
      points[points.length - 2] = gx;
      points[points.length - 1] = gz;
    }
    return points;
  }
}
