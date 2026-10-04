import './rockfall.css';
import type { GameInfo } from './ui';

export const GAME_ID = 'rockfall';

/** Three little rocks above the title: the same coral / amber as the game's. */
function titleArt(): HTMLElement {
  const art = document.createElement('div');
  art.className = 'logo-rocks';
  for (const kind of ['a', 'b', 'c']) {
    const rock = document.createElement('i');
    rock.className = `rock rock-${kind}`;
    art.append(rock);
  }
  return art;
}

export const GAME_INFO: GameInfo = {
  title: 'RockFall',
  tagline: 'Drag to dodge the falling rocks',
  scoreLabel: 'You survived',
  scoreUnit: 'seconds',
  titleArt,
};
