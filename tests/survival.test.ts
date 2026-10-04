import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  bisectingLine,
  createRun,
  drainEvents,
  endRun,
  fruitPolygon,
  lossMultiplierFor,
  restartRun,
  runCoins,
  runStats,
  spawnRound,
  splitAreas,
  stepRun,
  survivalAllowed,
  type Run,
  type RunEvent,
  type Vec,
} from '../src/game/sim';

const S = CONFIG.survival;
const SECOND = CONFIG.ticksPerSecond;

function step(run: Run, cut: { a: Vec; b: Vec } | null = null, times = 1): void {
  for (let i = 0; i < times; i++) stepRun(run, { cut: i === 0 ? cut : null });
}

function waitForFruit(run: Run): void {
  for (let i = 0; i < 5 * SECOND && run.fruits.length === 0 && run.phase === 'playing'; i++) step(run);
}

/** A drag across the first fruit that splits it with the given deviation from 50/50 (percentage points). */
function cutWithDeviation(run: Run, deviation: number, angle = 0.3): { a: Vec; b: Vec } {
  const poly = fruitPolygon(run.fruits[0]!);
  const base = bisectingLine(poly, angle);
  if (deviation === 0) return base;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const shifted = (t: number): { a: Vec; b: Vec } => ({
    a: { x: base.a.x + nx * t, y: base.a.y + ny * t },
    b: { x: base.b.x + nx * t, y: base.b.y + ny * t },
  });
  const dev = (t: number): number => {
    const { a, b } = shifted(t);
    const s = splitAreas(poly, a, b);
    return Math.abs(s.left / (s.left + s.right) - 0.5) * 100;
  };
  let lo = 0;
  let hi = run.fruits[0]!.radius * 0.97;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dev(mid) < deviation) lo = mid;
    else hi = mid;
  }
  return shifted((lo + hi) / 2);
}

/** A (nearly) perfect cut aimed through the bubble over the first fruit. */
function cutThroughBubble(run: Run): { a: Vec; b: Vec } {
  const fruit = run.fruits[0]!;
  const bubble = run.bubbles[0]!;
  return bisectingLine(fruitPolygon(fruit), Math.atan2(bubble.y - fruit.y, bubble.x - fruit.x));
}

/** The first seed whose opening fruit has a bubble (or none). */
function seedWith(bubble: boolean): number {
  for (let seed = 1; seed < 400; seed++) {
    if ((createRun('survival', seed).bubbles.length > 0) === bubble) return seed;
  }
  throw new Error('no such seed');
}

const events = (run: Run): RunEvent[] => drainEvents(run);
const marginEvent = (list: RunEvent[]) => list.find((e) => e.type === 'margin');

describe('survival margin', () => {
  it('starts with the widest margin, one still fruit, and a tolerance that follows from it', () => {
    const run = createRun('survival', seedWith(false));
    expect(run.fruits).toHaveLength(1);
    expect(run.fruits[0]).toMatchObject({ vx: 0, vy: 0, spin: 0 });
    expect(run.margin).toBe(S.startMargin);
    expect(run.tolerance).toBeCloseTo(survivalAllowed(S.startMargin, 0), 9);
    expect(run.bombs).toHaveLength(0);
  });

  it('a perfect cut costs nothing; any other cut costs its deviation', () => {
    const run = createRun('survival', seedWith(false));
    events(run);
    step(run, cutWithDeviation(run, 0));
    expect(run.round).toBe(1);
    expect(run.score).toBe(110);
    expect(run.margin).toBeCloseTo(S.startMargin, 1);
    events(run);

    waitForFruit(run);
    const before = run.margin;
    step(run, cutWithDeviation(run, 5));
    const margin = marginEvent(events(run));
    expect(margin).toBeDefined();
    if (margin?.type === 'margin') {
      expect(margin.lost).toBeCloseTo(5, 1);
      expect(margin.gained).toBe(0);
      expect(margin.remaining).toBeCloseTo(before - 5, 1);
    }
    expect(run.margin).toBeCloseTo(before - 5, 1);
    expect(run.round).toBe(2); // a cut that holds is a won fruit, not a lost one
    expect(run.phase).toBe('playing');
  });

  it('the next fruit allows what the margin allows', () => {
    const run = createRun('survival', seedWith(false));
    step(run, cutWithDeviation(run, 10));
    waitForFruit(run);
    expect(run.tolerance).toBeCloseTo(survivalAllowed(run.margin, run.round), 9);
    expect(run.tolerance).toBeLessThan(survivalAllowed(S.startMargin, 0));
  });

  it('a cut the margin cannot pay for ends the run, once, with the fruit still there', () => {
    const run = createRun('survival', seedWith(false));
    events(run);
    const first = run.fruits[0]!.id;
    step(run, cutWithDeviation(run, run.tolerance + 1.5));
    const list = events(run);
    expect(list.filter((e) => e.type === 'failed')).toEqual([{ type: 'failed', reason: 'budget' }]);
    expect(run.phase).toBe('failed');
    expect(run.failReason).toBe('budget');
    expect(run.fruits[0]!.id).toBe(first);
    expect(run.margin).toBe(S.startMargin); // nothing was spent

    const frozen = structuredClone(run);
    step(run, cutWithDeviation(run, 0), 120);
    expect(run).toEqual(frozen);
  });

  it('stops exactly where the margin runs out', () => {
    const fine = createRun('survival', seedWith(false));
    step(fine, cutWithDeviation(fine, fine.tolerance - 0.3));
    expect(fine.phase).toBe('playing'); // leaves a little more than the minimum
    const toomuch = createRun('survival', seedWith(false));
    step(toomuch, cutWithDeviation(toomuch, toomuch.tolerance + 0.3));
    expect(toomuch.phase).toBe('failed');
  });

  it('a try puts the same fruit back, with the margin it had before the fatal cut', () => {
    const run = createRun('survival', seedWith(false));
    step(run, cutWithDeviation(run, 10));
    waitForFruit(run);
    const marginBefore = run.margin;
    const fruit = structuredClone(run.fruits[0]!);
    step(run, cutWithDeviation(run, run.tolerance + 5));
    expect(run.phase).toBe('failed');
    events(run);

    expect(restartRun(run)).toBe(true);
    expect(run.phase).toBe('playing');
    expect(run.restarts).toBe(1);
    expect(run.margin).toBeCloseTo(marginBefore, 9);
    expect(run.fruits[0]).toEqual(fruit);
    expect(run.tolerance).toBeCloseTo(survivalAllowed(marginBefore, run.round), 9);

    step(run, cutWithDeviation(run, 0));
    expect(run.round).toBe(2);
  });
});

describe('survival bubbles', () => {
  it('sit over the fruit, off-centre, and are worth between the configured values', () => {
    const run = createRun('survival', seedWith(true));
    const fruit = run.fruits[0]!;
    const bubble = run.bubbles[0]!;
    expect(Math.hypot(bubble.x - fruit.x, bubble.y - fruit.y)).toBeCloseTo(fruit.radius * S.bubbleOffset, 6);
    expect(bubble.value).toBeGreaterThanOrEqual(S.bubbleMin);
    expect(bubble.value).toBeLessThanOrEqual(S.bubbleMax);
  });

  it('a drag through the bubble adds its value to the margin', () => {
    const run = createRun('survival', seedWith(true));
    events(run);
    run.margin = 15; // room to grow
    const value = run.bubbles[0]!.value;
    step(run, cutThroughBubble(run));
    const list = events(run);
    const cut = list.find((e) => e.type === 'cut');
    expect(cut?.type === 'cut' && cut.bubbles).toEqual([expect.objectContaining({ value })]);
    const margin = marginEvent(list);
    expect(margin?.type === 'margin' && margin.gained).toBe(value);
    expect(run.margin).toBeGreaterThan(15 + value - 6); // the cut itself cost a little
    expect(run.margin).toBeLessThanOrEqual(15 + value);
    expect(run.bubbles).toHaveLength(0);
  });

  it('a drag that misses the bubble gets nothing, and the bubble goes with the fruit', () => {
    const run = createRun('survival', seedWith(true));
    events(run);
    const fruit = run.fruits[0]!;
    const bubble = run.bubbles[0]!;
    // Across the fruit at right angles to the bubble: it passes the middle, far from the bubble.
    const line = bisectingLine(fruitPolygon(fruit), Math.atan2(bubble.y - fruit.y, bubble.x - fruit.x) + Math.PI / 2);
    run.margin = 15;
    step(run, line);
    const margin = marginEvent(events(run));
    expect(margin?.type === 'margin' && margin.gained).toBe(0);
    expect(run.margin).toBeLessThanOrEqual(15);
    expect(run.bubbles).toHaveLength(0);
  });

  it('cannot push the margin past the maximum', () => {
    const run = createRun('survival', seedWith(true));
    run.margin = S.maxMargin - 1;
    step(run, cutThroughBubble(run));
    expect(run.margin).toBeLessThanOrEqual(S.maxMargin);
    expect(run.margin).toBeGreaterThan(S.maxMargin - 3);
  });

  it('can rescue a cut that would otherwise have been fatal', () => {
    const run = createRun('survival', seedWith(true));
    run.margin = 3;
    run.tolerance = survivalAllowed(3, run.round);
    const fruit = run.fruits[0]!;
    const bubble = run.bubbles[0]!;
    const angle = Math.atan2(bubble.y - fruit.y, bubble.x - fruit.x);
    // Shift the line towards the bubble until the cut is worse than 3 allows but still hits the bubble.
    const poly = fruitPolygon(fruit);
    const base = bisectingLine(poly, angle);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    let found: { a: Vec; b: Vec } | null = null;
    for (let t = 0; t < bubble.r - 1 && !found; t += 0.25) {
      const l = { a: { x: base.a.x + nx * t, y: base.a.y + ny * t }, b: { x: base.b.x + nx * t, y: base.b.y + ny * t } };
      const sp = splitAreas(poly, l.a, l.b);
      const dev = Math.abs(sp.left / (sp.left + sp.right) - 0.5) * 100;
      if (dev > 3 && dev < 3 + bubble.value - 0.5) found = l;
    }
    expect(found).not.toBeNull();
    step(run, found);
    expect(run.phase).toBe('playing');
  });
});

describe('survival loss multiplier', () => {
  it('is 1 at first, then grows with the fruit cut, up to a cap', () => {
    expect(lossMultiplierFor(0)).toBe(1);
    expect(lossMultiplierFor(S.lossFrom)).toBe(1);
    expect(lossMultiplierFor(S.lossFrom + 5)).toBeCloseTo(1 + 5 * S.lossPerFruit, 9);
    expect(lossMultiplierFor(10_000)).toBe(S.maxLoss);
    let previous = 0;
    for (let n = 0; n < 100; n++) {
      expect(lossMultiplierFor(n)).toBeGreaterThanOrEqual(previous);
      previous = lossMultiplierFor(n);
    }
  });

  it('makes the same cut cost more later', () => {
    const early = createRun('survival', seedWith(false));
    step(early, cutWithDeviation(early, 2));
    const earlyLoss = S.startMargin - early.margin;

    const late = createRun('survival', seedWith(false));
    late.round = 20;
    late.fruits = [];
    spawnRound(late);
    late.bubbles = [];
    const before = late.margin;
    step(late, cutWithDeviation(late, 2));
    expect(before - late.margin).toBeCloseTo(earlyLoss * lossMultiplierFor(20), 1);
    expect(before - late.margin).toBeGreaterThan(earlyLoss * 1.5);
  });

  it('means no run lasts forever, even with small, steady errors', () => {
    const run = createRun('survival', 5);
    let cuts = 0;
    while (run.phase === 'playing' && cuts < 400) {
      waitForFruit(run);
      if (run.phase !== 'playing') break;
      step(run, cutWithDeviation(run, 1));
      cuts++;
    }
    expect(run.phase).toBe('failed');
    expect(cuts).toBeGreaterThan(10);
    expect(cuts).toBeLessThan(400);
  });

  it('lets a perfect cutter carry on (a perfect cut costs nothing at any multiplier)', () => {
    const run = createRun('survival', 6);
    for (let i = 0; i < 40; i++) {
      waitForFruit(run);
      step(run, cutWithDeviation(run, 0));
    }
    expect(run.phase).toBe('playing');
    expect(run.round).toBe(40);
  });
});

describe('survival in general', () => {
  it('pays coins like the other modes and records stats', () => {
    const run = createRun('survival', 9);
    step(run, cutWithDeviation(run, 0));
    waitForFruit(run);
    step(run, cutWithDeviation(run, 3));
    endRun(run);
    const stats = runStats(run);
    expect(stats.fruits).toBe(2);
    expect(runCoins(stats)).toBeGreaterThan(0);
    expect(run.phase).toBe('over');
  });

  it('is deterministic', () => {
    const play = (seed: number): Run => {
      const run = createRun('survival', seed);
      for (let i = 0; i < 6; i++) {
        waitForFruit(run);
        step(run, cutWithDeviation(run, i % 3));
      }
      return run;
    };
    expect(play(33)).toEqual(play(33));
  });
});
