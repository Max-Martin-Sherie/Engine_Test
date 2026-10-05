import type { AudioService, HapticsService } from '../engine/services';

/** The game's sounds and vibrations, in one place. All are synthesised; none can throw. */
export function createSfx(audio: AudioService, haptics: HapticsService) {
  const notes = (freqs: readonly number[], gap: number, volume: number, type: OscillatorType = 'triangle'): void => {
    freqs.forEach((freq, i) => audio.tone({ freq, duration: 0.14, type, volume, delay: i * gap }));
  };

  return {
    click(): void {
      audio.tone({ freq: 720, endFreq: 560, duration: 0.05, type: 'square', volume: 0.05 });
    },

    /** An orb: a bright blip that is higher for you and lower for a ghost. */
    orb(byPlayer: boolean): void {
      audio.tone({ freq: byPlayer ? 740 : 520, endFreq: byPlayer ? 1180 : 780, duration: 0.12, type: 'sine', volume: byPlayer ? 0.17 : 0.1 });
      if (byPlayer) haptics.impact('light');
    },

    /** A gate opening (rising) or closing (falling). */
    gate(open: boolean): void {
      audio.tone({ freq: open ? 330 : 520, endFreq: open ? 620 : 260, duration: 0.14, type: 'square', volume: 0.06 });
    },

    died(): void {
      audio.noise({ duration: 0.3, volume: 0.22, filterFreq: 2400, endFilterFreq: 300 });
      audio.tone({ freq: 240, endFreq: 60, duration: 0.35, type: 'sawtooth', volume: 0.14 });
      haptics.impact('heavy');
    },

    ghostDied(): void {
      audio.tone({ freq: 300, endFreq: 120, duration: 0.18, type: 'sine', volume: 0.07 });
    },

    /** The loop ends and time runs backwards. */
    rewind(): void {
      audio.tone({ freq: 1400, endFreq: 180, duration: 0.55, type: 'triangle', volume: 0.1 });
      audio.noise({ duration: 0.5, volume: 0.08, filterFreq: 4000, endFilterFreq: 400 });
      haptics.impact('medium');
    },

    loopStart(): void {
      notes([440, 660], 0.08, 0.08);
    },

    win(): void {
      notes([523, 659, 784, 1047, 1319], 0.085, 0.13);
      haptics.notify('success');
    },

    lost(): void {
      audio.tone({ freq: 260, endFreq: 90, duration: 0.5, type: 'sawtooth', volume: 0.12 });
      haptics.notify('error');
    },
  };
}

export type Sfx = ReturnType<typeof createSfx>;
