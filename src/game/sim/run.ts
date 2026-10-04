import { createRng, nextFloat, nextRange, type RngState } from '../../engine/core/rng';
import { CONFIG, type Mode } from './config';
import { evaluateCut, segmentHitsCircle, type CancelReason } from './cut';
import { makeFruitShape, pickKind, type FruitKind, type FruitShape } from './fruit';
import { place, type Polygon, type Vec } from './geometry';
import {
  accuracyFor,
  fruitRadiusFor,
  kindsFor,
  nextCombo,
  pointsFor,
  ratingFor,
  toleranceFor,
  type Rating,
  type RunStats,
} from './rules';

export interface Fruit {
  id: number;
  kind: FruitKind;
  shape: FruitShape;
  /** Bounding radius in world units. */
  radius: number;
  x: number;
  y: number;
  rotation: number;
  /** Position at the start of the latest step, for render interpolation. */
  prevX: number;
  prevY: number;
  prevRotation: number;
  vx: number;
  vy: number;
  /** Radians per second. */
  spin: number;
}

export interface Bomb {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  r: number;
  vx: number;
  vy: number;
}

export type RunPhase = 'playing' | 'failed' | 'over';
export type FailReason = 'tolerance' | 'strikes' | 'time';

/** One fruit as it was at the moment it was cut, so the view can animate the two halves. */
export interface CutPiece {
  kind: FruitKind;
  shape: FruitShape;
  radius: number;
  x: number;
  y: number;
  rotation: number;
  /** Fraction (0..1) of this fruit's area on the "left" side of the line. */
  fraction: number;
}

export type RunEvent =
  | { type: 'spawn' }
  | { type: 'cancel'; reason: CancelReason; a: Vec; b: Vec }
  | {
      type: 'cut';
      ok: boolean;
      a: Vec;
      b: Vec;
      pieces: CutPiece[];
      /** The worst deviation among the fruit cut (percentage points from 50). */
      deviation: number;
      tolerance: number;
      rating: Rating | 'miss';
      points: number;
      combo: number;
    }
  | { type: 'bomb'; x: number; y: number }
  | { type: 'strike'; strikes: number }
  | { type: 'failed'; reason: FailReason }
  | { type: 'restarted'; restarts: number }
  | { type: 'over' };

export interface Run {
  mode: Mode;
  seed: number;
  rng: RngState;
  tick: number;
  phase: RunPhase;
  failReason: FailReason | null;
  fruits: Fruit[];
  bombs: Bomb[];
  /** The fruit and bombs as spawned, so a retry brings back exactly the same ones. */
  snapshot: { fruits: Fruit[]; bombs: Bomb[] } | null;
  nextId: number;
  /** Seconds until the next fruit appears (while no fruit is on screen). */
  cooldown: number;
  /** Rounds won so far; drives tolerance, size, kinds and chaos. */
  round: number;
  fruitsCut: number;
  perfects: number;
  score: number;
  combo: number;
  accuracySum: number;
  /** Tolerance of the fruit on screen now (percentage points). */
  tolerance: number;
  /** Arcade only. */
  timeLeft: number;
  strikes: number;
  /** Tries used this run; sets the price of the next one. */
  restarts: number;
  events: RunEvent[];
}

export interface RunInput {
  /** The drag that just ended, in world coordinates, or null. */
  cut: { a: Vec; b: Vec } | null;
}

const { fruit: FRUIT, arcade: ARCADE } = CONFIG;

export function createRun(mode: Mode, seed: number, options: { startTime?: number } = {}): Run {
  const run: Run = {
    mode,
    seed: seed >>> 0,
    rng: createRng(seed),
    tick: 0,
    phase: 'playing',
    failReason: null,
    fruits: [],
    bombs: [],
    snapshot: null,
    nextId: 1,
    cooldown: 0,
    round: 0,
    fruitsCut: 0,
    perfects: 0,
    score: 0,
    combo: 0,
    accuracySum: 0,
    tolerance: toleranceFor(mode, 0),
    timeLeft: mode === 'arcade' ? (options.startTime ?? ARCADE.startTime) : 0,
    strikes: 0,
    restarts: 0,
    events: [],
  };
  spawnRound(run);
  return run;
}

/** The fruit's outline in world coordinates. */
export function fruitPolygon(f: Fruit): Vec[] {
  return place(f.shape.outline, f.x, f.y, f.rotation, f.radius);
}

export function drainEvents(run: Run): RunEvent[] {
  return run.events.splice(0, run.events.length);
}

export function runStats(run: Run): RunStats & { accuracy: number } {
  return {
    fruits: run.fruitsCut,
    perfects: run.perfects,
    score: run.score,
    accuracy: run.fruitsCut > 0 ? run.accuracySum / run.fruitsCut : 0,
  };
}

// ---- spawning ----------------------------------------------------------------------------

interface ArcadeSpec {
  twin: boolean;
  drift: number;
  spin: number;
  bombs: number;
}

function arcadeSpec(round: number, rng: RngState): ArcadeSpec {
  const drift = round >= ARCADE.driftFrom ? Math.min(ARCADE.maxDrift, 18 + 5 * (round - ARCADE.driftFrom)) : 0;
  const spinSpeed = round >= ARCADE.spinFrom ? Math.min(ARCADE.maxSpin, 0.5 + 0.1 * (round - ARCADE.spinFrom)) : 0;
  const spin = nextFloat(rng) < 0.5 ? -spinSpeed : spinSpeed;
  const bombs = round >= ARCADE.bombsFrom ? (round >= 18 ? 2 : 1) : 0;
  const twin = round >= ARCADE.twinFrom && nextFloat(rng) < ARCADE.twinChance;
  return { twin, drift, spin, bombs };
}

function makeFruit(run: Run, radius: number, x: number, y: number, speed: number, spin: number): Fruit {
  const kind = pickKind(kindsFor(run.round), run.rng);
  const shape = makeFruitShape(kind, run.rng, FRUIT.segments);
  const rotation = nextRange(run.rng, -0.6, 0.6);
  const heading = nextRange(run.rng, 0, Math.PI * 2);
  return {
    id: run.nextId++,
    kind,
    shape,
    radius,
    x,
    y,
    rotation,
    prevX: x,
    prevY: y,
    prevRotation: rotation,
    vx: speed === 0 ? 0 : Math.cos(heading) * speed, // (not -0 for a fruit that stays put)
    vy: speed === 0 ? 0 : Math.sin(heading) * speed,
    spin,
  };
}

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function roamingPosition(run: Run, radius: number, bounds: Bounds = ARCADE.bounds): Vec {
  const minX = bounds.left + radius;
  const maxX = bounds.right - radius;
  const minY = bounds.top + radius;
  const maxY = bounds.bottom - radius;
  return {
    x: maxX > minX ? nextRange(run.rng, minX, maxX) : FRUIT.centerX,
    y: maxY > minY ? nextRange(run.rng, minY, maxY) : FRUIT.centerY,
  };
}

/**
 * Puts the next round's fruit (and bombs) on screen, using the current `run.round` for
 * tolerance, size, kinds and chaos. The run does this itself; exported so tests and tools can
 * jump to a late round without playing the early ones.
 */
export function spawnRound(run: Run): void {
  run.tolerance = toleranceFor(run.mode, run.round);
  const radius = fruitRadiusFor(run.round);
  run.fruits = [];
  run.bombs = [];

  if (run.mode === 'classic') {
    run.fruits.push(makeFruit(run, radius, FRUIT.centerX, FRUIT.centerY, 0, 0));
  } else {
    const spec = arcadeSpec(run.round, run.rng);
    if (spec.twin) {
      const r = radius * 0.72;
      run.tolerance *= ARCADE.twinToleranceFactor;
      const y = roamingPosition(run, r).y;
      run.fruits.push(makeFruit(run, r, 100, y, spec.drift * 0.6, spec.spin));
      run.fruits.push(makeFruit(run, r, 260, y, spec.drift * 0.6, -spec.spin));
    } else {
      const at = roamingPosition(run, radius);
      run.fruits.push(makeFruit(run, radius, at.x, at.y, spec.drift, spec.spin));
    }
    for (let i = 0; i < spec.bombs; i++) {
      const bomb = placeBomb(run);
      if (bomb) run.bombs.push(bomb);
    }
  }
  run.snapshot = { fruits: run.fruits.map((f) => ({ ...f })), bombs: run.bombs.map((b) => ({ ...b })) };
  run.events.push({ type: 'spawn' });
}

/** A bomb somewhere clear of the fruit. */
function placeBomb(run: Run): Bomb | null {
  const r = ARCADE.bombRadius;
  for (let attempt = 0; attempt < 24; attempt++) {
    const at = roamingPosition(run, r, { left: 30, right: 330, top: 150, bottom: 560 });
    const clear = run.fruits.every((f) => Math.hypot(f.x - at.x, f.y - at.y) > f.radius + r + 24);
    if (clear) {
      const heading = nextRange(run.rng, 0, Math.PI * 2);
      return { id: run.nextId++, x: at.x, y: at.y, prevX: at.x, prevY: at.y, r, vx: Math.cos(heading) * 22, vy: Math.sin(heading) * 22 };
    }
  }
  return null;
}

// ---- the step ----------------------------------------------------------------------------

function bounce(value: number, velocity: number, min: number, max: number): [number, number] {
  if (value < min) return [min, Math.abs(velocity)];
  if (value > max) return [max, -Math.abs(velocity)];
  return [value, velocity];
}

function moveThings(run: Run): void {
  const dt = CONFIG.dt;
  const { left, right, top, bottom } = ARCADE.bounds;
  for (const f of run.fruits) {
    f.prevX = f.x;
    f.prevY = f.y;
    f.prevRotation = f.rotation;
    if (f.vx === 0 && f.vy === 0 && f.spin === 0) continue;
    [f.x, f.vx] = bounce(f.x + f.vx * dt, f.vx, left + f.radius, right - f.radius);
    [f.y, f.vy] = bounce(f.y + f.vy * dt, f.vy, top + f.radius, bottom - f.radius);
    f.rotation += f.spin * dt;
  }
  for (const b of run.bombs) {
    b.prevX = b.x;
    b.prevY = b.y;
    [b.x, b.vx] = bounce(b.x + b.vx * dt, b.vx, 30 + b.r, 330 - b.r);
    [b.y, b.vy] = bounce(b.y + b.vy * dt, b.vy, 150 + b.r, 560 - b.r);
  }
}

function fail(run: Run, reason: FailReason): void {
  run.phase = 'failed';
  run.failReason = reason;
  run.events.push({ type: 'failed', reason });
}

/** Arcade: a mistake costs a strike and some time; too many of either ends the run. Returns true if it did. */
function strike(run: Run): boolean {
  run.strikes += 1;
  run.timeLeft = Math.max(0, run.timeLeft - ARCADE.penaltyTime);
  run.combo = 0;
  run.events.push({ type: 'strike', strikes: run.strikes });
  if (run.timeLeft <= 0) {
    fail(run, 'time');
    return true;
  }
  if (run.strikes >= ARCADE.maxStrikes) {
    fail(run, 'strikes');
    return true;
  }
  return false;
}

/** Advances the run by one fixed step. Does nothing unless the run is in progress. */
export function stepRun(run: Run, input: RunInput): void {
  if (run.phase !== 'playing') return;
  run.tick += 1;
  const dt = CONFIG.dt;

  if (run.mode === 'arcade') {
    run.timeLeft = Math.max(0, run.timeLeft - dt);
    if (run.timeLeft <= 0) {
      fail(run, 'time');
      return;
    }
  }

  if (run.fruits.length === 0) {
    run.cooldown -= dt;
    if (run.cooldown <= 0) spawnRound(run);
    return; // drags during the pause between fruit are ignored
  }

  moveThings(run);
  if (input.cut) handleCut(run, input.cut.a, input.cut.b);
}

function handleCut(run: Run, a: Vec, b: Vec): void {
  // A bomb on the line voids the cut and costs a strike.
  const hit = run.bombs.filter((bomb) => segmentHitsCircle(a, b, bomb, bomb.r));
  if (hit.length > 0) {
    for (const bomb of hit) run.events.push({ type: 'bomb', x: bomb.x, y: bomb.y });
    run.bombs = run.bombs.filter((bomb) => !hit.includes(bomb));
    strike(run);
    return;
  }

  const results = run.fruits.map((f) => ({ f, ev: evaluateCut(fruitPolygon(f), a, b, CONFIG.cut.minLength) }));
  const cancelled = results.find((r) => r.ev.kind === 'cancel');
  if (cancelled && cancelled.ev.kind === 'cancel') {
    // With two fruit, every one must be cut; report the most telling reason.
    const partial = results.find((r) => r.ev.kind === 'cancel' && r.ev.reason === 'partial');
    const reason = partial && partial.ev.kind === 'cancel' ? partial.ev.reason : cancelled.ev.reason;
    run.events.push({ type: 'cancel', reason, a, b });
    return;
  }

  const pieces: CutPiece[] = [];
  let worst = 0;
  for (const { f, ev } of results) {
    if (ev.kind !== 'cut') continue;
    worst = Math.max(worst, ev.deviation);
    pieces.push({ kind: f.kind, shape: f.shape, radius: f.radius, x: f.x, y: f.y, rotation: f.rotation, fraction: ev.fraction });
  }

  const ok = worst <= run.tolerance;
  if (ok) {
    const rating = ratingFor(worst);
    const accuracy = accuracyFor(worst);
    run.combo = nextCombo(run.combo, rating);
    const points = pointsFor(accuracy, run.combo);
    run.score += points;
    run.fruitsCut += pieces.length;
    run.accuracySum += accuracy * pieces.length;
    if (rating === 'perfect') run.perfects += pieces.length;
    run.round += 1;
    if (run.mode === 'arcade') {
      const bonus = ARCADE.timeBonus + (rating === 'perfect' ? ARCADE.perfectTimeBonus : 0);
      run.timeLeft = Math.min(ARCADE.maxTime, run.timeLeft + bonus);
    }
    run.events.push({ type: 'cut', ok, a, b, pieces, deviation: worst, tolerance: run.tolerance, rating, points, combo: run.combo });
    run.fruits = [];
    run.bombs = [];
    run.cooldown = run.mode === 'classic' ? FRUIT.classicCooldown : FRUIT.arcadeCooldown;
    return;
  }

  run.events.push({ type: 'cut', ok, a, b, pieces, deviation: worst, tolerance: run.tolerance, rating: 'miss', points: 0, combo: 0 });
  run.combo = 0;
  if (run.mode === 'classic') {
    fail(run, 'tolerance');
    return;
  }
  // Arcade: the fruit is lost; carry on unless that was the last strike.
  run.fruits = [];
  run.bombs = [];
  run.cooldown = FRUIT.arcadeCooldown;
  strike(run);
}

// ---- after a failure ---------------------------------------------------------------------

/**
 * Carries on after a failure ("try again"). Classic brings back the very same fruit; Arcade gives
 * time back and clears strikes down to one. Returns false if the run is not in the failed state.
 */
export function restartRun(run: Run): boolean {
  if (run.phase !== 'failed') return false;
  run.restarts += 1;
  run.phase = 'playing';
  run.failReason = null;
  run.combo = 0;
  if (run.mode === 'arcade') {
    run.timeLeft = Math.max(run.timeLeft, ARCADE.continueTime);
    run.strikes = Math.min(run.strikes, ARCADE.continueStrikes);
    run.fruits = [];
    run.bombs = [];
    run.cooldown = FRUIT.arcadeCooldown;
  } else if (run.snapshot) {
    run.fruits = run.snapshot.fruits.map((f) => ({ ...f }));
    run.bombs = run.snapshot.bombs.map((b) => ({ ...b }));
    run.tolerance = toleranceFor(run.mode, run.round);
    run.cooldown = 0;
  }
  run.events.push({ type: 'restarted', restarts: run.restarts });
  return true;
}

/** Ends the run for good (from the try-again screen, or by quitting). */
export function endRun(run: Run): void {
  if (run.phase === 'over') return;
  run.phase = 'over';
  run.events.push({ type: 'over' });
}

/** A JSON-friendly snapshot for tests. */
export function debugRun(run: Run): Record<string, unknown> {
  return {
    mode: run.mode,
    phase: run.phase,
    failReason: run.failReason,
    round: run.round,
    fruitsCut: run.fruitsCut,
    score: run.score,
    combo: run.combo,
    tolerance: run.tolerance,
    timeLeft: run.timeLeft,
    strikes: run.strikes,
    restarts: run.restarts,
    cooldown: run.cooldown,
    fruits: run.fruits.map((f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y, radius: f.radius, polygon: fruitPolygon(f) })),
    bombs: run.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r })),
  };
}

export type { Polygon };
