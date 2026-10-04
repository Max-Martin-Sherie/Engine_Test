import type { AdService } from './ads';

/**
 * ok:      ads load; a rewarded ad plays for 2 s and grants the reward
 * no-fill: ads never load (nothing is ever ready)
 * skip:    ads load and play, but a rewarded ad is closed early (no reward)
 */
export type FakeAdMode = 'ok' | 'no-fill' | 'skip';

export const FAKE_AD_DURATION_MS = 2000;
/** Interstitials are the short kind: shown between screens, no reward. */
export const FAKE_INTERSTITIAL_DURATION_MS = 1000;
const FAKE_LOAD_MS = 250;

export function parseFakeAdMode(value: string | null): FakeAdMode {
  return value === 'no-fill' || value === 'skip' ? value : 'ok';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Browser stand-in for AdMob: a grey "Test ad" overlay (2 s rewarded, 1 s interstitial). */
export class FakeAdService implements AdService {
  private rewardedReady = false;
  private rewardedLoading = false;
  private interstitialReady = false;
  private interstitialLoading = false;

  constructor(private readonly mode: FakeAdMode) {}

  async init(): Promise<void> {
    await Promise.all([this.preloadRewarded(), this.preloadInterstitial()]);
  }

  isRewardedReady(): boolean {
    return this.rewardedReady;
  }

  async preloadRewarded(): Promise<void> {
    if (this.rewardedReady || this.rewardedLoading) return;
    this.rewardedLoading = true;
    await sleep(FAKE_LOAD_MS);
    this.rewardedReady = this.mode !== 'no-fill';
    this.rewardedLoading = false;
  }

  async showRewarded(): Promise<boolean> {
    if (!this.rewardedReady) return false;
    this.rewardedReady = false; // a loaded ad can be shown once
    await this.playOverlay('Test ad', this.mode === 'skip' ? 'Simulating: user skips' : 'Simulating a rewarded video', FAKE_AD_DURATION_MS);
    return this.mode !== 'skip';
  }

  isInterstitialReady(): boolean {
    return this.interstitialReady;
  }

  async preloadInterstitial(): Promise<void> {
    if (this.interstitialReady || this.interstitialLoading) return;
    this.interstitialLoading = true;
    await sleep(FAKE_LOAD_MS);
    this.interstitialReady = this.mode !== 'no-fill';
    this.interstitialLoading = false;
  }

  async showInterstitial(): Promise<boolean> {
    if (!this.interstitialReady) return false;
    this.interstitialReady = false;
    await this.playOverlay('Test ad', 'Short test ad', FAKE_INTERSTITIAL_DURATION_MS);
    return true;
  }

  private async playOverlay(title: string, hint: string, ms: number): Promise<void> {
    const overlay = this.createOverlay(title, hint);
    document.body.append(overlay);
    try {
      await sleep(ms);
    } finally {
      overlay.remove();
    }
  }

  private createOverlay(titleText: string, hintText: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', titleText);
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:1000',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:8px',
      'background:#7b8083',
      'color:#fff',
      'font:900 32px/1.1 ui-rounded,system-ui,sans-serif',
      'letter-spacing:0.04em',
      'touch-action:none',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = titleText;
    const hint = document.createElement('div');
    hint.textContent = hintText;
    hint.style.cssText = 'font:600 14px system-ui,sans-serif;opacity:0.8;letter-spacing:0';
    overlay.append(title, hint);
    return overlay;
  }
}
