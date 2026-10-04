/** DEV-only, read-only debug snapshot of the game for tests. Absent in production builds. */
interface Window {
  readonly __game?: {
    readonly phase: string;
    readonly score: number;
    readonly alive: boolean;
    /** Everything tests need: the run (fruit polygons, tolerance, timers), the profile, the catalog. */
    readonly debug: Readonly<Record<string, unknown>>;
  };
}

interface ImportMetaEnv {
  /** Optional URL of an online skin catalog (JSON). Leave unset to use only the bundled skins. */
  readonly VITE_SKINS_CATALOG_URL?: string;
}
