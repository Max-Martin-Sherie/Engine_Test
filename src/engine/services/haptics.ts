export type ImpactKind = 'light' | 'medium' | 'heavy';
export type NotifyKind = 'success' | 'warning' | 'error';

/** Vibration feedback. Fire-and-forget; must never throw. Off when disabled. */
export interface HapticsService {
  setEnabled(enabled: boolean): void;
  /** A short tap: light for small things, heavy for big ones. */
  impact(kind?: ImpactKind): void;
  /** A distinct pattern for success / warning / error. */
  notify(kind: NotifyKind): void;
}

type HapticsModule = typeof import('@capacitor/haptics');

/**
 * Haptics through @capacitor/haptics, imported lazily the first time it is used. On devices it
 * uses the platform's haptic engine; in browsers the plugin falls back to navigator.vibrate,
 * which simply does nothing where it is unsupported.
 */
export class CapacitorHaptics implements HapticsService {
  private enabled = true;
  private module: Promise<HapticsModule | null> | null = null;

  constructor(private readonly load: () => Promise<HapticsModule> = () => import('@capacitor/haptics')) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  impact(kind: ImpactKind = 'light'): void {
    if (!this.enabled) return;
    void this.run(async ({ Haptics, ImpactStyle }) => {
      const style = kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
      await Haptics.impact({ style });
    });
  }

  notify(kind: NotifyKind): void {
    if (!this.enabled) return;
    void this.run(async ({ Haptics, NotificationType }) => {
      const type =
        kind === 'error' ? NotificationType.Error : kind === 'warning' ? NotificationType.Warning : NotificationType.Success;
      await Haptics.notification({ type });
    });
  }

  private async run(action: (module: HapticsModule) => Promise<void>): Promise<void> {
    try {
      this.module ??= this.load().catch(() => null);
      const module = await this.module;
      if (module !== null) await action(module);
    } catch {
      // No vibration available; feedback is optional.
    }
  }
}
