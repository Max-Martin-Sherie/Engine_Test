/** Every tuning number for Fruit Slice lives here. Units: world units, seconds, percentage points. */
import { WORLD } from '../../engine/core/config';

const TICKS_PER_SECOND = 60;

export const CONFIG = {
  world: WORLD,
  ticksPerSecond: TICKS_PER_SECOND,
  /** Fixed simulation step in seconds. */
  dt: 1 / TICKS_PER_SECOND,

  cut: {
    /** A drag shorter than this (world units) is a cancel, not a cut. */
    minLength: 40,
  },

  /**
   * Tolerance is how far from a perfect 50/50 split a cut may be, in percentage points:
   * 12 means anything from 38/62 to 62/38 is fine. It shrinks as fruit are cut, down to a floor.
   */
  tolerance: {
    classic: { start: 12, floor: 1.5, fruitsToFloor: 30 },
    arcade: { start: 14, floor: 3, fruitsToFloor: 40 },
  },

  /** Deviation (percentage points) at or under which a cut is rated Perfect / Great. */
  rating: { perfect: 0.5, great: 1.5 },

  fruit: {
    /** Where fruit appear (world units): the centre of the play area. */
    centerX: 180,
    centerY: 330,
    /** Bounding radius of a fresh fruit, shrinking with progress, never below the minimum. */
    startRadius: 105,
    minRadius: 62,
    /** Fruit cut before the radius reaches its minimum. */
    fruitsToMinRadius: 30,
    /** Polygon resolution of every fruit shape. */
    segments: 64,
    /** Seconds the cut fruit lingers before the next one appears. */
    classicCooldown: 0.75,
    arcadeCooldown: 0.4,
  },

  /** Which fruit can appear after this many have been cut: easy round ones first, awkward ones later. */
  kindsByProgress: [
    { from: 0, kinds: ['orange', 'apple', 'watermelon'] },
    { from: 6, kinds: ['orange', 'apple', 'watermelon', 'lemon'] },
    { from: 12, kinds: ['apple', 'watermelon', 'lemon', 'pear'] },
    { from: 20, kinds: ['lemon', 'pear', 'banana', 'watermelon'] },
  ],

  scoring: {
    /** Each consecutive Perfect adds this to the multiplier, up to the cap. */
    comboStep: 0.1,
    comboMax: 10,
  },

  arcade: {
    startTime: 45,
    maxTime: 90,
    /** Seconds added by a cut inside tolerance (+ the bonus when it is Perfect). */
    timeBonus: 3,
    perfectTimeBonus: 1,
    /** Seconds lost by a cut outside tolerance or a bomb hit. */
    penaltyTime: 3,
    maxStrikes: 3,
    /** After a "try again": time given back, and the strikes you keep. */
    continueTime: 15,
    continueStrikes: 1,
    /** Chaos ramps in after this many fruit. */
    driftFrom: 3,
    spinFrom: 6,
    bombsFrom: 8,
    twinFrom: 10,
    twinChance: 0.35,
    /** Two fruit at once are harder to bisect with one line, so they get a looser tolerance. */
    twinToleranceFactor: 1.5,
    maxDrift: 85,
    maxSpin: 1.8,
    bombRadius: 22,
    /** Where moving fruit may roam. */
    bounds: { left: 20, right: 340, top: 190, bottom: 520 },
  },

  economy: {
    /** Coins paid at the end of a run. */
    perFruit: 2,
    perPerfect: 3,
    scoreDivisor: 100,
    /** Cost of the first "try again" in a run; each later one doubles, up to the cap. */
    firstRestartCost: 20,
    maxRestartCost: 1000,
  },

  /** A short ad is shown on returning to the menu, at most this often (ms), and never right after a rewarded ad. */
  interstitial: { minGapMs: 45_000 },

  /** A new player's wallet and kit. */
  startCoins: 0,
  defaultSkin: 'steel',
} as const;

export type Mode = 'classic' | 'arcade';
