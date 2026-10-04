/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" switches from Google's test ad units to the real IDs below. Anything else = test ads. */
  readonly VITE_ADS_TESTING?: string;
  /** Real rewarded ad unit IDs; only read when VITE_ADS_TESTING is "false". */
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
  readonly VITE_ADMOB_REWARDED_IOS?: string;
  /** Real interstitial ad unit IDs; same rule. */
  readonly VITE_ADMOB_INTERSTITIAL_ANDROID?: string;
  readonly VITE_ADMOB_INTERSTITIAL_IOS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** DEV-only, read-only debug snapshot of the engine for tests. Absent in production builds. */
interface Window {
  readonly __engine?: {
    readonly viewReady: boolean;
    /** "webgpu" or "webgl" */
    readonly renderer: string | null;
    readonly fit: { readonly scale: number; readonly offsetX: number; readonly offsetY: number };
    readonly adsReady: boolean;
  };
}
