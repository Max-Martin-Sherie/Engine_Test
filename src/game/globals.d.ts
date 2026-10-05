/** DEV-only, read-only debug snapshot of the game for tests. Absent in production builds. */
interface Window {
  readonly __game?: {
    readonly phase: string;
    readonly score: number;
    readonly alive: boolean;
    /** Everything tests need: the run, the arena, the bot's solution, the profile. */
    readonly debug: Readonly<Record<string, unknown>>;
  };
}
