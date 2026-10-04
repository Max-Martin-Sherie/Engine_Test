import { Capacitor } from '@capacitor/core';
import { guardAdService, type AdService } from './ads';
import { ConsoleAnalytics, type AnalyticsService } from './analytics';
import { FakeAdService, type FakeAdMode } from './fakeAds';

export type { AdService } from './ads';
export type { AnalyticsService } from './analytics';
export { parseFakeAdMode, type FakeAdMode } from './fakeAds';

export interface Services {
  ads: AdService;
  analytics: AnalyticsService;
}

/**
 * Native builds: forwards to the AdMob service, which is imported lazily so the plugin is not
 * evaluated (or even downloaded) in the browser. Until it has loaded, no ad is ready.
 */
class NativeAdService implements AdService {
  private inner: AdService | null = null;

  constructor(private readonly analytics: AnalyticsService) {}

  async init(): Promise<void> {
    const { createAdMobService, resolveRewardedConfig } = await import('./admobAds');
    const config = resolveRewardedConfig(Capacitor.getPlatform(), import.meta.env);
    if (!config) {
      this.analytics.track('ads_disabled', { reason: 'missing_unit_id' });
      return;
    }
    this.inner = await createAdMobService(config, this.analytics);
    await this.inner.init();
  }

  isRewardedReady(): boolean {
    return this.inner?.isRewardedReady() ?? false;
  }

  preloadRewarded(): Promise<void> {
    return this.inner?.preloadRewarded() ?? Promise.resolve();
  }

  showRewarded(): Promise<boolean> {
    return this.inner?.showRewarded() ?? Promise.resolve(false);
  }
}

export function createServices(options: { fakeAdMode: FakeAdMode }): Services {
  const analytics = new ConsoleAnalytics();
  const ads: AdService = Capacitor.isNativePlatform()
    ? new NativeAdService(analytics)
    : new FakeAdService(options.fakeAdMode);
  return { ads: guardAdService(ads, analytics), analytics };
}
