/** DEV-only, read-only debug snapshot of the game for tests. Absent in production builds. */
interface Window {
  readonly __game?: {
    readonly phase: 'title' | 'playing' | 'paused' | 'over' | 'ad';
    readonly score: number;
    readonly alive: boolean;
    /** Whatever sim/game.ts debugSnapshot() returns. */
    readonly debug: Readonly<Record<string, unknown>>;
  };
}
