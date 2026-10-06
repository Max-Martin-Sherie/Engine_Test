import type { AudioService, HapticsService } from '../engine/services';
import type { WeaponId } from './sim/config';

/** The game's sounds and vibrations, in one place. All are synthesised; none can throw. */
export function createSfx(audio: AudioService, haptics: HapticsService) {
  // A big fight would otherwise be a wall of noise: only so many shots sound in a tenth of a second.
  let budget = 0;
  let refilled = 0;
  const allowed = (): boolean => {
    const now = performance.now();
    if (now - refilled > 100) {
      budget = 5;
      refilled = now;
    }
    if (budget <= 0) return false;
    budget -= 1;
    return true;
  };

  const chord = (freqs: readonly number[], gap: number, volume: number, type: OscillatorType = 'triangle'): void => {
    freqs.forEach((freq, i) => audio.tone({ freq, duration: 0.16, type, volume, delay: i * gap }));
  };

  return {
    click(): void {
      audio.tone({ freq: 700, endFreq: 540, duration: 0.05, type: 'square', volume: 0.05 });
    },

    /** A gun going off; `volume` is 0..1 by how near it is (1 for your own). */
    shot(weapon: WeaponId, volume: number, own = false): void {
      if (volume <= 0.04 || (!own && !allowed())) return;
      switch (weapon) {
        case 'pistol':
          audio.tone({ freq: 1500, endFreq: 380, duration: 0.09, type: 'square', volume: 0.07 * volume });
          audio.noise({ duration: 0.05, volume: 0.06 * volume, filterFreq: 3000, endFilterFreq: 1500 });
          break;
        case 'rifle':
          audio.noise({ duration: 0.07, volume: 0.1 * volume, filterFreq: 2200, endFilterFreq: 900 });
          audio.tone({ freq: 220, endFreq: 90, duration: 0.07, type: 'sawtooth', volume: 0.06 * volume });
          break;
        case 'shotgun':
          audio.noise({ duration: 0.22, volume: 0.22 * volume, filterFreq: 1200, endFilterFreq: 200 });
          audio.tone({ freq: 140, endFreq: 50, duration: 0.2, type: 'sawtooth', volume: 0.14 * volume });
          break;
        case 'rail':
          audio.tone({ freq: 2400, endFreq: 140, duration: 0.35, type: 'sawtooth', volume: 0.1 * volume });
          audio.noise({ duration: 0.14, volume: 0.1 * volume, filterFreq: 4000, endFilterFreq: 600 });
          break;
        case 'rocket':
          audio.noise({ duration: 0.3, volume: 0.14 * volume, filterFreq: 600, endFilterFreq: 160 });
          audio.tone({ freq: 90, endFreq: 40, duration: 0.3, type: 'sawtooth', volume: 0.1 * volume });
          break;
      }
      if (own) haptics.impact(weapon === 'shotgun' || weapon === 'rail' || weapon === 'rocket' ? 'medium' : 'light');
    },

    explosion(volume: number): void {
      if (volume <= 0.04) return;
      audio.noise({ duration: 0.7, volume: 0.3 * volume, filterFreq: 900, endFilterFreq: 90 });
      audio.tone({ freq: 90, endFreq: 36, duration: 0.55, type: 'sawtooth', volume: 0.18 * volume });
      if (volume > 0.5) haptics.impact('heavy');
    },

    /** You hit someone: a tick, higher for the head, and a chime when they fall. */
    hit(head: boolean, killed: boolean): void {
      if (killed) {
        chord([784, 1175], 0.06, 0.1, 'sine');
        haptics.impact('medium');
        return;
      }
      audio.tone({ freq: head ? 1900 : 1250, endFreq: head ? 1500 : 900, duration: 0.05, type: 'sine', volume: head ? 0.11 : 0.08 });
      haptics.impact('light');
    },

    /** You are hit. */
    hurt(heavy: boolean): void {
      audio.tone({ freq: 160, endFreq: 70, duration: 0.14, type: 'sawtooth', volume: 0.12 });
      audio.noise({ duration: 0.08, volume: 0.07, filterFreq: 900, endFilterFreq: 400 });
      haptics.impact(heavy ? 'heavy' : 'medium');
    },

    die(): void {
      audio.tone({ freq: 300, endFreq: 50, duration: 0.8, type: 'sawtooth', volume: 0.14 });
      audio.noise({ duration: 0.4, volume: 0.1, filterFreq: 700, endFilterFreq: 120 });
      haptics.notify('error');
    },

    /** Someone else falls, somewhere near. */
    fall(volume: number): void {
      if (volume <= 0.05) return;
      audio.tone({ freq: 200, endFreq: 70, duration: 0.3, type: 'triangle', volume: 0.07 * volume });
    },

    pickup(kind: string): void {
      if (kind === 'health') chord([523, 784], 0.07, 0.09, 'sine');
      else if (kind === 'armor') chord([392, 523], 0.07, 0.09, 'triangle');
      else if (kind === 'ammo') audio.tone({ freq: 660, endFreq: 880, duration: 0.07, type: 'square', volume: 0.06 });
      else chord([440, 554, 659], 0.06, 0.1, 'square');
      haptics.impact('light');
    },

    reload(): void {
      audio.tone({ freq: 420, endFreq: 300, duration: 0.05, type: 'square', volume: 0.05 });
      audio.tone({ freq: 300, endFreq: 520, duration: 0.07, type: 'square', volume: 0.06, delay: 0.5 });
    },

    switchWeapon(): void {
      audio.tone({ freq: 360, endFreq: 520, duration: 0.05, type: 'square', volume: 0.05 });
    },

    empty(): void {
      audio.tone({ freq: 260, duration: 0.03, type: 'square', volume: 0.06 });
    },

    jump(): void {
      audio.noise({ duration: 0.08, volume: 0.04, filterFreq: 500, endFilterFreq: 900 });
    },

    land(speed: number): void {
      if (speed < 5) return;
      audio.noise({ duration: 0.09, volume: Math.min(0.12, speed * 0.01), filterFreq: 300, endFilterFreq: 120 });
      if (speed > 11) haptics.impact('light');
    },

    respawn(): void {
      chord([330, 440, 660], 0.06, 0.08, 'sine');
    },

    count(go: boolean): void {
      audio.tone({ freq: go ? 880 : 520, duration: go ? 0.28 : 0.1, type: 'square', volume: 0.07 });
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
