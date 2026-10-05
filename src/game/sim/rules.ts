import { CONFIG } from './config';

export interface InterstitialContext {
  nowMs: number;
  /** When the last interstitial was shown, or null if none yet this session. */
  lastShownAtMs: number | null;
  /** The player chose to watch a rewarded ad since the last interstitial. */
  watchedRewarded: boolean;
  /** An interstitial is loaded. */
  ready: boolean;
}

/** Whether to show the short ad on returning to the menu: loaded, not right after a rewarded ad, and not too often. */
export function shouldShowInterstitial(ctx: InterstitialContext): boolean {
  if (!ctx.ready || ctx.watchedRewarded) return false;
  if (ctx.lastShownAtMs === null) return true;
  return ctx.nowMs - ctx.lastShownAtMs >= CONFIG.interstitial.minGapMs;
}

/** The number of full days since 1970 (UTC): the daily seed. The flow reads the clock; the rules just name the day. */
export const dailySeed = (daysSinceEpoch: number): number => Math.max(0, Math.floor(daysSinceEpoch));

/** "Loop 2 of 8". */
export const loopLabel = (loop: number, maxLoops: number): string => `Loop ${loop + 1} of ${maxLoops}`;
