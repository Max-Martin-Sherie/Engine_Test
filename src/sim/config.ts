/** Every tuning number for the game lives here. Units: world units and seconds. */

const TICKS_PER_SECOND = 60;

export const CONFIG = {
  /** The play field. Everything (sim, view, UI) is laid out in these units, letterboxed to the screen. */
  world: { width: 360, height: 640 },

  ticksPerSecond: TICKS_PER_SECOND,
  /** Fixed simulation step in seconds. */
  dt: 1 / TICKS_PER_SECOND,

  /** Seconds of invulnerability after a revive. */
  reviveGrace: 1.5,

  /** GAME: delete this and add your own tuning. Used only by the placeholder rule in game.ts. */
  placeholder: {
    /** The run ends every this many seconds, so the play -> die -> revive flow can be exercised. */
    dieEverySeconds: 5,
  },
} as const;
