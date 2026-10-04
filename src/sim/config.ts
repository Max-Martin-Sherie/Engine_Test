/** Every tuning number for the game lives here. Units: world units and seconds. */

const TICKS_PER_SECOND = 60;

export const CONFIG = {
  world: { width: 360, height: 640 },

  ticksPerSecond: TICKS_PER_SECOND,
  /** Fixed simulation step in seconds. */
  dt: 1 / TICKS_PER_SECOND,

  player: {
    radius: 15,
    /** Fixed y of the player's centre. */
    y: 560,
    /** Cap on horizontal speed, units per second. */
    maxSpeed: 480,
  },

  rocks: {
    minRadius: 12,
    maxRadius: 30,
    /** Horizontal drift is picked from [-maxDrift, maxDrift] units per second. */
    maxDrift: 22,
    /** Each rock's fall speed is the current speed times a factor in [1 - jitter, 1 + jitter]. */
    speedJitter: 0.25,
  },

  spawn: {
    /** Delay before the first rock of a run (and after a revive). */
    firstDelay: 0.5,
    startInterval: 0.9,
    /** Interval never goes below this. */
    minInterval: 0.3,
    /** How much the interval shrinks per second survived. */
    shrinkPerSecond: 0.012,
  },

  fall: {
    startSpeed: 130,
    /** Fall speed never goes above this. */
    maxSpeed: 360,
    /** How much the base fall speed grows per second survived. */
    gainPerSecond: 4,
  },

  /** A hit needs the centres closer than this fraction of the summed radii. */
  hitboxScale: 0.85,

  /** Seconds of invulnerability after a revive. */
  reviveGrace: 1.5,
} as const;
