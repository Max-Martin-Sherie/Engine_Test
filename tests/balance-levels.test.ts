import { describe, expect, it } from 'vitest';
import { play } from './helpers/play';

describe('difficulty levels', () => {
  it('the harder levels beat the easier ones, whichever side they start on', () => {
    for (const seed of [1, 2, 3]) {
      expect(play(seed, 'hard', 'easy').winner, `hard (side 0) vs easy, seed ${seed}`).toBe(0);
      expect(play(seed, 'easy', 'hard').winner, `easy vs hard (side 1), seed ${seed}`).toBe(1);
    }
  }, 60000);
});
