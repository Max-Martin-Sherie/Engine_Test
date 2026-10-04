export interface ToneOptions {
  /** Start frequency in Hz. */
  freq: number;
  /** If set, the pitch glides to this frequency over the duration. */
  endFreq?: number;
  /** Seconds. */
  duration: number;
  type?: OscillatorType;
  /** 0..1, default 0.2. */
  volume?: number;
  /** Seconds to wait before the sound starts. */
  delay?: number;
}

export interface NoiseOptions {
  duration: number;
  volume?: number;
  delay?: number;
  /** Band-pass centre frequency; with endFilterFreq the band sweeps (a "swish"). */
  filterFreq?: number;
  endFilterFreq?: number;
}

/** Simple synthesised sound effects, no audio files. Fire-and-forget; must never throw. */
export interface AudioService {
  setEnabled(enabled: boolean): void;
  /** Call from a user gesture: browsers only allow audio after one. The engine does this for you. */
  unlock(): void;
  tone(options: ToneOptions): void;
  noise(options: NoiseOptions): void;
}

const SILENCE = 0.0001;

/** Web Audio synth. The AudioContext is created lazily, and only while sound is enabled. */
export class WebAudioService implements AudioService {
  private enabled = true;
  private context: AudioContext | null = null;

  constructor(private readonly createContext: () => AudioContext = defaultContext) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  unlock(): void {
    if (!this.enabled) return;
    const context = this.ensure();
    if (context !== null && context.state === 'suspended') void context.resume().catch(() => {});
  }

  tone({ freq, endFreq, duration, type = 'sine', volume = 0.2, delay = 0 }: ToneOptions): void {
    const context = this.ready();
    if (context === null) return;
    try {
      const start = context.currentTime + delay;
      const end = start + duration;
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), end);
      osc.connect(this.envelope(context, start, end, volume));
      osc.start(start);
      osc.stop(end + 0.02);
    } catch {
      // Audio is optional.
    }
  }

  noise({ duration, volume = 0.2, delay = 0, filterFreq, endFilterFreq }: NoiseOptions): void {
    const context = this.ready();
    if (context === null) return;
    try {
      const start = context.currentTime + delay;
      const end = start + duration;
      const length = Math.max(1, Math.floor(context.sampleRate * duration));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      let node: AudioNode = source;
      if (filterFreq !== undefined) {
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(filterFreq, start);
        if (endFilterFreq !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(endFilterFreq, 1), end);
        source.connect(filter);
        node = filter;
      }
      node.connect(this.envelope(context, start, end, volume));
      source.start(start);
      source.stop(end + 0.02);
    } catch {
      // Audio is optional.
    }
  }

  /** A gain node with a quick attack and an exponential decay, wired to the speakers. */
  private envelope(context: AudioContext, start: number, end: number, volume: number): GainNode {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.linearRampToValueAtTime(Math.max(volume, SILENCE), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(SILENCE, end);
    gain.connect(context.destination);
    return gain;
  }

  private ready(): AudioContext | null {
    return this.enabled ? this.ensure() : null;
  }

  private ensure(): AudioContext | null {
    if (this.context === null) {
      try {
        this.context = this.createContext();
      } catch {
        return null;
      }
    }
    return this.context;
  }
}

function defaultContext(): AudioContext {
  const Ctor =
    globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) throw new Error('Web Audio is not available');
  return new Ctor();
}
