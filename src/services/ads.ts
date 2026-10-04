import type { AnalyticsService } from './analytics';

/**
 * Rewarded ads, as the game sees them. No method may throw or reject into game code: failures
 * mean "not ready" / `false`.
 */
export interface AdService {
  /** Sets the SDK up (consent, ATT, first preload). Resolves when done; never rejects. */
  init(): Promise<void>;
  /** True when a rewarded ad is loaded and can be shown right now. */
  isRewardedReady(): boolean;
  /** Starts loading the next rewarded ad. Safe to call at any time. */
  preloadRewarded(): Promise<void>;
  /** Shows the loaded ad. Resolves true only if the user earned the reward. */
  showRewarded(): Promise<boolean>;
}

/**
 * Wraps an AdService so that nothing it does can throw or reject into game code, whatever the
 * inner implementation does. Implementations still handle their own errors; this is the backstop.
 */
export function guardAdService(inner: AdService, analytics: AnalyticsService): AdService {
  const fail = (method: string, error: unknown): void => {
    analytics.track('ad_service_error', { method, message: String(error) });
  };
  return {
    async init() {
      try {
        await inner.init();
      } catch (error) {
        fail('init', error);
      }
    },
    isRewardedReady() {
      try {
        return inner.isRewardedReady();
      } catch (error) {
        fail('isRewardedReady', error);
        return false;
      }
    },
    async preloadRewarded() {
      try {
        await inner.preloadRewarded();
      } catch (error) {
        fail('preloadRewarded', error);
      }
    },
    async showRewarded() {
      try {
        return await inner.showRewarded();
      } catch (error) {
        fail('showRewarded', error);
        return false;
      }
    },
  };
}
