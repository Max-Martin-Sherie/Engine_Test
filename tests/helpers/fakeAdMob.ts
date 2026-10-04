import {
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
  type AdMobPlugin,
  type AdmobConsentInfo,
} from '@capacitor-community/admob';
import {
  AdMobAdService,
  TEST_INTERSTITIAL_ANDROID,
  TEST_REWARDED_ANDROID,
  type AdUnits,
} from '../../src/engine/services/admobAds';
import type { AnalyticsService } from '../../src/engine/services/analytics';

export type Listener = (...args: unknown[]) => void;

export function consent(over: Partial<AdmobConsentInfo> = {}): AdmobConsentInfo {
  return {
    status: AdmobConsentStatus.NOT_REQUIRED,
    isConsentFormAvailable: false,
    canRequestAds: true,
    // The plugin's index does not export this enum as a value, so use its string form.
    privacyOptionsRequirementStatus: 'NOT_REQUIRED' as AdmobConsentInfo['privacyOptionsRequirementStatus'],
    ...over,
  };
}

/** A scripted stand-in for the AdMob plugin that records every call in order. */
export class FakeAdMob {
  calls: string[] = [];
  listeners = new Map<string, Set<Listener>>();
  removed = 0;

  consentInfo: AdmobConsentInfo = consent();
  afterForm: AdmobConsentInfo = consent({ status: AdmobConsentStatus.OBTAINED });
  attStatus: 'authorized' | 'notDetermined' = 'authorized';
  failConsentInfo = false;
  failLoad = false;
  failInterstitialLoad = false;
  failAddListenerOn: string | null = null;
  /** What happens when showRewardVideoAd() is called. Default: never settle, like Android. */
  onShow: () => Promise<unknown> = () => new Promise(() => {});
  /** What happens when showInterstitial() is called. Default: resolves at once, like both platforms. */
  onShowInterstitial: () => Promise<unknown> = () => Promise.resolve();

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  initialize = async (): Promise<void> => {
    this.calls.push('initialize');
  };
  requestConsentInfo = async (): Promise<AdmobConsentInfo> => {
    this.calls.push('requestConsentInfo');
    if (this.failConsentInfo) throw new Error('network');
    return this.consentInfo;
  };
  showConsentForm = async (): Promise<AdmobConsentInfo> => {
    this.calls.push('showConsentForm');
    return this.afterForm;
  };
  trackingAuthorizationStatus = async (): Promise<{ status: 'authorized' | 'notDetermined' }> => {
    this.calls.push('trackingAuthorizationStatus');
    return { status: this.attStatus };
  };
  requestTrackingAuthorization = async (): Promise<void> => {
    this.calls.push('requestTrackingAuthorization');
  };
  prepareRewardVideoAd = async (options: { adId: string; isTesting?: boolean }) => {
    this.calls.push('prepareRewardVideoAd');
    if (this.failLoad) throw new Error('no fill');
    return { adUnitId: options.adId };
  };
  showRewardVideoAd = (): Promise<unknown> => {
    this.calls.push('showRewardVideoAd');
    return this.onShow();
  };
  prepareInterstitial = async (options: { adId: string; isTesting?: boolean }) => {
    this.calls.push('prepareInterstitial');
    if (this.failInterstitialLoad) throw new Error('no fill');
    return { adUnitId: options.adId };
  };
  showInterstitial = (): Promise<unknown> => {
    this.calls.push('showInterstitial');
    return this.onShowInterstitial();
  };
  addListener = async (event: string, fn: Listener) => {
    this.calls.push(`addListener:${event}`);
    if (event === this.failAddListenerOn) throw new Error('cannot listen');
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(event, set);
    return {
      remove: async () => {
        this.removed++;
        set.delete(fn);
      },
    };
  };
}

export const analytics: AnalyticsService & { events: string[] } = {
  events: [],
  track(event) {
    this.events.push(event);
  },
};

export const TEST_UNITS: AdUnits = {
  rewarded: { adId: TEST_REWARDED_ANDROID, isTesting: true },
  interstitial: { adId: TEST_INTERSTITIAL_ANDROID, isTesting: true },
};

export function makeService(admob: FakeAdMob, timeoutMs?: number, units: AdUnits = TEST_UNITS): AdMobAdService {
  return new AdMobAdService(
    {
      AdMob: admob as unknown as AdMobPlugin,
      AdmobConsentStatus,
      RewardAdPluginEvents,
      InterstitialAdPluginEvents,
    },
    units,
    analytics,
    timeoutMs === undefined ? {} : { rewardedMs: timeoutMs, interstitialMs: timeoutMs },
  );
}

/** A service that has been through init(), with its rewarded ad loaded. */
export async function readyService(admob: FakeAdMob, timeoutMs?: number): Promise<AdMobAdService> {
  const service = makeService(admob, timeoutMs);
  await service.init();
  return service;
}
