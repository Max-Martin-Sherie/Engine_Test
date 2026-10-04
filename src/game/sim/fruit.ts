import { nextFloat, nextRange, type RngState } from '../../engine/core/rng';
import { boundingRadius, centroid, scale, translate, type Polygon, type Vec } from './geometry';

export type FruitKind = 'orange' | 'apple' | 'watermelon' | 'lemon' | 'pear' | 'banana';

export const FRUIT_KINDS: readonly FruitKind[] = ['orange', 'apple', 'watermelon', 'lemon', 'pear', 'banana'];

/**
 * A fruit's silhouette, centred on its centroid and scaled so the farthest point is at distance 1.
 * `inner` is the flesh, drawn inside the skin. Multiply by a radius to get world units.
 */
export interface FruitShape {
  kind: FruitKind;
  outline: Vec[];
  inner: Vec[];
}

const TAU = Math.PI * 2;
const gauss = (x: number, sigma: number): number => Math.exp(-(x * x) / (2 * sigma * sigma));

/** Smallest signed difference between two angles. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

interface Wobble {
  a1: number;
  p1: number;
  a2: number;
  p2: number;
}

/** A smooth, seeded deviation so no two fruit are identical. */
function makeWobble(rng: RngState, strength: number): Wobble {
  return {
    a1: nextRange(rng, 0, strength),
    p1: nextRange(rng, 0, TAU),
    a2: nextRange(rng, 0, strength * 0.7),
    p2: nextRange(rng, 0, TAU),
  };
}

const wobbleAt = (w: Wobble, theta: number): number => 1 + w.a1 * Math.cos(theta + w.p1) + w.a2 * Math.cos(2 * theta + w.p2);

/** Points on a closed curve given by radius as a function of angle. y points down, so the top is -PI/2. */
function radial(segments: number, radius: (theta: number) => number, ax: number, ay: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (TAU * i) / segments;
    const r = radius(theta);
    pts.push({ x: Math.cos(theta) * r * ax, y: Math.sin(theta) * r * ay });
  }
  return pts;
}

/** A crescent: an arc of half-width `w(t)` around a curve, pointed at both ends. */
function crescent(segments: number, sweep: number, width: number): Vec[] {
  const steps = Math.floor(segments / 2);
  const outer: Vec[] = [];
  const innerSide: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const phi = -sweep + 2 * sweep * t;
    const w = width * Math.pow(Math.sin(Math.PI * t), 0.55);
    const n = { x: Math.sin(phi), y: Math.cos(phi) };
    outer.push({ x: n.x * (1 + w), y: n.y * (1 + w) });
    innerSide.push({ x: n.x * (1 - w), y: n.y * (1 - w) });
  }
  return [...outer, ...innerSide.reverse().slice(1, -1)];
}

/** Moves the shape's centroid to the origin and scales it so its farthest point is at distance 1. */
function normalize(outline: Polygon, inner: Polygon): { outline: Vec[]; inner: Vec[] } {
  const c = centroid(outline);
  const moved = translate(outline, -c.x, -c.y);
  const k = 1 / boundingRadius(moved);
  return { outline: scale(moved, k), inner: scale(translate(inner, -c.x, -c.y), k) };
}

export function makeFruitShape(kind: FruitKind, rng: RngState, segments: number): FruitShape {
  let outline: Vec[];
  let inner: Vec[];

  if (kind === 'banana') {
    const sweep = 0.95 + nextRange(rng, -0.1, 0.1);
    const width = 0.23 + nextRange(rng, -0.02, 0.03);
    outline = crescent(segments, sweep, width);
    // A bit shorter and slimmer, so the peel shows at the tips instead of the flesh touching them.
    inner = crescent(segments, sweep * 0.92, width * 0.62);
  } else {
    const wobble = makeWobble(rng, kind === 'orange' ? 0.025 : 0.04);
    const aspect = nextRange(rng, -0.05, 0.05);
    let radius: (theta: number) => number;
    let ax = 1;
    let ay = 1;
    if (kind === 'orange') {
      radius = (t) => wobbleAt(wobble, t);
    } else if (kind === 'apple') {
      ay = 0.94;
      radius = (t) => wobbleAt(wobble, t) * (1 - 0.2 * gauss(angleDiff(t, -Math.PI / 2), 0.3) - 0.06 * gauss(angleDiff(t, Math.PI / 2), 0.3));
    } else if (kind === 'watermelon') {
      ax = 1.3 + aspect;
      ay = 0.92;
      radius = (t) => wobbleAt(wobble, t);
    } else if (kind === 'lemon') {
      ax = 1.2 + aspect;
      ay = 0.82;
      radius = (t) => wobbleAt(wobble, t) * (1 + 0.16 * gauss(angleDiff(t, 0), 0.2) + 0.16 * gauss(angleDiff(t, Math.PI), 0.2));
    } else {
      // pear: a circle squeezed narrow at the top (a homeomorphism, so it stays a simple polygon)
      radius = (t) => wobbleAt(wobble, t);
    }
    outline = radial(segments, radius, ax, ay);
    if (kind === 'pear') {
      outline = outline.map((p) => {
        const t = (p.y + 1) / 2; // 0 at the top, 1 at the bottom
        return { x: p.x * (0.5 + 0.58 * Math.pow(Math.max(t, 0), 1.4)), y: p.y * 1.12 };
      });
    }
    inner = outline.map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }));
  }

  const shape = normalize(outline, inner);
  return { kind, ...shape };
}

/** Picks a kind from `kinds` using the seeded RNG. */
export function pickKind(kinds: readonly FruitKind[], rng: RngState): FruitKind {
  return kinds[Math.min(kinds.length - 1, Math.floor(nextFloat(rng) * kinds.length))] ?? 'orange';
}
