import { CONFIG } from '../sim';
import './styles.css';

export type Screen = 'title' | 'playing' | 'paused' | 'over' | 'ad';

export interface UiCallbacks {
  onPlay(): void;
  onPlayAgain(): void;
  onRevive(): void;
  onResume(): void;
}

export interface GameOverInfo {
  score: number;
  best: number;
  isNewBest: boolean;
  /** Show the "Watch ad to continue" button. */
  canRevive: boolean;
}

/** The words (and optional art) the screens show. Supplied by the game through main.ts. */
export interface GameInfo {
  title: string;
  tagline: string;
  /** Label above the score on the game-over screen, e.g. "Score". */
  scoreLabel: string;
  /** Optional small label under the score, e.g. "seconds". */
  scoreUnit?: string;
  /** Optional decoration shown above the title. Build it with plain DOM; style it in your own CSS. */
  titleArt?: () => HTMLElement;
}

export interface Ui {
  show(screen: Screen): void;
  setScore(score: number): void;
  setBest(best: number): void;
  setGameOver(info: GameOverInfo): void;
}

const { width: WORLD_W, height: WORLD_H } = CONFIG.world;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: string, className: string): HTMLButtonElement {
  const b = el('button', `btn ${className}`, label);
  b.type = 'button';
  b.dataset['action'] = action;
  return b;
}

function screenSection(name: Screen, label: string, dim: 'light' | 'heavy'): HTMLElement {
  const section = el('section', `screen screen-${dim}`);
  section.dataset['screen'] = name;
  section.setAttribute('aria-label', label);
  section.hidden = true;
  return section;
}

/** Builds the overlay inside `root` (a full-window element). Pure DOM; knows nothing about GameState. */
export function createUi(root: HTMLElement, callbacks: UiCallbacks, info: GameInfo): Ui {
  root.classList.add('ui-root');

  // Reads the device's safe-area insets as pixels. Capacitor's SystemBars plugin exposes them as
  // --safe-area-inset-* on Android, where env() is unreliable; iOS and browsers provide env().
  const probe = el('div', 'safe-probe');
  const stage = el('div', 'stage');

  // HUD: score and best. Never takes pointer events, so touches fall through to the game.
  const hud = el('div', 'hud');
  hud.hidden = true;
  const hudScore = el('div', 'hud-score', '0');
  const hudBest = el('div', 'hud-best', 'BEST 0');
  hud.append(hudScore, hudBest);

  // Title.
  const title = screenSection('title', info.title, 'light');
  const titlePanel = el('div', 'panel');
  const titleBest = el('p', 'meta', 'Best 0');
  const art = info.titleArt?.();
  art?.setAttribute('aria-hidden', 'true');
  titlePanel.append(
    ...(art ? [art] : []),
    el('h1', 'logo', info.title),
    el('p', 'tagline', info.tagline),
    button('Play', 'play', 'btn-primary'),
    titleBest,
  );
  title.append(titlePanel);

  // Paused.
  const paused = screenSection('paused', 'Paused', 'heavy');
  const pausedPanel = el('div', 'panel');
  pausedPanel.append(el('h2', 'heading', 'Paused'), button('Resume', 'resume', 'btn-primary'));
  paused.append(pausedPanel);

  // Game over.
  const over = screenSection('over', 'Game over', 'heavy');
  const overPanel = el('div', 'panel');
  const overScore = el('div', 'big-score', '0');
  const overBest = el('p', 'meta', 'Best 0');
  const reviveButton = button('Watch ad to continue', 'revive', 'btn-ghost');
  const actions = el('div', 'actions');
  actions.append(button('Play again', 'again', 'btn-primary'), reviveButton);
  overPanel.append(
    el('h2', 'heading', 'Game over'),
    el('p', 'meta', info.scoreLabel),
    overScore,
    ...(info.scoreUnit ? [el('p', 'meta', info.scoreUnit)] : []),
    overBest,
    actions,
  );
  over.append(overPanel);

  // Waiting for the ad.
  const waiting = screenSection('ad', 'Loading ad', 'heavy');
  const waitingPanel = el('div', 'panel');
  const spinner = el('div', 'spinner');
  spinner.setAttribute('aria-hidden', 'true');
  waitingPanel.append(spinner, el('h2', 'heading', 'Waiting for ad…'));
  waiting.append(waitingPanel);

  stage.append(hud, title, paused, over, waiting);
  root.append(probe, stage);

  const screens: Record<Screen, HTMLElement[]> = {
    title: [title],
    playing: [hud],
    paused: [hud, paused],
    over: [over],
    ad: [hud, waiting],
  };
  const all = [hud, title, paused, over, waiting];

  // One delegated listener for every button.
  stage.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>('button[data-action]')?.dataset['action'];
    switch (action) {
      case 'play':
        callbacks.onPlay();
        break;
      case 'again':
        callbacks.onPlayAgain();
        break;
      case 'revive':
        callbacks.onRevive();
        break;
      case 'resume':
        callbacks.onResume();
        break;
    }
  });

  // Keep the stage exactly over the letterboxed play field, and inset it from notches.
  function layout(): void {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const unit = Math.min(w / WORLD_W, h / WORLD_H);
    const stageW = WORLD_W * unit;
    const stageH = WORLD_H * unit;
    const barX = (w - stageW) / 2;
    const barY = (h - stageH) / 2;
    const probeStyle = getComputedStyle(probe);
    // Only the part of an inset that the stage actually reaches into matters.
    const inset = (px: string, bar: number): string =>
      `${Math.max(0, (Number.parseFloat(px) || 0) - bar)}px`;

    stage.style.left = `${barX}px`;
    stage.style.top = `${barY}px`;
    stage.style.width = `${stageW}px`;
    stage.style.height = `${stageH}px`;
    stage.style.setProperty('--u', `${unit}px`);
    stage.style.setProperty('--inset-top', inset(probeStyle.paddingTop, barY));
    stage.style.setProperty('--inset-bottom', inset(probeStyle.paddingBottom, barY));
    stage.style.setProperty('--inset-left', inset(probeStyle.paddingLeft, barX));
    stage.style.setProperty('--inset-right', inset(probeStyle.paddingRight, barX));
  }
  new ResizeObserver(layout).observe(root);
  window.addEventListener('resize', layout);
  layout();

  let shownScore = -1;
  let shownBest = -1;

  return {
    show(screen) {
      const visible = new Set(screens[screen]);
      for (const node of all) node.hidden = !visible.has(node);
    },

    setScore(score) {
      if (score === shownScore) return; // the HUD changes once a second; don't touch the DOM per frame
      shownScore = score;
      hudScore.textContent = String(score);
    },

    setBest(best) {
      if (best === shownBest) return;
      shownBest = best;
      hudBest.textContent = `BEST ${best}`;
      titleBest.textContent = best > 0 ? `Best ${best}` : 'No best yet';
    },

    setGameOver({ score, best, isNewBest, canRevive }) {
      overScore.textContent = String(score);
      overBest.textContent = isNewBest ? 'New best!' : `Best ${best}`;
      overBest.classList.toggle('is-new-best', isNewBest);
      reviveButton.hidden = !canRevive;
      // Restart the short input lock so a finger that was still dragging can't hit a button.
      actions.classList.remove('is-arming');
      void actions.offsetWidth;
      actions.classList.add('is-arming');
    },
  };
}
