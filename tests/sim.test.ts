import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  beginNextLoop,
  cellCenterX,
  cellCenterY,
  createRun,
  drainEvents,
  drifterX,
  decodeReplay,
  drifterY,
  encodeReplay,
  endLoop,
  extendLoops,
  gateLethal,
  ghostTimeline,
  lethalAt,
  loopsOf,
  playReplay,
  pulsarActive,
  pulsarWarning,
  retryLoop,
  stepRun,
  verifyLoop,
  type Arena,
  type Pointer,
  type Run,
  type Samples,
} from '../src/game/sim';

/** A small hand-made arena: one gate with its plate in the bottom band, one orb behind the gate, one beside the start. */
function arena(extra: Partial<Arena> = {}): Arena {
  const gateY = cellCenterY(30);
  return {
    seed: 1,
    attempt: 0,
    heat: 0,
    start: { x: cellCenterX(16), y: cellCenterY(43) },
    orbs: [
      { x: cellCenterX(16), y: cellCenterY(20) },
      { x: cellCenterX(26), y: cellCenterY(40) },
    ],
    drifters: [],
    pulsars: [],
    gates: [{ y: gateY, doorX0: CONFIG.grid.left + 14 * CONFIG.grid.cell, doorX1: CONFIG.grid.left + 18 * CONFIG.grid.cell, plate: { x: cellCenterX(6), y: cellCenterY(38) } }],
    par: 2,
    ...extra,
  };
}

const plate = (a: Arena) => a.gates[0]!.plate;

function play(run: Run, ticks: number, pointer: (tick: number) => Pointer): void {
  for (let i = 0; i < ticks && run.phase === 'playing'; i++) stepRun(run, pointer(run.tick));
}

/** A recording that holds one target for the whole loop. */
const hold = (x: number, y: number): Samples => Array.from({ length: CONFIG.loopSamples }, () => [x, y]).flat();

describe('moving and recording', () => {
  it('moves toward the finger at a fixed speed and stops when the finger lifts', () => {
    const run = createRun(arena());
    const { start } = run.arena;
    play(run, 6, () => ({ x: start.x + 100, y: start.y }));
    expect(run.player.x).toBeCloseTo(start.x + 6 * CONFIG.player.speed, 6);
    play(run, 12, () => null);
    expect(run.player.x).toBeCloseTo(start.x + 6 * CONFIG.player.speed, 6); // held still: the reading changed at the next sample
  });

  it('only reads the finger every few ticks and records exactly what it read', () => {
    const run = createRun(arena());
    const seen: Pointer[] = [];
    play(run, 24, (tick) => {
      const p = { x: 100 + tick, y: 300 };
      seen.push(p);
      return p;
    });
    expect(run.recording).toEqual([100, 300, 106, 300, 112, 300, 118, 300]);
  });

  it('records "not touching" as -1, -1 and quantises to whole numbers', () => {
    const run = createRun(arena());
    stepRun(run, { x: 100.6, y: 200.4 });
    play(run, 5, () => null);
    stepRun(run, null);
    expect(run.recording).toEqual([101, 200, -1, -1]);
  });

  it('keeps the player inside the arena', () => {
    const run = createRun(arena());
    play(run, 600, () => ({ x: 0, y: 0 }));
    expect(run.player.x).toBeGreaterThanOrEqual(CONFIG.grid.left);
    expect(run.player.y).toBeGreaterThanOrEqual(CONFIG.grid.top);
  });

  it('is deterministic: the same fingers give the same run, to the last bit', () => {
    const finger = (tick: number): Pointer => ({ x: 180 + 90 * ((tick % 240) / 240 - 0.5), y: 400 + (tick % 7) * 9 });
    const a = createRun(arena());
    const b = createRun(arena());
    play(a, 500, finger);
    play(b, 500, finger);
    expect(a).toEqual(b);
  });
});

describe('ghosts', () => {
  it('replay a recording exactly: a ghost ends up where the player was, at every tick', () => {
    const first = createRun(arena());
    const track: [number, number][] = [];
    const finger = (tick: number): Pointer => ({ x: 120 + (tick % 300), y: 560 - (tick % 200) });
    for (let t = 0; t < 600; t++) {
      stepRun(first, finger(t));
      track.push([first.player.x, first.player.y]);
    }
    const ghost = createRun(arena(), { ghosts: [first.recording], withPlayer: false });
    for (let t = 0; t < 600; t++) {
      stepRun(ghost, null);
      expect(ghost.ghosts[0]!.x).toBe(track[t]![0]);
      expect(ghost.ghosts[0]!.y).toBe(track[t]![1]);
    }
  });

  it('become real when a loop ends: loopEnd -> beginNextLoop adds the ghost and rewinds time', () => {
    const run = createRun(arena());
    play(run, CONFIG.loopTicks, () => ({ x: 200, y: 560 }));
    expect(run.phase).toBe('loopEnd');
    expect(run.recording).toHaveLength(CONFIG.loopSamples * 2);
    expect(beginNextLoop(run)).toBe(true);
    expect(run.loop).toBe(1);
    expect(run.tick).toBe(0);
    expect(run.ghosts).toHaveLength(1);
    expect(run.player.x).toBe(run.arena.start.x);
    expect(run.ghosts[0]!.x).toBe(run.arena.start.x);
    expect(run.recording).toEqual([]);
    expect(beginNextLoop(run)).toBe(false); // only valid right after a loop ended
  });
});

describe('plates, gates and orbs', () => {
  it('a gate is open exactly while someone alive stands on its plate', () => {
    const a = arena();
    const run = createRun(a, { ghosts: [hold(plate(a).x, plate(a).y)], withPlayer: false });
    expect(run.open[0]).toBe(false);
    const open = ghostTimeline(a, [hold(plate(a).x, plate(a).y)]).open[0]!;
    expect(open[0]).toBe(0);
    expect(open[CONFIG.loopTicks - 1]).toBe(1);
    const arrived = open.indexOf(1);
    expect(arrived).toBeGreaterThan(30); // the ghost has to walk there first
    expect(arrived).toBeLessThan(80);
    for (let t = arrived; t < CONFIG.loopTicks; t++) expect(open[t]).toBe(1);
  });

  it('a closed door is deadly, an open one is not, and walls beside the door always are', () => {
    const g = arena().gates[0]!;
    const mid = (g.doorX0 + g.doorX1) / 2;
    expect(gateLethal(g, mid, g.y, CONFIG.player.radius, false)).toBe(true);
    expect(gateLethal(g, mid, g.y, CONFIG.player.radius, true)).toBe(false);
    expect(gateLethal(g, g.doorX0 - 20, g.y, CONFIG.player.radius, true)).toBe(true);
    expect(gateLethal(g, mid, g.y + 10, CONFIG.player.radius, false)).toBe(false); // one cell away is clear
  });

  it('two loops win: loop 1 holds the plate, loop 2 walks through the open door and collects both orbs', () => {
    const a = arena();
    const run = createRun(a);
    play(run, CONFIG.loopTicks, () => ({ x: plate(a).x, y: plate(a).y })); // loop 1: stand on the plate
    expect(run.phase).toBe('loopEnd');
    expect(run.collectedCount).toBe(0);
    beginNextLoop(run);
    const orbBehind = { x: a.start.x, y: a.orbs[0]!.y }; // straight through the door
    const backThroughDoor = { x: a.start.x, y: 520 };
    const orbBeside = { x: a.orbs[1]!.x, y: a.orbs[1]!.y };
    // Wait for the ghost to open the door, then go there, come back down through the door, then to the other orb.
    play(run, CONFIG.loopTicks, (tick) => (tick < 84 ? null : !run.collected[0] ? orbBehind : run.player.y < 500 ? backThroughDoor : orbBeside));
    expect(run.phase).toBe('won');
    expect(run.collectedCount).toBe(2);
    expect(drainEvents(run).some((e) => e.type === 'won' && e.loops === 2)).toBe(true);
  });

  it('orbs only count within ONE loop: collecting one now and one later does not win', () => {
    const a = arena();
    const run = createRun(a);
    play(run, CONFIG.loopTicks, (tick) => (run.collected[1] ? null : { x: a.orbs[1]!.x, y: a.orbs[1]!.y }) ?? (tick > 0 ? null : null));
    expect(run.collected[1]).toBe(true);
    expect(run.collectedCount).toBe(1);
    expect(run.phase).toBe('loopEnd');
    beginNextLoop(run);
    // The ghost collects that orb again by itself; the player has to fetch the other one in the same loop.
    expect(run.collectedCount).toBe(0);
    play(run, 200, () => null);
    expect(run.collected[1]).toBe(true); // the ghost did it
    expect(run.collected[0]).toBe(false);
  });

  it('walking into a closed door kills the player, and the loop simply starts over without a ghost', () => {
    const a = arena();
    const run = createRun(a);
    play(run, 400, () => ({ x: a.start.x, y: a.orbs[0]!.y }));
    expect(run.phase).toBe('dead');
    expect(run.deaths).toBe(1);
    const events = drainEvents(run);
    expect(events.some((e) => e.type === 'died')).toBe(true);
    expect(retryLoop(run)).toBe(true);
    expect(run.ghosts).toHaveLength(0);
    expect(run.tick).toBe(0);
    expect(run.phase).toBe('playing');
    expect(run.recording).toEqual([]);
  });
});

describe('rewind now (ending a loop early)', () => {
  it('ends the loop at once; the ghost then stands still where it was, still holding the plate', () => {
    const a = arena();
    const run = createRun(a);
    play(run, 300, () => ({ x: plate(a).x, y: plate(a).y }));
    expect(run.phase).toBe('playing');
    expect(endLoop(run)).toBe(true);
    expect(run.phase).toBe('loopEnd');
    expect(run.recording).toHaveLength((300 / CONFIG.sampleTicks) * 2); // only what was played
    const open = ghostTimeline(a, [run.recording]).open[0]!;
    expect(open[CONFIG.loopTicks - 1]).toBe(1); // still on the plate at the very end of a full loop
    expect(open.indexOf(1)).toBeLessThan(80);
  });

  it('does nothing before anything was played or when the run is not in play', () => {
    const run = createRun(arena());
    expect(endLoop(run)).toBe(false);
    play(run, 12, () => null);
    expect(endLoop(run)).toBe(true);
    expect(endLoop(run)).toBe(false); // already over
  });

  it('on the last loop it ends the whole run', () => {
    const run = createRun(arena(), { maxLoops: 1 });
    play(run, 60, () => null);
    expect(endLoop(run)).toBe(true);
    expect(run.phase).toBe('lost');
  });

  it('a shared run that used it still replays exactly, and still wins', () => {
    const a = arena();
    const live = createRun(a);
    play(live, 300, () => ({ x: plate(a).x, y: plate(a).y }));
    endLoop(live);
    beginNextLoop(live);
    const orbBehind = { x: a.start.x, y: a.orbs[0]!.y };
    const backThroughDoor = { x: a.start.x, y: 520 };
    const orbBeside = { x: a.orbs[1]!.x, y: a.orbs[1]!.y };
    play(live, CONFIG.loopTicks, (tick) => (tick < 84 ? null : !live.collected[0] ? orbBehind : live.player.y < 500 ? backThroughDoor : orbBeside));
    expect(live.phase).toBe('won');
    const replay = { seed: 1, loops: loopsOf(live) };
    expect(replay.loops[0]).toHaveLength(100); // 300 ticks of readings, not a whole loop
    const back = decodeReplay(encodeReplay(replay));
    expect(back).toEqual(replay);
    expect(playReplay(a, back!)).toEqual({ won: true, loops: 2 });
  });
});

describe('hazards', () => {
  it('a drifter bounces inside its box forever and its position is a pure function of the tick', () => {
    const d = { r: 9, minX: 25, maxX: 335, minY: 300, maxY: 400, x0: 100, y0: 350, vx: 0.9, vy: -0.4 };
    for (let t = 0; t < 5000; t += 37) {
      expect(drifterX(d, t)).toBeGreaterThanOrEqual(25);
      expect(drifterX(d, t)).toBeLessThanOrEqual(335);
      expect(drifterY(d, t)).toBeGreaterThanOrEqual(300);
      expect(drifterY(d, t)).toBeLessThanOrEqual(400);
    }
    expect(drifterX(d, 0)).toBe(100);
    expect(drifterX(d, 100)).toBeCloseTo(190, 9);
    expect(drifterX(d, 0)).toBe(drifterX({ ...d }, 0));
  });

  it('a pulsar warns shortly before it switches on, is deadly while on, and repeats', () => {
    const p = { x: 180, y: 300, r: 30, period: 200, on: 80, phase: 0 };
    expect(pulsarActive(p, 0)).toBe(true);
    expect(pulsarActive(p, 79)).toBe(true);
    expect(pulsarActive(p, 80)).toBe(false);
    expect(pulsarWarning(p, 150)).toBe(false);
    expect(pulsarWarning(p, 175)).toBe(true);
    expect(pulsarActive(p, 200)).toBe(true);
    const a = arena({ pulsars: [p] });
    expect(lethalAt(a, 10, 180, 300, 6, [true])).toBe(true);
    expect(lethalAt(a, 120, 180, 300, 6, [true])).toBe(false);
  });

  it('kills a ghost too, which then stops (and a dead ghost does not hold a plate)', () => {
    const a = arena({ pulsars: [{ x: 120, y: 540, r: 30, period: 1000, on: 900, phase: 0 }] });
    const dying = hold(plate(a).x, plate(a).y);
    const timeline = ghostTimeline(a, [dying]);
    // The plate is at (85, 525): inside that pulsar's reach, so the ghost dies on arrival and the gate never stays open.
    expect(timeline.open[0]!.reduce((n, v) => n + v, 0)).toBeLessThan(40);
  });
});

describe('the end of a run', () => {
  it('is lost after the last loop, and a rewarded ad can give more loops', () => {
    const a = arena();
    const run = createRun(a, { maxLoops: 2 });
    for (let i = 0; i < 2; i++) {
      play(run, CONFIG.loopTicks, () => null);
      if (i === 0) beginNextLoop(run);
    }
    expect(run.phase).toBe('lost');
    expect(extendLoops(run, CONFIG.extraLoops)).toBe(true);
    expect(run.phase).toBe('loopEnd');
    expect(run.maxLoops).toBe(2 + CONFIG.extraLoops);
    expect(beginNextLoop(run)).toBe(true);
    expect(run.phase).toBe('playing');
    expect(extendLoops(run, 0)).toBe(false);
  });

  it('can verify a recording against the real rules', () => {
    const a = arena();
    const verdict = verifyLoop(a, [], hold(plate(a).x, plate(a).y));
    expect(verdict).toMatchObject({ alive: true, won: false, collected: 0 });
    const walkIntoDoor = verifyLoop(a, [], hold(a.start.x, a.orbs[0]!.y));
    expect(walkIntoDoor.alive).toBe(false);
  });

  it('exposes every loop for sharing', () => {
    const run = createRun(arena());
    play(run, CONFIG.loopTicks, () => ({ x: 150, y: 500 }));
    beginNextLoop(run);
    play(run, 60, () => ({ x: 200, y: 500 }));
    const loops = loopsOf(run);
    expect(loops).toHaveLength(2);
    expect(loops[0]).toHaveLength(CONFIG.loopSamples * 2);
    expect(loops[1]).toHaveLength(10 * 2);
  });
});

describe('cross-device determinism (a shared link must replay identically everywhere)', () => {
  it('the sim never uses maths functions whose last digit can differ between browsers', () => {
    const dir = join(__dirname, '..', 'src', 'game', 'sim');
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b|\*\*/;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => banned.test(readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    expect(offenders).toEqual([]);
  });
});
