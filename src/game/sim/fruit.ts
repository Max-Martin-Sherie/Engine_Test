import { nextFloat, nextRange, type RngState } from '../../engine/core/rng';
import { boundingRadius, centroid, scale, translate, type Polygon, type Vec } from './geometry';

export type FruitKind =
  | 'orange'
  | 'apple'
  | 'watermelon'
  | 'lemon'
  | 'pear'
  | 'banana'
  | 'kiwi'
  | 'dragonfruit'
  | 'pineapple'
  | 'mango'
  | 'starfruit'
  | 'pomegranate'
  | 'passionfruit'
  | 'avocado'
  | 'papaya'
  | 'lychee'
  | 'coconut'
  | 'strawberry'
  | 'persimmon';

export const FRUIT_KINDS: readonly FruitKind[] = [
  'orange', 'apple', 'watermelon', 'lemon', 'pear', 'banana',
  'kiwi', 'dragonfruit', 'pineapple', 'mango', 'starfruit', 'pomegranate',
  'passionfruit', 'avocado', 'papaya', 'lychee', 'coconut', 'strawberry', 'persimmon',
];

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
const TOP = -Math.PI / 2; // y points down, so the top of a fruit is at -PI/2
const BOTTOM = Math.PI / 2;
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

/** Points on a closed curve given by radius as a function of angle. */
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

/**
 * Squeezes a unit-ish circle so it is narrower at one end: x is scaled by a width that runs from
 * `top` to `bottom`, and y by `stretch`. Squeezing x by a positive factor keeps a simple polygon simple.
 */
const taper =
  (top: number, bottom: number, stretch: number) =>
  (p: Vec): Vec => {
    const t = Math.min(1, Math.max(0, (p.y + 1) / 2)); // 0 at the top, 1 at the bottom
    return { x: p.x * (top + (bottom - top) * Math.pow(t, 1.3)), y: p.y * stretch };
  };

/** How a roundish fruit is built: a radius curve, how stretched it is, an optional squeeze, and how thick the skin is. */
interface RadialSpec {
  wobble: number;
  ax: number;
  ay: number;
  radius: (theta: number) => number;
  map?: (p: Vec) => Vec;
  /** Flesh size as a fraction of the skin outline. */
  flesh: number;
}

const dimple = (angle: number, depth: number, sigma = 0.3) => (t: number): number => 1 - depth * gauss(angleDiff(t, angle), sigma);

function radialSpec(kind: Exclude<FruitKind, 'banana'>, rng: RngState): RadialSpec {
  const jitter = nextRange(rng, -0.05, 0.05);
  const round = (): number => 1;
  switch (kind) {
    case 'orange':
      return { wobble: 0.025, ax: 1, ay: 1, radius: round, flesh: 0.9 };
    case 'apple': {
      const top = dimple(TOP, 0.2);
      const bottom = dimple(BOTTOM, 0.06);
      return { wobble: 0.04, ax: 1, ay: 0.94, radius: (t) => top(t) * bottom(t), flesh: 0.9 };
    }
    case 'watermelon':
      return { wobble: 0.04, ax: 1.3 + jitter, ay: 0.92, radius: round, flesh: 0.9 };
    case 'lemon':
      return {
        wobble: 0.04,
        ax: 1.2 + jitter,
        ay: 0.82,
        radius: (t) => 1 + 0.16 * gauss(angleDiff(t, 0), 0.2) + 0.16 * gauss(angleDiff(t, Math.PI), 0.2),
        flesh: 0.9,
      };
    case 'pear':
      return { wobble: 0.04, ax: 1, ay: 1, radius: round, map: taper(0.5, 1.08, 1.12), flesh: 0.9 };
    case 'kiwi':
      return { wobble: 0.04, ax: 1.12 + jitter, ay: 0.92, radius: round, flesh: 0.88 };
    case 'dragonfruit':
      return { wobble: 0.035, ax: 1.2 + jitter, ay: 0.9, radius: round, flesh: 0.9 };
    case 'pineapple':
      return { wobble: 0.03, ax: 0.78 + jitter / 2, ay: 1.12, radius: round, flesh: 0.88 };
    case 'mango': {
      const dent = dimple(BOTTOM, 0.17, 0.5);
      return { wobble: 0.04, ax: 1.22 + jitter, ay: 0.86, radius: dent, flesh: 0.9 };
    }
    case 'starfruit':
      // A five-pointed star with a point straight up: concave between the points.
      return {
        wobble: 0.03,
        ax: 1,
        ay: 1,
        radius: (t) => 0.58 + 0.42 * Math.pow((1 + Math.cos(5 * (t - TOP))) / 2, 0.75),
        flesh: 0.84,
      };
    case 'pomegranate': {
      const crown = (t: number): number => 1 + 0.07 * gauss(angleDiff(t, TOP), 0.22);
      return { wobble: 0.03, ax: 1, ay: 0.96, radius: crown, flesh: 0.88 };
    }
    case 'passionfruit':
      return { wobble: 0.02, ax: 1.05, ay: 0.97, radius: round, flesh: 0.86 };
    case 'avocado':
      return { wobble: 0.03, ax: 1, ay: 1, radius: round, map: taper(0.62, 1.02, 1.22), flesh: 0.9 };
    case 'papaya':
      return { wobble: 0.03, ax: 0.8, ay: 1, radius: round, map: taper(0.58, 1.05, 1.32), flesh: 0.9 };
    case 'lychee': {
      const phase = nextRange(rng, 0, TAU);
      return { wobble: 0.025, ax: 1, ay: 1, radius: (t) => 1 + 0.035 * Math.cos(14 * t + phase), flesh: 0.88 };
    }
    case 'coconut':
      return { wobble: 0.025, ax: 1, ay: 0.98, radius: round, flesh: 0.84 };
    case 'strawberry': {
      const top = dimple(TOP, 0.1, 0.35);
      return { wobble: 0.03, ax: 1, ay: 1, radius: top, map: taper(1.04, 0.5, 1.08), flesh: 0.9 };
    }
    case 'persimmon': {
      const top = dimple(TOP, 0.06);
      return { wobble: 0.025, ax: 1.08 + jitter / 2, ay: 0.88, radius: top, flesh: 0.9 };
    }
  }
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
    const spec = radialSpec(kind, rng);
    const wobble = makeWobble(rng, spec.wobble);
    outline = radial(segments, (t) => spec.radius(t) * wobbleAt(wobble, t), spec.ax, spec.ay);
    if (spec.map) outline = outline.map(spec.map);
    inner = outline.map((p) => ({ x: p.x * spec.flesh, y: p.y * spec.flesh }));
  }

  return { kind, ...normalize(outline, inner) };
}

/** Picks a kind from `kinds` using the seeded RNG. */
export function pickKind(kinds: readonly FruitKind[], rng: RngState): FruitKind {
  return kinds[Math.min(kinds.length - 1, Math.floor(nextFloat(rng) * kinds.length))] ?? 'orange';
}
