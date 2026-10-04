import { WORLD, type WorldSize } from './config';

/** How the world is scaled and centred inside a screen (all in CSS pixels). */
export interface Fit {
  /** CSS pixels per world unit. */
  scale: number;
  /** Left / top bar thickness: where the world's (0, 0) sits on screen. */
  offsetX: number;
  offsetY: number;
}

/** Fits the world inside a screen, keeping its aspect ratio (letterbox bars on the long side). */
export function fitWorld(screenWidth: number, screenHeight: number, world: WorldSize = WORLD): Fit {
  const scale = Math.min(screenWidth / world.width, screenHeight / world.height);
  if (!(scale > 0)) return { scale: 0, offsetX: 0, offsetY: 0 };
  return {
    scale,
    offsetX: (screenWidth - world.width * scale) / 2,
    offsetY: (screenHeight - world.height * scale) / 2,
  };
}

/** Converts a client-space x (CSS pixels) to world x. `canvasLeft` is the canvas's client x. */
export function clientToWorldX(clientX: number, canvasLeft: number, fit: Fit): number {
  return fit.scale > 0 ? (clientX - canvasLeft - fit.offsetX) / fit.scale : 0;
}

export interface Point {
  x: number;
  y: number;
}

/** Converts a client-space point to world coordinates. `canvasLeft/Top` is the canvas's client origin. */
export function clientToWorld(
  clientX: number,
  clientY: number,
  canvasLeft: number,
  canvasTop: number,
  fit: Fit,
): Point {
  if (!(fit.scale > 0)) return { x: 0, y: 0 };
  return {
    x: (clientX - canvasLeft - fit.offsetX) / fit.scale,
    y: (clientY - canvasTop - fit.offsetY) / fit.scale,
  };
}
