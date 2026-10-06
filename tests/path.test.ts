import { describe, expect, it } from 'vitest';
import { Pathfinder } from '../src/game/sim';

const N = 40;

/** A grid with the given rectangles blocked ([x0, y0, x1, y1], inclusive). */
function grid(rects: [number, number, number, number][] = []): Uint8Array {
  const g = new Uint8Array(N * N);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * N + x] = 1;
  return g;
}

/** Does walking the route stay out of blocked cells? */
function clear(g: Uint8Array, sx: number, sy: number, points: number[]): boolean {
  let x = sx;
  let y = sy;
  for (let i = 0; i < points.length; i += 2) {
    const tx = points[i]!;
    const ty = points[i + 1]!;
    const steps = Math.ceil(Math.hypot(tx - x, ty - y) / 0.1);
    for (let s = 0; s <= steps; s++) {
      const px = x + ((tx - x) * s) / Math.max(1, steps);
      const py = y + ((ty - y) * s) / Math.max(1, steps);
      if (g[Math.floor(py) * N + Math.floor(px)] === 1) return false;
    }
    x = tx;
    y = ty;
  }
  return true;
}

describe('pathfinding', () => {
  it('goes straight across open ground, in one leg', () => {
    const finder = new Pathfinder(N);
    const route = finder.find(grid(), 2.5, 2.5, 30.5, 25.5);
    expect(route).not.toBeNull();
    expect(route!.complete).toBe(true);
    expect(route!.points).toEqual([30.5, 25.5]);
  });

  it('goes around a wall, never through it', () => {
    const g = grid([[15, 5, 17, 34]]);
    const route = new Pathfinder(N).find(g, 5.5, 20.5, 30.5, 20.5)!;
    expect(route.complete).toBe(true);
    expect(route.points.length).toBeGreaterThanOrEqual(4); // at least one bend
    expect(clear(g, 5.5, 20.5, route.points)).toBe(true);
    expect(route.points.slice(-2)).toEqual([30.5, 20.5]);
  });

  it('squeezes through a gap and does not cut corners', () => {
    const g = grid([[15, 0, 17, 18], [15, 22, 17, 39]]);
    const route = new Pathfinder(N).find(g, 5.5, 20.5, 30.5, 20.5)!;
    expect(route.complete).toBe(true);
    expect(clear(g, 5.5, 20.5, route.points)).toBe(true);
  });

  it('goes to the nearest free cell when the goal is blocked', () => {
    const g = grid([[20, 20, 24, 24]]);
    const route = new Pathfinder(N).find(g, 5.5, 22.5, 22.5, 22.5)!;
    expect(route.complete).toBe(true);
    const end = [route.points[route.points.length - 2]!, route.points[route.points.length - 1]!];
    expect(g[Math.floor(end[1]!) * N + Math.floor(end[0]!)]).toBe(0);
    expect(Math.hypot(end[0]! - 22.5, end[1]! - 22.5)).toBeLessThan(5);
  });

  it('goes as close as it can when the goal cannot be reached, and says so', () => {
    const g = grid([[0, 20, 39, 22]]); // a wall right across the map
    const route = new Pathfinder(N).find(g, 20.5, 5.5, 20.5, 35.5)!;
    expect(route.complete).toBe(false);
    const y = route.points[route.points.length - 1]!;
    expect(y).toBeGreaterThan(15);
    expect(y).toBeLessThan(20);
  });

  it('returns null when standing in a sealed box with nowhere to go', () => {
    const g = grid([[10, 10, 14, 14]]);
    for (const [x, y] of [[12, 12]]) g[y! * N + x!] = 0;
    expect(new Pathfinder(N).find(g, 12.5, 12.5, 30.5, 30.5)).toBeNull();
  });

  it('is deterministic and reusable: the same question gives the same answer, again and again', () => {
    const g = grid([[10, 5, 12, 30], [25, 10, 27, 39]]);
    const finder = new Pathfinder(N);
    const first = finder.find(g, 3.5, 20.5, 35.5, 20.5)!;
    for (let i = 0; i < 5; i++) expect(finder.find(g, 3.5, 20.5, 35.5, 20.5)).toEqual(first);
    expect(finder.find(g, 3.5, 3.5, 8.5, 8.5)!.points).toEqual([8.5, 8.5]);
    expect(finder.find(g, 3.5, 20.5, 35.5, 20.5)).toEqual(first);
  });

  it('keeps a wide unit away from corners that a narrow one could pass', () => {
    const g = grid([[15, 0, 19, 19], [15, 21, 19, 39]]); // a one-cell gap at y = 20
    const narrow = new Pathfinder(N).find(g, 5.5, 20.5, 30.5, 20.5, 0.2)!;
    expect(clear(g, 5.5, 20.5, narrow.points)).toBe(true);
  });
});
