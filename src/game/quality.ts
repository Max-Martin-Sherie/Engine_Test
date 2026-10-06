/**
 * Adaptive resolution. A phone's GPU is not something the game can know in advance, so it measures: when frames keep
 * taking too long it draws fewer pixels (the cheapest way to get the speed back), down to a floor. It only ever
 * lowers, and waits a few seconds between steps, so it cannot flap. Pure: the flow feeds it frame times.
 */

export interface Quality {
  /** Fraction of the usual resolution, `MIN_SCALE` .. 1. */
  scale: number;
  /** A smoothed frame time in seconds. */
  average: number;
  /** When (seconds on the game clock) the scale last changed. */
  changedAt: number;
}

/** Frames slower than this on average (about 31 fps) mean the device cannot keep up. */
export const SLOW_FRAME = 0.032;
export const MIN_SCALE = 0.6;
/** Each step multiplies the scale by this. */
export const STEP = 0.85;
/** Seconds to wait after a change before judging again (the smoothed time needs to settle). */
export const SETTLE = 3;

export const createQuality = (scale = 1): Quality => ({ scale, average: 1 / 60, changedAt: 0 });

/**
 * Feeds one frame (`dt` seconds, `now` on the game clock). Returns true when the scale was just lowered, so the
 * caller can apply it. One long hitch does not count: the average moves a little each frame.
 */
export function adaptQuality(q: Quality, dt: number, now: number): boolean {
  q.average += (Math.min(dt, 0.25) - q.average) * 0.04;
  if (now - q.changedAt < SETTLE || q.average < SLOW_FRAME || q.scale <= MIN_SCALE) return false;
  q.scale = Math.max(MIN_SCALE, q.scale * STEP);
  q.average = 1 / 60;
  q.changedAt = now;
  return true;
}
