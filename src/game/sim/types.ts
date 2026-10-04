import type { RngState } from '../../engine/core/rng';
import type { GameData } from './game';

export type GameEvent = { type: 'died'; score: number } | { type: 'revived' };

/** What every game has. A game adds its own fields through GameData (see game.ts). */
export interface EngineState {
  seed: number;
  /** Fixed steps survived. Time and score derive from this, so they never drift. */
  tick: number;
  alive: boolean;
  /** Seconds of invulnerability left (after a revive). Games decide what it protects against. */
  invuln: number;
  reviveUsed: boolean;
  rng: RngState;
  /** Pending events; the host drains them with drainEvents(). */
  events: GameEvent[];
}

export type GameState = EngineState & GameData;

export interface Input {
  /** World x the pointer points at, or null before the first pointer event. */
  targetX: number | null;
}
