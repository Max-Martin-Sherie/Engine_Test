/** Every tuning number for Fruit Slice lives here. Units: world units, seconds, percentage points. */
import { WORLD } from '../../engine/core/config';

const TICKS_PER_SECOND = 60;

export type Mode = 'classic' | 'arcade' | 'survival';
/** Modes whose tolerance follows a curve over the fruit cut (Survival works from a margin instead). */
export type CurveMode = Exclude<Mode, 'survival'>;
export const MODES: readonly Mode[] = ['classic', 'arcade', 'survival'];

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
    arcade: { start: 16, floor: 4, fruitsToFloor: 60 },
  },

  /**
   * Survival: you have a margin (in percentage points). Every cut takes its deviation from 50/50,
   * times the loss multiplier, off it; a perfect cut costs nothing. The run ends when a cut would
   * leave less than `minMargin`, so the widest cut allowed is (margin - minMargin) / multiplier.
   * Now and then a "+x" bubble sits over the fruit: a drag through it adds x (up to `maxMargin`).
   * The multiplier grows after `lossFrom` fruit so that no run can last forever.
   */
  survival: {
    startMargin: 25,
    maxMargin: 35,
    minMargin: 0.6,
    lossFrom: 8,
    lossPerFruit: 0.08,
    maxLoss: 4,
    bubbleFrom: 0,
    bubbleChance: 0.4,
    bubbleRadius: 18,
    /** How far from the fruit's middle the bubble sits, as a fraction of the fruit's radius. */
    bubbleOffset: 0.5,
    bubbleMin: 3,
    bubbleMax: 6,
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

  scoring: {
    /** Each consecutive Perfect adds this to the multiplier, up to the cap. */
    comboStep: 0.1,
    comboMax: 10,
  },

  arcade: {
    startTime: 60,
    maxTime: 99,
    /** Seconds added by a cut inside tolerance (+ the bonus when it is Perfect). */
    timeBonus: 4,
    perfectTimeBonus: 1,
    /** Seconds lost by a cut outside tolerance or a bomb hit. */
    penaltyTime: 2,
    maxStrikes: 3,
    /** After a "try again": time given back, and the strikes you keep. */
    continueTime: 20,
    continueStrikes: 1,
    /** Chaos ramps in slowly, after this many fruit. */
    driftFrom: 6,
    spinFrom: 12,
    bombsFrom: 16,
    twinFrom: 22,
    twinChance: 0.25,
    /** Two fruit at once are harder to bisect with one line, so they get a looser tolerance. */
    twinToleranceFactor: 1.5,
    /** Speeds grow by this much per round once their chaos has started, up to the maxima. */
    driftBase: 12,
    driftPerRound: 3,
    maxDrift: 55,
    spinBase: 0.35,
    spinPerRound: 0.06,
    maxSpin: 1.0,
    /** The second bomb joins at this round. */
    secondBombFrom: 28,
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
