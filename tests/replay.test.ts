import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextRange } from '../src/engine/core/rng';
import { MAX_REPLAY_INT, decodeInts, encodeInts } from '../src/engine/core/replay';

describe('replay codec', () => {
  it('round-trips simple lists', () => {
    for (const list of [[], [0], [1], [-1], [5, 5, 5, 5], [0, 0, 0], [1, 2, 3, 2, 1, 0, -1, -2], [300, 640, 299, 641]]) {
      expect(decodeInts(encodeInts(list)), JSON.stringify(list)).toEqual(list);
    }
  });

  it('round-trips big, small and negative numbers exactly', () => {
    const list = [0, 1, -1, 127, 128, -128, 16383, 16384, 1_000_000, -1_000_000, MAX_REPLAY_INT, -MAX_REPLAY_INT, 0];
    expect(decodeInts(encodeInts(list))).toEqual(list);
  });

  it('round-trips random input-like sequences (slow changes, long holds, -1 gaps)', () => {
    const rng = createRng(7);
    for (let n = 0; n < 60; n++) {
      const list: number[] = [];
      let x = 180;
      let y = 400;
      const length = Math.floor(nextRange(rng, 0, 900));
      for (let i = 0; i < length; i++) {
        if (nextFloat(rng) < 0.3) {
          list.push(-1, -1);
        } else {
          if (nextFloat(rng) < 0.6) x = Math.round(Math.min(360, Math.max(0, x + nextRange(rng, -12, 12))));
          if (nextFloat(rng) < 0.6) y = Math.round(Math.min(640, Math.max(0, y + nextRange(rng, -12, 12))));
          list.push(x, y);
        }
      }
      expect(decodeInts(encodeInts(list))).toEqual(list);
    }
  });

  it('is URL-safe and compact for held inputs', () => {
    const held = Array.from({ length: 4000 }, () => 180);
    const text = encodeInts(held);
    expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(text.length).toBeLessThan(12); // a long hold is a few bytes, not thousands
    const moving = Array.from({ length: 400 }, (_, i) => 100 + Math.round(60 * Math.abs(((i % 40) - 20) / 20)));
    expect(encodeInts(moving).length).toBeLessThan(moving.length * 1.4);
  });

  it('is deterministic', () => {
    const list = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    expect(encodeInts(list)).toBe(encodeInts([...list]));
  });

  it('returns null for malformed text instead of throwing', () => {
    for (const bad of ['!', 'a!b', 'A', 'AAAAA', '=', 'abc def', 'é']) {
      expect(() => decodeInts(bad), bad).not.toThrow();
    }
    expect(decodeInts('!')).toBeNull();
    expect(decodeInts('a b')).toBeNull();
    expect(decodeInts('A')).toBeNull();
  });

  it('survives random garbage without throwing, and honours the size limit', () => {
    const rng = createRng(99);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let n = 0; n < 200; n++) {
      let text = '';
      const length = Math.floor(nextRange(rng, 0, 80));
      for (let i = 0; i < length; i++) text += alphabet.charAt(Math.floor(nextFloat(rng) * alphabet.length));
      expect(() => decodeInts(text)).not.toThrow();
    }
    // A tiny text that claims a billion repeats must be refused.
    const bomb = encodeInts([7, ...Array.from({ length: 50 }, () => 7)]);
    expect(decodeInts(bomb, 10)).toBeNull();
    expect(decodeInts(bomb)).toHaveLength(51);
  });

  it('refuses to encode what it cannot store exactly', () => {
    expect(() => encodeInts([1.5])).toThrow();
    expect(() => encodeInts([MAX_REPLAY_INT + 1])).toThrow();
    expect(() => encodeInts([Number.NaN])).toThrow();
  });
});
