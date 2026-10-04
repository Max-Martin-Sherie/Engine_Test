import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/core/rng';
import { CONFIG } from '../src/game/sim/config';
import { FRUIT_KINDS, makeFruitShape, pickKind } from '../src/game/sim/fruit';
import { createRun } from '../src/game/sim/run';
import { area, boundingRadius, centroid, containsPoint, type Vec } from '../src/game/sim/geometry';
import {
  accuracyFor,
  comboMultiplier,
  fruitRadiusFor,
  nextCombo,
  pointsFor,
  ratingFor,
  restartCost,
  runCoins,
  shouldShowInterstitial,
  toleranceFor,
} from '../src/game/sim/rules';

function segmentsIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const orient = (a: Vec, b: Vec, c: Vec): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** No two non-adjacent edges cross. */
function isSimple(poly: readonly Vec[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap-around
      if (segmentsIntersect(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

describe('fruit shapes', () => {
  it('every kind, for many seeds, is a valid, normalised, non-self-intersecting polygon', () => {
    for (const kind of FRUIT_KINDS) {
      for (let seed = 1; seed <= 25; seed++) {
        const shape = makeFruitShape(kind, createRng(seed), CONFIG.fruit.segments);
        const label = `${kind} #${seed}`;
        expect(shape.outline.length, label).toBeGreaterThanOrEqual(32);
        expect(isSimple(shape.outline), `${label} outline`).toBe(true);
        expect(isSimple(shape.inner), `${label} inner`).toBe(true);
        expect(boundingRadius(shape.outline), label).toBeCloseTo(1, 9);
        expect(area(shape.outline), label).toBeGreaterThan(0.3);
        const c = centroid(shape.outline);
        expect(Math.hypot(c.x, c.y), `${label} centred`).toBeLessThan(1e-9);
        // The flesh sits inside the skin.
        expect(area(shape.inner), label).toBeLessThan(area(shape.outline));
        const insideCount = shape.inner.filter((p) => containsPoint(shape.outline, p)).length;
        expect(insideCount, `${label} flesh inside skin`).toBe(shape.inner.length);
      }
    }
  });

  it('is deterministic for a seed, and different between seeds', () => {
    for (const kind of FRUIT_KINDS) {
      const a = makeFruitShape(kind, createRng(5), 64);
      const b = makeFruitShape(kind, createRng(5), 64);
      const c = makeFruitShape(kind, createRng(6), 64);
      expect(a).toEqual(b);
      expect(a.outline).not.toEqual(c.outline);
    }
  });

  it('the banana is concave and the round fruit are not', () => {
    const convexHullArea = (pts: Vec[]): number => {
      const sorted = [...pts].sort((p, q) => p.x - q.x || p.y - q.y);
      const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const half = (list: Vec[]): Vec[] => {
        const h: Vec[] = [];
        for (const p of list) {
          while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
          h.push(p);
        }
        h.pop();
        return h;
      };
      return area([...half(sorted), ...half([...sorted].reverse())]);
    };
    const banana = makeFruitShape('banana', createRng(2), 64).outline;
    const orange = makeFruitShape('orange', createRng(2), 64).outline;
    expect(area(banana) / convexHullArea(banana)).toBeLessThan(0.8);
    expect(area(orange) / convexHullArea(orange)).toBeGreaterThan(0.98);
    const star = makeFruitShape('starfruit', createRng(2), 64).outline;
    expect(area(star) / convexHullArea(star)).toBeLessThan(0.85);
  });

  it('has a big roster, with exotic fruit', () => {
    expect(FRUIT_KINDS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(FRUIT_KINDS).size).toBe(FRUIT_KINDS.length);
    for (const exotic of ['dragonfruit', 'kiwi', 'pineapple', 'mango', 'starfruit', 'pomegranate', 'passionfruit', 'lychee', 'papaya', 'coconut', 'avocado', 'strawberry', 'persimmon']) {
      expect(FRUIT_KINDS).toContain(exotic);
    }
  });

  it('any fruit can come up from the very first round: difficulty never decides the kind', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 600; seed++) seen.add(createRun('classic', seed).fruits[0]!.kind);
    expect([...seen].sort()).toEqual([...FRUIT_KINDS].sort());
  });

  it('shapes look like their fruit: stretched, tapered, starry', () => {
    const outline = (kind: Parameters<typeof makeFruitShape>[0], seed = 1) => makeFruitShape(kind, createRng(seed), 64).outline;
    const extent = (pts: Vec[]) => ({
      w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
      h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
    });
    expect(extent(outline('pineapple')).h).toBeGreaterThan(extent(outline('pineapple')).w * 1.2);
    expect(extent(outline('papaya')).h).toBeGreaterThan(extent(outline('papaya')).w * 1.3);
    expect(extent(outline('watermelon')).w).toBeGreaterThan(extent(outline('watermelon')).h * 1.2);

    /** Width of the shape in a horizontal band near the top versus near the bottom. */
    const widthAt = (pts: Vec[], from: number, to: number): number => {
      const ys = pts.map((p) => p.y);
      const lo = Math.min(...ys);
      const span = Math.max(...ys) - lo;
      const band = pts.filter((p) => p.y >= lo + span * from && p.y <= lo + span * to);
      return Math.max(...band.map((p) => p.x)) - Math.min(...band.map((p) => p.x));
    };
    for (const narrowTop of ['pear', 'avocado', 'papaya'] as const) {
      const pts = outline(narrowTop);
      expect(widthAt(pts, 0.05, 0.25), narrowTop).toBeLessThan(widthAt(pts, 0.75, 0.95));
    }
    const berry = outline('strawberry');
    expect(widthAt(berry, 0.05, 0.25)).toBeGreaterThan(widthAt(berry, 0.75, 0.95));

    // A star fruit has five points: five local peaks in distance from the middle.
    const star = outline('starfruit', 3);
    const dist = star.map((p) => Math.hypot(p.x, p.y));
    const peaks = dist.filter((d, i) => d > dist[(i + dist.length - 1) % dist.length]! && d >= dist[(i + 1) % dist.length]! && d > 0.85);
    expect(peaks).toHaveLength(5);
  });

  it('pickKind only returns what it is offered', () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickKind(['apple', 'lemon'], rng));
    expect([...seen].sort()).toEqual(['apple', 'lemon']);
  });
});

describe('difficulty curve', () => {
  it('tolerance starts wide, shrinks every fruit, and stops at the floor', () => {
    for (const mode of ['classic', 'arcade', 'survival'] as const) {
      const { start, floor, fruitsToFloor } = CONFIG.tolerance[mode];
      expect(toleranceFor(mode, 0)).toBeCloseTo(start, 9);
      let previous = Infinity;
      for (let n = 0; n <= fruitsToFloor + 20; n++) {
        const t = toleranceFor(mode, n);
        expect(t).toBeLessThanOrEqual(previous);
        expect(t).toBeGreaterThanOrEqual(floor - 1e-9);
        previous = t;
      }
      expect(toleranceFor(mode, fruitsToFloor)).toBeCloseTo(floor, 9);
      expect(toleranceFor(mode, 1e6)).toBeCloseTo(floor, 9);
      expect(toleranceFor(mode, -5)).toBeCloseTo(start, 9);
    }
  });

  it('classic tolerance is a constant ratio per fruit (smooth, not stepped)', () => {
    const r1 = toleranceFor('classic', 1) / toleranceFor('classic', 0);
    const r2 = toleranceFor('classic', 11) / toleranceFor('classic', 10);
    expect(r1).toBeCloseTo(r2, 9);
    expect(r1).toBeLessThan(1);
  });

  it('fruit shrink with progress down to a minimum', () => {
    expect(fruitRadiusFor(0)).toBe(CONFIG.fruit.startRadius);
    expect(fruitRadiusFor(CONFIG.fruit.fruitsToMinRadius)).toBe(CONFIG.fruit.minRadius);
    expect(fruitRadiusFor(1000)).toBe(CONFIG.fruit.minRadius);
    expect(fruitRadiusFor(10)).toBeLessThan(fruitRadiusFor(5));
  });
});

describe('rating and score', () => {
  it('accuracy is 100 for a perfect split and 0 for nothing on one side', () => {
    expect(accuracyFor(0)).toBe(100);
    expect(accuracyFor(2)).toBe(96); // a 52/48 cut
    expect(accuracyFor(50)).toBe(0);
  });

  it('rates by deviation', () => {
    expect(ratingFor(0)).toBe('perfect');
    expect(ratingFor(CONFIG.rating.perfect)).toBe('perfect');
    expect(ratingFor(CONFIG.rating.perfect + 0.01)).toBe('great');
    expect(ratingFor(CONFIG.rating.great)).toBe('great');
    expect(ratingFor(CONFIG.rating.great + 0.01)).toBe('good');
  });

  it('a perfect extends the combo, a great keeps it, a good breaks it', () => {
    expect(nextCombo(3, 'perfect')).toBe(4);
    expect(nextCombo(3, 'great')).toBe(3);
    expect(nextCombo(3, 'good')).toBe(0);
  });

  it('the combo multiplier grows then caps', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(5)).toBeCloseTo(1.5, 9);
    expect(comboMultiplier(CONFIG.scoring.comboMax)).toBeCloseTo(2, 9);
    expect(comboMultiplier(1000)).toBeCloseTo(2, 9);
  });

  it('points are accuracy times the multiplier, rounded', () => {
    expect(pointsFor(100, 0)).toBe(100);
    expect(pointsFor(96, 5)).toBe(144);
    expect(pointsFor(0, 9)).toBe(0);
  });
});

describe('economy', () => {
  it('pays coins for fruit, perfects and score', () => {
    expect(runCoins({ fruits: 0, perfects: 0, score: 0 })).toBe(0);
    const { perFruit, perPerfect, scoreDivisor } = CONFIG.economy;
    expect(runCoins({ fruits: 10, perfects: 4, score: 1050 })).toBe(10 * perFruit + 4 * perPerfect + Math.floor(1050 / scoreDivisor));
  });

  it('each try again costs double the last, up to a cap', () => {
    const { firstRestartCost, maxRestartCost } = CONFIG.economy;
    expect(restartCost(0)).toBe(firstRestartCost);
    expect(restartCost(1)).toBe(firstRestartCost * 2);
    expect(restartCost(2)).toBe(firstRestartCost * 4);
    expect(restartCost(50)).toBe(maxRestartCost);
    expect(restartCost(-3)).toBe(firstRestartCost);
    for (let n = 0; n < 12; n++) expect(restartCost(n + 1)).toBeGreaterThanOrEqual(restartCost(n));
  });
});

describe('interstitial pacing', () => {
  const base = { nowMs: 1_000_000, lastShownAtMs: null, watchedRewardedThisRun: false, ready: true };
  const gap = CONFIG.interstitial.minGapMs;

  it('shows one when ready and none has been shown yet', () => {
    expect(shouldShowInterstitial(base)).toBe(true);
  });

  it('never when none is loaded', () => {
    expect(shouldShowInterstitial({ ...base, ready: false })).toBe(false);
  });

  it('never right after the player chose to watch a rewarded ad', () => {
    expect(shouldShowInterstitial({ ...base, watchedRewardedThisRun: true })).toBe(false);
  });

  it('not again until the minimum gap has passed', () => {
    expect(shouldShowInterstitial({ ...base, lastShownAtMs: base.nowMs - (gap - 1) })).toBe(false);
    expect(shouldShowInterstitial({ ...base, lastShownAtMs: base.nowMs - gap })).toBe(true);
    expect(shouldShowInterstitial({ ...base, lastShownAtMs: base.nowMs - 10 * gap })).toBe(true);
  });
});
