import type { WorldSize } from './core/config';
import type { PointerInput } from './core/input';
import type { AdService, AnalyticsService, AudioService, HapticsService } from './services';
import type { EngineView } from './view/view';

/** Everything the engine hands to a game. */
export interface EngineContext {
  /** The play field size in world units (360 x 640). */
  readonly world: WorldSize;
  /**
   * The primary pointer in client space: poll `clientX` / `clientY`, or subscribe to drag
   * gestures with `onGesture` (they start only on the game canvas). Convert to world space with
   * `view.clientToWorld` / `view.clientToWorldX`.
   */
  readonly input: PointerInput;
  /** The letterboxed PixiJS canvas: add display objects to `view.field`. */
  readonly view: EngineView;
  /** Rewarded ads and interstitials: the fake in browsers, AdMob on a device. Never throws. */
  readonly ads: AdService;
  readonly analytics: AnalyticsService;
  /** Vibration feedback (no-op where unsupported). Toggle with `setEnabled`. */
  readonly haptics: HapticsService;
  /** Synthesised sound effects, no audio files. Toggle with `setEnabled`. */
  readonly audio: AudioService;
  /** The page's URL query (?seed=, ?ads=, ...). */
  readonly params: URLSearchParams;
  /** The full-window overlay element (#ui) for DOM screens; see engine/ui/stage. */
  readonly uiRoot: HTMLElement;
  /** Forget the loop's last frame time, e.g. after resuming from a pause. */
  resetClock(): void;
}

/** What a game gives back to the engine. */
export interface Game {
  /** Fixed simulation step in seconds, e.g. 1 / 60. */
  readonly step: number;
  /** Advances the simulation by one fixed step. */
  update(dt: number): void;
  /** Updates what is drawn; `alpha` in [0, 1) is how far we are into the next step. The engine renders after this. */
  render(alpha: number): void;
}

/** A game is a function from the engine's tools to a Game. */
export type GameFactory = (context: EngineContext) => Game;
