import {
  AdmobConsentStatus,
  RewardAdPluginEvents,
  type AdMobPlugin,
  type AdmobConsentInfo,
} from '@capacitor-community/admob';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdMobAdService,
  REWARDED_SAFETY_TIMEOUT_MS,
  resolveRewardedConfig,
  TEST_REWARDED_ANDROID,
  TEST_REWARDED_IOS,
} from '../src/engine/services/admobAds';
import type { AnalyticsService } from '../src/engine/services/analytics';

type Listener = (...args: unknown[]) => void;

function consent(over: Partial<AdmobConsentInfo> = {}): AdmobConsentInfo {
  return {
    status: AdmobConsentStatus.NOT_REQUIRED,
    isConsentFormAvailable: false,
    canRequestAds: true,
    // The plugin's index does not export this enum as a value, so use its string form.
    privacyOptionsRequirementStatus:
      'NOT_REQUIRED' as AdmobConsentInfo['privacyOptionsRequirementStatus'],
    ...over,
  };
}

/** A scripted stand-in for the AdMob plugin that records every call in order. */
class FakeAdMob {
  calls: string[] = [];
  listeners = new Map<string, Set<Listener>>();
  removed = 0;

  consentInfo: AdmobConsentInfo = consent();
  afterForm: AdmobConsentInfo = consent({ status: AdmobConsentStatus.OBTAINED });
  attStatus: 'authorized' | 'notDetermined' = 'authorized';
  failConsentInfo = false;
  failLoad = false;
  failAddListenerOn: string | null = null;
  /** What happens when showRewardVideoAd() is called. Default: never settle, like Android. */
  onShow: () => Promise<unknown> = () => new Promise(() => {});

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

const analytics: AnalyticsService & { events: string[] } = {
  events: [],
  track(event) {
    this.events.push(event);
  },
};

function makeService(admob: FakeAdMob, timeoutMs?: number): AdMobAdService {
  return new AdMobAdService(
    {
      AdMob: admob as unknown as AdMobPlugin,
      AdmobConsentStatus,
      RewardAdPluginEvents,
    },
    { adId: TEST_REWARDED_ANDROID, isTesting: true },
    analytics,
    timeoutMs,
  );
}

async function readyService(admob: FakeAdMob, timeoutMs?: number): Promise<AdMobAdService> {
  const service = makeService(admob, timeoutMs);
  await service.init();
  expect(service.isRewardedReady()).toBe(true);
  return service;
}

beforeEach(() => {
  analytics.events.length = 0;
});

describe('resolveRewardedConfig', () => {
  it('uses Google test units unless VITE_ADS_TESTING is exactly "false"', () => {
    for (const flag of [undefined, '', 'true', 'nope']) {
      expect(resolveRewardedConfig('android', { VITE_ADS_TESTING: flag })).toEqual({
        adId: TEST_REWARDED_ANDROID,
        isTesting: true,
      });
      expect(resolveRewardedConfig('ios', { VITE_ADS_TESTING: flag })).toEqual({
        adId: TEST_REWARDED_IOS,
        isTesting: true,
      });
    }
  });

  it('uses the real IDs from env when testing is off', () => {
    const env = {
      VITE_ADS_TESTING: 'false',
      VITE_ADMOB_REWARDED_ANDROID: 'ca-app-pub-1/android',
      VITE_ADMOB_REWARDED_IOS: 'ca-app-pub-1/ios',
    };
    expect(resolveRewardedConfig('android', env)).toEqual({ adId: 'ca-app-pub-1/android', isTesting: false });
    expect(resolveRewardedConfig('ios', env)).toEqual({ adId: 'ca-app-pub-1/ios', isTesting: false });
  });

  it('disables ads rather than falling back to a test ID in a release build', () => {
    expect(resolveRewardedConfig('android', { VITE_ADS_TESTING: 'false' })).toBeNull();
    expect(resolveRewardedConfig('ios', { VITE_ADS_TESTING: 'false', VITE_ADMOB_REWARDED_ANDROID: 'x' })).toBeNull();
  });

  it('has no ads on the web', () => {
    expect(resolveRewardedConfig('web', {})).toBeNull();
  });
});

describe('AdMobAdService.init', () => {
  it('initializes the SDK before it asks about consent', async () => {
    const admob = new FakeAdMob();
    await makeService(admob).init();
    expect(admob.calls.slice(0, 2)).toEqual(['initialize', 'requestConsentInfo']);
  });

  it('shows the consent form only when required AND available, after initialize', async () => {
    const required = new FakeAdMob();
    required.consentInfo = consent({ status: AdmobConsentStatus.REQUIRED, isConsentFormAvailable: true, canRequestAds: false });
    await makeService(required).init();
    expect(required.calls.indexOf('initialize')).toBeLessThan(required.calls.indexOf('showConsentForm'));
    expect(required.calls.indexOf('requestConsentInfo')).toBeLessThan(required.calls.indexOf('showConsentForm'));

    const notRequired = new FakeAdMob();
    await makeService(notRequired).init();
    expect(notRequired.calls).not.toContain('showConsentForm');

    const noForm = new FakeAdMob();
    noForm.consentInfo = consent({ status: AdmobConsentStatus.REQUIRED, isConsentFormAvailable: false, canRequestAds: false });
    await makeService(noForm).init();
    expect(noForm.calls).not.toContain('showConsentForm');

    const obtained = new FakeAdMob();
    obtained.consentInfo = consent({ status: AdmobConsentStatus.OBTAINED });
    await makeService(obtained).init();
    expect(obtained.calls).not.toContain('showConsentForm');
  });

  it('loads nothing, and asks nothing else, when consent forbids requesting ads', async () => {
    const admob = new FakeAdMob();
    admob.consentInfo = consent({ status: AdmobConsentStatus.REQUIRED, isConsentFormAvailable: true, canRequestAds: false });
    admob.afterForm = consent({ status: AdmobConsentStatus.REQUIRED, canRequestAds: false });
    admob.attStatus = 'notDetermined';
    const service = makeService(admob);
    await service.init();
    expect(admob.calls).not.toContain('prepareRewardVideoAd');
    expect(admob.calls).not.toContain('requestTrackingAuthorization');
    expect(service.isRewardedReady()).toBe(false);
    await service.preloadRewarded(); // still gated
    expect(admob.calls).not.toContain('prepareRewardVideoAd');
  });

  it('loads after the user grants consent in the form', async () => {
    const admob = new FakeAdMob();
    admob.consentInfo = consent({ status: AdmobConsentStatus.REQUIRED, isConsentFormAvailable: true, canRequestAds: false });
    admob.afterForm = consent({ status: AdmobConsentStatus.OBTAINED, canRequestAds: true });
    const service = await readyService(admob);
    expect(admob.calls.indexOf('showConsentForm')).toBeLessThan(admob.calls.indexOf('prepareRewardVideoAd'));
    expect(service.isRewardedReady()).toBe(true);
  });

  it('requests ATT only when notDetermined, and before the first ad load', async () => {
    const asked = new FakeAdMob();
    asked.attStatus = 'notDetermined';
    await makeService(asked).init();
    expect(asked.calls.indexOf('requestTrackingAuthorization')).toBeGreaterThan(-1);
    expect(asked.calls.indexOf('requestTrackingAuthorization')).toBeLessThan(asked.calls.indexOf('prepareRewardVideoAd'));

    const settled = new FakeAdMob();
    settled.attStatus = 'authorized';
    await makeService(settled).init();
    expect(settled.calls).not.toContain('requestTrackingAuthorization');
  });

  it('never throws, and just leaves ads off, when the SDK fails', async () => {
    const admob = new FakeAdMob();
    admob.failConsentInfo = true;
    const service = makeService(admob);
    await expect(service.init()).resolves.toBeUndefined();
    expect(service.isRewardedReady()).toBe(false);
    expect(analytics.events).toContain('ads_init_failed');
  });

  it('a failed load is not-ready, and concurrent preloads share one request', async () => {
    const admob = new FakeAdMob();
    admob.failLoad = true;
    const service = makeService(admob);
    await service.init();
    expect(service.isRewardedReady()).toBe(false);

    admob.failLoad = false;
    admob.calls.length = 0;
    await Promise.all([service.preloadRewarded(), service.preloadRewarded(), service.preloadRewarded()]);
    expect(admob.calls.filter((c) => c === 'prepareRewardVideoAd')).toHaveLength(1);
    expect(service.isRewardedReady()).toBe(true);

    await service.preloadRewarded(); // already ready: nothing to do
    expect(admob.calls.filter((c) => c === 'prepareRewardVideoAd')).toHaveLength(1);
  });
});

describe('AdMobAdService.showRewarded', () => {
  afterEach(() => vi.useRealTimers());

  it('is false, without touching the SDK, when no ad is ready', async () => {
    const admob = new FakeAdMob();
    const service = makeService(admob);
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.calls).toEqual([]);
  });

  it('registers all three listeners BEFORE it calls show', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = async () => {
      admob.emit(RewardAdPluginEvents.Dismissed);
    };
    await service.showRewarded();
    const show = admob.calls.indexOf('showRewardVideoAd');
    for (const event of [RewardAdPluginEvents.Rewarded, RewardAdPluginEvents.Dismissed, RewardAdPluginEvents.FailedToShow]) {
      const at = admob.calls.indexOf(`addListener:${event}`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(show);
    }
  });

  it('rewards when Rewarded fires before Dismissed, even if show() never settles (Android)', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = () => {
      queueMicrotask(() => {
        admob.emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
        admob.emit(RewardAdPluginEvents.Dismissed);
      });
      return new Promise(() => {}); // Android: never settles
    };
    await expect(service.showRewarded()).resolves.toBe(true);
    expect(admob.listenerCount()).toBe(0);
    expect(admob.removed).toBe(3);
    expect(service.isRewardedReady()).toBe(false); // the ad is consumed
  });

  it('is false when the user closes the ad early (Dismissed without Rewarded)', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = () => {
      queueMicrotask(() => admob.emit(RewardAdPluginEvents.Dismissed));
      return new Promise(() => {}); // Android: never settles on early close
    };
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.listenerCount()).toBe(0);
  });

  it('is false on FailedToShow', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = () => {
      queueMicrotask(() => admob.emit(RewardAdPluginEvents.FailedToShow, { code: 3, message: 'x' }));
      return new Promise(() => {});
    };
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.listenerCount()).toBe(0);
  });

  it('is false when show() rejects, and cleans up', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = () => Promise.reject(new Error('An ad is already showing'));
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.listenerCount()).toBe(0);
    expect(admob.removed).toBe(3);
  });

  it('ignores the show() promise resolving (iOS resolves on reward, before dismissal)', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    let outcome: boolean | undefined;
    admob.onShow = async () => {
      admob.emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
      return { type: 'coins', amount: 1 };
    };
    const shown = service.showRewarded().then((r) => (outcome = r));
    await vi.waitFor(() => expect(admob.calls).toContain('showRewardVideoAd'));
    await new Promise((r) => setTimeout(r, 10));
    expect(outcome).toBeUndefined(); // reward earned, but the ad is still on screen
    admob.emit(RewardAdPluginEvents.Dismissed);
    await shown;
    expect(outcome).toBe(true);
  });

  it('gives up after the safety timeout and removes its listeners', async () => {
    vi.useFakeTimers();
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    let outcome: boolean | undefined;
    const shown = service.showRewarded().then((r) => (outcome = r));
    await vi.advanceTimersByTimeAsync(REWARDED_SAFETY_TIMEOUT_MS - 1);
    expect(outcome).toBeUndefined();
    expect(admob.listenerCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    await shown;
    expect(outcome).toBe(false);
    expect(admob.listenerCount()).toBe(0);
    expect(REWARDED_SAFETY_TIMEOUT_MS).toBe(120_000);
  });

  it('on timeout, still honours a reward that was earned', async () => {
    vi.useFakeTimers();
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    const shown = service.showRewarded();
    await vi.advanceTimersByTimeAsync(10);
    admob.emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
    await vi.advanceTimersByTimeAsync(REWARDED_SAFETY_TIMEOUT_MS);
    await expect(shown).resolves.toBe(true);
    expect(admob.listenerCount()).toBe(0);
  });

  it('if a listener cannot be registered: false, show() never called, earlier listeners removed', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.failAddListenerOn = RewardAdPluginEvents.FailedToShow;
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.calls).not.toContain('showRewardVideoAd');
    expect(admob.listenerCount()).toBe(0);
    expect(admob.removed).toBe(2);
  });

  it('can show again after reloading', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShow = () => {
      queueMicrotask(() => {
        admob.emit(RewardAdPluginEvents.Rewarded);
        admob.emit(RewardAdPluginEvents.Dismissed);
      });
      return new Promise(() => {});
    };
    await expect(service.showRewarded()).resolves.toBe(true);
    await expect(service.showRewarded()).resolves.toBe(false); // nothing loaded now
    await service.preloadRewarded();
    expect(service.isRewardedReady()).toBe(true);
    await expect(service.showRewarded()).resolves.toBe(true);
  });
});
