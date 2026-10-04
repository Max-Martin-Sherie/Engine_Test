/**
 * GAME: the one file in sim/ that holds your game's rules. The engine (step.ts) owns the
 * lifecycle - ticking, score, death, revive, events - and calls the four functions below.
 *
 * Stay pure: no DOM, timers, Date or Math.random. Use `state.rng` (see core/rng) for randomness
 * and keep tuning numbers in config.ts.
 */
import { CONFIG } from './config';
import type { GameState, Input } from './types';

/** Your game's extra state (entities, timers, ...), merged into GameState. */
export interface GameData {}

/** Initial game state for a new run. */
export function createGameData(): GameData {
  return {};
}

/**
 * Advances the game by one fixed step. The engine has already incremented `state.tick` and
 * counted `state.invuln` down. Return true if the player died this step.
 */
export function updateGame(state: GameState, _input: Input): boolean {
  // Placeholder rule, so the whole engine loop works out of the box. Replace it.
  const period = Math.round(CONFIG.placeholder.dieEverySeconds * CONFIG.ticksPerSecond);
  return state.invuln <= 0 && state.tick % period === 0;
}

/** Called when a dead player is revived: clear whatever would kill them again. */
export function onRevive(_state: GameState): void {}

/** Sets every "previous" position to the current one, so rendering at any alpha shows the final pose. */
export function syncGamePrev(_state: GameState): void {}

/** A JSON-friendly view of the game for tests; exposed as `window.__game.debug` in dev builds. */
export function debugSnapshot(_state: GameState): Record<string, unknown> {
  return {};
}
