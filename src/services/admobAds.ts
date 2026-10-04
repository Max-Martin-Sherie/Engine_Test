import type { PluginListenerHandle } from '@capacitor/core';
// Type-only imports: this file must not pull the plugin in statically. createAdMobService() below
// loads it with a dynamic import, so the browser build never evaluates it.
import type {
  AdMobPlugin,
  AdmobConsentStatus,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdService } from './ads';
import type { AnalyticsService } from './analytics';

/** Google's official sample rewarded units. https://developers.google.com/admob/android/test-ads */
export const TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
export const TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313';

/** If the ad never reports back (lost event, stuck view), give up after this long. */
export const REWARDED_SAFETY_TIMEOUT_MS = 120_000;

export interface RewardedConfig {
  adId: string;
  isTesting: boolean;
}

export interface AdEnv {
  VITE_ADS_TESTING?: string | undefined;
  VITE_ADMOB_REWARDED_ANDROID?: string | undefined;
  VITE_ADMOB_REWARDED_IOS?: string | undefined;
}

/**
 * Test unit IDs unless VITE_ADS_TESTING is exactly "false"; then the real IDs from env.
 * Returns null (ads disabled) if a real ID is missing, rather than silently using a test ID in
 * a release build.
 */
export function resolveRewardedConfig(platform: string, env: AdEnv): RewardedConfig | null {
  const android = platform === 'android';
  const ios = platform === 'ios';
  if (!android && !ios) return null;
  if (env.VITE_ADS_TESTING !== 'false') {
    return { adId: android ? TEST_REWARDED_ANDROID : TEST_REWARDED_IOS, isTesting: true };
  }
  const adId = android ? env.VITE_ADMOB_REWARDED_ANDROID : env.VITE_ADMOB_REWARDED_IOS;
  if (!adId) return null;
  return { adId, isTesting: false };
}

/** The pieces of '@capacitor-community/admob' we use, injected so tests can supply fakes. */
export interface AdMobBindings {
  AdMob: AdMobPlugin;
  AdmobConsentStatus: typeof AdmobConsentStatus;
  RewardAdPluginEvents: typeof RewardAdPluginEvents;
}

export class AdMobAdService implements AdService {
  private canRequestAds = false;
  private ready = false;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly sdk: AdMobBindings,
    private readonly config: RewardedConfig,
    private readonly analytics: AnalyticsService,
    private readonly safetyTimeoutMs: number = REWARDED_SAFETY_TIMEOUT_MS,
  ) {}

  async init(): Promise<void> {
    const { AdMob, AdmobConsentStatus } = this.sdk;
    try {
      // 1. Initialize first: on iOS the consent form cannot present before the SDK is initialized.
      await AdMob.initialize();

      // 2. Consent (UMP). Only show the form when it is required and available.
      let info = await AdMob.requestConsentInfo();
      if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
        info = await AdMob.showConsentForm();
      }

      // 3. Nothing is loaded unless consent allows requesting ads.
      if (!info.canRequestAds) {
        this.analytics.track('ads_blocked', { reason: 'consent' });
        return;
      }
      this.canRequestAds = true;

      // 4. App Tracking Transparency (iOS only; other platforms report "authorized").
      try {
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
      } catch (error) {
        this.analytics.track('att_failed', { message: String(error) });
      }

      await this.preloadRewarded();
    } catch (error) {
      this.analytics.track('ads_init_failed', { message: String(error) });
    }
  }

  isRewardedReady(): boolean {
    return this.ready;
  }

  preloadRewarded(): Promise<void> {
    if (!this.canRequestAds || this.ready) return Promise.resolve();
    // Share one in-flight load between callers.
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      await this.sdk.AdMob.prepareRewardVideoAd({
        adId: this.config.adId,
        isTesting: this.config.isTesting,
      });
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.analytics.track('rewarded_load_failed', { message: String(error) });
    }
  }

  async showRewarded(): Promise<boolean> {
    if (!this.ready) return false;
    this.ready = false; // a prepared ad can only be shown once

    const { AdMob, RewardAdPluginEvents } = this.sdk;
    let rewarded = false;
    let finish: (result: boolean) => void = () => {};
    const outcome = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const handles: PluginListenerHandle[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // The outcome comes from events. On Android the promise returned by showRewardVideoAd()
      // never settles if the user closes the ad before earning the reward.
      // Await each registration so no event can fire before we are listening.
      handles.push(
        await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
          rewarded = true;
        }),
      );
      handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(rewarded)));
      handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));

      timer = setTimeout(() => finish(rewarded), this.safetyTimeoutMs);

      // Fire and forget: only a rejection matters (nothing to show, ad already showing, ...).
      AdMob.showRewardVideoAd().catch((error: unknown) => {
        this.analytics.track('rewarded_show_failed', { message: String(error) });
        finish(false);
      });

      return await outcome;
    } catch (error) {
      this.analytics.track('rewarded_show_failed', { message: String(error) });
      return false;
    } finally {
      clearTimeout(timer);
      await Promise.all(
        handles.map(async (handle) => {
          try {
            await handle.remove();
          } catch {
            // Already gone; nothing to clean up.
          }
        }),
      );
    }
  }
}

/** Loads the plugin on demand and builds the service. */
export async function createAdMobService(
  config: RewardedConfig,
  analytics: AnalyticsService,
): Promise<AdService> {
  const { AdMob, AdmobConsentStatus, RewardAdPluginEvents } = await import(
    '@capacitor-community/admob'
  );
  return new AdMobAdService({ AdMob, AdmobConsentStatus, RewardAdPluginEvents }, config, analytics);
}
