import type { RngState } from '../core/rng';

export interface Rock {
  id: number;
  x: number;
  y: number;
  /** Position at the start of the latest step, for render interpolation. */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Player {
  x: number;
  y: number;
  prevX: number;
  r: number;
}

export type GameEvent = { type: 'died'; score: number } | { type: 'revived' };

export interface GameState {
  seed: number;
  /** Fixed steps survived. Time and score derive from this, so they never drift. */
  tick: number;
  alive: boolean;
  player: Player;
  rocks: Rock[];
  /** Seconds until the next rock spawns. */
  spawnTimer: number;
  nextRockId: number;
  /** Seconds of invulnerability left (after a revive). */
  invuln: number;
  reviveUsed: boolean;
  rng: RngState;
  /** Pending events; the host drains them with drainEvents(). */
  events: GameEvent[];
}

export interface Input {
  /** World x the player steers toward, or null to hold position. */
  targetX: number | null;
}
