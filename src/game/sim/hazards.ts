/**
 * What is dangerous where and when. Everything here is a pure function of the arena and the tick,
 * built only from + - * / % and square-free comparisons (no sin, cos, pow or hypot), so every browser
 * gets bit-for-bit the same answer and a recorded run replays identically on any device.
 */
import { CONFIG } from './config';
import type { Arena, Drifter, Gate, Pulsar } from './types';

const { grid } = CONFIG;

export const arenaLeft = grid.left;
export const arenaTop = grid.top;
export const arenaRight = grid.left + grid.cols * grid.cell;
export const arenaBottom = grid.top + grid.rows * grid.cell;
export const cellCount = grid.cols * grid.rows;

export const cellCenterX = (col: number): number => grid.left + col * grid.cell + grid.cell / 2;
export const cellCenterY = (row: number): number => grid.top + row * grid.cell + grid.cell / 2;
export const cellIndex = (col: number, row: number): number => row * grid.cols + col;
export const colOf = (x: number): number => Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.left) / grid.cell)));
export const rowOf = (y: number): number => Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.top) / grid.cell)));

/** The nearest cell centre (or the edge cell) to a point. */
export const cellAt = (x: number, y: number): number => cellIndex(colOf(x), rowOf(y));

const mod = (a: number, b: number): number => ((a % b) + b) % b;

/** A point moving at constant speed that bounces between lo and hi (a triangle wave). */
function fold(p0: number, v: number, t: number, lo: number, hi: number): number {
  const width = hi - lo;
  if (width <= 0) return lo;
  const m = mod(p0 - lo + v * t, 2 * width);
  return lo + (m <= width ? m : 2 * width - m);
}

export const drifterX = (d: Drifter, tick: number): number => fold(d.x0, d.vx, tick, d.minX, d.maxX);
export const drifterY = (d: Drifter, tick: number): number => fold(d.y0, d.vy, tick, d.minY, d.maxY);

const pulsarClock = (p: Pulsar, tick: number): number => mod(tick + p.phase, p.period);
export const pulsarActive = (p: Pulsar, tick: number): boolean => pulsarClock(p, tick) < p.on;
/** True shortly before a pulsar switches on, so players (and the picture) can see it coming. */
export const pulsarWarning = (p: Pulsar, tick: number): boolean => {
  const clock = pulsarClock(p, tick);
  return clock >= p.period - CONFIG.pulsar.warn && clock < p.period;
};

/** Is a circle at (x, y) with radius r touching this gate's wall? An open door only leaves its gap clear. */
export function gateLethal(gate: Gate, x: number, y: number, r: number, open: boolean): boolean {
  const reach = CONFIG.barrier.halfThickness + r;
  const dy = y - gate.y;
  if (dy >= reach || dy <= -reach) return false;
  return !open || x < gate.doorX0 || x > gate.doorX1;
}

/**
 * Would a circle of radius r at (x, y) be destroyed at this tick? `open[i]` says whether gate i is open.
 * `margin` widens the moving hazards (never the walls); only the bot uses it, to plan with room to spare.
 */
export function lethalAt(arena: Arena, tick: number, x: number, y: number, r: number, open: readonly boolean[], margin = 0): boolean {
  for (const d of arena.drifters) {
    const dx = x - drifterX(d, tick);
    const dy = y - drifterY(d, tick);
    const reach = d.r + r + margin;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  for (const p of arena.pulsars) {
    if (!pulsarActive(p, tick)) continue;
    const dx = x - p.x;
    const dy = y - p.y;
    const reach = p.r + r + margin;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  for (let i = 0; i < arena.gates.length; i++) {
    const gate = arena.gates[i];
    if (gate !== undefined && gateLethal(gate, x, y, r, open[i] === true)) return true;
  }
  return false;
}
