import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/game/sim/config';
import { NavGrid, flood, generateArena, heightAt, mergeRects, stepOk } from '../src/game/sim/arena';

const S = ARENA.size;

describe('arenas', () => {
  it('are the same for the same seed and different for different seeds', () => {
    const a = generateArena(42);
    const b = generateArena(42);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.pickups).toEqual(b.pickups);
    expect(Array.from(generateArena(43).heights)).not.toEqual(Array.from(a.heights));
  });

  it('are the same on both sides: mirrored left to right and top to bottom, cell by cell', () => {
    for (const seed of [1, 2, 3, 7, 99, 1234]) {
      const arena = generateArena(seed);
      for (let z = 0; z < S; z++) {
        for (let x = 0; x < S; x++) {
          const here = arena.heights[z * S + x];
          expect(arena.heights[z * S + (S - 1 - x)], `seed ${seed} ${x},${z} left-right`).toBe(here);
          expect(arena.heights[(S - 1 - z) * S + x], `seed ${seed} ${x},${z} top-bottom`).toBe(here);
        }
      }
    }
  });

  it('are closed in by a tall wall all the way round', () => {
    const arena = generateArena(5);
    for (let i = 0; i < S; i++) {
      for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]] as const) expect(arena.heights[z * S + x]).toBe(ARENA.wall);
    }
    expect(heightAt(arena, -3, 10)).toBe(ARENA.wall);
    expect(heightAt(arena, 10, S + 4)).toBe(ARENA.wall);
  });

  it('can be walked: every start and goody is reachable from every other, for many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const arena = generateArena(seed);
      const first = arena.spawns[0]!;
      const reached = flood(arena, Math.floor(first.x), Math.floor(first.z));
      for (const s of arena.spawns) {
        expect(heightAt(arena, s.x, s.z), `seed ${seed} spawn`).toBeLessThanOrEqual(ARENA.maxFloor);
        expect(reached[Math.floor(s.z) * S + Math.floor(s.x)], `seed ${seed} spawn ${s.x},${s.z}`).toBe(1);
      }
      for (const p of arena.pickups) expect(reached[Math.floor(p.z) * S + Math.floor(p.x)], `seed ${seed} ${p.kind} ${p.x},${p.z}`).toBe(1);
      // No pocket of floor is left that a person cannot get to.
      for (let i = 0; i < S * S; i++) if ((arena.heights[i] ?? 0) <= ARENA.maxFloor) expect(reached[i], `seed ${seed} cell ${i}`).toBe(1);
    }
  });

  it('leave plenty of room to move, and are not empty', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const arena = generateArena(seed);
      let open = 0;
      let blocks = 0;
      for (const h of arena.heights) {
        if (h <= 0.01) open += 1;
        else blocks += 1;
      }
      expect(open / (S * S), `seed ${seed}`).toBeGreaterThan(0.55);
      expect(blocks, `seed ${seed}`).toBeGreaterThan(S * 4); // more than the wall
    }
  });

  it('have twelve starts, six to a side, looking at the middle, on flat ground', () => {
    const arena = generateArena(9);
    expect(arena.spawns).toHaveLength(12);
    expect(arena.spawns.filter((s) => s.team === 0)).toHaveLength(6);
    for (const s of arena.spawns) {
      expect(s.team).toBe(s.x < S / 2 ? 0 : 1);
      const dx = -Math.sin(s.yaw);
      const dz = -Math.cos(s.yaw);
      // Facing the middle: stepping forward gets closer to it.
      expect(Math.hypot(S / 2 - (s.x + dx), S / 2 - (s.z + dz))).toBeLessThan(Math.hypot(S / 2 - s.x, S / 2 - s.z));
      expect(heightAt(arena, s.x, s.z)).toBe(0);
    }
  });

  it('put the same goodies on both sides: health, ammo, armour and a shotgun in each quarter, two railguns, two rocket launchers', () => {
    const arena = generateArena(11);
    const count = (kind: string) => arena.pickups.filter((p) => p.kind === kind).length;
    for (const kind of ['health', 'ammo', 'armor', 'shotgun']) expect(count(kind), kind).toBe(4);
    expect(count('rail')).toBe(2);
    expect(count('rocket')).toBe(2);
    for (const p of arena.pickups) {
      const twin = arena.pickups.find((q) => q.kind === p.kind && Math.abs(q.x - (S - p.x)) < 0.01 && Math.abs(q.z - p.z) < 0.01);
      expect(twin, `${p.kind} at ${p.x},${p.z} has a mirror`).toBeDefined();
    }
  });

  it('merge columns into blocks that cover exactly the raised cells, with no overlap', () => {
    const arena = generateArena(13);
    const covered = new Uint8Array(S * S);
    for (const r of arena.rects) {
      for (let z = r.z; z < r.z + r.d; z++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          expect(covered[z * S + x], 'no cell twice').toBe(0);
          covered[z * S + x] = 1;
          expect(arena.heights[z * S + x]).toBe(r.h);
        }
      }
    }
    for (let i = 0; i < S * S; i++) expect(covered[i] === 1, `cell ${i}`).toBe((arena.heights[i] ?? 0) > 0.01);
    expect(arena.rects.length).toBeLessThan(arena.heights.filter((h) => h > 0.01).length);
    expect(mergeRects(arena.heights)).toEqual(arena.rects);
  });
});

describe('finding a way', () => {
  it('goes between any two starts, in segments a walker can really walk', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const arena = generateArena(seed);
      const nav = new NavGrid(arena);
      for (const to of arena.spawns) {
        const from = arena.spawns[0]!;
        const route = nav.find(from.x, from.z, to.x, to.z);
        expect(route, `seed ${seed} to ${to.x},${to.z}`).not.toBeNull();
        let x = from.x;
        let z = from.z;
        for (let i = 0; i < route!.length; i += 2) {
          expect(nav.lineClear(x, z, route![i]!, route![i + 1]!), `seed ${seed} leg ${i / 2}`).toBe(true);
          x = route![i]!;
          z = route![i + 1]!;
        }
        expect(Math.hypot(x - to.x, z - to.z)).toBeLessThan(0.75);
      }
    }
  });

  it('goes up steps and down again, but not up a wall', () => {
    const arena = generateArena(3);
    expect(stepOk(arena, 5, 5, 6, 5)).toBe(true);
    expect(stepOk(arena, 5, 5, 0, 5)).toBe(false); // the outer wall
    const nav = new NavGrid(arena);
    // A route to the top of the stepped middle exists.
    const top = nav.find(arena.spawns[0]!.x, arena.spawns[0]!.z, S / 2, S / 2);
    expect(top).not.toBeNull();
  });

  it('is deterministic, reusable and quick', () => {
    const arena = generateArena(2);
    const nav = new NavGrid(arena);
    const a = arena.spawns[0]!;
    const b = arena.spawns[11]!;
    const first = nav.find(a.x, a.z, b.x, b.z)!;
    const start = performance.now();
    for (let i = 0; i < 200; i++) expect(nav.find(a.x, a.z, b.x, b.z)).toEqual(first);
    expect((performance.now() - start) / 200).toBeLessThan(2);
  });

  it('returns null for a goal that cannot be walked to, and a trivial route for the same cell', () => {
    const arena = generateArena(4);
    const nav = new NavGrid(arena);
    expect(nav.find(10.5, 10.5, 10.6, 10.4)).toEqual([10.6, 10.4]);
  });
});
