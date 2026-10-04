import { CONFIG, type Mode } from './config';

// ---- difficulty curve -------------------------------------------------------------------

/**
 * How far from 50/50 (in percentage points) a cut may be after `fruitsCut` fruit. Shrinks
 * smoothly (a constant ratio per fruit) from the start value to the floor, then holds.
 */
export function toleranceFor(mode: Mode, fruitsCut: number): number {
  const { start, floor, fruitsToFloor } = CONFIG.tolerance[mode];
  const progress = Math.min(Math.max(fruitsCut, 0), fruitsToFloor) / fruitsToFloor;
  return start * Math.pow(floor / start, progress);
}

/** Bounding radius of the next fruit: shrinks linearly with progress, then holds. */
export function fruitRadiusFor(fruitsCut: number): number {
  const { startRadius, minRadius, fruitsToMinRadius } = CONFIG.fruit;
  const progress = Math.min(Math.max(fruitsCut, 0), fruitsToMinRadius) / fruitsToMinRadius;
  return startRadius + (minRadius - startRadius) * progress;
}

// ---- rating and score --------------------------------------------------------------------

export type Rating = 'perfect' | 'great' | 'good';

/** Rating of a cut that was inside tolerance. */
export function ratingFor(deviation: number): Rating {
  if (deviation <= CONFIG.rating.perfect) return 'perfect';
  if (deviation <= CONFIG.rating.great) return 'great';
  return 'good';
}

/** 100 for a perfect split, 0 when one side got nothing. */
export function accuracyFor(deviation: number): number {
  return 100 - 2 * deviation;
}

/** A Perfect extends the combo, a Great keeps it, anything else breaks it. */
export function nextCombo(combo: number, rating: Rating): number {
  return rating === 'perfect' ? combo + 1 : rating === 'great' ? combo : 0;
}

export function comboMultiplier(combo: number): number {
  const { comboStep, comboMax } = CONFIG.scoring;
  return 1 + Math.min(combo, comboMax) * comboStep;
}

/** Points for a successful cut: accuracy times the combo multiplier, rounded. */
export function pointsFor(accuracy: number, combo: number): number {
  return Math.round(accuracy * comboMultiplier(combo));
}

// ---- economy -----------------------------------------------------------------------------

export interface RunStats {
  fruits: number;
  perfects: number;
  score: number;
}

/** Coins paid out at the end of a run. */
export function runCoins({ fruits, perfects, score }: RunStats): number {
  const { perFruit, perPerfect, scoreDivisor } = CONFIG.economy;
  return fruits * perFruit + perfects * perPerfect + Math.floor(score / scoreDivisor);
}

/** Coins to try again after the `restartsUsed`-th restart this run (0 = the first). Doubles each time. */
export function restartCost(restartsUsed: number): number {
  const { firstRestartCost, maxRestartCost } = CONFIG.economy;
  return Math.min(maxRestartCost, firstRestartCost * Math.pow(2, Math.max(restartsUsed, 0)));
}

// ---- ad pacing ---------------------------------------------------------------------------

export interface InterstitialContext {
  nowMs: number;
  /** When the last interstitial was shown, or null if none yet this session. */
  lastShownAtMs: number | null;
  /** The player already watched a rewarded ad during the run that just ended. */
  watchedRewardedThisRun: boolean;
  /** An interstitial is loaded. */
  ready: boolean;
}

/**
 * Whether to show the short ad on returning to the menu after a run: only if one is loaded, the
 * player did not just choose to watch a rewarded ad, and the last one was a while ago.
 */
export function shouldShowInterstitial(ctx: InterstitialContext): boolean {
  if (!ctx.ready || ctx.watchedRewardedThisRun) return false;
  if (ctx.lastShownAtMs === null) return true;
  return ctx.nowMs - ctx.lastShownAtMs >= CONFIG.interstitial.minGapMs;
}
