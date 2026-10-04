/** The play field: portrait 9:16, in world units. Letterboxed to any screen by the engine. */
export const WORLD = { width: 360, height: 640 } as const;

export interface WorldSize {
  readonly width: number;
  readonly height: number;
}
