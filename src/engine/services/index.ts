import { Capacitor } from '@capacitor/core';
import { guardAdService, type AdService } from './ads';
import { ConsoleAnalytics, type AnalyticsService } from './analytics';
import { WebAudioService, type AudioService } from './audio';
import { FakeAdService, type FakeAdMode } from './fakeAds';
import { CapacitorHaptics, type HapticsService } from './haptics';

export type { AdService } from './ads';
export type { AnalyticsService } from './analytics';
export type { AudioService, NoiseOptions, ToneOptions } from './audio';
export { parseFakeAdMode, type FakeAdMode } from './fakeAds';
export type { HapticsService, ImpactKind, NotifyKind } from './haptics';

export interface Services {
  ads: AdService;
  analytics: AnalyticsService;
  haptics: HapticsService;
  audio: AudioService;
}

/**
 * Native builds: forwards to the AdMob service, which is imported lazily so the plugin is not
 * evaluated (or even downloaded) in the browser. Until it has loaded, no ad is ready.
 */
class NativeAdService implements AdService {
  private inner: AdService | null = null;

  constructor(private readonly analytics: AnalyticsService) {}

  async init(): Promise<void> {
    const { createAdMobService, resolveAdUnits } = await import('./admobAds');
    const units = resolveAdUnits(Capacitor.getPlatform(), import.meta.env);
    if (units.rewarded === null && units.interstitial === null) {
      this.analytics.track('ads_disabled', { reason: 'missing_unit_id' });
      return;
    }
    this.inner = await createAdMobService(units, this.analytics);
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

  isInterstitialReady(): boolean {
    return this.inner?.isInterstitialReady() ?? false;
  }

  preloadInterstitial(): Promise<void> {
    return this.inner?.preloadInterstitial() ?? Promise.resolve();
  }

  showInterstitial(): Promise<boolean> {
    return this.inner?.showInterstitial() ?? Promise.resolve(false);
  }
}

export function createServices(options: { fakeAdMode: FakeAdMode }): Services {
  const analytics = new ConsoleAnalytics();
  const ads: AdService = Capacitor.isNativePlatform()
    ? new NativeAdService(analytics)
    : new FakeAdService(options.fakeAdMode);
  return {
    ads: guardAdService(ads, analytics),
    analytics,
    haptics: new CapacitorHaptics(),
    audio: new WebAudioService(),
  };
}
