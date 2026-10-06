import { describe, expect, it } from 'vitest';
import { MIN_SCALE, SETTLE, STEP, adaptQuality, createQuality } from '../src/game/quality';

/** Plays `seconds` of frames, each `dt` long, starting at `from`; returns the clock afterwards. */
function play(q: ReturnType<typeof createQuality>, dt: number, seconds: number, from: number): { now: number; lowered: number } {
  let now = from;
  let lowered = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    now += dt;
    if (adaptQuality(q, dt, now)) lowered += 1;
  }
  return { now, lowered };
}

describe('adaptive resolution', () => {
  it('leaves a device that keeps up alone', () => {
    const q = createQuality();
    const { lowered } = play(q, 1 / 60, 60, 0);
    expect(lowered).toBe(0);
    expect(q.scale).toBe(1);
  });

  it('lowers the resolution on a device that cannot keep up, a step at a time, down to a floor', () => {
    const q = createQuality();
    const first = play(q, 1 / 20, 4, 0); // 20 fps: the first judgement comes after the settling time
    expect(first.lowered).toBe(1);
    expect(q.scale).toBeLessThan(1);
    expect(q.scale).toBeCloseTo(STEP, 5);
    const rest = play(q, 1 / 20, 120, first.now);
    expect(rest.lowered).toBeGreaterThanOrEqual(1);
    expect(q.scale).toBe(MIN_SCALE); // never below the floor, however slow
    expect(play(q, 1 / 5, 30, rest.now).lowered).toBe(0);
  });

  it('waits for the average to settle between steps', () => {
    const q = createQuality();
    const times: number[] = [];
    let now = 0;
    for (let i = 0; i < 20 * 40; i++) {
      now += 1 / 20;
      if (adaptQuality(q, 1 / 20, now)) times.push(now);
    }
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(SETTLE);
  });

  it('is not fooled by one long hitch, such as a menu opening or a garbage collection', () => {
    const q = createQuality();
    let now = play(q, 1 / 60, 10, 0).now;
    now += 0.4;
    expect(adaptQuality(q, 0.4, now)).toBe(false);
    expect(play(q, 1 / 60, 10, now).lowered).toBe(0);
    expect(q.scale).toBe(1);
  });

  it('can start from a lower scale (a pinned test run)', () => {
    expect(createQuality(0.8).scale).toBe(0.8);
  });
});
