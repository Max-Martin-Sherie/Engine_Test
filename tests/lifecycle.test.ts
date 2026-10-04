import { describe, expect, it, vi } from 'vitest';
import { CONFIG, createState, drainEvents, revive, scoreOf, step, timeOf, type GameState, type Input } from '../src/game/sim';

/**
 * Engine lifecycle tests: ticks, score, death, revive, events, determinism.
 *
 * sim/game.ts is mocked with a trivial rule (the player dies every DIE_EVERY ticks, unless
 * invulnerable), so these tests pass unchanged on every game branch whatever its real rules are.
 * Test your own rules in a separate file.
 */
const DIE_EVERY = 300;

vi.mock('../src/game/sim/game', () => ({
  createGameData: () => ({}),
  updateGame: (state: { tick: number; invuln: number }) => state.invuln <= 0 && state.tick % DIE_EVERY === 0,
  onRevive: () => {},
  syncGamePrev: () => {},
  debugSnapshot: () => ({}),
}));

const { dt, ticksPerSecond } = CONFIG;
const STILL: Input = { targetX: null };
const PERIOD = DIE_EVERY;
const DIE_EVERY_SECONDS = DIE_EVERY / ticksPerSecond;

function run(state: GameState, steps: number, inputFor: (i: number) => Input = () => STILL): void {
  for (let i = 0; i < steps; i++) step(state, inputFor(i));
}

function runUntilDead(state: GameState, maxSteps = PERIOD * 4): number {
  for (let i = 0; i < maxSteps; i++) {
    step(state, STILL);
    if (!state.alive) return i + 1;
  }
  throw new Error(`still alive after ${maxSteps} steps`);
}

describe('state', () => {
  it('starts alive at tick 0 with the given seed', () => {
    const state = createState(1234);
    expect(state).toMatchObject({ seed: 1234, tick: 0, alive: true, invuln: 0, reviveUsed: false, events: [] });
    expect(state.rng.s).toBe(1234);
  });

  it('is deterministic: same seed and inputs give a deep-equal state', () => {
    const a = createState(7);
    const b = createState(7);
    const input = (i: number): Input => ({ targetX: 50 + (i % 200) });
    run(a, PERIOD + 100, input);
    run(b, PERIOD + 100, input);
    expect(a).toEqual(b);
    expect(createState(8)).not.toEqual(createState(7));
  });

  it('does not depend on Math.random', () => {
    const realRandom = Math.random;
    Math.random = () => {
      throw new Error('sim must not call Math.random');
    };
    try {
      run(createState(5), PERIOD + 50);
    } finally {
      Math.random = realRandom;
    }
  });

  });

describe('ticking and score', () => {
  it('counts fixed steps; score is whole seconds survived', () => {
    const state = createState(1);
    expect(scoreOf(state)).toBe(0);
    run(state, ticksPerSecond - 1);
    expect(scoreOf(state)).toBe(0);
    run(state, 1);
    expect(scoreOf(state)).toBe(1);
    expect(timeOf(state)).toBeCloseTo(1, 9);
    expect(state.tick).toBe(ticksPerSecond);
    expect(dt * ticksPerSecond).toBeCloseTo(1, 9);
  });
});

describe('death', () => {
  it('ends the run once, with exactly one died event carrying the score', () => {
    const state = createState(1);
    const steps = runUntilDead(state);
    expect(steps).toBe(PERIOD);
    expect(drainEvents(state)).toEqual([{ type: 'died', score: DIE_EVERY_SECONDS }]);
    expect(drainEvents(state)).toEqual([]); // draining clears
    run(state, PERIOD * 2);
    expect(drainEvents(state)).toEqual([]); // and it never fires again
  });

  it('is frozen while dead', () => {
    const state = createState(1);
    runUntilDead(state);
    drainEvents(state);
    const frozen = structuredClone(state);
    run(state, 300, (i) => ({ targetX: i % 2 === 0 ? 0 : 360 }));
    expect(state).toEqual(frozen);
  });
});

describe('revive', () => {
  it('refuses while alive', () => {
    const state = createState(1);
    expect(revive(state)).toBe(false);
    expect(state.reviveUsed).toBe(false);
  });

  it('works once per run: grace period, one revived event, then a normal run again', () => {
    const state = createState(1);
    runUntilDead(state);
    drainEvents(state);

    expect(revive(state)).toBe(true);
    expect(state).toMatchObject({ alive: true, reviveUsed: true, invuln: CONFIG.reviveGrace });
    expect(drainEvents(state)).toEqual([{ type: 'revived' }]);

    // Grace counts down to exactly zero and no further.
    run(state, Math.ceil(CONFIG.reviveGrace * ticksPerSecond) + 5);
    expect(state.invuln).toBe(0);

    // The run continues from where it stopped and ends again on the next period boundary.
    runUntilDead(state);
    expect(state.tick).toBe(PERIOD * 2);
    expect(drainEvents(state)).toEqual([{ type: 'died', score: DIE_EVERY_SECONDS * 2 }]);

    const dead = structuredClone(state);
    expect(revive(state)).toBe(false); // the second revive is refused
    expect(state).toEqual(dead);
  });
});
