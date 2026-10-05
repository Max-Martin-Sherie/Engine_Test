export interface Vec {
  x: number;
  y: number;
}

/** Where the player's finger is, in world units, or null when it is not touching. */
export type Pointer = Vec | null;

export interface Orb extends Vec {}

/**
 * A ball that bounces around inside a rectangle. Its position is a plain formula of the tick
 * (no state), so the bot and the renderer can ask "where is it at tick t" for any t.
 */
export interface Drifter {
  r: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  x0: number;
  y0: number;
  /** Units per tick; the sign is the starting direction. */
  vx: number;
  vy: number;
}

/** A danger zone that switches on for `on` ticks out of every `period` ticks. */
export interface Pulsar extends Vec {
  r: number;
  period: number;
  on: number;
  phase: number;
}

/** A laser wall across the arena. Its door (doorX0..doorX1) is shut unless `plate` is pressed. */
export interface Gate {
  y: number;
  doorX0: number;
  doorX1: number;
  plate: Vec;
}

export interface Arena {
  seed: number;
  /** Which of the generator's tries this arena came from (0 = the first). */
  attempt: number;
  heat: number;
  start: Vec;
  orbs: Orb[];
  drifters: Drifter[];
  pulsars: Pulsar[];
  gates: Gate[];
  /** How many loops the bot needs: the benchmark for the stars. */
  par: number;
}

/** One recording: a finger reading every few ticks, as x, y pairs; (-1, -1) means "not touching". */
export type Samples = number[];

export interface Solution {
  /** One recording per loop; the last one is the loop in which everything is collected. */
  loops: Samples[];
  par: number;
}
