import type { AnalyticsService } from './analytics';

/**
 * Ads, as the game sees them. No method may throw or reject into game code: failures mean
 * "not ready" / `false`.
 */
export interface AdService {
  /** Sets the SDK up (consent, ATT, first preloads). Resolves when done; never rejects. */
  init(): Promise<void>;

  /** True when a rewarded ad is loaded and can be shown right now. */
  isRewardedReady(): boolean;
  /** Starts loading the next rewarded ad. Safe to call at any time. */
  preloadRewarded(): Promise<void>;
  /** Shows the loaded rewarded ad. Resolves true only if the user earned the reward. */
  showRewarded(): Promise<boolean>;

  /** True when an interstitial (a short ad between screens) is loaded. */
  isInterstitialReady(): boolean;
  /** Starts loading the next interstitial. Safe to call at any time. */
  preloadInterstitial(): Promise<void>;
  /** Shows the loaded interstitial. Resolves true if it was shown and closed, false if it could not be shown. */
  showInterstitial(): Promise<boolean>;
}

/**
 * Wraps an AdService so that nothing it does can throw or reject into game code, whatever the
 * inner implementation does. Implementations still handle their own errors; this is the backstop.
 */
export function guardAdService(inner: AdService, analytics: AnalyticsService): AdService {
  const fail = (method: string, error: unknown): void => {
    analytics.track('ad_service_error', { method, message: String(error) });
  };
  const safeVoid = async (method: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      fail(method, error);
    }
  };
  const safeBool = async (method: string, run: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await run();
    } catch (error) {
      fail(method, error);
      return false;
    }
  };
  const safeReady = (method: string, run: () => boolean): boolean => {
    try {
      return run();
    } catch (error) {
      fail(method, error);
      return false;
    }
  };
  return {
    init: () => safeVoid('init', () => inner.init()),
    isRewardedReady: () => safeReady('isRewardedReady', () => inner.isRewardedReady()),
    preloadRewarded: () => safeVoid('preloadRewarded', () => inner.preloadRewarded()),
    showRewarded: () => safeBool('showRewarded', () => inner.showRewarded()),
    isInterstitialReady: () => safeReady('isInterstitialReady', () => inner.isInterstitialReady()),
    preloadInterstitial: () => safeVoid('preloadInterstitial', () => inner.preloadInterstitial()),
    showInterstitial: () => safeBool('showInterstitial', () => inner.showInterstitial()),
  };
}
