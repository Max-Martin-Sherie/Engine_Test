import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  createState,
  drainEvents,
  fallSpeed,
  revive,
  scoreOf,
  spawnInterval,
  step,
  type GameState,
  type Input,
  type Rock,
} from '../src/game/sim';

const { dt } = CONFIG;
const { width: W } = CONFIG.world;
const STILL: Input = { targetX: null };

function run(state: GameState, steps: number, inputFor: (i: number) => Input = () => STILL): void {
  for (let i = 0; i < steps; i++) step(state, inputFor(i));
}

/** Steps with no input until the player dies; fails the test if that never happens. */
function runUntilDead(state: GameState, maxSteps = 60 * 600): number {
  for (let i = 0; i < maxSteps; i++) {
    step(state, STILL);
    if (!state.alive) return i + 1;
  }
  throw new Error(`still alive after ${maxSteps} steps (seed ${state.seed})`);
}

function rockAt(x: number, y: number, r: number, id = 9000): Rock {
  return { id, x, y, prevX: x, prevY: y, vx: 0, vy: 0, r };
}

/** A state with no rocks and no spawning, for placing rocks by hand. */
function quietState(): GameState {
  const state = createState(1);
  state.spawnTimer = 1e9;
  return state;
}

describe('determinism', () => {
  const sweep = (i: number): Input => ({ targetX: 180 + 170 * Math.sin(i / 37) });

  it('same seed and inputs give a deep-equal state', () => {
    const a = createState(1234);
    const b = createState(1234);
    run(a, 900, sweep);
    run(b, 900, sweep);
    expect(a.rocks.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const a = createState(1);
    const b = createState(2);
    run(a, 300, sweep);
    run(b, 300, sweep);
    expect(a.rocks).not.toEqual(b.rocks);
  });

  it('does not depend on the wall clock or Math.random', () => {
    const realRandom = Math.random;
    Math.random = () => {
      throw new Error('sim must not call Math.random');
    };
    try {
      const state = createState(5);
      run(state, 600, sweep);
    } finally {
      Math.random = realRandom;
    }
  });
});

describe('player movement', () => {
  it('stays inside the field, whatever the target', () => {
    const state = quietState();
    const { radius } = CONFIG.player;
    for (const target of [-1e9, 1e9, -5, W + 50, 180]) {
      for (let i = 0; i < 90; i++) {
        step(state, { targetX: target });
        expect(state.player.x).toBeGreaterThanOrEqual(radius);
        expect(state.player.x).toBeLessThanOrEqual(W - radius);
      }
    }
    run(state, 90, () => ({ targetX: -1e9 }));
    expect(state.player.x).toBe(radius);
    run(state, 90, () => ({ targetX: 1e9 }));
    expect(state.player.x).toBe(W - radius);
  });

  it('never moves faster than the speed cap, and does reach it', () => {
    const state = quietState();
    const maxMove = CONFIG.player.maxSpeed * dt;
    step(state, { targetX: W });
    expect(state.player.x - state.player.prevX).toBeCloseTo(maxMove, 9);
    for (let i = 0; i < 200; i++) {
      step(state, { targetX: i % 40 < 20 ? 0 : W });
      expect(Math.abs(state.player.x - state.player.prevX)).toBeLessThanOrEqual(maxMove + 1e-9);
    }
  });

  it('holds still without a target and ignores non-finite targets', () => {
    const state = quietState();
    const x0 = state.player.x;
    run(state, 30, () => ({ targetX: null }));
    run(state, 30, () => ({ targetX: Number.NaN }));
    run(state, 30, () => ({ targetX: Number.POSITIVE_INFINITY }));
    expect(state.player.x).toBe(x0);
  });
});

describe('difficulty', () => {
  it('spawn interval shrinks over time and stops at its floor', () => {
    const { startInterval, minInterval } = CONFIG.spawn;
    expect(spawnInterval(0)).toBe(startInterval);
    let previous = Infinity;
    for (let t = 0; t <= 300; t += 5) {
      const value = spawnInterval(t);
      expect(value).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(minInterval);
      previous = value;
    }
    expect(spawnInterval(1e6)).toBe(minInterval);
  });

  it('fall speed rises over time and stops at its cap', () => {
    const { startSpeed, maxSpeed } = CONFIG.fall;
    expect(fallSpeed(0)).toBe(startSpeed);
    let previous = 0;
    for (let t = 0; t <= 300; t += 5) {
      const value = fallSpeed(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(maxSpeed);
      previous = value;
    }
    expect(fallSpeed(1e6)).toBe(maxSpeed);
  });

  it('the caps hold inside the running sim', () => {
    const state = createState(77);
    state.tick = 60 * 3600; // an hour in: far past both caps
    state.invuln = 1e9; // survive so we can watch spawning
    const steps = 60 * 100;
    run(state, steps);
    const spawned = state.nextRockId - 1;
    const expected = (steps * dt) / CONFIG.spawn.minInterval;
    expect(Math.abs(spawned - expected)).toBeLessThanOrEqual(2);
    const fastest = CONFIG.fall.maxSpeed * (1 + CONFIG.rocks.speedJitter);
    for (const rock of state.rocks) expect(rock.vy).toBeLessThanOrEqual(fastest + 1e-9);
  });
});

describe('rocks', () => {
  it('spawn above the field, fall, and are removed past the bottom', () => {
    const state = createState(3);
    state.invuln = 1e9;
    run(state, 60 * 30);
    for (const rock of state.rocks) {
      expect(rock.y - rock.r).toBeLessThanOrEqual(CONFIG.world.height);
      expect(rock.x).toBeGreaterThanOrEqual(rock.r);
      expect(rock.x).toBeLessThanOrEqual(W - rock.r);
    }
    expect(state.nextRockId - 1).toBeGreaterThan(state.rocks.length); // some already left
  });

  it('remember their previous position for render interpolation', () => {
    const state = createState(3);
    state.invuln = 1e9;
    run(state, 120);
    const rock = state.rocks[0];
    if (rock === undefined) throw new Error('expected a rock');
    const { x, y } = rock;
    step(state, STILL);
    expect(rock.prevX).toBe(x);
    expect(rock.prevY).toBe(y);
    expect(rock.y).toBeGreaterThan(y);
  });
});

describe('collisions', () => {
  it('use a forgiving hitbox of 85% of the summed radii', () => {
    const { radius } = CONFIG.player;
    const rockRadius = 20;
    const reach = (radius + rockRadius) * CONFIG.hitboxScale;

    // Just outside the hit zone (89% of the summed radii): the circles visibly overlap, no hit.
    const near = quietState();
    near.rocks.push(rockAt(near.player.x + reach * 1.05, near.player.y, rockRadius));
    step(near, STILL);
    expect(near.alive).toBe(true);

    // Just inside it (81% of the summed radii): a hit.
    const hit = quietState();
    hit.rocks.push(rockAt(hit.player.x + reach * 0.95, hit.player.y, rockRadius));
    step(hit, STILL);
    expect(hit.alive).toBe(false);
  });

  it('standing still eventually dies, with exactly one died event', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createState(seed);
      runUntilDead(state);
      const events = drainEvents(state);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'died', score: scoreOf(state) });
      run(state, 600);
      expect(drainEvents(state)).toEqual([]);
    }
  });

  it('the game is frozen while dead', () => {
    const state = createState(8);
    runUntilDead(state);
    drainEvents(state);
    const frozen = structuredClone(state);
    run(state, 300, (i) => ({ targetX: i % 2 === 0 ? 0 : W }));
    expect(state).toEqual(frozen);
  });

  it('interpolation shows the final pose once dead', () => {
    const state = createState(8);
    runUntilDead(state);
    expect(state.player.prevX).toBe(state.player.x);
    for (const rock of state.rocks) {
      expect(rock.prevX).toBe(rock.x);
      expect(rock.prevY).toBe(rock.y);
    }
  });
});

describe('score', () => {
  it('is whole seconds survived', () => {
    const state = quietState();
    expect(scoreOf(state)).toBe(0);
    run(state, 59);
    expect(scoreOf(state)).toBe(0);
    run(state, 1);
    expect(scoreOf(state)).toBe(1);
    run(state, 60 * 9);
    expect(scoreOf(state)).toBe(10);
  });

  it('is reported in the died event', () => {
    const state = quietState();
    run(state, 150);
    state.rocks.push(rockAt(state.player.x, state.player.y, 20));
    step(state, STILL);
    expect(drainEvents(state)).toEqual([{ type: 'died', score: 2 }]);
  });
});

describe('revive', () => {
  it('works once, clears every rock, and emits one revived event', () => {
    const state = createState(11);
    expect(revive(state)).toBe(false); // alive: nothing to revive
    runUntilDead(state);
    drainEvents(state);
    expect(state.rocks.length).toBeGreaterThan(0);

    expect(revive(state)).toBe(true);
    expect(state.alive).toBe(true);
    expect(state.rocks).toHaveLength(0);
    expect(state.invuln).toBe(CONFIG.reviveGrace);
    expect(drainEvents(state)).toEqual([{ type: 'revived' }]);

    // Die again; the second revive is refused and nothing changes.
    runUntilDead(state);
    drainEvents(state);
    const dead = structuredClone(state);
    expect(revive(state)).toBe(false);
    expect(state).toEqual(dead);
  });

  it('grants a grace period with no collisions, then the rock counts again', () => {
    const state = createState(11);
    runUntilDead(state);
    revive(state);
    drainEvents(state);
    state.spawnTimer = 1e9;
    state.rocks.push(rockAt(state.player.x, state.player.y, 25));

    let steps = 0;
    while (state.alive && steps < 600) {
      step(state, STILL);
      steps++;
    }
    expect(state.alive).toBe(false);
    // Invulnerable for the whole grace period, give or take the step it ends on.
    const graceSteps = Math.round(CONFIG.reviveGrace / dt);
    expect(steps).toBeGreaterThanOrEqual(graceSteps - 1);
    expect(steps).toBeLessThanOrEqual(graceSteps + 1);
    expect(drainEvents(state)).toHaveLength(1);
  });

  it('survives overlapping rocks at every step of the grace period', () => {
    const state = createState(21);
    runUntilDead(state);
    revive(state);
    state.spawnTimer = 1e9;
    state.rocks.push(rockAt(state.player.x, state.player.y, 25));
    const safeSteps = Math.floor(CONFIG.reviveGrace / dt) - 1;
    for (let i = 0; i < safeSteps; i++) {
      step(state, STILL);
      expect(state.alive).toBe(true);
    }
  });
});
