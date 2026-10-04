/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" switches from Google's test ad units to the real IDs below. Anything else = test ads. */
  readonly VITE_ADS_TESTING?: string;
  /** Real rewarded ad unit IDs; only read when VITE_ADS_TESTING is "false". */
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
  readonly VITE_ADMOB_REWARDED_IOS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** DEV-only, read-only debug snapshot for tests. Absent in production builds. */
interface Window {
  readonly __game?: {
    readonly phase: 'title' | 'playing' | 'paused' | 'over' | 'ad';
    readonly score: number;
    readonly alive: boolean;
    /** Whatever sim/game.ts debugSnapshot() returns; your game's view for tests. */
    readonly debug: Readonly<Record<string, unknown>>;
  };
}
