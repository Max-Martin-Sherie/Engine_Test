import { createMatch, drainEvents, stepMatch, type Difficulty, type Match } from '../../src/game/sim/testing';

export const MINUTE = 20 * 60;

/** Plays a match between two computer players to the end (or the limit) and returns it. */
export function play(seed: number, a: Difficulty, b: Difficulty, minutes = 40, watch?: (m: Match) => void): Match {
  const m = createMatch({ seed, ai: [true, true], difficulty: [a, b] });
  while (m.winner < 0 && m.tick < minutes * MINUTE) {
    stepMatch(m);
    drainEvents(m);
    watch?.(m);
  }
  return m;
}
