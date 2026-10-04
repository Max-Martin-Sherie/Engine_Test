import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/core/rng';
import {
  area,
  bisectingLine,
  boundingRadius,
  centroid,
  clipToSide,
  containsPoint,
  lineCrossings,
  place,
  splitAreas,
  type Vec,
} from '../src/game/sim/geometry';
import { evaluateCut, segmentHitsCircle } from '../src/game/sim/cut';
import { FRUIT_KINDS, makeFruitShape } from '../src/game/sim/fruit';

const square = (size: number, cx = 0, cy = 0): Vec[] => [
  { x: cx - size, y: cy - size },
  { x: cx + size, y: cy - size },
  { x: cx + size, y: cy + size },
  { x: cx - size, y: cy + size },
];

function circle(radius: number, n = 360, cx = 0, cy = 0): Vec[] {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + Math.cos((2 * Math.PI * i) / n) * radius,
    y: cy + Math.sin((2 * Math.PI * i) / n) * radius,
  }));
}

/** An L shape: concave. Area 3 (three unit squares). */
const ell: Vec[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
];

describe('polygon basics', () => {
  it('area is independent of winding, centroid is where it should be', () => {
    const sq = square(2);
    expect(area(sq)).toBe(16);
    expect(area([...sq].reverse())).toBe(16);
    expect(centroid(sq)).toEqual({ x: 0, y: 0 });
    const c = centroid(square(1, 10, -4));
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(-4, 9);
    expect(area(ell)).toBe(3);
  });

  it('a circle polygon approximates pi r^2', () => {
    expect(area(circle(10))).toBeCloseTo(Math.PI * 100, 1);
  });

  it('point in polygon, including concave notches', () => {
    expect(containsPoint(square(1), { x: 0, y: 0 })).toBe(true);
    expect(containsPoint(square(1), { x: 2, y: 0 })).toBe(false);
    expect(containsPoint(ell, { x: 0.5, y: 1.5 })).toBe(true);
    expect(containsPoint(ell, { x: 1.5, y: 1.5 })).toBe(false); // the notch
  });

  it('place rotates, scales and moves', () => {
    const [p] = place([{ x: 1, y: 0 }], 10, 20, Math.PI / 2, 3);
    expect(p!.x).toBeCloseTo(10, 9);
    expect(p!.y).toBeCloseTo(23, 9);
  });

  it('boundingRadius is the farthest vertex', () => {
    expect(boundingRadius(square(1))).toBeCloseTo(Math.SQRT2, 9);
  });
});

describe('splitting by a line', () => {
  it('a line through the middle of a square gives 50/50, an off-centre one gives the exact ratio', () => {
    const sq = square(1); // 2 x 2
    const mid = splitAreas(sq, { x: 0, y: -5 }, { x: 0, y: 5 });
    expect(mid.left).toBeCloseTo(2, 9);
    expect(mid.right).toBeCloseTo(2, 9);
    const off = splitAreas(sq, { x: 0.5, y: -5 }, { x: 0.5, y: 5 }); // 25% / 75%
    expect(Math.min(off.left, off.right)).toBeCloseTo(1, 9);
    expect(Math.max(off.left, off.right)).toBeCloseTo(3, 9);
  });

  it('the two sides always add up to the whole, whatever the angle', () => {
    const poly = [...circle(5, 90), ] as Vec[];
    for (let angle = 0; angle < Math.PI; angle += 0.37) {
      const a = { x: -20 * Math.cos(angle) + 1, y: -20 * Math.sin(angle) - 0.5 };
      const b = { x: 20 * Math.cos(angle) + 1, y: 20 * Math.sin(angle) - 0.5 };
      const s = splitAreas(poly, a, b);
      expect(s.left + s.right).toBeCloseTo(area(poly), 6);
    }
  });

  it('works on concave shapes: pieces on one side are summed', () => {
    // A horizontal line at y = 1.5 cuts only the vertical arm of the L (area 1 above, 2 below).
    const s = splitAreas(ell, { x: -5, y: 1.5 }, { x: 5, y: 1.5 });
    expect(Math.min(s.left, s.right)).toBeCloseTo(0.5, 9);
    expect(s.left + s.right).toBeCloseTo(3, 9);
    // A line at y = 0.5 crosses the L in the wide part only.
    const t = splitAreas(ell, { x: -5, y: 0.5 }, { x: 5, y: 0.5 });
    expect(Math.min(t.left, t.right)).toBeCloseTo(1, 9);
  });

  it('clipToSide keeps only the requested half', () => {
    const half = clipToSide(square(1), { x: 0, y: -5 }, { x: 0, y: 5 }, 1);
    expect(area(half)).toBeCloseTo(2, 9);
    // Everything kept is on one side of x = 0 (which side depends on the line's direction).
    expect(half.every((p) => p.x <= 1e-9) || half.every((p) => p.x >= -1e-9)).toBe(true);
    const other = clipToSide(square(1), { x: 0, y: -5 }, { x: 0, y: 5 }, -1);
    expect(area(other)).toBeCloseTo(2, 9);
    expect(Math.sign(half.reduce((s, p) => s + p.x, 0))).toBe(-Math.sign(other.reduce((s, p) => s + p.x, 0)));
  });

  it('lineCrossings reports where the infinite line meets the edges', () => {
    const ts = lineCrossings(square(1), { x: -3, y: 0 }, { x: 3, y: 0 });
    expect(ts).toHaveLength(2);
    expect(Math.min(...ts)).toBeCloseTo(2 / 6, 9);
    expect(Math.max(...ts)).toBeCloseTo(4 / 6, 9);
    expect(lineCrossings(square(1), { x: -3, y: 5 }, { x: 3, y: 5 })).toHaveLength(0);
  });

  it('a line exactly through a vertex is counted consistently (no lone crossing)', () => {
    const diamond: Vec[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    for (const [a, b] of [
      [{ x: -3, y: 0 }, { x: 3, y: 0 }],
      [{ x: 0, y: -3 }, { x: 0, y: 3 }],
      [{ x: -3, y: -3 }, { x: 3, y: 3 }],
    ] as const) {
      expect(lineCrossings(diamond, a, b).length % 2).toBe(0);
    }
  });
});

describe('bisectingLine', () => {
  it('finds an exact 50/50 line at any angle, for round and awkward shapes', () => {
    const shapes: Vec[][] = [circle(40, 200, 100, 200), square(30, 5, 5), ell.map((p) => ({ x: p.x * 20 + 50, y: p.y * 20 - 7 }))];
    const rng = createRng(3);
    for (const kind of FRUIT_KINDS) shapes.push(place(makeFruitShape(kind, rng, 64).outline, 180, 300, 0.4, 90));
    for (const poly of shapes) {
      for (let angle = 0; angle < Math.PI; angle += 0.5) {
        const { a, b } = bisectingLine(poly, angle);
        const s = splitAreas(poly, a, b);
        expect(Math.abs(s.left - s.right) / (s.left + s.right)).toBeLessThan(1e-6);
      }
    }
  });
});

describe('evaluateCut: the drag must go fully across', () => {
  const fruit = circle(50, 200, 180, 300);
  const MIN = 40;

  it('a clean drag through the middle is a perfect cut', () => {
    const r = evaluateCut(fruit, { x: 100, y: 300 }, { x: 260, y: 300 }, MIN);
    expect(r.kind).toBe('cut');
    if (r.kind === 'cut') expect(r.deviation).toBeLessThan(0.01);
  });

  it('an off-centre drag reports the deviation from 50/50 in percentage points', () => {
    // A chord 25 from the centre of a r=50 circle: the small segment is ~15.2% of the area.
    const r = evaluateCut(fruit, { x: 100, y: 325 }, { x: 260, y: 325 }, MIN);
    expect(r.kind).toBe('cut');
    if (r.kind === 'cut') {
      expect(r.deviation).toBeGreaterThan(30);
      expect(r.deviation).toBeLessThan(40);
    }
  });

  it('a drag that misses the fruit is a cancel', () => {
    expect(evaluateCut(fruit, { x: 100, y: 400 }, { x: 260, y: 400 }, MIN)).toEqual({ kind: 'cancel', reason: 'miss' });
  });

  it('a drag that stops short of the far edge is a cancel, as is one that starts or ends on the fruit', () => {
    expect(evaluateCut(fruit, { x: 100, y: 300 }, { x: 200, y: 300 }, MIN)).toEqual({ kind: 'cancel', reason: 'partial' }); // ends inside
    expect(evaluateCut(fruit, { x: 180, y: 300 }, { x: 260, y: 300 }, MIN)).toEqual({ kind: 'cancel', reason: 'partial' }); // starts inside
    expect(evaluateCut(fruit, { x: 100, y: 300 }, { x: 150, y: 300 }, MIN)).toEqual({ kind: 'cancel', reason: 'partial' }); // stops at the near edge
    expect(evaluateCut(fruit, { x: 100, y: 300 }, { x: 220, y: 300 }, MIN)).toEqual({ kind: 'cancel', reason: 'partial' }); // stops inside
  });

  it('a tap or tiny drag is a cancel (too short)', () => {
    expect(evaluateCut(fruit, { x: 180, y: 300 }, { x: 181, y: 300 }, MIN)).toEqual({ kind: 'cancel', reason: 'short' });
    expect(evaluateCut(fruit, { x: 10, y: 10 }, { x: 10, y: 10 }, MIN)).toEqual({ kind: 'cancel', reason: 'short' });
  });

  it('cuts concave fruit as long as the whole drag spans it', () => {
    const banana = place(makeFruitShape('banana', createRng(1), 64).outline, 180, 300, 0, 100);
    const { a, b } = bisectingLine(banana, 0.3);
    const r = evaluateCut(banana, a, b, MIN);
    expect(r.kind).toBe('cut');
    if (r.kind === 'cut') expect(r.deviation).toBeLessThan(0.001);
    // The same line, drawn only across the middle, does not cover every crossing.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(evaluateCut(banana, mid, b, MIN).kind).toBe('cancel');
  });

  it('every way of being off is reflected the same on both sides (direction does not matter)', () => {
    const forward = evaluateCut(fruit, { x: 100, y: 310 }, { x: 260, y: 310 }, MIN);
    const backward = evaluateCut(fruit, { x: 260, y: 310 }, { x: 100, y: 310 }, MIN);
    expect(forward.kind === 'cut' && backward.kind === 'cut' && Math.abs(forward.deviation - backward.deviation) < 1e-9).toBe(true);
  });
});

describe('segmentHitsCircle', () => {
  it('detects a segment passing through, touching, or missing a circle', () => {
    const c = { x: 50, y: 50 };
    expect(segmentHitsCircle({ x: 0, y: 50 }, { x: 100, y: 50 }, c, 10)).toBe(true);
    expect(segmentHitsCircle({ x: 0, y: 60 }, { x: 100, y: 60 }, c, 10)).toBe(true); // tangent
    expect(segmentHitsCircle({ x: 0, y: 70 }, { x: 100, y: 70 }, c, 10)).toBe(false);
    expect(segmentHitsCircle({ x: 0, y: 50 }, { x: 30, y: 50 }, c, 10)).toBe(false); // stops short
    expect(segmentHitsCircle({ x: 50, y: 50 }, { x: 50, y: 50 }, c, 10)).toBe(true); // a point inside
  });
});
