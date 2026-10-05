/**
 * A finished run as a short piece of text. Because the game is deterministic, a run is fully described
 * by its seed and the player's finger readings in every loop, a few hundred numbers. Anyone who opens the
 * link replays exactly that run (and the game checks it really wins before showing it as a challenge).
 */
import { decodeInts, encodeInts } from '../../engine/core/replay';
import { CONFIG } from './config';
import { beginNextLoop, createRun, endLoop, stepRun, type Run } from './run';
import type { Arena, Pointer, Samples } from './types';

export interface Replay {
  seed: number;
  /** One recording per loop, in order; the last loop is the one that collected everything. */
  loops: Samples[];
}

const VERSION = 1;
const MAX_LOOPS = 16;
const MAX_SAMPLE_NUMBERS = CONFIG.loopSamples * 2;

/** Splits a recording into its x readings and y readings and stores each as steps (the codec then stores the change of step). */
function toChannels(loop: Samples): number[] {
  const out: number[] = [];
  for (const offset of [0, 1]) {
    let previous = 0;
    for (let i = offset; i < loop.length; i += 2) {
      const value = loop[i]!;
      out.push(value - previous);
      previous = value;
    }
  }
  return out;
}

function fromChannels(numbers: readonly number[]): Samples {
  const count = numbers.length / 2;
  const loop: Samples = new Array<number>(numbers.length).fill(0);
  for (const offset of [0, 1]) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value += numbers[offset * count + i]!;
      loop[i * 2 + offset] = value;
    }
  }
  return loop;
}

export function encodeReplay(replay: Replay): string {
  const numbers: number[] = [VERSION, replay.seed, replay.loops.length];
  for (const loop of replay.loops) numbers.push(loop.length, ...toChannels(loop));
  return encodeInts(numbers);
}

/** Reads what `encodeReplay` wrote. Returns null for anything that is not a plausible recording. */
export function decodeReplay(text: string): Replay | null {
  const numbers = decodeInts(text, MAX_LOOPS * (MAX_SAMPLE_NUMBERS + 1) + 3);
  if (numbers === null || numbers.length < 3 || numbers[0] !== VERSION) return null;
  const seed = numbers[1];
  const count = numbers[2];
  if (seed === undefined || count === undefined || seed < 0 || count < 1 || count > MAX_LOOPS) return null;
  const loops: Samples[] = [];
  let at = 3;
  for (let i = 0; i < count; i++) {
    const length = numbers[at++];
    if (length === undefined || length < 0 || length > MAX_SAMPLE_NUMBERS || length % 2 !== 0) return null;
    const channels = numbers.slice(at, at + length);
    if (channels.length !== length) return null;
    const loop = fromChannels(channels);
    for (const v of loop) if (v < -1 || v > CONFIG.world.height) return null;
    loops.push(loop);
    at += length;
  }
  return at === numbers.length ? { seed, loops } : null;
}

/** The finger position a recording says to use at this tick (it is only read every few ticks). */
export function pointerAt(samples: Samples, tick: number): Pointer {
  const index = Math.floor(tick / CONFIG.sampleTicks);
  const x = samples[index * 2];
  const y = samples[index * 2 + 1];
  return x === undefined || y === undefined || x < 0 || y < 0 ? null : { x, y };
}

export interface ReplayResult {
  /** True if the recording collects every orb in its last loop. */
  won: boolean;
  /** Loops used. */
  loops: number;
}

/**
 * Advances a recorded run by one tick. A loop whose recording is shorter than the full time was ended early
 * ("rewind now"), so when its recording runs out the loop ends there, exactly as it did live.
 */
export function stepReplay(run: Run, loops: readonly Samples[]): void {
  if (run.phase !== 'playing') return;
  const samples = loops[run.loop] ?? [];
  const isLast = run.loop >= loops.length - 1;
  if (!isLast && run.tick >= (samples.length / 2) * CONFIG.sampleTicks) {
    endLoop(run);
    return;
  }
  stepRun(run, pointerAt(samples, run.tick));
}

/** Plays a recording through the real rules. */
export function playReplay(arena: Arena, replay: Replay): ReplayResult {
  const run = createRun(arena, { maxLoops: MAX_LOOPS + 1 });
  for (let i = 0; i < replay.loops.length; i++) {
    while (run.phase === 'playing' && run.loop === i && run.tick < CONFIG.loopTicks) stepReplay(run, replay.loops);
    if (i === replay.loops.length - 1) return { won: run.phase === 'won', loops: i + 1 };
    if (!beginNextLoop(run)) return { won: false, loops: i + 1 };
  }
  return { won: false, loops: replay.loops.length };
}

/** How many stars a result earns: 3 at par or better, 2 one loop over, 1 otherwise. */
export function starsFor(loops: number, par: number): number {
  if (loops <= par + CONFIG.stars.threeUpTo) return 3;
  if (loops <= par + CONFIG.stars.twoUpTo) return 2;
  return 1;
}
