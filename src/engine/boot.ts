import type { EngineContext, GameFactory } from './context';
import { worldFor, type Orientation } from './core/config';
import { PointerInput } from './core/input';
import { FixedLoop } from './core/loop';
import { createServices, parseFakeAdMode } from './services';
import './ui/base.css';
import { createEngineView } from './view/view';

export interface BootOptions {
  /** 'portrait' (360 x 640, the default) or 'landscape' (640 x 360). The play field is letterboxed to fit. */
  orientation?: Orientation;
  /** A transparent 2D canvas, so a game can draw its own canvas (3D) underneath and use the 2D layer for its overlay. */
  transparent?: boolean;
}

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing #${id} in index.html`);
  return node;
}

/**
 * Starts the engine and hands it a game. It loads the libraries and services, runs the
 * fixed-timestep loop, and draws nothing of its own: with an empty game the screen is blank.
 *
 * The loop starts immediately; the renderer and ad SDK start up in the background, so a game's
 * own UI is never blocked by them.
 */
export function boot(createGame: GameFactory, options: BootOptions = {}): void {
  const world = worldFor(options.orientation ?? 'portrait');
  const params = new URLSearchParams(window.location.search);
  const { ads, analytics, haptics, audio } = createServices({ fakeAdMode: parseFakeAdMode(params.get('ads')) });
  const gameHost = requireElement('game');
  // Drag gestures only start on the game canvas, never on DOM buttons laid over it.
  const input = new PointerInput(window, gameHost);
  const view = createEngineView(gameHost, { world, transparent: options.transparent ?? false });

  let loop: FixedLoop | undefined;
  const context: EngineContext = {
    world,
    input,
    view,
    ads,
    analytics,
    haptics,
    audio,
    params,
    uiRoot: requireElement('ui'),
    resetClock: () => loop?.resetClock(),
  };

  const game = createGame(context);
  loop = new FixedLoop(
    {
      update: (dt) => game.update(dt),
      render: (alpha) => {
        game.render(alpha);
        view.draw();
      },
    },
    { step: game.step, maxFrameTime: 0.25 },
  );
  const runningLoop = loop;

  // After the page was hidden, the next frame must not see a huge time gap.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) runningLoop.resetClock();
  });
  // Browsers only start audio after a user gesture; unlock it on every press (it is cheap once running).
  window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  // The game owns the screen: no long-press menu, no iOS pinch gesture.
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  runningLoop.start();

  view.init().catch((error: unknown) => {
    console.error('Renderer failed to start', error);
    analytics.track('view_init_failed', { message: String(error) });
  });
  void ads.init();

  if (import.meta.env.DEV) {
    // Read-only snapshot for e2e tests. Not present in production builds.
    Object.defineProperty(window, '__engine', {
      get: () => ({
        viewReady: view.ready,
        renderer: view.rendererName,
        fit: view.fit(),
        adsReady: ads.isRewardedReady(),
      }),
    });
  }
}
