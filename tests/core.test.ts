import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixedLoop } from '../src/engine/core/loop';
import { createRng, nextFloat, nextRange } from '../src/engine/core/rng';
import { safeGetItem, safeGetNumber, safeSetItem, safeSetNumber } from '../src/engine/core/storage';

describe('rng (mulberry32)', () => {
  // The well-known reference implementation, as a closure.
  function reference(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('matches the reference implementation', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef, 2 ** 32 + 5]) {
      const rng = createRng(seed);
      const expected = reference(seed);
      for (let i = 0; i < 1000; i++) expect(nextFloat(rng)).toBe(expected());
    }
  });

  it('keeps all of its state in one uint32 and stays in [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 5000; i++) {
      const v = nextFloat(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger(rng.s) && rng.s >= 0 && rng.s < 2 ** 32).toBe(true);
    }
  });

  it('nextRange stays within bounds', () => {
    const rng = createRng(5);
    for (let i = 0; i < 1000; i++) {
      const v = nextRange(rng, -3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });
});

describe('FixedLoop', () => {
  // 1/64 s = 15.625 ms: every number below is exact in binary, so there is no float fuzz.
  const STEP = 1 / 64;
  const MS = 1000 * STEP;

  function makeLoop() {
    const updates: number[] = [];
    const alphas: number[] = [];
    const loop = new FixedLoop(
      { update: (dt) => updates.push(dt), render: (a) => alphas.push(a) },
      { step: STEP },
    );
    return { loop, updates, alphas };
  }

  it('runs whole fixed steps and renders with the leftover as alpha', () => {
    const { loop, updates, alphas } = makeLoop();
    loop.frame(0);
    expect(updates).toHaveLength(0); // the first frame only sets the clock
    loop.frame(MS * 3.5);
    expect(updates).toEqual([STEP, STEP, STEP]);
    expect(alphas.at(-1)).toBe(0.5);
    loop.frame(MS * 3.5 + MS * 0.5);
    expect(updates).toHaveLength(4);
    expect(alphas.at(-1)).toBe(0);
  });

  it('renders once per frame, even when no step is due', () => {
    const { loop, updates, alphas } = makeLoop();
    loop.frame(0);
    loop.frame(MS * 0.25);
    expect(updates).toHaveLength(0);
    expect(alphas).toEqual([0, 0.25]);
  });

  it('clamps long frames to 0.25 s', () => {
    const { loop, updates } = makeLoop();
    loop.frame(0);
    loop.frame(60_000); // a minute in the background
    expect(updates).toHaveLength(0.25 / STEP);
  });

  it('ignores a clock that goes backwards', () => {
    const { loop, updates } = makeLoop();
    loop.frame(1000);
    loop.frame(500);
    expect(updates).toHaveLength(0);
  });

  it('resetClock makes the next frame start from zero', () => {
    const { loop, updates } = makeLoop();
    loop.frame(0);
    loop.resetClock();
    loop.frame(10_000);
    expect(updates).toHaveLength(0);
  });
});

describe('safe storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(store: Record<string, string>) {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    });
  }

  it('round-trips numbers', () => {
    stubStorage({});
    expect(safeGetNumber('best', 0)).toBe(0);
    expect(safeSetNumber('best', 17)).toBe(true);
    expect(safeGetNumber('best', 0)).toBe(17);
  });

  it('falls back on corrupt values', () => {
    for (const bad of ['abc', '-5', 'NaN', 'Infinity']) {
      stubStorage({ best: bad });
      expect(safeGetNumber('best', 3)).toBe(3);
    }
  });

  it('never throws when storage is broken', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(safeGetItem('x')).toBeNull();
    expect(safeGetNumber('x', 9)).toBe(9);
    expect(safeSetItem('x', '1')).toBe(false);
    expect(safeSetNumber('x', 1)).toBe(false);
  });

  it('never throws when localStorage does not exist', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(safeGetNumber('x', 4)).toBe(4);
    expect(safeSetNumber('x', 1)).toBe(false);
  });

  it('never throws when merely touching localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(safeGetItem('x')).toBeNull();
      expect(safeSetItem('x', '1')).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
