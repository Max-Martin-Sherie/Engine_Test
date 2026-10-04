/**
 * GAME: your game starts here. `createGame` receives the engine's tools (see
 * engine/context.ts: pointer input, the letterboxed Pixi `view`, ads, analytics, the #ui overlay)
 * and returns a Game the engine runs: a fixed `step`, `update(dt)` and `render(alpha)`.
 *
 * This empty game draws nothing, so the engine alone shows a blank, letterboxed canvas.
 */
import type { GameFactory } from '../engine';

export const createGame: GameFactory = () => ({
  step: 1 / 60,
  update() {},
  render() {},
});
