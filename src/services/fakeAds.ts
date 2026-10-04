import type { AdService } from './ads';

/**
 * ok:      ad loads, plays for 2 s, reward granted
 * no-fill: ads never load (isRewardedReady stays false)
 * skip:    ad loads and plays, but the user closes it early (no reward)
 */
export type FakeAdMode = 'ok' | 'no-fill' | 'skip';

export const FAKE_AD_DURATION_MS = 2000;
const FAKE_LOAD_MS = 250;

export function parseFakeAdMode(value: string | null): FakeAdMode {
  return value === 'no-fill' || value === 'skip' ? value : 'ok';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Browser stand-in for AdMob: a grey "Test ad" overlay for 2 seconds. */
export class FakeAdService implements AdService {
  private ready = false;
  private loading = false;

  constructor(private readonly mode: FakeAdMode) {}

  async init(): Promise<void> {
    await this.preloadRewarded();
  }

  isRewardedReady(): boolean {
    return this.ready;
  }

  async preloadRewarded(): Promise<void> {
    if (this.ready || this.loading) return;
    this.loading = true;
    await sleep(FAKE_LOAD_MS);
    this.ready = this.mode !== 'no-fill';
    this.loading = false;
  }

  async showRewarded(): Promise<boolean> {
    if (!this.ready) return false;
    this.ready = false; // a loaded ad can be shown once
    const overlay = this.createOverlay();
    document.body.append(overlay);
    try {
      await sleep(FAKE_AD_DURATION_MS);
    } finally {
      overlay.remove();
    }
    return this.mode !== 'skip';
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Test ad');
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
    title.textContent = 'Test ad';
    const hint = document.createElement('div');
    hint.textContent = this.mode === 'skip' ? 'Simulating: user skips' : 'Simulating a rewarded video';
    hint.style.cssText = 'font:600 14px system-ui,sans-serif;opacity:0.8;letter-spacing:0';
    overlay.append(title, hint);
    return overlay;
  }
}
