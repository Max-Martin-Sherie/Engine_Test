import { PointerInput } from './core/input';
import { FixedLoop } from './core/loop';
import { safeGetNumber, safeSetNumber } from './core/storage';
import { GAME_ID, GAME_INFO } from './gameInfo';
import { createServices, parseFakeAdMode } from './services';
import {
  CONFIG,
  createState,
  debugSnapshot,
  drainEvents,
  revive,
  scoreOf,
  step,
  type GameEvent,
} from './sim';
import { createUi, type GameOverInfo } from './ui';
import { createGameView, type GameView } from './view2d';

type Phase = 'title' | 'playing' | 'paused' | 'over' | 'ad';

const BEST_KEY = `${GAME_ID}.best`;

// ---- URL flags ---------------------------------------------------------------------------
// ?seed=N  every run uses seed N (reproducible)   ?ads=no-fill | skip  fake ad failure modes
const params = new URLSearchParams(window.location.search);

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : null;
}
const fixedSeed = parseSeed(params.get('seed'));
const pickSeed = (): number => fixedSeed ?? (Math.random() * 0x100000000) >>> 0;

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing #${id} in index.html`);
  return node;
}

// ---- composition -------------------------------------------------------------------------
const { ads, analytics } = createServices({ fakeAdMode: parseFakeAdMode(params.get('ads')) });
const input = new PointerInput();

let phase: Phase = 'title';
let state = createState(pickSeed()); // idle field shown behind the title screen
let best = safeGetNumber(BEST_KEY, 0);
let lastOver: Omit<GameOverInfo, 'canRevive'> = { score: 0, best, isNewBest: false };
let view: GameView | null = null;

const ui = createUi(
  requireElement('ui'),
  {
    onPlay: startRun,
    onPlayAgain: startRun,
    onRevive: () => void reviveWithAd(),
    onResume: resume,
  },
  GAME_INFO,
);
ui.setBest(best);
ui.show('title');

const loop = new FixedLoop(
  {
    update() {
      if (phase !== 'playing') return;
      const clientX = input.clientX;
      const targetX = clientX !== null && view !== null ? view.clientToWorldX(clientX) : null;
      step(state, { targetX });
      for (const event of drainEvents(state)) handleEvent(event);
    },
    render(alpha) {
      view?.render(state, alpha);
      ui.setScore(scoreOf(state));
    },
  },
  { step: CONFIG.dt, maxFrameTime: 0.25 },
);

// ---- phase machine -----------------------------------------------------------------------
function setPhase(next: Phase): void {
  phase = next;
  ui.show(next);
}

// A function call, so TypeScript doesn't narrow `phase` across an await.
const isPhase = (p: Phase): boolean => phase === p;

const canRevive = (): boolean => !state.reviveUsed && ads.isRewardedReady();

function startRun(): void {
  if (phase !== 'title' && phase !== 'over') return;
  state = createState(pickSeed());
  setPhase('playing');
  loop.resetClock();
  analytics.track('run_start', { seed: state.seed });
  void ads.preloadRewarded();
}

function handleEvent(event: GameEvent): void {
  switch (event.type) {
    case 'died': {
      const isNewBest = event.score > best;
      if (isNewBest) {
        best = event.score;
        safeSetNumber(BEST_KEY, best);
        ui.setBest(best);
      }
      lastOver = { score: event.score, best, isNewBest };
      const offerRevive = canRevive();
      ui.setGameOver({ ...lastOver, canRevive: offerRevive });
      setPhase('over');
      analytics.track('run_end', { score: event.score, revive_offered: offerRevive });
      break;
    }
    case 'revived':
      analytics.track('revived');
      break;
  }
}

async function reviveWithAd(): Promise<void> {
  if (phase !== 'over' || !canRevive()) return;
  setPhase('ad');
  const rewarded = await ads.showRewarded(); // never rejects
  void ads.preloadRewarded();
  analytics.track('revive_ad_result', { rewarded });
  if (!isPhase('ad')) return; // something else moved us on while the ad was up

  if (rewarded && revive(state)) {
    // If the app was backgrounded behind the ad, wait for the player on the pause screen.
    setPhase(document.hidden ? 'paused' : 'playing');
    loop.resetClock();
  } else {
    ui.setGameOver({ ...lastOver, canRevive: canRevive() });
    setPhase('over');
  }
}

function resume(): void {
  if (phase !== 'paused') return;
  setPhase('playing');
  loop.resetClock();
}

// Backgrounded: pause. Only while playing, so an ad that covers the app doesn't trip it.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (phase === 'playing') setPhase('paused');
  } else {
    loop.resetClock();
  }
});

// The game owns the screen: no long-press menu, no iOS pinch gesture.
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---- go ----------------------------------------------------------------------------------
// Everything below runs in the background: the loop and title screen are already live.
loop.start();

createGameView(requireElement('game')).then(
  (v) => {
    view = v;
  },
  (error: unknown) => {
    console.error('Renderer failed to start', error);
    analytics.track('view_init_failed', { message: String(error) });
  },
);

void ads.init();

if (import.meta.env.DEV) {
  // Read-only snapshot for e2e tests. Not present in production builds.
  Object.defineProperty(window, '__game', {
    get: () => ({
      phase,
      score: scoreOf(state),
      alive: state.alive,
      debug: debugSnapshot(state),
    }),
  });
}
