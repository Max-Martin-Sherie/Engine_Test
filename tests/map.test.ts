import { describe, expect, it } from 'vitest';
import { Pathfinder, generateMap, MAP } from '../src/game/sim';

const S = MAP.size;

describe('maps', () => {
  it('are the same for the same seed and different for different seeds', () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(Array.from(a.rock)).toEqual(Array.from(b.rock));
    expect(a.bases).toEqual(b.bases);
    expect(a.resources).toEqual(b.resources);
    expect(Array.from(generateMap(43).rock)).not.toEqual(Array.from(a.rock));
  });

  it('give both sides the same ground, turned half way round', () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      const map = generateMap(seed);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          expect(map.rock[y * S + x], `seed ${seed} cell ${x},${y}`).toBe(map.rock[(S - 1 - y) * S + (S - 1 - x)]);
        }
      }
      const [a, b] = map.bases;
      expect(a!.x + b!.x).toBe(S);
      expect(a!.y + b!.y).toBe(S);
      const mineralsA = map.resources.filter((r) => r.type === 'minerals' && r.base === 0).map((r) => `${r.x},${r.y}`).sort();
      const mineralsB = map.resources.filter((r) => r.type === 'minerals' && r.base === 1).map((r) => `${S - 1 - r.x},${S - 1 - r.y}`).sort();
      expect(mineralsB).toEqual(mineralsA);
    }
  });

  it('have eight mineral patches at every base, and the starts have two geysers', () => {
    const map = generateMap(5);
    expect(map.bases).toHaveLength(6);
    for (let i = 0; i < map.bases.length; i++) {
      expect(map.resources.filter((r) => r.type === 'minerals' && r.base === i)).toHaveLength(8);
      expect(map.resources.filter((r) => r.type === 'geyser' && r.base === i)).toHaveLength(map.bases[i]!.start >= 0 ? 2 : 1);
    }
  });

  it('keep every base and its resources clear of rock, and the border closed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const map = generateMap(seed);
      for (const r of map.resources) expect(map.rock[r.y * S + r.x], `seed ${seed} resource ${r.x},${r.y}`).toBe(0);
      for (const b of map.bases) {
        for (let y = b.y - 2; y <= b.y + 1; y++) for (let x = b.x - 2; x <= b.x + 1; x++) expect(map.rock[y * S + x], `seed ${seed} hub ${x},${y}`).toBe(0);
      }
      for (let i = 0; i < S; i++) {
        expect(map.rock[i]).toBe(1);
        expect(map.rock[(S - 1) * S + i]).toBe(1);
        expect(map.rock[i * S]).toBe(1);
        expect(map.rock[i * S + S - 1]).toBe(1);
      }
    }
  });

  it('can be walked from any base to any other, for many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const map = generateMap(seed);
      const finder = new Pathfinder(S);
      const first = map.bases[0]!;
      for (const b of map.bases) {
        const route = finder.find(map.rock, first.x, first.y + 3, b.x, b.y + 3);
        expect(route, `seed ${seed} to base ${b.x},${b.y}`).not.toBeNull();
        expect(route!.complete, `seed ${seed} to base ${b.x},${b.y}`).toBe(true);
      }
    }
  });

  it('have some rock in the middle (they are not an empty field) and not too much', () => {
    for (const seed of [1, 2, 3, 4]) {
      const map = generateMap(seed);
      const inner = Array.from(map.rock).filter((v, i) => v === 1 && i % S > 4 && i % S < S - 5 && Math.floor(i / S) > 4 && Math.floor(i / S) < S - 5).length;
      expect(inner).toBeGreaterThan(80);
      expect(inner).toBeLessThan(2500);
    }
  });
});
