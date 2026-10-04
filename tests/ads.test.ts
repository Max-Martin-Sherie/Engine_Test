import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardAdService, type AdService } from '../src/engine/services/ads';
import type { AnalyticsService } from '../src/engine/services/analytics';
import { FakeAdService, FAKE_AD_DURATION_MS, parseFakeAdMode } from '../src/engine/services/fakeAds';

const analytics: AnalyticsService & { events: string[] } = {
  events: [],
  track(event) {
    this.events.push(event);
  },
};

describe('guardAdService', () => {
  const boom = (): never => {
    throw new Error('boom');
  };

  it('turns every kind of failure into a safe default', async () => {
    const throwing: AdService = {
      init: () => Promise.reject(new Error('x')),
      isRewardedReady: boom,
      preloadRewarded: boom,
      showRewarded: boom,
    };
    const guarded = guardAdService(throwing, analytics);
    await expect(guarded.init()).resolves.toBeUndefined();
    expect(guarded.isRewardedReady()).toBe(false);
    await expect(guarded.preloadRewarded()).resolves.toBeUndefined();
    await expect(guarded.showRewarded()).resolves.toBe(false);
    expect(analytics.events).toContain('ad_service_error');
  });

  it('passes results through untouched', async () => {
    const ok: AdService = {
      init: async () => {},
      isRewardedReady: () => true,
      preloadRewarded: async () => {},
      showRewarded: async () => true,
    };
    const guarded = guardAdService(ok, analytics);
    expect(guarded.isRewardedReady()).toBe(true);
    await expect(guarded.showRewarded()).resolves.toBe(true);
  });
});

describe('FakeAdService', () => {
  /** Elements appended to document.body, i.e. the overlays on screen (or removed again). */
  const overlays: { removed: boolean }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    overlays.length = 0;
    // The service only needs enough DOM to create elements and append / remove the overlay.
    vi.stubGlobal('document', {
      createElement: () => {
        const node = {
          removed: false,
          style: {} as Record<string, string>,
          textContent: '',
          setAttribute() {},
          append() {},
          remove() {
            node.removed = true;
          },
        };
        return node;
      },
      body: {
        append(node: { removed: boolean }) {
          overlays.push(node);
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('parses ?ads= values', () => {
    expect(parseFakeAdMode(null)).toBe('ok');
    expect(parseFakeAdMode('nonsense')).toBe('ok');
    expect(parseFakeAdMode('no-fill')).toBe('no-fill');
    expect(parseFakeAdMode('skip')).toBe('skip');
  });

  it('ok: loads, shows for 2 s, rewards, and needs a reload for the next one', async () => {
    const ads = new FakeAdService('ok');
    expect(ads.isRewardedReady()).toBe(false);
    const init = ads.init();
    await vi.runAllTimersAsync();
    await init;
    expect(ads.isRewardedReady()).toBe(true);

    let result: boolean | undefined;
    const shown = ads.showRewarded().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(FAKE_AD_DURATION_MS - 1);
    expect(result).toBeUndefined(); // still showing
    expect(overlays.some((o) => !o.removed)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await shown;
    expect(result).toBe(true);
    expect(overlays.every((o) => o.removed)).toBe(true);

    expect(ads.isRewardedReady()).toBe(false); // consumed
    await expect(ads.showRewarded()).resolves.toBe(false);
    const reload = ads.preloadRewarded();
    await vi.runAllTimersAsync();
    await reload;
    expect(ads.isRewardedReady()).toBe(true);
  });

  it('no-fill: an ad never becomes ready', async () => {
    const ads = new FakeAdService('no-fill');
    const init = ads.init();
    await vi.runAllTimersAsync();
    await init;
    expect(ads.isRewardedReady()).toBe(false);
    await expect(ads.showRewarded()).resolves.toBe(false);
  });

  it('skip: the ad plays but there is no reward', async () => {
    const ads = new FakeAdService('skip');
    const init = ads.init();
    await vi.runAllTimersAsync();
    await init;
    expect(ads.isRewardedReady()).toBe(true);
    const shown = ads.showRewarded();
    await vi.advanceTimersByTimeAsync(FAKE_AD_DURATION_MS);
    await expect(shown).resolves.toBe(false);
  });
});
