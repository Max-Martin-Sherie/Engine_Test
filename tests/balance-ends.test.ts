import { expect, it } from 'vitest';
import { play } from './helpers/play';

it('every match ends with a winner inside half an hour, and there are no draws', () => {
  for (const seed of [1, 2, 3]) {
    const m = play(seed, 'normal', 'normal', 30);
    expect(m.winner, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    expect(m.winner, `seed ${seed}`).toBeLessThanOrEqual(1);
    expect(m.players[m.winner === 0 ? 1 : 0]!.defeated).toBe(true);
  }
}, 90000);
