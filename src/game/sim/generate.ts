/**
 * Builds an arena from a number. There are no hand-made levels: a seed becomes a layout by rules, and the
 * bot (plan.ts) then tries to clear it. A layout the bot cannot clear is thrown away and the next attempt
 * for the same seed is tried, so every seed always yields a layout that can be won, the same one every time.
 */
import { createRng, nextFloat, nextRange, type RngState } from '../../engine/core/rng';
import { CONFIG } from './config';
import { cellCenterX, cellCenterY } from './hazards';
import { blockedLayers, buildGrid, solveArena } from './plan';
import type { Arena, Drifter, Gate, Orb, Pulsar, Solution, Vec } from './types';

const { grid, generator } = CONFIG;
const COLS = grid.cols;
const ROWS = grid.rows;
/** Hazards stay this many rows (drifters) or cells (pulsars) away from the start and the plates. */
const SANCTUARY_ROWS = 4;
const PULSAR_CLEARANCE = 7;

export interface Generated {
  arena: Arena;
  solution: Solution;
  /** How many layouts were tried before one could be cleared (1 = the first). */
  attempts: number;
}

/** A different, well-mixed stream of random numbers for every (seed, attempt). */
const mixSeed = (seed: number, attempt: number): number => (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;

/** A whole number from lo to hi, both included. */
const pickInt = (rng: RngState, lo: number, hi: number): number => lo + Math.min(hi - lo, Math.floor(nextFloat(rng) * (hi - lo + 1)));

const cellOf = (col: number, row: number): Vec => ({ x: cellCenterX(col), y: cellCenterY(row) });
const farEnough = (a: Vec, b: Vec, cells: number): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= cells * grid.cell;

/** Lays out one arena. `calm` leaves out every moving hazard (the last resort that always works). */
export function layoutArena(seed: number, attempt: number, calm: boolean): Arena {
  const rng = createRng(mixSeed(seed, attempt));
  const heat = calm ? 0 : nextRange(rng, generator.minHeat, generator.maxHeat);
  const roll = nextFloat(rng);
  const gateCount = roll < 0.15 ? 1 : roll < 0.55 ? 2 : 3;
  const bands = gateCount + 1;
  const bandRows = Math.floor(ROWS / bands);

  // Band 0 is the bottom; barrier g sits between band g and band g + 1.
  const barrierRow = (g: number): number => ROWS - (g + 1) * bandRows;
  const bandLo = (b: number): number => (b === gateCount ? 1 : barrierRow(b) + 2);
  const bandHi = (b: number): number => (b === 0 ? ROWS - 2 : barrierRow(b - 1) - 2);

  const start = cellOf(Math.floor(COLS / 2), ROWS - 3);

  const gates: Gate[] = [];
  for (let g = 0; g < gateCount; g++) {
    const doorCol = pickInt(rng, 4, COLS - 5);
    const doorX0 = grid.left + (doorCol - 2) * grid.cell;
    let plate = cellOf(pickInt(rng, 2, COLS - 3), pickInt(rng, bandLo(g) + 2, bandHi(g) - 1));
    for (let tries = 0; tries < 30 && g === 0 && !farEnough(plate, start, 6); tries++) {
      plate = cellOf(pickInt(rng, 2, COLS - 3), pickInt(rng, bandLo(g) + 2, bandHi(g) - 1));
    }
    gates.push({ y: cellCenterY(barrierRow(g)), doorX0, doorX1: doorX0 + CONFIG.barrier.doorCells * grid.cell, plate });
  }

  const orbs: Orb[] = [];
  const spread = (a: Vec): boolean =>
    orbs.every((o) => farEnough(o, a, 4)) && farEnough(a, start, 3) && gates.every((g) => farEnough(g.plate, a, 3));
  for (let b = 0; b <= gateCount; b++) {
    const wanted = b === gateCount ? (gateCount === 1 ? 4 : 3) : b === 0 ? 1 + (nextFloat(rng) < 0.5 ? 1 : 0) : 2;
    for (let n = 0, tries = 0; n < wanted && tries < 60; tries++) {
      const orb = cellOf(pickInt(rng, 1, COLS - 2), pickInt(rng, bandLo(b), bandHi(b)));
      if (!spread(orb)) continue;
      orbs.push(orb);
      n += 1;
    }
  }

  const drifters: Drifter[] = [];
  const pulsars: Pulsar[] = [];
  /** Spots a ghost must be able to stand on for a whole loop (the start and every plate): hazards keep clear of them. */
  const sanctuaries: Vec[] = [start, ...gates.map((g) => g.plate)];
  const rowOfY = (y: number): number => Math.round((y - grid.top - grid.cell / 2) / grid.cell);
  /** The rows of a band that stay free of sanctuaries, as inclusive [first, last] intervals. */
  const freeRows = (b: number): [number, number][] => {
    const blocked = new Set<number>();
    for (const sp of sanctuaries) {
      const row = rowOfY(sp.y);
      for (let r = row - SANCTUARY_ROWS; r <= row + SANCTUARY_ROWS; r++) blocked.add(r);
    }
    const out: [number, number][] = [];
    let from: number | null = null;
    for (let r = bandLo(b); r <= bandHi(b) + 1; r++) {
      const free = r <= bandHi(b) && !blocked.has(r);
      if (free && from === null) from = r;
      if (!free && from !== null) {
        out.push([from, r - 1]);
        from = null;
      }
    }
    return out;
  };
  if (!calm) {
    for (let b = 0; b <= gateCount; b++) {
      const lanes = freeRows(b);
      const count = 1 + (nextFloat(rng) < heat ? 1 : 0) + (heat > 0.7 && nextFloat(rng) < 0.5 ? 1 : 0);
      for (let n = 0; n < count && lanes.length > 0; n++) {
        const lane = lanes[pickInt(rng, 0, lanes.length - 1)]!;
        const minY = cellCenterY(lane[0]);
        const maxY = cellCenterY(lane[1]);
        const side = nextFloat(rng) < 0.5 ? -1 : 1;
        const tall = lane[1] - lane[0] >= 2;
        const vertical = !tall || nextFloat(rng) < 0.5 ? 0 : (nextFloat(rng) < 0.5 ? -1 : 1) * nextRange(rng, 0.25, CONFIG.drifter.maxDriftY);
        drifters.push({
          r: CONFIG.drifter.radius,
          minX: cellCenterX(0),
          maxX: cellCenterX(COLS - 1),
          minY,
          maxY,
          x0: nextRange(rng, cellCenterX(0), cellCenterX(COLS - 1)),
          y0: nextRange(rng, minY, maxY),
          vx: side * nextRange(rng, CONFIG.drifter.minSpeed, CONFIG.drifter.maxSpeed),
          vy: vertical,
        });
      }
      const pulses = (nextFloat(rng) < heat * 0.9 ? 1 : 0) + (heat > 0.6 && nextFloat(rng) < 0.4 ? 1 : 0);
      for (let n = 0; n < pulses; n++) {
        const period = pickInt(rng, CONFIG.pulsar.minPeriod, CONFIG.pulsar.maxPeriod);
        let at = cellOf(pickInt(rng, 3, COLS - 4), pickInt(rng, bandLo(b), bandHi(b)));
        for (let tries = 0; tries < 20 && !sanctuaries.every((sp) => farEnough(sp, at, PULSAR_CLEARANCE)); tries++) {
          at = cellOf(pickInt(rng, 3, COLS - 4), pickInt(rng, bandLo(b), bandHi(b)));
        }
        if (!sanctuaries.every((sp) => farEnough(sp, at, PULSAR_CLEARANCE))) continue;
        pulsars.push({
          ...at,
          r: Math.round(nextRange(rng, CONFIG.pulsar.minRadius, CONFIG.pulsar.maxRadius)),
          period,
          on: Math.min(period - 60, pickInt(rng, CONFIG.pulsar.minOn, CONFIG.pulsar.maxOn)),
          phase: pickInt(rng, 0, period - 1),
        });
      }
    }
  }

  return { seed, attempt, heat, start, orbs, drifters, pulsars, gates, par: 0 };
}

/** Is this layout worth handing to the bot? Start and plates must always be safe; orbs must not be hidden in danger. */
export function worthSolving(arena: Arena, planning: ReturnType<typeof buildGrid>): boolean {
  const top = arena.gates.length;
  if (arena.orbs.length < 2 + top) return false;
  const topBandStart = arena.gates[top - 1]?.y ?? 0;
  if (!arena.orbs.some((o) => o.y < topBandStart)) return false; // something must wait behind the last gate
  if (blockedLayers(planning, planning.startCell) > 0) return false;
  if (planning.plateCells.some((c) => blockedLayers(planning, c) > 0)) return false;
  return planning.orbCells.every((c) => blockedLayers(planning, c) < CONFIG.loopSamples * 0.5);
}

/** The arena for a seed, with the bot's solution. The same seed always gives the same arena. */
export function generateArena(seed: number): Generated {
  const total = generator.maxAttempts + 8;
  for (let attempt = 0; attempt < total; attempt++) {
    const calm = attempt >= generator.maxAttempts;
    const arena = layoutArena(seed, attempt, calm);
    const planning = buildGrid(arena);
    if (!worthSolving(arena, planning)) continue;
    const solution = solveArena(arena, planning);
    if (solution === null) continue;
    arena.par = solution.par;
    return { arena, solution, attempts: attempt + 1 };
  }
  throw new Error(`no arena could be built for seed ${seed}`);
}
