/** Every tuning number for Echo Loop lives here. Units: world units, ticks (1/60 s) and seconds. */

import { WORLD } from '../../engine/core/config';

const TICKS_PER_SECOND = 60;
const LOOP_SECONDS = 20;
/** The player's finger is read once every this many ticks (10 times a second); in between, the last reading is held. */
const SAMPLE_TICKS = 6;
const LOOP_TICKS = TICKS_PER_SECOND * LOOP_SECONDS;

export const CONFIG = {
  world: WORLD,

  ticksPerSecond: TICKS_PER_SECOND,
  dt: 1 / TICKS_PER_SECOND,

  /** Every loop lasts the same time; then it rewinds and what you did becomes a ghost. */
  loopSeconds: LOOP_SECONDS,
  loopTicks: LOOP_TICKS,
  sampleTicks: SAMPLE_TICKS,
  /** Finger readings in a whole loop: the size of one recording. */
  loopSamples: LOOP_TICKS / SAMPLE_TICKS,
  /** A run is over when this many loops have been used without collecting every orb together. */
  maxLoops: 8,
  /** What a rewarded ad adds. */
  extraLoops: 2,

  /**
   * The arena is a grid of square cells. Everything the generator places sits on cell centres, and the
   * bot (the solver that proves every arena can be cleared) walks the grid one cell at a time.
   */
  grid: { cell: 10, left: 20, top: 140, cols: 32, rows: 46 },

  /** Units per tick. One cell takes 4 ticks, a diagonal ~6, so one cell per finger reading is always reachable. */
  player: { radius: 6, speed: 2.5 },

  /** An orb is picked up when the centre of a player or ghost is this close to it. */
  orb: { pickup: 12, radius: 7 },
  /** A plate counts as pressed when the centre of a player or ghost is this close to it. */
  plate: { reach: 12 },
  /** Barriers are laser walls across the arena with one door each; the door is shut unless its plate is pressed. */
  barrier: { halfThickness: 4, doorCells: 4 },

  drifter: { radius: 9, minSpeed: 0.55, maxSpeed: 1.05, maxDriftY: 0.7 },
  pulsar: { minRadius: 26, maxRadius: 34, minPeriod: 150, maxPeriod: 260, minOn: 70, maxOn: 110, warn: 30 },

  /** The generator tries seeds-with-an-attempt-number until the bot can clear one. */
  generator: {
    maxAttempts: 24,
    minHeat: 0.2,
    maxHeat: 0.85,
    /** The bot gives up on an arena that needs more loops than this. */
    botMaxLoops: 8,
    /** Extra room around moving hazards when the bot plans (the real check is exact; this is only to cut corners safely). */
    planMargin: 4,
  },

  /** Stars: loops used compared with the bot's loops (par). */
  stars: { threeUpTo: 0, twoUpTo: 1 },

  /** A short ad when returning to the menu, at most this often (ms), never right after a rewarded ad. */
  interstitial: { minGapMs: 60_000 },
} as const;
