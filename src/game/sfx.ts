import type { AudioService, HapticsService } from '../engine/services';

/** The game's sounds and vibrations, in one place. All are synthesised; none can throw. */
export function createSfx(audio: AudioService, haptics: HapticsService) {
  // Gunfire is rate-limited: a big fight would otherwise be a wall of noise.
  let shotBudget = 0;
  let lastRefill = 0;
  const allowShot = (): boolean => {
    const now = performance.now();
    if (now - lastRefill > 100) {
      shotBudget = 5;
      lastRefill = now;
    }
    if (shotBudget <= 0) return false;
    shotBudget -= 1;
    return true;
  };

  const chord = (freqs: readonly number[], gap: number, volume: number, type: OscillatorType = 'triangle'): void => {
    freqs.forEach((freq, i) => audio.tone({ freq, duration: 0.16, type, volume, delay: i * gap }));
  };

  return {
    click(): void {
      audio.tone({ freq: 700, endFreq: 540, duration: 0.05, type: 'square', volume: 0.05 });
    },

    select(): void {
      audio.tone({ freq: 520, endFreq: 640, duration: 0.05, type: 'sine', volume: 0.07 });
    },

    order(): void {
      audio.tone({ freq: 380, endFreq: 520, duration: 0.07, type: 'triangle', volume: 0.09 });
      haptics.impact('light');
    },

    attackOrder(): void {
      audio.tone({ freq: 300, endFreq: 190, duration: 0.1, type: 'square', volume: 0.07 });
      haptics.impact('medium');
    },

    error(): void {
      audio.tone({ freq: 170, endFreq: 120, duration: 0.14, type: 'sawtooth', volume: 0.09 });
    },

    train(): void {
      audio.tone({ freq: 440, endFreq: 660, duration: 0.09, type: 'triangle', volume: 0.09 });
    },

    ready(): void {
      chord([660, 880], 0.07, 0.08);
    },

    placed(): void {
      audio.noise({ duration: 0.12, volume: 0.12, filterFreq: 500, endFilterFreq: 200 });
      audio.tone({ freq: 140, endFreq: 90, duration: 0.14, type: 'triangle', volume: 0.1 });
    },

    built(): void {
      chord([523, 659, 784], 0.07, 0.1);
      haptics.impact('medium');
    },

    /** A shot; `volume` is 0..1 by how close it is to the camera. */
    shot(weapon: string, volume: number): void {
      if (volume <= 0.05 || !allowShot()) return;
      if (weapon === 'tank') {
        audio.noise({ duration: 0.2, volume: 0.15 * volume, filterFreq: 700, endFilterFreq: 160 });
        audio.tone({ freq: 120, endFreq: 55, duration: 0.18, type: 'sawtooth', volume: 0.12 * volume });
      } else if (weapon === 'skiff' || weapon === 'turret') {
        audio.tone({ freq: 1200, endFreq: 600, duration: 0.09, type: 'square', volume: 0.05 * volume });
      } else {
        audio.noise({ duration: 0.05, volume: 0.07 * volume, filterFreq: 2600, endFilterFreq: 1400 });
      }
    },

    explosion(big: boolean, volume: number): void {
      if (volume <= 0.05) return;
      audio.noise({ duration: big ? 0.6 : 0.28, volume: (big ? 0.28 : 0.16) * volume, filterFreq: big ? 900 : 1800, endFilterFreq: 120 });
      audio.tone({ freq: big ? 90 : 150, endFreq: 40, duration: big ? 0.5 : 0.25, type: 'sawtooth', volume: (big ? 0.16 : 0.09) * volume });
      if (big) haptics.impact('heavy');
    },

    deposit(): void {
      audio.tone({ freq: 880, duration: 0.04, type: 'sine', volume: 0.025 });
    },

    alarm(): void {
      audio.tone({ freq: 520, duration: 0.18, type: 'square', volume: 0.08 });
      audio.tone({ freq: 400, duration: 0.18, type: 'square', volume: 0.08, delay: 0.2 });
      haptics.notify('warning');
    },

    drop(): void {
      chord([392, 523, 659, 784], 0.08, 0.1);
      haptics.notify('success');
    },

    win(): void {
      chord([523, 659, 784, 1047, 1319], 0.09, 0.13);
      haptics.notify('success');
    },

    lose(): void {
      audio.tone({ freq: 280, endFreq: 70, duration: 0.7, type: 'sawtooth', volume: 0.13 });
      haptics.notify('error');
    },
  };
}

export type Sfx = ReturnType<typeof createSfx>;
