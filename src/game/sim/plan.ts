/**
 * The bot: a solver that plays Echo Loop. It exists for two reasons: the generator uses it to throw away
 * any arena that cannot be cleared (so no human ever designs or checks a level), and it supplies the
 * "par" the stars are measured against, plus the demo that plays itself.
 *
 * It plans on the grid, layer by layer (one layer per finger reading), over everything that is known
 * ahead of time: where each drifter and pulsar is at every tick, and when each gate is open thanks to the
 * ghosts already made. Whatever it plans is then replayed through the real rules (verifyLoop); if the
 * real thing disagrees, the arena is simply rejected, so the planner may be approximate but never wrong.
 */
import { CONFIG } from './config';
import { cellCenterX, cellCenterY, cellCount, cellIndex, colOf, drifterX, drifterY, pulsarActive, rowOf } from './hazards';
import { ghostTimeline, verifyLoop, type Timeline } from './run';
import type { Arena, Samples, Solution } from './types';

const { grid, loopTicks, sampleTicks, generator } = CONFIG;
const COLS = grid.cols;
const ROWS = grid.rows;
const N = cellCount;
const LAYERS = CONFIG.loopSamples;
const PLAYER_R = CONFIG.player.radius;

/** The nine things one finger reading can do: stay, or step to any of the eight neighbours. */
const DC = [0, 1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 0, 1, -1, 1, -1, 1, -1];

export interface PlanningGrid {
  /** blocked[layer * N + cell]: standing on that cell around that layer would be destroyed (open doors assumed). */
  blocked: Uint8Array;
  /** The gate whose door covers this cell, or -1. */
  doorOf: Int8Array;
  /** 1 for cells in a barrier's row (no diagonal moves into or out of them). */
  barrierRow: Uint8Array;
  startCell: number;
  plateCells: number[];
  orbCells: number[];
}

/** The ticks a layer's cell is "occupied": the mover arrives shortly before the layer starts and leaves shortly after. */
function occupancy(layer: number): number[] {
  const first = Math.max(0, layer * sampleTicks - 2);
  const mid = layer * sampleTicks;
  const last = Math.min(loopTicks - 1, layer * sampleTicks + 3);
  return [first, mid, last];
}

export function buildGrid(arena: Arena): PlanningGrid {
  const blocked = new Uint8Array(LAYERS * N);
  const doorOf = new Int8Array(N).fill(-1);
  const barrierRow = new Uint8Array(N);

  // Walls: every cell of a barrier's row is deadly except the door cells (which depend on the plate).
  arena.gates.forEach((gate, g) => {
    const row = rowOf(gate.y);
    for (let col = 0; col < COLS; col++) {
      const c = cellIndex(col, row);
      barrierRow[c] = 1;
      const x = cellCenterX(col);
      if (x >= gate.doorX0 && x <= gate.doorX1) doorOf[c] = g;
      else for (let j = 0; j < LAYERS; j++) blocked[j * N + c] = 1;
    }
  });

  // Moving hazards, painted onto the cells they threaten at the ticks each layer is occupied.
  const circle = (j: number, x: number, y: number, reach: number): void => {
    const c0 = colOf(x - reach - grid.cell);
    const c1 = colOf(x + reach + grid.cell);
    const r0 = rowOf(y - reach - grid.cell);
    const r1 = rowOf(y + reach + grid.cell);
    for (let row = r0; row <= r1; row++) {
      const dy = cellCenterY(row) - y;
      for (let col = c0; col <= c1; col++) {
        const dx = cellCenterX(col) - x;
        if (dx * dx + dy * dy < reach * reach) blocked[j * N + cellIndex(col, row)] = 1;
      }
    }
  };
  for (let j = 0; j < LAYERS; j++) {
    for (const tick of occupancy(j)) {
      for (const d of arena.drifters) circle(j, drifterX(d, tick), drifterY(d, tick), d.r + PLAYER_R + generator.planMargin);
      for (const p of arena.pulsars) if (pulsarActive(p, tick)) circle(j, p.x, p.y, p.r + PLAYER_R + generator.planMargin);
    }
  }

  const cellOfPoint = (p: { x: number; y: number }): number => cellIndex(colOf(p.x), rowOf(p.y));
  return {
    blocked,
    doorOf,
    barrierRow,
    startCell: cellOfPoint(arena.start),
    plateCells: arena.gates.map((g) => cellOfPoint(g.plate)),
    orbCells: arena.orbs.map(cellOfPoint),
  };
}

/** How many layers a cell is unsafe in (of LAYERS). */
export function blockedLayers(g: PlanningGrid, cell: number): number {
  let count = 0;
  for (let j = 0; j < LAYERS; j++) if (g.blocked[j * N + cell] === 1) count += 1;
  return count;
}

interface Planner {
  grid: PlanningGrid;
  /** closed[g][t]: number of ticks before t at which gate g is closed (prefix sums). */
  closedBefore: Int32Array[];
  reach: Uint8Array;
  parent: Uint8Array;
}

function makePlanner(grid: PlanningGrid, timeline: Timeline): Planner {
  const closedBefore = timeline.open.map((lane) => {
    const sums = new Int32Array(loopTicks + 1);
    for (let t = 0; t < loopTicks; t++) sums[t + 1] = (sums[t] ?? 0) + (lane[t] === 1 ? 0 : 1);
    return sums;
  });
  return { grid, closedBefore, reach: new Uint8Array(LAYERS * N), parent: new Uint8Array(LAYERS * N) };
}

/** Is gate g open for every tick from..to (inclusive)? */
function openThrough(p: Planner, g: number, from: number, to: number): boolean {
  const sums = p.closedBefore[g];
  if (sums === undefined) return false;
  const a = Math.max(0, from);
  const b = Math.min(loopTicks - 1, to);
  return (sums[b + 1] ?? 0) - (sums[a] ?? 0) === 0;
}

function allowed(p: Planner, j: number, from: number, to: number, move: number): boolean {
  const g = p.grid;
  if (g.blocked[(j + 1) * N + to] === 1) return false;
  const diagonal = (DC[move] ?? 0) !== 0 && (DR[move] ?? 0) !== 0;
  if (diagonal && (g.barrierRow[from] === 1 || g.barrierRow[to] === 1)) return false;
  const doorTo = g.doorOf[to] ?? -1;
  if (doorTo >= 0 && !openThrough(p, doorTo, sampleTicks * j + 1, sampleTicks * (j + 1) + 3)) return false;
  const doorFrom = g.doorOf[from] ?? -1;
  if (doorFrom >= 0 && !openThrough(p, doorFrom, sampleTicks * j - 2, sampleTicks * j + 4)) return false;
  return true;
}

interface Hit {
  layer: number;
  cell: number;
}

/** Earliest layer at which any goal cell can be reached from (startLayer, startCell). */
function search(p: Planner, startLayer: number, startCell: number, goals: readonly number[]): Hit | null {
  if (goals.includes(startCell)) return { layer: startLayer, cell: startCell };
  const { reach, parent } = p;
  reach.fill(0, startLayer * N);
  reach[startLayer * N + startCell] = 1;
  for (let j = startLayer; j < LAYERS - 1; j++) {
    const base = j * N;
    const next = (j + 1) * N;
    let any = false;
    for (let c = 0; c < N; c++) {
      if (reach[base + c] !== 1) continue;
      const col = c % COLS;
      const row = (c - col) / COLS;
      for (let m = 0; m < DC.length; m++) {
        const nc = col + (DC[m] ?? 0);
        const nr = row + (DR[m] ?? 0);
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        const to = nr * COLS + nc;
        if (reach[next + to] === 1 || !allowed(p, j, c, to, m)) continue;
        reach[next + to] = 1;
        parent[next + to] = m;
        any = true;
      }
    }
    if (!any) return null;
    for (const goal of goals) if (reach[next + goal] === 1) return { layer: j + 1, cell: goal };
  }
  return null;
}

/** The cells walked from (startLayer) to the hit, one per layer, inclusive of the hit. */
function walk(p: Planner, startLayer: number, hit: Hit): number[] {
  const cells: number[] = new Array<number>(hit.layer - startLayer + 1).fill(hit.cell);
  let col = hit.cell % COLS;
  let row = (hit.cell - col) / COLS;
  for (let j = hit.layer; j > startLayer; j--) {
    cells[j - startLayer] = row * COLS + col;
    const m = p.parent[j * N + row * COLS + col] ?? 0;
    col -= DC[m] ?? 0;
    row -= DR[m] ?? 0;
  }
  cells[0] = row * COLS + col;
  return cells;
}

/** One finger reading per layer: where to be at the start of the next layer. */
function toSamples(path: readonly number[]): Samples {
  const out: Samples = [];
  for (let j = 0; j < LAYERS; j++) {
    const cell = path[Math.min(LAYERS - 1, j + 1)] ?? path[j] ?? 0;
    const col = cell % COLS;
    out.push(cellCenterX(col), cellCenterY((cell - col) / COLS));
  }
  return out;
}

/** Plans one loop of the bot; null if it cannot make progress. */
function planLoop(p: Planner, arena: Arena, loopIndex: number, timeline: Timeline): number[] | null {
  const g = p.grid;
  const path: number[] = new Array<number>(LAYERS).fill(g.startCell);
  let layer = 0;
  let cell = g.startCell;
  const advance = (hit: Hit): void => {
    const cells = walk(p, layer, hit);
    cells.forEach((c, i) => {
      path[layer + i] = c;
    });
    layer = hit.layer;
    cell = hit.cell;
  };

  if (loopIndex < arena.gates.length) {
    // Serve a gate: go to its plate and stand there for the rest of the loop.
    const plate = g.plateCells[loopIndex];
    if (plate === undefined) return null;
    const hit = search(p, layer, cell, [plate]);
    if (hit === null) return null;
    advance(hit);
  } else {
    // Collect what the ghosts do not: nearest-in-time first.
    let remaining = g.orbCells.filter((_, i) => timeline.collected[i] !== true);
    let got = 0;
    while (remaining.length > 0) {
      const hit = search(p, layer, cell, remaining);
      if (hit === null) break;
      advance(hit);
      got += 1;
      const cx = cellCenterX(hit.cell % COLS);
      const cy = cellCenterY((hit.cell - (hit.cell % COLS)) / COLS);
      const r2 = CONFIG.orb.pickup * CONFIG.orb.pickup;
      remaining = remaining.filter((o) => {
        const ox = cellCenterX(o % COLS) - cx;
        const oy = cellCenterY((o - (o % COLS)) / COLS) - cy;
        return ox * ox + oy * oy >= r2;
      });
    }
    if (got === 0 && remaining.length > 0) return null;
  }
  for (let j = layer + 1; j < LAYERS; j++) path[j] = cell;
  return path;
}

/**
 * Solves an arena: the loops the bot would play to collect every orb at once. Returns null if it cannot
 * (the generator then tries another arena). The result is checked against the real rules.
 */
export function solveArena(arena: Arena, planningGrid: PlanningGrid = buildGrid(arena)): Solution | null {
  const ghosts: Samples[] = [];
  for (let loop = 0; loop < generator.botMaxLoops; loop++) {
    const timeline = ghostTimeline(arena, ghosts);
    const planner = makePlanner(planningGrid, timeline);
    const path = planLoop(planner, arena, loop, timeline);
    if (path === null) return null;
    const samples = toSamples(path);
    const verdict = verifyLoop(arena, ghosts, samples);
    if (!verdict.alive) return null;
    ghosts.push(samples);
    if (verdict.won) return { loops: ghosts, par: ghosts.length };
  }
  return null;
}
