export type AnalyticsParams = Record<string, string | number | boolean>;

/** Fire-and-forget event tracking. Must never throw. */
export interface AnalyticsService {
  track(event: string, params?: AnalyticsParams): void;
}

/** Logs events to the console. Swap in a real provider behind the same interface. */
export class ConsoleAnalytics implements AnalyticsService {
  track(event: string, params?: AnalyticsParams): void {
    try {
      console.info('[analytics]', event, params ?? {});
    } catch {
      // Logging must never break the game.
    }
  }
}
