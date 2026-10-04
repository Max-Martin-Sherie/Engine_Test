/**
 * RockFall: the game's flow. The engine gives us its tools (input, the Pixi view, ads, analytics,
 * the #ui overlay); this file runs the phase machine (title / playing / paused / over / ad) and
 * connects the pure simulation to what is drawn and shown.
 */
import type { GameFactory } from '../engine';
import { safeGetNumber, safeSetNumber } from '../engine/core/storage';
import { GAME_ID, GAME_INFO } from './info';
import { CONFIG, createState, debugSnapshot, drainEvents, revive, scoreOf, step, type GameEvent } from './sim';
import { createUi, type GameOverInfo } from './ui';
import { COLORS, createScene } from './view';

type Phase = 'title' | 'playing' | 'paused' | 'over' | 'ad';

const BEST_KEY = `${GAME_ID}.best`;

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : null;
}

export const createGame: GameFactory = ({ ads, analytics, input, view, params, uiRoot, resetClock }) => {
  // ?seed=N makes every run use seed N (reproducible).
  const fixedSeed = parseSeed(params.get('seed'));
  const pickSeed = (): number => fixedSeed ?? (Math.random() * 0x100000000) >>> 0;

  view.setBackground(COLORS.letterbox);
  const scene = createScene(view.field);

  let phase: Phase = 'title';
  let state = createState(pickSeed()); // idle field shown behind the title screen
  let best = safeGetNumber(BEST_KEY, 0);
  let lastOver: Omit<GameOverInfo, 'canRevive'> = { score: 0, best, isNewBest: false };

  const ui = createUi(
    uiRoot,
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
    resetClock();
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
      resetClock();
    } else {
      ui.setGameOver({ ...lastOver, canRevive: canRevive() });
      setPhase('over');
    }
  }

  function resume(): void {
    if (phase !== 'paused') return;
    setPhase('playing');
    resetClock();
  }

  // Backgrounded: pause. Only while playing, so an ad that covers the app doesn't trip it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') setPhase('paused');
  });

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

  return {
    step: CONFIG.dt,
    update() {
      if (phase !== 'playing') return;
      const clientX = input.clientX;
      const targetX = clientX !== null ? view.clientToWorldX(clientX) : null;
      step(state, { targetX });
      for (const event of drainEvents(state)) handleEvent(event);
    },
    render(alpha) {
      scene.update(state, alpha);
      ui.setScore(scoreOf(state));
    },
  };
};
