import { Application, Container, Graphics } from 'pixi.js';
import { WORLD, type WorldSize } from '../core/config';
import { clientToWorld, clientToWorldX, fitWorld, type Fit, type Point } from '../core/layout';

/**
 * The engine's PixiJS canvas. It draws nothing itself: a game adds display objects to `field`
 * and the engine renders them once per frame.
 */
export interface EngineView {
  /** The element the canvas lives in (#game). A game that draws its own canvas (3D, say) can add it here. */
  readonly host: HTMLElement;
  /**
   * The play field. Units are world units (see core/config WORLD), (0, 0) is its top-left, and
   * anything outside it is clipped. Usable immediately, even before the renderer is ready.
   */
  readonly field: Container;
  /** True once the renderer has initialised (WebGPU, or WebGL as the fallback). */
  readonly ready: boolean;
  /** "webgpu" or "webgl" once ready, else null. */
  readonly rendererName: string | null;
  /** Colour behind and around the field (the letterbox bars), 0xRRGGBB. */
  setBackground(color: number): void;
  /** Converts a client-space x (CSS pixels) to world x. */
  clientToWorldX(clientX: number): number;
  /** Converts a client-space point (CSS pixels) to world coordinates. */
  clientToWorld(clientX: number, clientY: number): Point;
  /** Current scale/offset of the world on screen. */
  fit(): Fit;
  /** Renders the field. A no-op until ready. Called by the engine after the game's render. */
  draw(): void;
  /** Starts the renderer. Resolves when ready; the engine runs it in the background. */
  init(): Promise<void>;
}

/**
 * Pixi's screen-reader support is only for interactive Pixi objects, which we don't use (the UI is
 * real DOM). On phones it also appends a stray 1px red <button> to <body>. The renderer modules
 * register that system lazily during init, so it cannot be unregistered up front; instead remove
 * the hook afterwards with Pixi's own cleanup. The engine e2e test (no buttons on a phone profile)
 * fails if a Pixi upgrade changes this.
 */
function removeAccessibilityHook(app: Application): void {
  const accessibility = (app.renderer as unknown as { accessibility?: { _destroyTouchHook?: () => void } })
    .accessibility;
  try {
    accessibility?._destroyTouchHook?.();
  } catch {
    // Already gone; nothing to clean up.
  }
}

export interface ViewOptions {
  /** The play field's size (portrait by default). */
  world?: WorldSize;
  /** Leave the canvas transparent, so something drawn underneath (a 3D canvas) shows through. */
  transparent?: boolean;
}

export function createEngineView(host: HTMLElement, options: ViewOptions = {}): EngineView {
  const size = options.world ?? WORLD;
  const transparent = options.transparent ?? false;
  const app = new Application();

  // worldRoot: scaled and centred to fit the screen. field: clipped to the play field.
  const worldRoot = new Container();
  const field = new Container();
  const mask = new Graphics().rect(0, 0, size.width, size.height).fill(0xffffff);
  field.mask = mask;
  worldRoot.addChild(mask, field);

  let ready = false;
  let background = 0x000000;
  // The canvas sits at the host's origin; re-read once per rendered frame, not per fixed step.
  let canvasLeft = 0;
  let canvasTop = 0;

  function currentFit(): Fit {
    // app.screen follows the host after a resize; before init, ask the host directly.
    return ready
      ? fitWorld(app.screen.width, app.screen.height, size)
      : fitWorld(host.clientWidth, host.clientHeight, size);
  }

  function applyLayout(): void {
    const fit = currentFit();
    worldRoot.scale.set(fit.scale);
    worldRoot.position.set(fit.offsetX, fit.offsetY);
  }

  return {
    host,
    field,

    get ready() {
      return ready;
    },

    get rendererName() {
      return ready ? app.renderer.name : null;
    },

    setBackground(color) {
      background = color;
      if (ready) app.renderer.background.color = color;
    },

    clientToWorldX(clientX) {
      return clientToWorldX(clientX, canvasLeft, currentFit());
    },

    clientToWorld(clientX, clientY) {
      return clientToWorld(clientX, clientY, canvasLeft, canvasTop, currentFit());
    },

    fit: currentFit,

    draw() {
      if (!ready) return;
      applyLayout();
      const rect = app.canvas.getBoundingClientRect();
      canvasLeft = rect.left;
      canvasTop = rect.top;
      app.render();
    },

    async init() {
      await app.init({
        preference: 'webgpu', // falls back to WebGL on its own when WebGPU is unavailable
        autoStart: false, // our fixed-step loop calls app.render()
        resizeTo: host,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        antialias: true,
        background,
        backgroundAlpha: transparent ? 0 : 1,
      });
      host.append(app.canvas);
      app.stage.addChild(worldRoot);
      removeAccessibilityHook(app);
      ready = true;
    },
  };
}
