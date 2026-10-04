import type { GameInfo } from './ui';

/** GAME: a short unique id; namespaces this game's localStorage keys. */
export const GAME_ID = 'game';

/** GAME: the words your screens show. See ui/ui.ts for what each field does. */
export const GAME_INFO: GameInfo = {
  title: 'Game Engine',
  tagline: 'Replace sim/game.ts and view2d/scene.ts',
  scoreLabel: 'Score',
};
