import { describe, expect, it } from 'vitest';
import {
  adRetriesLeft,
  CONFIG,
  bisectingLine,
  createRun,
  debugRun,
  drainEvents,
  endRun,
  fruitPolygon,
  restartRun,
  runStats,
  spawnRound,
  splitAreas,
  stepRun,
  type Run,
  type RunEvent,
  type Vec,
} from '../src/game/sim';

const dt = CONFIG.dt;
const SECOND = CONFIG.ticksPerSecond;

function step(run: Run, cut: { a: Vec; b: Vec } | null = null, times = 1): void {
  for (let i = 0; i < times; i++) stepRun(run, { cut: i === 0 ? cut : null });
}

/** Steps with no input until a fruit is on screen (after the pause that follows a cut). */
function waitForFruit(run: Run, maxSeconds = 5): void {
  for (let i = 0; i < maxSeconds * SECOND && run.fruits.length === 0 && run.phase === 'playing'; i++) step(run);
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
  let hi = run.fruits[0]!.radius * 0.95;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dev(mid) < deviation) lo = mid;
    else hi = mid;
  }
  return shifted((lo + hi) / 2);
}

const perfectCut = (run: Run) => cutWithDeviation(run, 0);

function events(run: Run): RunEvent[] {
  return drainEvents(run);
}

function cutEvent(list: RunEvent[]) {
  const e = list.find((x) => x.type === 'cut');
  if (!e || e.type !== 'cut') throw new Error('no cut event');
  return e;
}

describe('ad tries', () => {
  const fail = (run: ReturnType<typeof createRun>): void => {
    for (let i = 0; i < 400 && run.phase === 'playing'; i++) stepRun(run, { cut: null });
  };

  it('allow two retries by ad per run, then say no; coins have no such limit', () => {
    const run = createRun('arcade', 3, { startTime: 1 });
    fail(run);
    expect(run.phase).toBe('failed');
    expect(run.adRestarts).toBe(0);
    expect(restartRun(run, true)).toBe(true);
    expect(run.adRestarts).toBe(1);
    run.timeLeft = 0;
    run.phase = 'failed';
    expect(restartRun(run, true)).toBe(true);
    expect(run.adRestarts).toBe(2);
    run.phase = 'failed';
    expect(adRetriesLeft(run.adRestarts)).toBe(0);
    expect(restartRun(run, true)).toBe(false); // no third ad
    expect(run.phase).toBe('failed');
    expect(run.restarts).toBe(2);
    expect(restartRun(run)).toBe(true); // but coins still work
    expect(run.restarts).toBe(3);
    expect(run.adRestarts).toBe(2);
  });
});

describe('classic: a round', () => {
  it('starts with one still fruit at the centre, the widest tolerance and a spawn event', () => {
    const run = createRun('classic', 1);
    expect(run.phase).toBe('playing');
    expect(run.fruits).toHaveLength(1);
    expect(run.fruits[0]).toMatchObject({ x: CONFIG.fruit.centerX, y: CONFIG.fruit.centerY, vx: 0, vy: 0, spin: 0 });
    expect(run.tolerance).toBe(CONFIG.tolerance.classic.start);
    expect(run.bombs).toHaveLength(0);
    expect(events(run).map((e) => e.type)).toEqual(['spawn']);
  });

  it('a drag that does not cross the fruit is a cancel and changes nothing', () => {
    const run = createRun('classic', 2);
    events(run);
    const before = structuredClone({ ...run, events: [] });
    step(run, { a: { x: 20, y: 600 }, b: { x: 340, y: 600 } }); // far from the fruit: a miss
    expect(events(run)).toEqual([{ type: 'cancel', reason: 'miss', a: { x: 20, y: 600 }, b: { x: 340, y: 600 } }]); // carries the drag, for the view
    step(run, { a: { x: 180, y: 330 }, b: { x: 183, y: 330 } }); // a tap
    expect(events(run)).toMatchObject([{ type: 'cancel', reason: 'short' }]);
    const f = fruitPolygon(run.fruits[0]!);
    const inside = { x: f[0]!.x * 0.5 + 90, y: f[0]!.y * 0.5 + 165 };
    step(run, { a: inside, b: { x: 340, y: 100 } }); // starts on the fruit
    expect(events(run).map((e) => e.type)).toEqual(['cancel']);
    expect(run.phase).toBe('playing');
    expect(run.score).toBe(0);
    expect(run.round).toBe(0);
    expect(run.fruits[0]!.id).toBe(before.fruits[0]!.id);
    expect(run.restarts).toBe(0);
  });

  it('a perfect cut wins the round: points, combo, a Perfect rating and then the next fruit', () => {
    const run = createRun('classic', 3);
    events(run);
    const first = run.fruits[0]!;
    step(run, perfectCut(run));
    const cut = cutEvent(events(run));
    expect(cut.ok).toBe(true);
    expect(cut.rating).toBe('perfect');
    expect(cut.deviation).toBeLessThan(CONFIG.rating.perfect);
    expect(cut.pieces).toHaveLength(1);
    expect(cut.pieces[0]!.kind).toBe(first.kind);
    expect(cut.combo).toBe(1);
    expect(cut.points).toBe(Math.round(100 * 1.1));
    expect(run.score).toBe(cut.points);
    expect(run.round).toBe(1);
    expect(run.fruitsCut).toBe(1);
    expect(run.perfects).toBe(1);
    expect(run.fruits).toHaveLength(0);

    // Drags during the pause are ignored; then the next, smaller, harder fruit appears.
    step(run, { a: { x: 0, y: 330 }, b: { x: 360, y: 330 } });
    expect(events(run)).toEqual([]);
    waitForFruit(run);
    expect(run.fruits).toHaveLength(1);
    expect(run.fruits[0]!.id).not.toBe(first.id);
    expect(run.fruits[0]!.radius).toBeLessThan(first.radius);
    expect(run.tolerance).toBeLessThan(CONFIG.tolerance.classic.start);
  });

  it('a cut inside tolerance but not perfect still wins, with a lower rating and no combo', () => {
    const run = createRun('classic', 4);
    events(run);
    step(run, cutWithDeviation(run, 6));
    const cut = cutEvent(events(run));
    expect(cut.ok).toBe(true);
    expect(cut.rating).toBe('good');
    expect(cut.deviation).toBeCloseTo(6, 1);
    expect(cut.combo).toBe(0);
    expect(run.phase).toBe('playing');
  });

  it('a cut outside tolerance fails the run in the failed state, once', () => {
    const run = createRun('classic', 5);
    events(run);
    step(run, cutWithDeviation(run, 25));
    const list = events(run);
    expect(cutEvent(list)).toMatchObject({ ok: false, rating: 'miss', points: 0 });
    expect(list.filter((e) => e.type === 'failed')).toEqual([{ type: 'failed', reason: 'tolerance' }]);
    expect(run.phase).toBe('failed');
    expect(run.failReason).toBe('tolerance');
    expect(run.round).toBe(0);
  });

  it('is frozen once failed', () => {
    const run = createRun('classic', 6);
    step(run, cutWithDeviation(run, 25));
    events(run);
    const frozen = structuredClone(run);
    step(run, perfectCut(run), 120);
    expect(run).toEqual(frozen);
  });

  it('the tolerance is judged on the fruit on screen, and widens only through the curve', () => {
    const run = createRun('classic', 7);
    const first = run.tolerance;
    for (let i = 0; i < 5; i++) {
      waitForFruit(run);
      step(run, perfectCut(run));
    }
    expect(run.round).toBe(5);
    waitForFruit(run);
    expect(run.tolerance).toBeLessThan(first);
    expect(run.tolerance).toBeCloseTo(CONFIG.tolerance.classic.start * Math.pow(CONFIG.tolerance.classic.floor / CONFIG.tolerance.classic.start, 5 / 30), 9);
  });

  it('a streak of perfects builds the multiplier; a good cut breaks it', () => {
    const run = createRun('classic', 8);
    const points: number[] = [];
    for (let i = 0; i < 3; i++) {
      waitForFruit(run);
      step(run, perfectCut(run));
      points.push(cutEvent(events(run)).points);
    }
    expect(points).toEqual([110, 120, 130]);
    waitForFruit(run);
    step(run, cutWithDeviation(run, 2));
    expect(cutEvent(events(run)).combo).toBe(0);
    expect(run.combo).toBe(0);
  });
});

describe('classic: trying again', () => {
  function failedRun(seed: number): Run {
    const run = createRun('classic', seed);
    step(run, perfectCut(run));
    waitForFruit(run);
    step(run, cutWithDeviation(run, 30));
    events(run);
    expect(run.phase).toBe('failed');
    return run;
  }

  it('brings back exactly the same fruit, with the same tolerance, and counts the try', () => {
    const run = failedRun(11);
    const before = structuredClone(run.fruits[0]!);
    const tolerance = run.tolerance;
    expect(restartRun(run)).toBe(true);
    expect(run.phase).toBe('playing');
    expect(run.restarts).toBe(1);
    expect(run.fruits).toHaveLength(1);
    expect(run.fruits[0]).toEqual(before);
    expect(run.tolerance).toBe(tolerance);
    expect(run.failReason).toBeNull();
    expect(events(run).map((e) => e.type)).toEqual(['restarted']);
    // …and it can be won now.
    step(run, perfectCut(run));
    expect(cutEvent(events(run)).ok).toBe(true);
    expect(run.round).toBe(2);
  });

  it('can be repeated, and the count keeps climbing', () => {
    const run = failedRun(12);
    restartRun(run);
    step(run, cutWithDeviation(run, 30));
    expect(run.phase).toBe('failed');
    expect(restartRun(run)).toBe(true);
    expect(run.restarts).toBe(2);
  });

  it('only works from the failed state', () => {
    const run = createRun('classic', 13);
    expect(restartRun(run)).toBe(false);
    expect(run.restarts).toBe(0);
    endRun(run);
    expect(restartRun(run)).toBe(false);
  });

  it('giving up ends the run once', () => {
    const run = failedRun(14);
    events(run);
    endRun(run);
    endRun(run);
    expect(run.phase).toBe('over');
    expect(events(run)).toEqual([{ type: 'over' }]);
    const frozen = structuredClone(run);
    step(run, perfectCut(run) as never, 30);
    expect(run).toEqual(frozen);
  });

  it('a retried run keeps its score and progress', () => {
    const run = failedRun(15);
    const { score, round, fruitsCut } = run;
    restartRun(run);
    expect({ score: run.score, round: run.round, fruitsCut: run.fruitsCut }).toEqual({ score, round, fruitsCut });
    expect(run.combo).toBe(0);
  });
});

describe('determinism', () => {
  it('the same seed and the same drags give an identical run, events included', () => {
    const play = (seed: number): Run => {
      const run = createRun('classic', seed);
      for (let i = 0; i < 6; i++) {
        waitForFruit(run);
        step(run, i === 4 ? cutWithDeviation(run, 3) : perfectCut(run));
      }
      return run;
    };
    expect(play(77)).toEqual(play(77));
    expect(play(77).snapshot).not.toEqual(play(78).snapshot); // a different seed deals different fruit
  });

  it('arcade is deterministic too, motion included', () => {
    const play = (seed: number): Run => {
      const run = createRun('arcade', seed);
      run.round = 9;
      spawnRound(run);
      step(run, null, 200);
      return run;
    };
    expect(play(5)).toEqual(play(5));
    expect(play(5)).not.toEqual(play(6));
  });

  it('never uses Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('sim must not call Math.random');
    };
    try {
      const run = createRun('arcade', 3);
      run.round = 12;
      spawnRound(run);
      step(run, null, 300);
    } finally {
      Math.random = real;
    }
  });
});

describe('arcade', () => {
  it('starts with a clock and no strikes, and the clock runs', () => {
    const run = createRun('arcade', 1);
    expect(run.timeLeft).toBe(CONFIG.arcade.startTime);
    expect(run.strikes).toBe(0);
    step(run, null, SECOND);
    expect(run.timeLeft).toBeCloseTo(CONFIG.arcade.startTime - 1, 6);
  });

  it('the first fruit are still; chaos arrives with progress', () => {
    const run = createRun('arcade', 2);
    expect(run.fruits[0]).toMatchObject({ vx: 0, vy: 0, spin: 0 });
    expect(run.bombs).toHaveLength(0);

    run.round = CONFIG.arcade.driftFrom;
    spawnRound(run);
    expect(Math.hypot(run.fruits[0]!.vx, run.fruits[0]!.vy)).toBeGreaterThan(5);

    run.round = CONFIG.arcade.spinFrom;
    spawnRound(run);
    expect(Math.abs(run.fruits[0]!.spin)).toBeGreaterThan(0.3);

    run.round = CONFIG.arcade.bombsFrom;
    spawnRound(run);
    expect(run.bombs.length).toBeGreaterThanOrEqual(1);
  });

  it('moving fruit stay inside the roaming bounds and keep moving', () => {
    const run = createRun('arcade', 3);
    run.round = 15;
    spawnRound(run);
    const { left, right, top, bottom } = CONFIG.arcade.bounds;
    const start = run.fruits.map((f) => ({ x: f.x, y: f.y }));
    for (let i = 0; i < 20 * SECOND; i++) {
      step(run);
      for (const f of run.fruits) {
        expect(f.x - f.radius).toBeGreaterThanOrEqual(left - 1e-6);
        expect(f.x + f.radius).toBeLessThanOrEqual(right + 1e-6);
        expect(f.y - f.radius).toBeGreaterThanOrEqual(top - 1e-6);
        expect(f.y + f.radius).toBeLessThanOrEqual(bottom + 1e-6);
      }
      run.timeLeft = 50; // keep the clock out of the way
    }
    expect(run.fruits.some((f, i) => f.x !== start[i]!.x || f.y !== start[i]!.y)).toBe(true);
  });

  it('twin fruit appear later, need one line through both, and get a looser tolerance', () => {
    let twins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const run = createRun('arcade', seed);
      run.round = CONFIG.arcade.twinFrom + 2;
      spawnRound(run);
      if (run.fruits.length === 2) {
        twins++;
        expect(run.tolerance).toBeCloseTo(
          CONFIG.tolerance.arcade.start * Math.pow(CONFIG.tolerance.arcade.floor / CONFIG.tolerance.arcade.start, (CONFIG.arcade.twinFrom + 2) / CONFIG.tolerance.arcade.fruitsToFloor) * CONFIG.arcade.twinToleranceFactor,
          9,
        );
      }
    }
    expect(twins).toBeGreaterThan(2);
    expect(twins).toBeLessThan(25);
    for (let seed = 1; seed <= 20; seed++) {
      const early = createRun('arcade', seed);
      expect(early.fruits).toHaveLength(1);
    }
  });

  it('a good cut adds time (more for a Perfect) and the clock never exceeds its cap', () => {
    const run = createRun('arcade', 4);
    run.timeLeft = 20;
    step(run, perfectCut(run));
    expect(run.timeLeft).toBeCloseTo(20 - dt + CONFIG.arcade.timeBonus + CONFIG.arcade.perfectTimeBonus, 6);
    waitForFruit(run);
    run.timeLeft = CONFIG.arcade.maxTime - 1;
    step(run, perfectCut(run));
    expect(run.timeLeft).toBe(CONFIG.arcade.maxTime);
  });

  it('a mistake costs a strike and time, loses the fruit, and play goes on', () => {
    const run = createRun('arcade', 5);
    events(run);
    step(run, cutWithDeviation(run, 40));
    expect(run.strikes).toBe(1);
    expect(run.timeLeft).toBeCloseTo(CONFIG.arcade.startTime - dt - CONFIG.arcade.penaltyTime, 6);
    expect(run.phase).toBe('playing');
    expect(run.fruits).toHaveLength(0);
    expect(events(run).map((e) => e.type)).toEqual(['cut', 'strike']);
    waitForFruit(run);
    expect(run.fruits).toHaveLength(1);
  });

  it('a cancel costs nothing but the clock keeps running', () => {
    const run = createRun('arcade', 6);
    events(run);
    step(run, { a: { x: 10, y: 600 }, b: { x: 350, y: 600 } });
    expect(events(run)).toMatchObject([{ type: 'cancel', reason: 'miss' }]);
    expect(run.strikes).toBe(0);
    expect(run.timeLeft).toBeCloseTo(CONFIG.arcade.startTime - dt, 9);
  });

  it('the third strike ends the run (failed: strikes)', () => {
    const run = createRun('arcade', 7);
    for (let i = 0; i < CONFIG.arcade.maxStrikes; i++) {
      waitForFruit(run);
      step(run, cutWithDeviation(run, 40));
    }
    expect(run.phase).toBe('failed');
    expect(run.failReason).toBe('strikes');
    expect(run.strikes).toBe(CONFIG.arcade.maxStrikes);
  });

  it('running out of time ends the run (failed: time), exactly once', () => {
    const run = createRun('arcade', 8, { startTime: 2 });
    step(run, null, 3 * SECOND);
    expect(run.phase).toBe('failed');
    expect(run.failReason).toBe('time');
    expect(run.timeLeft).toBe(0);
    expect(events(run).filter((e) => e.type === 'failed')).toHaveLength(1);
  });

  it('a bomb on the drag voids the cut, costs a strike, and is removed; the fruit stays', () => {
    const run = createRun('arcade', 9);
    events(run);
    const cut = perfectCut(run);
    const mid = { x: (cut.a.x + cut.b.x) / 2, y: (cut.a.y + cut.b.y) / 2 };
    run.bombs.push({ id: 999, x: mid.x, y: mid.y, prevX: mid.x, prevY: mid.y, r: 20, vx: 0, vy: 0 });
    const fruitId = run.fruits[0]!.id;
    step(run, cut);
    expect(events(run).map((e) => e.type)).toEqual(['bomb', 'strike']);
    expect(run.strikes).toBe(1);
    expect(run.score).toBe(0);
    expect(run.bombs).toHaveLength(0);
    expect(run.fruits[0]!.id).toBe(fruitId);
    // Cutting around where the bomb was now works.
    step(run, cut);
    expect(cutEvent(events(run)).ok).toBe(true);
  });

  it('trying again gives time back, forgives strikes down to one, and counts the try', () => {
    const run = createRun('arcade', 10);
    for (let i = 0; i < CONFIG.arcade.maxStrikes; i++) {
      waitForFruit(run);
      step(run, cutWithDeviation(run, 40));
    }
    expect(run.phase).toBe('failed');
    run.timeLeft = 2;
    expect(restartRun(run)).toBe(true);
    expect(run.phase).toBe('playing');
    expect(run.timeLeft).toBe(CONFIG.arcade.continueTime);
    expect(run.strikes).toBe(CONFIG.arcade.continueStrikes);
    expect(run.restarts).toBe(1);
    waitForFruit(run);
    expect(run.fruits.length).toBeGreaterThan(0);
  });

  it('twin fruit are cut together: if the line misses one it is a cancel', () => {
    let tested = false;
    for (let seed = 1; seed <= 40 && !tested; seed++) {
      const run = createRun('arcade', seed);
      run.round = CONFIG.arcade.twinFrom + 2;
      spawnRound(run);
      if (run.fruits.length !== 2) continue;
      tested = true;
      events(run);
      const [left] = run.fruits;
      step(run, bisectingLine(fruitPolygon(left!), 0.2)); // bisects one, misses or only partly crosses the other
      const list = events(run);
      expect(list.some((e) => e.type === 'cancel') || list.some((e) => e.type === 'cut')).toBe(true);
      if (list.some((e) => e.type === 'cut')) expect(cutEvent(list).pieces).toHaveLength(2);
    }
    expect(tested).toBe(true);
  });
});

describe('stats and debugging', () => {
  it('runStats summarises a run', () => {
    const run = createRun('classic', 21);
    for (let i = 0; i < 3; i++) {
      waitForFruit(run);
      step(run, perfectCut(run));
    }
    const stats = runStats(run);
    expect(stats).toMatchObject({ fruits: 3, perfects: 3, score: run.score });
    expect(stats.accuracy).toBeGreaterThan(99);
    expect(runStats(createRun('classic', 1)).accuracy).toBe(0);
  });

  it('debugRun is JSON-friendly and includes the world polygons tests need', () => {
    const run = createRun('classic', 22);
    const dump = JSON.parse(JSON.stringify(debugRun(run))) as { fruits: { polygon: Vec[] }[]; tolerance: number };
    expect(dump.fruits[0]!.polygon.length).toBe(CONFIG.fruit.segments);
    expect(dump.tolerance).toBe(CONFIG.tolerance.classic.start);
  });
});
