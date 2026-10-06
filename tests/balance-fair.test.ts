import { expect, it } from 'vitest';
import { play } from './helpers/play';

it('is fair: neither side wins every time when the two are equal', () => {
  let first = 0;
  for (let seed = 1; seed <= 6; seed++) if (play(seed, 'normal', 'normal').winner === 0) first += 1;
  expect(first).toBeGreaterThanOrEqual(1);
  expect(first).toBeLessThanOrEqual(5);
}, 90000);
