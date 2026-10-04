import type { PluginListenerHandle } from '@capacitor/core';
// Type-only imports: this file must not pull the plugin in statically. createAdMobService() below
// loads it with a dynamic import, so the browser build never evaluates it.
import type {
  AdMobPlugin,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdService } from './ads';
import type { AnalyticsService } from './analytics';

/** Google's official sample units. https://developers.google.com/admob/android/test-ads */
export const TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
export const TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313';
export const TEST_INTERSTITIAL_ANDROID = 'ca-app-pub-3940256099942544/1033173712';
// Not the plugin's own iOS default: its source falls back to the Android interstitial ID on iOS.
export const TEST_INTERSTITIAL_IOS = 'ca-app-pub-3940256099942544/4411468910';

/** If a rewarded ad never reports back (lost event, stuck view), give up after this long. */
export const REWARDED_SAFETY_TIMEOUT_MS = 120_000;
export const INTERSTITIAL_SAFETY_TIMEOUT_MS = 90_000;

export interface AdUnit {
  adId: string;
  isTesting: boolean;
}

/** A null unit means that kind of ad is disabled. */
export interface AdUnits {
  rewarded: AdUnit | null;
  interstitial: AdUnit | null;
}

export interface AdEnv {
  VITE_ADS_TESTING?: string | undefined;
  VITE_ADMOB_REWARDED_ANDROID?: string | undefined;
  VITE_ADMOB_REWARDED_IOS?: string | undefined;
  VITE_ADMOB_INTERSTITIAL_ANDROID?: string | undefined;
  VITE_ADMOB_INTERSTITIAL_IOS?: string | undefined;
}

function resolveUnit(
  platform: string,
  env: AdEnv,
  test: { android: string; ios: string },
  real: { android: string | undefined; ios: string | undefined },
): AdUnit | null {
  const android = platform === 'android';
  const ios = platform === 'ios';
  if (!android && !ios) return null;
  if (env.VITE_ADS_TESTING !== 'false') {
    return { adId: android ? test.android : test.ios, isTesting: true };
  }
  const adId = android ? real.android : real.ios;
  if (!adId) return null;
  return { adId, isTesting: false };
}

/**
 * Test unit IDs unless VITE_ADS_TESTING is exactly "false"; then the real IDs from env.
 * Returns null (that ad kind disabled) if a real ID is missing, rather than silently using a
 * test ID in a release build.
 */
export function resolveRewardedConfig(platform: string, env: AdEnv): AdUnit | null {
  return resolveUnit(
    platform,
    env,
    { android: TEST_REWARDED_ANDROID, ios: TEST_REWARDED_IOS },
    { android: env.VITE_ADMOB_REWARDED_ANDROID, ios: env.VITE_ADMOB_REWARDED_IOS },
  );
}

export function resolveInterstitialConfig(platform: string, env: AdEnv): AdUnit | null {
  return resolveUnit(
    platform,
    env,
    { android: TEST_INTERSTITIAL_ANDROID, ios: TEST_INTERSTITIAL_IOS },
    { android: env.VITE_ADMOB_INTERSTITIAL_ANDROID, ios: env.VITE_ADMOB_INTERSTITIAL_IOS },
  );
}

export function resolveAdUnits(platform: string, env: AdEnv): AdUnits {
  return {
    rewarded: resolveRewardedConfig(platform, env),
    interstitial: resolveInterstitialConfig(platform, env),
  };
}

/** The pieces of '@capacitor-community/admob' we use, injected so tests can supply fakes. */
export interface AdMobBindings {
  AdMob: AdMobPlugin;
  AdmobConsentStatus: typeof AdmobConsentStatus;
  RewardAdPluginEvents: typeof RewardAdPluginEvents;
  InterstitialAdPluginEvents: typeof InterstitialAdPluginEvents;
}

export interface AdTimeouts {
  rewardedMs?: number;
  interstitialMs?: number;
}

type Kind = 'rewarded' | 'interstitial';

export class AdMobAdService implements AdService {
  private canRequestAds = false;
  private readonly ready: Record<Kind, boolean> = { rewarded: false, interstitial: false };
  private readonly loading: Record<Kind, Promise<void> | null> = { rewarded: null, interstitial: null };
  /** AdMob can only show one full-screen ad at a time. */
  private showing = false;
  private readonly rewardedTimeoutMs: number;
  private readonly interstitialTimeoutMs: number;

  constructor(
    private readonly sdk: AdMobBindings,
    private readonly units: AdUnits,
    private readonly analytics: AnalyticsService,
    timeouts: AdTimeouts = {},
  ) {
    this.rewardedTimeoutMs = timeouts.rewardedMs ?? REWARDED_SAFETY_TIMEOUT_MS;
    this.interstitialTimeoutMs = timeouts.interstitialMs ?? INTERSTITIAL_SAFETY_TIMEOUT_MS;
  }

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

      await Promise.all([this.preloadRewarded(), this.preloadInterstitial()]);
    } catch (error) {
      this.analytics.track('ads_init_failed', { message: String(error) });
    }
  }

  // ---- loading ---------------------------------------------------------------------------

  isRewardedReady(): boolean {
    return this.ready.rewarded;
  }

  isInterstitialReady(): boolean {
    return this.ready.interstitial;
  }

  preloadRewarded(): Promise<void> {
    return this.preload('rewarded');
  }

  preloadInterstitial(): Promise<void> {
    return this.preload('interstitial');
  }

  private preload(kind: Kind): Promise<void> {
    const unit = this.units[kind];
    if (unit === null || !this.canRequestAds || this.ready[kind]) return Promise.resolve();
    // Share one in-flight load between callers.
    this.loading[kind] ??= this.load(kind, unit).finally(() => {
      this.loading[kind] = null;
    });
    return this.loading[kind] ?? Promise.resolve();
  }

  private async load(kind: Kind, unit: AdUnit): Promise<void> {
    const { AdMob } = this.sdk;
    try {
      const options = { adId: unit.adId, isTesting: unit.isTesting };
      if (kind === 'rewarded') await AdMob.prepareRewardVideoAd(options);
      else await AdMob.prepareInterstitial(options);
      this.ready[kind] = true;
    } catch (error) {
      this.ready[kind] = false;
      this.analytics.track(`${kind}_load_failed`, { message: String(error) });
    }
  }

  // ---- showing ---------------------------------------------------------------------------

  async showRewarded(): Promise<boolean> {
    if (!this.ready.rewarded || this.showing) return false;
    this.ready.rewarded = false; // a prepared ad can only be shown once
    this.showing = true;

    const { AdMob, RewardAdPluginEvents } = this.sdk;
    let rewarded = false;
    const outcome = deferred<boolean>();
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
      handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => outcome.resolve(rewarded)));
      handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => outcome.resolve(false)));

      timer = setTimeout(() => outcome.resolve(rewarded), this.rewardedTimeoutMs);

      // Fire and forget: only a rejection matters (nothing to show, ad already showing, ...).
      AdMob.showRewardVideoAd().catch((error: unknown) => {
        this.analytics.track('rewarded_show_failed', { message: String(error) });
        outcome.resolve(false);
      });

      return await outcome.promise;
    } catch (error) {
      this.analytics.track('rewarded_show_failed', { message: String(error) });
      return false;
    } finally {
      clearTimeout(timer);
      this.showing = false;
      await removeAll(handles);
    }
  }

  async showInterstitial(): Promise<boolean> {
    if (!this.ready.interstitial || this.showing) return false;
    this.ready.interstitial = false;
    this.showing = true;

    const { AdMob, InterstitialAdPluginEvents } = this.sdk;
    const outcome = deferred<boolean>();
    const handles: PluginListenerHandle[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // showInterstitial() resolves as soon as the ad is presented (both platforms), so the end
      // of the ad is only known from events.
      handles.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => outcome.resolve(true)));
      handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => outcome.resolve(false)));

      timer = setTimeout(() => outcome.resolve(false), this.interstitialTimeoutMs);

      AdMob.showInterstitial().catch((error: unknown) => {
        this.analytics.track('interstitial_show_failed', { message: String(error) });
        outcome.resolve(false);
      });

      return await outcome.promise;
    } catch (error) {
      this.analytics.track('interstitial_show_failed', { message: String(error) });
      return false;
    } finally {
      clearTimeout(timer);
      this.showing = false;
      await removeAll(handles);
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function removeAll(handles: PluginListenerHandle[]): Promise<void> {
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

/** Loads the plugin on demand and builds the service. */
export async function createAdMobService(units: AdUnits, analytics: AnalyticsService): Promise<AdService> {
  const { AdMob, AdmobConsentStatus, RewardAdPluginEvents, InterstitialAdPluginEvents } = await import(
    '@capacitor-community/admob'
  );
  return new AdMobAdService(
    { AdMob, AdmobConsentStatus, RewardAdPluginEvents, InterstitialAdPluginEvents },
    units,
    analytics,
  );
}
