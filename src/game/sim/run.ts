/**
 * One run of Echo Loop. You get a fixed time in the arena; when it ends the loop rewinds, what you
 * did becomes a ghost that repeats it exactly, and you go again with the ghosts beside you. A run is
 * won when, in a single loop, you and your ghosts together have collected every orb.
 *
 * Everything is a pure function of (arena, recordings): a ghost is just a recorded list of finger
 * readings played back through the very same rules as the player, so a run can be replayed from a
 * short list of numbers on any device.
 */
import { CONFIG } from './config';
import { arenaBottom, arenaLeft, arenaRight, arenaTop, lethalAt } from './hazards';
import type { Arena, Pointer, Samples } from './types';

export type RunPhase = 'playing' | 'dead' | 'loopEnd' | 'won' | 'lost';

/** Anything that moves toward a target: the player and every ghost. */
export interface Mover {
  x: number;
  y: number;
  /** Position at the start of the latest tick, for smooth drawing. */
  prevX: number;
  prevY: number;
  tx: number;
  ty: number;
  /** False when the finger is up: the mover stays where it is. */
  moving: boolean;
  alive: boolean;
}

export interface Ghost extends Mover {
  samples: Samples;
}

export type RunEvent =
  | { type: 'loopStart'; loop: number }
  | { type: 'orb'; index: number; by: number; x: number; y: number }
  | { type: 'died'; x: number; y: number }
  | { type: 'ghostDied'; ghost: number; x: number; y: number }
  | { type: 'gate'; gate: number; open: boolean }
  | { type: 'loopEnd'; loop: number; collected: number }
  | { type: 'won'; loops: number }
  | { type: 'lost' };

export interface Run {
  arena: Arena;
  maxLoops: number;
  /** 0-based index of the loop being played. */
  loop: number;
  /** Ticks played in this loop. */
  tick: number;
  phase: RunPhase;
  /** False for the bot's "ghosts only" timelines: nobody controls a player. */
  hasPlayer: boolean;
  player: Mover;
  ghosts: Ghost[];
  /** What the player's finger did this loop, as finger readings. */
  recording: Samples;
  collected: boolean[];
  collectedCount: number;
  /** Whether each gate is open right now. */
  open: boolean[];
  /** Deaths so far (the loop restarts each time; nothing else is lost). */
  deaths: number;
  events: RunEvent[];
}

export interface RunOptions {
  ghosts?: readonly Samples[];
  withPlayer?: boolean;
  maxLoops?: number;
}

const { grid } = CONFIG;
const MIN_X = arenaLeft + grid.cell / 2;
const MAX_X = arenaRight - grid.cell / 2;
const MIN_Y = arenaTop + grid.cell / 2;
const MAX_Y = arenaBottom - grid.cell / 2;

function mover(x: number, y: number, alive: boolean): Mover {
  return { x, y, prevX: x, prevY: y, tx: x, ty: y, moving: false, alive };
}

function newGhost(arena: Arena, samples: Samples): Ghost {
  return { ...mover(arena.start.x, arena.start.y, true), samples: [...samples] };
}

export function createRun(arena: Arena, options: RunOptions = {}): Run {
  const withPlayer = options.withPlayer ?? true;
  const run: Run = {
    arena,
    maxLoops: options.maxLoops ?? CONFIG.maxLoops,
    loop: options.ghosts?.length ?? 0,
    tick: 0,
    phase: 'playing',
    hasPlayer: withPlayer,
    player: mover(arena.start.x, arena.start.y, withPlayer),
    ghosts: (options.ghosts ?? []).map((samples) => newGhost(arena, samples)),
    recording: [],
    collected: arena.orbs.map(() => false),
    collectedCount: 0,
    open: arena.gates.map(() => false),
    deaths: 0,
    events: [{ type: 'loopStart', loop: options.ghosts?.length ?? 0 }],
  };
  return run;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function moveToward(m: Mover): void {
  m.prevX = m.x;
  m.prevY = m.y;
  if (!m.moving) return;
  const speed = CONFIG.player.speed;
  const dx = m.tx - m.x;
  const dy = m.ty - m.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= speed * speed) {
    m.x = m.tx;
    m.y = m.ty;
  } else {
    const d = Math.sqrt(d2);
    m.x += (dx / d) * speed;
    m.y += (dy / d) * speed;
  }
  m.x = clamp(m.x, MIN_X, MAX_X);
  m.y = clamp(m.y, MIN_Y, MAX_Y);
}

/** Turns a recorded finger reading into a target for a ghost (or stops it). */
function aim(m: Mover, x: number | undefined, y: number | undefined): void {
  if (x === undefined || y === undefined || x < 0 || y < 0) {
    m.moving = false;
    return;
  }
  m.tx = x;
  m.ty = y;
  m.moving = true;
}

const quantize = (v: number, max: number): number => clamp(Math.round(v), 0, max);

const NOBODY = -1;

/** Is this mover alive and within `reach2` (a squared distance) of the point? */
function touching(m: Mover, x: number, y: number, reach2: number): boolean {
  const dx = m.x - x;
  const dy = m.y - y;
  return m.alive && dx * dx + dy * dy < reach2;
}

/**
 * Advances the run by one fixed tick. `pointer` is where the finger is right now (or null); it is
 * only read every `sampleTicks` ticks, and what was read is recorded, so the loop can be replayed.
 */
export function stepRun(run: Run, pointer: Pointer): void {
  if (run.phase !== 'playing') return;
  const { arena } = run;
  const t = run.tick;

  if (t % CONFIG.sampleTicks === 0) {
    const index = t / CONFIG.sampleTicks;
    if (run.hasPlayer) {
      if (pointer === null) {
        run.player.moving = false;
        run.recording.push(-1, -1);
      } else {
        const x = quantize(pointer.x, CONFIG.world.width);
        const y = quantize(pointer.y, CONFIG.world.height);
        aim(run.player, x, y);
        run.recording.push(x, y);
      }
    }
    for (const g of run.ghosts) aim(g, g.samples[index * 2], g.samples[index * 2 + 1]);
  }

  if (run.hasPlayer && run.player.alive) moveToward(run.player);
  for (const g of run.ghosts) if (g.alive) moveToward(g);

  // Plates: a gate is open while anyone alive stands on its plate.
  const reach = CONFIG.plate.reach * CONFIG.plate.reach;
  for (let i = 0; i < arena.gates.length; i++) {
    const plate = arena.gates[i]!.plate;
    let pressed = touching(run.player, plate.x, plate.y, reach);
    for (let g = 0; g < run.ghosts.length && !pressed; g++) pressed = touching(run.ghosts[g]!, plate.x, plate.y, reach);
    if (pressed !== run.open[i]) {
      run.open[i] = pressed;
      run.events.push({ type: 'gate', gate: i, open: pressed });
    }
  }

  // Danger.
  const radius = CONFIG.player.radius;
  run.ghosts.forEach((g, i) => {
    if (g.alive && lethalAt(arena, t, g.x, g.y, radius, run.open)) {
      g.alive = false;
      run.events.push({ type: 'ghostDied', ghost: i, x: g.x, y: g.y });
    }
  });
  if (run.hasPlayer && run.player.alive && lethalAt(arena, t, run.player.x, run.player.y, radius, run.open)) {
    run.player.alive = false;
    run.deaths += 1;
    run.phase = 'dead';
    run.events.push({ type: 'died', x: run.player.x, y: run.player.y });
    return;
  }

  // Orbs: ghosts first (in the order they were made), then the player.
  const pickup = CONFIG.orb.pickup * CONFIG.orb.pickup;
  for (let index = 0; index < arena.orbs.length; index++) {
    const orb = arena.orbs[index]!;
    if (run.collected[index] === true) continue;
    let by = NOBODY;
    for (let g = 0; g < run.ghosts.length && by === NOBODY; g++) {
      if (touching(run.ghosts[g]!, orb.x, orb.y, pickup)) by = g + 1;
    }
    if (by === NOBODY && touching(run.player, orb.x, orb.y, pickup)) by = 0;
    if (by !== NOBODY) {
      run.collected[index] = true;
      run.collectedCount += 1;
      run.events.push({ type: 'orb', index, by, x: orb.x, y: orb.y });
    }
  }

  run.tick = t + 1;
  if (run.collectedCount === arena.orbs.length) {
    run.phase = 'won';
    run.events.push({ type: 'won', loops: run.loop + 1 });
    return;
  }
  if (run.tick >= CONFIG.loopTicks) finishLoop(run);
}

/** The loop is over (time ran out, or the player rewound early): on to the next loop, or the end of the run. */
function finishLoop(run: Run): void {
  run.events.push({ type: 'loopEnd', loop: run.loop, collected: run.collectedCount });
  if (run.loop + 1 >= run.maxLoops) {
    run.phase = 'lost';
    run.events.push({ type: 'lost' });
  } else {
    run.phase = 'loopEnd';
  }
}

/**
 * Ends the loop now ("rewind now"). What was recorded so far becomes the ghost, which simply stands still where
 * it was once its recording runs out, so a ghost can be left holding a plate without waiting out the clock.
 */
export function endLoop(run: Run): boolean {
  if (run.phase !== 'playing' || run.tick === 0) return false;
  finishLoop(run);
  return true;
}

function resetLoop(run: Run): void {
  const { start } = run.arena;
  run.tick = 0;
  run.phase = 'playing';
  run.player = mover(start.x, start.y, run.hasPlayer);
  for (const g of run.ghosts) {
    Object.assign(g, mover(start.x, start.y, true));
  }
  run.recording = [];
  run.collected = run.arena.orbs.map(() => false);
  run.collectedCount = 0;
  run.open = run.arena.gates.map(() => false);
}

/** The loop ended: what the player did becomes a ghost and a new loop begins. Only valid after 'loopEnd'. */
export function beginNextLoop(run: Run): boolean {
  if (run.phase !== 'loopEnd') return false;
  run.ghosts.push(newGhost(run.arena, run.recording));
  run.loop += 1;
  resetLoop(run);
  run.events.push({ type: 'loopStart', loop: run.loop });
  return true;
}

/** The player died: the same loop starts over (nothing is recorded or lost). Only valid after 'dead'. */
export function retryLoop(run: Run): boolean {
  if (run.phase !== 'dead') return false;
  resetLoop(run);
  run.events.push({ type: 'loopStart', loop: run.loop });
  return true;
}

/** Gives more loops (a rewarded ad); a run that was lost can carry on. */
export function extendLoops(run: Run, extra: number): boolean {
  if (extra <= 0) return false;
  run.maxLoops += extra;
  if (run.phase === 'lost') run.phase = 'loopEnd';
  return true;
}

export function drainEvents(run: Run): RunEvent[] {
  return run.events.splice(0, run.events.length);
}

/** Every loop's recording so far: the ghosts' and the current loop's. */
export function loopsOf(run: Run): Samples[] {
  return [...run.ghosts.map((g) => [...g.samples]), [...run.recording]];
}

export interface Timeline {
  /** open[g][tick]: whether gate g is open at that tick, with only the given ghosts playing. */
  open: Uint8Array[];
  /** Orbs the ghosts alone collect during a loop. */
  collected: boolean[];
}

/** Plays the ghosts on their own for a whole loop and records when each gate is open (the bot plans around this). */
export function ghostTimeline(arena: Arena, ghosts: readonly Samples[]): Timeline {
  const run = createRun(arena, { ghosts, withPlayer: false, maxLoops: 1000 });
  const open = arena.gates.map(() => new Uint8Array(CONFIG.loopTicks));
  let last: boolean[] = run.open.slice();
  for (let t = 0; t < CONFIG.loopTicks; t++) {
    if (run.phase === 'playing') {
      stepRun(run, null);
      last = run.open.slice();
    }
    last.forEach((isOpen, i) => {
      const lane = open[i];
      if (lane !== undefined) lane[t] = isOpen ? 1 : 0;
    });
  }
  return { open, collected: run.collected.slice() };
}

export interface Verdict {
  alive: boolean;
  won: boolean;
  collected: number;
}

/** Plays one more loop with the given recording as the player's finger, on top of the earlier ghosts. */
export function verifyLoop(arena: Arena, ghosts: readonly Samples[], samples: Samples): Verdict {
  const run = createRun(arena, { ghosts, maxLoops: 1000 });
  for (let t = 0; t < CONFIG.loopTicks && run.phase === 'playing'; t++) {
    const index = Math.floor(t / CONFIG.sampleTicks);
    const x = samples[index * 2];
    const y = samples[index * 2 + 1];
    stepRun(run, x === undefined || y === undefined || x < 0 ? null : { x, y });
  }
  return { alive: run.phase !== 'dead', won: run.phase === 'won', collected: run.collectedCount };
}

/** Debug snapshot for tests. */
export function debugRun(run: Run): Record<string, unknown> {
  return {
    phase: run.phase,
    loop: run.loop,
    maxLoops: run.maxLoops,
    tick: run.tick,
    deaths: run.deaths,
    orbs: run.arena.orbs.length,
    collected: run.collectedCount,
    player: { x: run.player.x, y: run.player.y, alive: run.player.alive },
    ghosts: run.ghosts.map((g) => ({ x: g.x, y: g.y, alive: g.alive })),
    open: run.open,
    par: run.arena.par,
    seed: run.arena.seed,
  };
}
