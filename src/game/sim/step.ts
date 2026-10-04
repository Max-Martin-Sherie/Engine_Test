import { createRng } from '../../engine/core/rng';
import { CONFIG } from './config';
import { createGameData, onRevive, syncGamePrev, updateGame } from './game';
import type { GameEvent, GameState, Input } from './types';

export function createState(seed: number): GameState {
  return {
    seed: seed >>> 0,
    tick: 0,
    alive: true,
    invuln: 0,
    reviveUsed: false,
    rng: createRng(seed),
    events: [],
    ...createGameData(),
  };
}

/** Seconds survived (continuous). */
export function timeOf(state: GameState): number {
  return state.tick * CONFIG.dt;
}

/** The score: whole seconds survived. */
export function scoreOf(state: GameState): number {
  return Math.floor(state.tick / CONFIG.ticksPerSecond);
}

/** Returns the pending events and clears them. */
export function drainEvents(state: GameState): GameEvent[] {
  return state.events.splice(0, state.events.length);
}

/** Advances the game by one fixed step. Does nothing while dead. */
export function step(state: GameState, input: Input): void {
  if (!state.alive) return;

  state.tick += 1;
  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - CONFIG.dt);

  if (updateGame(state, input)) {
    state.alive = false;
    state.events.push({ type: 'died', score: scoreOf(state) });
    syncGamePrev(state);
  }
}

/**
 * Brings a dead player back with a short invulnerability. Works once per run.
 * Returns whether the revive happened.
 */
export function revive(state: GameState): boolean {
  if (state.alive || state.reviveUsed) return false;
  state.alive = true;
  state.reviveUsed = true;
  state.invuln = CONFIG.reviveGrace;
  onRevive(state);
  syncGamePrev(state);
  state.events.push({ type: 'revived' });
  return true;
}
