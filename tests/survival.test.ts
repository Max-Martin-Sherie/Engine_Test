import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  bisectingLine,
  createRun,
  drainEvents,
  endRun,
  fruitPolygon,
  restartRun,
  runCoins,
  runStats,
  splitAreas,
  stepRun,
  toleranceFor,
  type Run,
  type RunEvent,
  type Vec,
} from '../src/game/sim';

const SECOND = CONFIG.ticksPerSecond;
const MIN = CONFIG.survival.minTolerance;

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

const events = (run: Run): RunEvent[] => drainEvents(run);
const marginEvent = (list: RunEvent[]) => list.find((e) => e.type === 'margin');

describe('survival', () => {
  it('starts like Classic: one still fruit and the widest tolerance', () => {
    const run = createRun('survival', 1);
    expect(run.fruits).toHaveLength(1);
    expect(run.fruits[0]).toMatchObject({ vx: 0, vy: 0, spin: 0 });
    expect(run.tolerance).toBe(CONFIG.tolerance.survival.start);
    expect(run.penalty).toBe(0);
    expect(run.bombs).toHaveLength(0);
  });

  it('a good cut works exactly as in Classic', () => {
    const run = createRun('survival', 2);
    events(run);
    step(run, cutWithDeviation(run, 0));
    expect(run.round).toBe(1);
    expect(run.score).toBe(110);
    expect(run.penalty).toBe(0);
    waitForFruit(run);
    expect(run.tolerance).toBeCloseTo(toleranceFor('survival', 1), 9);
  });

  it('the tolerance never shrinks by itself: only misses take margin', () => {
    const run = createRun('survival', 10);
    const start = run.tolerance;
    for (let i = 0; i < 12; i++) {
      waitForFruit(run);
      expect(run.tolerance).toBeCloseTo(start, 9);
      step(run, cutWithDeviation(run, 0));
    }
    expect(run.round).toBe(12);
    expect(run.penalty).toBe(0);
  });

  it('a miss does not end the run: the amount it was over by comes off the tolerance', () => {
    const run = createRun('survival', 3);
    events(run);
    const start = run.tolerance; // 12
    step(run, cutWithDeviation(run, start + 8)); // off by 20, allowed 12: 8 over
    const list = events(run);
    const margin = marginEvent(list);
    expect(margin).toBeDefined();
    if (margin?.type === 'margin') {
      expect(margin.lost).toBeCloseTo(8, 1);
      expect(margin.remaining).toBeCloseTo(start - 8, 1);
    }
    expect(list.some((e) => e.type === 'failed')).toBe(false);
    expect(run.phase).toBe('playing');
    expect(run.penalty).toBeCloseTo(8, 1);
    expect(run.round).toBe(0); // the fruit was lost, not won
    expect(run.score).toBe(0);
    expect(run.fruits).toHaveLength(0);

    // The next fruit has the smaller tolerance.
    waitForFruit(run);
    expect(run.fruits).toHaveLength(1);
    expect(run.tolerance).toBeCloseTo(start - 8, 1);
  });

  it('misses add up, and nothing gives the margin back', () => {
    const run = createRun('survival', 4);
    step(run, cutWithDeviation(run, 15)); // 3 over
    waitForFruit(run);
    const afterOne = run.penalty;
    expect(afterOne).toBeCloseTo(3, 1);
    step(run, cutWithDeviation(run, run.tolerance + 2)); // 2 more
    waitForFruit(run);
    expect(run.penalty).toBeCloseTo(afterOne + 2, 1);
    // A perfect cut afterwards does not undo it.
    step(run, cutWithDeviation(run, 0));
    expect(run.penalty).toBeCloseTo(afterOne + 2, 1);
    waitForFruit(run);
    expect(run.tolerance).toBeCloseTo(toleranceFor('survival', 1) - run.penalty, 6);
  });

  it('the run ends once too little tolerance is left, exactly once, with the fruit still there', () => {
    const run = createRun('survival', 5);
    events(run);
    const first = run.fruits[0]!.id;
    // Over by 11.9 leaves 0.1, under the minimum.
    step(run, cutWithDeviation(run, run.tolerance + 11.9));
    const list = events(run);
    expect(list.filter((e) => e.type === 'failed')).toEqual([{ type: 'failed', reason: 'budget' }]);
    expect(run.phase).toBe('failed');
    expect(run.failReason).toBe('budget');
    expect(run.fruits[0]!.id).toBe(first);

    const frozen = structuredClone(run);
    step(run, cutWithDeviation(run, 0), 120);
    expect(run).toEqual(frozen);
  });

  it('stops exactly at the minimum', () => {
    const justEnough = createRun('survival', 6);
    step(justEnough, cutWithDeviation(justEnough, justEnough.tolerance + (12 - MIN) - 0.3));
    expect(justEnough.phase).toBe('playing'); // leaves a little more than the minimum
    const tooMuch = createRun('survival', 6);
    step(tooMuch, cutWithDeviation(tooMuch, tooMuch.tolerance + (12 - MIN) + 0.3));
    expect(tooMuch.phase).toBe('failed');
  });

  it('a retry takes the fatal miss back: same fruit, margin as it was before', () => {
    const run = createRun('survival', 7);
    step(run, cutWithDeviation(run, 16)); // 4 over: survivable
    waitForFruit(run);
    const penaltyBefore = run.penalty;
    const fruit = structuredClone(run.fruits[0]!);
    step(run, cutWithDeviation(run, run.tolerance + 20)); // fatal
    expect(run.phase).toBe('failed');
    expect(run.penalty).toBeGreaterThan(penaltyBefore);
    events(run);

    expect(restartRun(run)).toBe(true);
    expect(run.phase).toBe('playing');
    expect(run.restarts).toBe(1);
    expect(run.penalty).toBeCloseTo(penaltyBefore, 9);
    expect(run.fruits[0]).toEqual(fruit);
    expect(run.tolerance).toBeCloseTo(toleranceFor('survival', 0) - penaltyBefore, 9);

    // And the fruit can be won now.
    step(run, cutWithDeviation(run, 0));
    expect(run.round).toBe(1);
  });

  it('a run can last many misses when they are small', () => {
    const run = createRun('survival', 8);
    let misses = 0;
    while (run.phase === 'playing' && misses < 40) {
      waitForFruit(run);
      step(run, cutWithDeviation(run, run.tolerance + 0.4));
      misses++;
    }
    expect(misses).toBeGreaterThan(10);
  });

  it('pays coins like the other modes and records stats', () => {
    const run = createRun('survival', 9);
    step(run, cutWithDeviation(run, 0));
    waitForFruit(run);
    step(run, cutWithDeviation(run, run.tolerance + 3));
    endRun(run);
    const stats = runStats(run);
    expect(stats.fruits).toBe(1);
    expect(runCoins(stats)).toBeGreaterThan(0);
    expect(run.phase).toBe('over');
  });

  it('is deterministic', () => {
    const play = (seed: number): Run => {
      const run = createRun('survival', seed);
      for (let i = 0; i < 4; i++) {
        waitForFruit(run);
        step(run, cutWithDeviation(run, i === 2 ? run.tolerance + 2 : 0));
      }
      return run;
    };
    expect(play(33)).toEqual(play(33));
  });
});
