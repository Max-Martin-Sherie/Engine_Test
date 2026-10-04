/**
 * GAME: the one file in view2d/ that draws your game. gameView.ts (engine) creates the Pixi
 * app, letterboxes the 360x640 world and calls this scene once per frame.
 *
 * Read `state`, never write it. Interpolate moving things between their previous and current
 * positions with `alpha` (see sim/game.ts syncGamePrev).
 */
import { Container, Graphics } from 'pixi.js';
import { CONFIG, type GameState } from '../sim';
import { COLORS } from './palette';

const { width: W, height: H } = CONFIG.world;
const GRID = 40;

export interface Scene {
  /** Updates the display objects for `state`; the engine renders right after. */
  update(state: GameState, alpha: number): void;
}

/**
 * `field` is the world layer: units are world units, (0,0) is the top-left of the play field,
 * and anything outside the field is clipped by a mask.
 */
export function createScene(field: Container): Scene {
  // A faint grid so you can see the coordinate space while building. Delete it.
  const grid = new Graphics();
  for (let x = GRID; x < W; x += GRID) grid.moveTo(x, 0).lineTo(x, H);
  for (let y = GRID; y < H; y += GRID) grid.moveTo(0, y).lineTo(W, y);
  grid.stroke({ width: 1, color: COLORS.grid, alpha: 0.35 });
  field.addChild(grid);

  return {
    update() {},
  };
}
