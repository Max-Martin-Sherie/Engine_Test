/** The portrait play field (the default): 9:16, in world units. Letterboxed to any screen by the engine. */
export const WORLD = { width: 360, height: 640 } as const;

/** The landscape play field: 16:9, in world units. A game picks it with `boot(createGame, { orientation: 'landscape' })`. */
export const LANDSCAPE_WORLD = { width: 640, height: 360 } as const;

export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

export type Orientation = 'portrait' | 'landscape';

export const worldFor = (orientation: Orientation): WorldSize => (orientation === 'landscape' ? LANDSCAPE_WORLD : WORLD);
