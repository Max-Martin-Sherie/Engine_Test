import { InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTERSTITIAL_SAFETY_TIMEOUT_MS,
  REWARDED_SAFETY_TIMEOUT_MS,
  resolveAdUnits,
  resolveInterstitialConfig,
  TEST_INTERSTITIAL_ANDROID,
  TEST_INTERSTITIAL_IOS,
  TEST_REWARDED_ANDROID,
} from '../src/engine/services/admobAds';
import { analytics, consent, FakeAdMob, makeService, readyService } from './helpers/fakeAdMob';

describe('interstitial ad units', () => {
  it('use the correct Google test units per platform (iOS differs from Android)', () => {
    expect(resolveInterstitialConfig('android', {})).toEqual({ adId: TEST_INTERSTITIAL_ANDROID, isTesting: true });
    expect(resolveInterstitialConfig('ios', {})).toEqual({ adId: TEST_INTERSTITIAL_IOS, isTesting: true });
    expect(TEST_INTERSTITIAL_ANDROID).toBe('ca-app-pub-3940256099942544/1033173712');
    expect(TEST_INTERSTITIAL_IOS).toBe('ca-app-pub-3940256099942544/4411468910');
    expect(TEST_INTERSTITIAL_IOS).not.toBe(TEST_INTERSTITIAL_ANDROID);
  });

  it('use real IDs from env when testing is off, and are disabled (not faked) when missing', () => {
    const env = {
      VITE_ADS_TESTING: 'false',
      VITE_ADMOB_INTERSTITIAL_ANDROID: 'ca-app-pub-1/int-android',
      VITE_ADMOB_INTERSTITIAL_IOS: 'ca-app-pub-1/int-ios',
    };
    expect(resolveInterstitialConfig('android', env)).toEqual({ adId: 'ca-app-pub-1/int-android', isTesting: false });
    expect(resolveInterstitialConfig('ios', env)).toEqual({ adId: 'ca-app-pub-1/int-ios', isTesting: false });
    expect(resolveInterstitialConfig('android', { VITE_ADS_TESTING: 'false' })).toBeNull();
    expect(resolveInterstitialConfig('web', {})).toBeNull();
  });

  it('are resolved independently of the rewarded units', () => {
    const units = resolveAdUnits('android', {
      VITE_ADS_TESTING: 'false',
      VITE_ADMOB_REWARDED_ANDROID: 'ca-app-pub-1/rewarded',
    });
    expect(units.rewarded).toEqual({ adId: 'ca-app-pub-1/rewarded', isTesting: false });
    expect(units.interstitial).toBeNull();
  });
});

describe('AdMobAdService interstitials', () => {
  afterEach(() => vi.useRealTimers());

  it('loads both kinds during init, after consent', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    expect(service.isRewardedReady()).toBe(true);
    expect(service.isInterstitialReady()).toBe(true);
    expect(admob.calls.indexOf('requestConsentInfo')).toBeLessThan(admob.calls.indexOf('prepareInterstitial'));
  });

  it('loads nothing when consent forbids requesting ads', async () => {
    const admob = new FakeAdMob();
    admob.consentInfo = consent({ canRequestAds: false });
    const service = makeService(admob);
    await service.init();
    expect(admob.calls).not.toContain('prepareInterstitial');
    expect(service.isInterstitialReady()).toBe(false);
  });

  it('a disabled unit is never loaded, and showing it is false', async () => {
    const admob = new FakeAdMob();
    const service = makeService(admob, undefined, {
      rewarded: { adId: TEST_REWARDED_ANDROID, isTesting: true },
      interstitial: null,
    });
    await service.init();
    expect(admob.calls).not.toContain('prepareInterstitial');
    await expect(service.showInterstitial()).resolves.toBe(false);
  });

  it('a failed interstitial load does not disturb the rewarded ad', async () => {
    const admob = new FakeAdMob();
    admob.failInterstitialLoad = true;
    const service = await readyService(admob);
    expect(service.isRewardedReady()).toBe(true);
    expect(service.isInterstitialReady()).toBe(false);
    expect(analytics.events).toContain('interstitial_load_failed');
  });

  it('is false, without touching the SDK, when none is ready', async () => {
    const admob = new FakeAdMob();
    const service = makeService(admob);
    await expect(service.showInterstitial()).resolves.toBe(false);
    expect(admob.calls).toEqual([]);
  });

  it('registers its listeners BEFORE it calls show, and finishes on Dismissed', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    admob.onShowInterstitial = async () => {
      // Both platforms resolve the show call as soon as the ad is presented; the ad is still up.
      queueMicrotask(() => admob.emit(InterstitialAdPluginEvents.Dismissed));
    };
    await expect(service.showInterstitial()).resolves.toBe(true);
    const show = admob.calls.indexOf('showInterstitial');
    for (const event of [InterstitialAdPluginEvents.Dismissed, InterstitialAdPluginEvents.FailedToShow]) {
      const at = admob.calls.indexOf(`addListener:${event}`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(show);
    }
    expect(admob.listenerCount()).toBe(0);
    expect(service.isInterstitialReady()).toBe(false); // consumed
  });

  it('does not treat the show() promise resolving as the ad having ended', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    let outcome: boolean | undefined;
    const shown = service.showInterstitial().then((r) => (outcome = r));
    await vi.waitFor(() => expect(admob.calls).toContain('showInterstitial'));
    await new Promise((r) => setTimeout(r, 10));
    expect(outcome).toBeUndefined();
    admob.emit(InterstitialAdPluginEvents.Dismissed);
    await shown;
    expect(outcome).toBe(true);
  });

  it('is false on FailedToShow or when show() rejects, and cleans up', async () => {
    const failed = new FakeAdMob();
    const a = await readyService(failed);
    failed.onShowInterstitial = async () => {
      queueMicrotask(() => failed.emit(InterstitialAdPluginEvents.FailedToShow, { code: 3, message: 'x' }));
    };
    await expect(a.showInterstitial()).resolves.toBe(false);
    expect(failed.listenerCount()).toBe(0);

    const rejected = new FakeAdMob();
    const b = await readyService(rejected);
    rejected.onShowInterstitial = () => Promise.reject(new Error('An ad is already showing'));
    await expect(b.showInterstitial()).resolves.toBe(false);
    expect(rejected.listenerCount()).toBe(0);
    expect(rejected.removed).toBe(2);
  });

  it('gives up after its safety timeout and removes its listeners', async () => {
    vi.useFakeTimers();
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    let outcome: boolean | undefined;
    const shown = service.showInterstitial().then((r) => (outcome = r));
    await vi.advanceTimersByTimeAsync(INTERSTITIAL_SAFETY_TIMEOUT_MS - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await shown;
    expect(outcome).toBe(false);
    expect(admob.listenerCount()).toBe(0);
    expect(INTERSTITIAL_SAFETY_TIMEOUT_MS).toBeLessThan(REWARDED_SAFETY_TIMEOUT_MS);
  });

  it('never shows two full-screen ads at once', async () => {
    const admob = new FakeAdMob();
    const service = await readyService(admob);
    const first = service.showInterstitial();
    await vi.waitFor(() => expect(admob.calls).toContain('showInterstitial'));
    // A rewarded ad is ready too, but an ad is already on screen.
    await expect(service.showRewarded()).resolves.toBe(false);
    expect(admob.calls).not.toContain('showRewardVideoAd');
    admob.emit(InterstitialAdPluginEvents.Dismissed);
    await expect(first).resolves.toBe(true);

    // Once it is over, the rewarded ad is still there and can be shown.
    admob.onShow = () => {
      queueMicrotask(() => {
        admob.emit(RewardAdPluginEvents.Rewarded);
        admob.emit(RewardAdPluginEvents.Dismissed);
      });
      return new Promise(() => {});
    };
    await expect(service.showRewarded()).resolves.toBe(true);
  });
});
