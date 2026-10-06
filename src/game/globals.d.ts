/** DEV-only, read-only debug snapshot of the game for tests. Absent in production builds. */
interface Window {
  readonly __game?: {
    readonly phase: string;
    readonly score: number;
    readonly alive: boolean;
    /** Everything tests need: the live match and session, helpers to look at and set up a scene. */
    readonly debug: Readonly<Record<string, unknown>>;
  };
}
