import { Application, Container, Graphics } from 'pixi.js';
import { CONFIG, type GameState } from '../sim';
import { COLORS } from './palette';
import { createScene } from './scene';

const { width: W, height: H } = CONFIG.world;

export interface GameView {
  /** Draws `state`, interpolated by alpha between its previous and current positions. */
  render(state: GameState, alpha: number): void;
  /** Converts a client-space x (CSS pixels) to world x. */
  clientToWorldX(clientX: number): number;
  destroy(): void;
}

export async function createGameView(host: HTMLElement): Promise<GameView> {
  const app = new Application();
  await app.init({
    preference: 'webgpu', // falls back to WebGL on its own when WebGPU is unavailable
    autoStart: false, // our fixed-step loop calls app.render()
    resizeTo: host,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    antialias: true,
    background: COLORS.letterbox,
  });
  host.append(app.canvas);

  // world: 360x640 units, scaled and centred to fit the screen.
  const world = new Container();
  app.stage.addChild(world);
  world.addChild(new Graphics().rect(0, 0, W, H).fill(COLORS.field));

  // Everything the scene draws goes in `field`, masked so nothing leaks into the letterbox
  // (e.g. things that spawn above the top edge).
  const fieldMask = new Graphics().rect(0, 0, W, H).fill(0xffffff);
  const field = new Container();
  field.mask = fieldMask;
  world.addChild(fieldMask, field);
  const scene = createScene(field);

  // The canvas sits at the host's origin; re-read once per rendered frame, not per fixed step.
  let canvasLeft = 0;

  function layout(): { scale: number; offsetX: number } {
    const { width, height } = app.screen;
    const scale = Math.min(width / W, height / H);
    const offsetX = (width - W * scale) / 2;
    world.scale.set(scale);
    world.position.set(offsetX, (height - H * scale) / 2);
    return { scale, offsetX };
  }

  return {
    render(state, alpha) {
      layout();
      canvasLeft = app.canvas.getBoundingClientRect().left;
      scene.update(state, alpha);
      app.render();
    },

    clientToWorldX(clientX) {
      const { scale, offsetX } = layout();
      return (clientX - canvasLeft - offsetX) / scale;
    },

    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
