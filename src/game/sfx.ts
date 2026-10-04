import type { AudioService, HapticsService } from '../engine/services';

export type CutRating = 'perfect' | 'great' | 'good';

/** The game's sounds and vibrations, in one place. All are synthesised; none can throw. */
export function createSfx(audio: AudioService, haptics: HapticsService) {
  const notes = (freqs: readonly number[], gap: number, volume: number): void => {
    freqs.forEach((freq, i) => audio.tone({ freq, duration: 0.14, type: 'triangle', volume, delay: i * gap }));
  };

  return {
    click(): void {
      audio.tone({ freq: 720, endFreq: 560, duration: 0.05, type: 'square', volume: 0.05 });
    },

    /** The knife swish, then a ding that climbs with how good the cut was. */
    slice(rating: CutRating): void {
      audio.noise({ duration: 0.13, volume: 0.22, filterFreq: 1600, endFilterFreq: 5200 });
      audio.tone({ freq: 880, endFreq: 260, duration: 0.11, type: 'triangle', volume: 0.1 });
      if (rating === 'perfect') notes([660, 880, 1320], 0.075, 0.13);
      else if (rating === 'great') notes([660, 880], 0.08, 0.11);
      else notes([660], 0.08, 0.09);
      if (rating === 'perfect') haptics.notify('success');
      else haptics.impact(rating === 'great' ? 'medium' : 'light');
    },

    /** Cut, but not even enough. */
    uneven(): void {
      audio.noise({ duration: 0.12, volume: 0.18, filterFreq: 1400, endFilterFreq: 4000 });
      audio.tone({ freq: 190, endFreq: 70, duration: 0.4, type: 'sawtooth', volume: 0.14, delay: 0.05 });
      haptics.notify('error');
    },

    cancel(): void {
      audio.tone({ freq: 320, endFreq: 200, duration: 0.09, type: 'sine', volume: 0.06 });
      haptics.impact('light');
    },

    bomb(): void {
      audio.noise({ duration: 0.45, volume: 0.3, filterFreq: 500, endFilterFreq: 120 });
      audio.tone({ freq: 110, endFreq: 40, duration: 0.45, type: 'sawtooth', volume: 0.22 });
      haptics.impact('heavy');
    },

    coins(): void {
      audio.tone({ freq: 1250, duration: 0.07, type: 'square', volume: 0.06 });
      audio.tone({ freq: 1680, duration: 0.12, type: 'square', volume: 0.06, delay: 0.07 });
      haptics.impact('light');
    },

    restart(): void {
      notes([440, 660], 0.09, 0.1);
      haptics.impact('medium');
    },
  };
}

export type Sfx = ReturnType<typeof createSfx>;
