import { describe, expect, it, vi } from 'vitest';
import { WebAudioService } from '../src/engine/services/audio';
import { CapacitorHaptics } from '../src/engine/services/haptics';

// ---- haptics ------------------------------------------------------------------------------

function fakeHapticsModule() {
  const calls: string[] = [];
  const module = {
    Haptics: {
      impact: async (o: { style: string }) => void calls.push(`impact:${o.style}`),
      notification: async (o: { type: string }) => void calls.push(`notification:${o.type}`),
    },
    ImpactStyle: { Heavy: 'HEAVY', Medium: 'MEDIUM', Light: 'LIGHT' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
  };
  return { module: module as unknown as typeof import('@capacitor/haptics'), calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CapacitorHaptics', () => {
  it('maps kinds to the plugin styles and types', async () => {
    const { module, calls } = fakeHapticsModule();
    const haptics = new CapacitorHaptics(async () => module);
    haptics.impact('light');
    haptics.impact('medium');
    haptics.impact('heavy');
    haptics.impact();
    haptics.notify('success');
    haptics.notify('warning');
    haptics.notify('error');
    await flush();
    expect(calls).toEqual([
      'impact:LIGHT',
      'impact:MEDIUM',
      'impact:HEAVY',
      'impact:LIGHT',
      'notification:SUCCESS',
      'notification:WARNING',
      'notification:ERROR',
    ]);
  });

  it('does nothing, and does not even load the plugin, while disabled', async () => {
    const { module, calls } = fakeHapticsModule();
    const load = vi.fn(async () => module);
    const haptics = new CapacitorHaptics(load);
    haptics.setEnabled(false);
    haptics.impact('heavy');
    haptics.notify('error');
    await flush();
    expect(calls).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    haptics.setEnabled(true);
    haptics.impact('heavy');
    await flush();
    expect(calls).toEqual(['impact:HEAVY']);
  });

  it('loads the plugin once, lazily', async () => {
    const { module } = fakeHapticsModule();
    const load = vi.fn(async () => module);
    const haptics = new CapacitorHaptics(load);
    expect(load).not.toHaveBeenCalled();
    haptics.impact();
    haptics.impact();
    haptics.notify('success');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never throws or rejects when the plugin is missing or broken', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const missing = new CapacitorHaptics(async () => {
        throw new Error('no plugin');
      });
      expect(() => missing.impact()).not.toThrow();
      expect(() => missing.notify('error')).not.toThrow();

      const broken = new CapacitorHaptics(async () => {
        const { module } = fakeHapticsModule();
        module.Haptics.impact = async () => {
          throw new Error('vibration unsupported');
        };
        return module;
      });
      expect(() => broken.impact()).not.toThrow();
      await flush();
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// ---- audio --------------------------------------------------------------------------------

interface Recorded {
  contexts: number;
  oscillators: { type?: string; freqSets: [number, number][]; ramps: [number, number][]; started?: number; stopped?: number }[];
  noiseSources: number;
  filters: number;
  resumed: number;
}

function fakeAudioContext() {
  const rec: Recorded = { contexts: 0, oscillators: [], noiseSources: 0, filters: 0, resumed: 0 };
  const param = (log?: { sets: [number, number][]; ramps: [number, number][] }) => ({
    setValueAtTime: (v: number, t: number) => void log?.sets.push([v, t]),
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: (v: number, t: number) => void log?.ramps.push([v, t]),
  });
  const create = () => {
    rec.contexts++;
    let state = 'suspended';
    return {
      get state() {
        return state;
      },
      resume: async () => {
        rec.resumed++;
        state = 'running';
      },
      currentTime: 10,
      sampleRate: 1000,
      destination: {},
      createOscillator: () => {
        const log = { sets: [] as [number, number][], ramps: [] as [number, number][] };
        const osc: Recorded['oscillators'][number] = { freqSets: log.sets, ramps: log.ramps };
        rec.oscillators.push(osc);
        return {
          set type(v: string) {
            osc.type = v;
          },
          frequency: param(log),
          connect: () => {},
          start: (t: number) => void (osc.started = t),
          stop: (t: number) => void (osc.stopped = t),
        };
      },
      createGain: () => ({ gain: param(), connect: () => {} }),
      createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
      createBufferSource: () => {
        rec.noiseSources++;
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      },
      createBiquadFilter: () => {
        rec.filters++;
        return { type: '', frequency: param(), connect: () => {} };
      },
    } as unknown as AudioContext;
  };
  return { create, rec };
}

describe('WebAudioService', () => {
  it('creates no AudioContext until the first sound or unlock', () => {
    const { create, rec } = fakeAudioContext();
    const audio = new WebAudioService(create);
    expect(rec.contexts).toBe(0);
    audio.tone({ freq: 440, duration: 0.1 });
    expect(rec.contexts).toBe(1);
    audio.tone({ freq: 440, duration: 0.1 });
    expect(rec.contexts).toBe(1); // reused
  });

  it('schedules a tone with its pitch, glide, delay and a stop after the end', () => {
    const { create, rec } = fakeAudioContext();
    const audio = new WebAudioService(create);
    audio.tone({ freq: 300, endFreq: 900, duration: 0.2, delay: 0.5, type: 'triangle' });
    const osc = rec.oscillators[0]!;
    expect(osc.type).toBe('triangle');
    expect(osc.freqSets).toEqual([[300, 10.5]]);
    expect(osc.ramps).toEqual([[900, 10.7]]);
    expect(osc.started).toBe(10.5);
    expect(osc.stopped).toBeGreaterThan(10.7);
  });

  it('makes filtered noise for swishes', () => {
    const { create, rec } = fakeAudioContext();
    const audio = new WebAudioService(create);
    audio.noise({ duration: 0.1, filterFreq: 800, endFilterFreq: 3000 });
    audio.noise({ duration: 0.1 });
    expect(rec.noiseSources).toBe(2);
    expect(rec.filters).toBe(1);
  });

  it('is silent, and creates nothing, while disabled', () => {
    const { create, rec } = fakeAudioContext();
    const audio = new WebAudioService(create);
    audio.setEnabled(false);
    audio.tone({ freq: 440, duration: 0.1 });
    audio.noise({ duration: 0.1 });
    audio.unlock();
    expect(rec.contexts).toBe(0);
    expect(rec.oscillators).toHaveLength(0);
    audio.setEnabled(true);
    audio.tone({ freq: 440, duration: 0.1 });
    expect(rec.oscillators).toHaveLength(1);
  });

  it('unlock resumes a suspended context, once', async () => {
    const { create, rec } = fakeAudioContext();
    const audio = new WebAudioService(create);
    audio.unlock();
    await flush();
    audio.unlock();
    expect(rec.resumed).toBe(1);
  });

  it('never throws when Web Audio is missing or fails', () => {
    const missing = new WebAudioService(() => {
      throw new Error('Web Audio is not available');
    });
    expect(() => missing.tone({ freq: 440, duration: 0.1 })).not.toThrow();
    expect(() => missing.noise({ duration: 0.1 })).not.toThrow();
    expect(() => missing.unlock()).not.toThrow();

    const failing = new WebAudioService(
      () =>
        ({
          currentTime: 0,
          state: 'running',
          createOscillator: () => {
            throw new Error('boom');
          },
        }) as unknown as AudioContext,
    );
    expect(() => failing.tone({ freq: 440, duration: 0.1 })).not.toThrow();
  });
});
