import type { Graphics } from 'pixi.js';
import { createRng, nextRange } from '../../engine/core/rng';
import { containsPoint, type FruitShape, type Vec } from '../sim';
import { FRUIT_COLORS, type FruitColors } from './palette';

/** Where and how large to draw a fruit. Unit-space shapes are multiplied by `radius`. */
export interface FruitPose {
  x: number;
  y: number;
  rotation: number;
  radius: number;
}

/** `whole`: the outside of the fruit, as you see it before cutting. `cut`: the inside, shown on a cut half. */
export type FruitView = 'whole' | 'cut';

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

const hashKind = (kind: string): number => [...kind].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

interface Stroke {
  width: number;
  color: number;
  alpha?: number;
}

/** Everything a fruit's drawing code needs, in unit space (the shape's own coordinates). */
interface Ctx {
  g: Graphics;
  shape: FruitShape;
  c: FruitColors;
  /** The skin outline, and slightly shrunken copies to place marks inside it. */
  outline: readonly Vec[];
  body: readonly Vec[];
  flesh: readonly Vec[];
  /** y of the top / bottom of the fruit at x = 0. */
  top: number;
  bottom: number;
  at(p: Vec): Vec;
  poly(points: readonly Vec[], fill: number, alpha?: number, stroke?: Stroke): void;
  dot(x: number, y: number, r: number, color: number, alpha?: number): void;
  line(a: Vec, b: Vec, width: number, color: number, alpha?: number): void;
  leaf(base: Vec, angle: number, length: number, width: number, color: number): void;
  star(center: Vec, outer: number, inner: number, points: number, rotation: number, color: number, alpha?: number): void;
  /** Random points inside a polygon (the same ones every time for a given kind). */
  scatter(poly: readonly Vec[], count: number, fn: (p: Vec, i: number) => void): void;
  /** Points around an ellipse. */
  ring(rx: number, ry: number, count: number, fn: (p: Vec, i: number) => void, phase?: number): void;
  rnd(min: number, max: number): number;
}

const shrink = (poly: readonly Vec[], k: number, dx = 0, dy = 0): Vec[] => poly.map((p) => ({ x: p.x * k + dx, y: p.y * k + dy }));

/** Lowest and highest y where the vertical line at `x` crosses the polygon, or null. */
function columnExtent(poly: readonly Vec[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    if (p.x > x !== q.x > x) {
      const y = p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Distance from the origin to the polygon's edge along `angle` (the polygon is star-shaped around the origin). */
function rayExtent(poly: readonly Vec[], angle: number): number {
  const d = { x: Math.cos(angle), y: Math.sin(angle) };
  let nearest = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const e = { x: q.x - p.x, y: q.y - p.y };
    const denom = d.x * e.y - d.y * e.x;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (p.x * e.y - p.y * e.x) / denom;
    const u = (p.x * d.y - p.y * d.x) / denom;
    if (t > 0 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
  }
  return Number.isFinite(nearest) ? nearest : 0.8;
}

/** Outward unit normal at vertex i of an outline centred on the origin. */
function outward(poly: readonly Vec[], i: number): Vec {
  const prev = poly[(i + poly.length - 1) % poly.length]!;
  const next = poly[(i + 1) % poly.length]!;
  const t = { x: next.x - prev.x, y: next.y - prev.y };
  const len = Math.hypot(t.x, t.y) || 1;
  const n = { x: t.y / len, y: -t.x / len };
  const p = poly[i]!;
  return n.x * p.x + n.y * p.y >= 0 ? n : { x: -n.x, y: -n.y };
}

function makeCtx(g: Graphics, shape: FruitShape, pose: FruitPose): Ctx {
  const c = FRUIT_COLORS[shape.kind] ?? FRUIT_COLORS['orange']!;
  const cos = Math.cos(pose.rotation) * pose.radius;
  const sin = Math.sin(pose.rotation) * pose.radius;
  const at = (p: Vec): Vec => ({ x: pose.x + p.x * cos - p.y * sin, y: pose.y + p.x * sin + p.y * cos });
  const flat = (pts: readonly Vec[]): number[] => pts.flatMap((p) => {
    const w = at(p);
    return [w.x, w.y];
  });
  const rng = createRng(0x9e3779b9 ^ hashKind(shape.kind));
  const rnd = (min: number, max: number): number => nextRange(rng, min, max);
  const extent = columnExtent(shape.outline, 0);
  const body = shrink(shape.outline, 0.9);

  const ctx: Ctx = {
    g,
    shape,
    c,
    outline: shape.outline,
    body,
    flesh: shape.inner,
    top: extent?.[0] ?? -0.9,
    bottom: extent?.[1] ?? 0.9,
    at,
    poly(points, fill, alpha = 1, stroke) {
      g.poly(flat(points)).fill({ color: fill, alpha });
      if (stroke) g.stroke({ width: stroke.width * pose.radius, color: stroke.color, alpha: stroke.alpha ?? 1, join: 'round' });
    },
    dot(x, y, r, color, alpha = 1) {
      const w = at({ x, y });
      g.circle(w.x, w.y, r * pose.radius).fill({ color, alpha });
    },
    line(a, b, width, color, alpha = 1) {
      const p = at(a);
      const q = at(b);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: Math.max(0.8, width * pose.radius), color, alpha, cap: 'round' });
    },
    leaf(base, angle, length, width, color) {
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const perp = { x: -dir.y, y: dir.x };
      const mid = { x: base.x + dir.x * length * 0.5, y: base.y + dir.y * length * 0.5 };
      ctx.poly(
        [
          base,
          { x: mid.x + perp.x * width, y: mid.y + perp.y * width },
          { x: base.x + dir.x * length, y: base.y + dir.y * length },
          { x: mid.x - perp.x * width, y: mid.y - perp.y * width },
        ],
        color,
      );
    },
    star(center, outer, inner, points, rotation, color, alpha = 1) {
      const pts: Vec[] = [];
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = rotation + (Math.PI * i) / points;
        pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
      }
      ctx.poly(pts, color, alpha);
    },
    scatter(poly, count, fn) {
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 12; tries++) {
        const p = { x: rnd(-1, 1), y: rnd(-1, 1) };
        if (containsPoint(poly, p)) fn(p, placed++);
      }
    },
    ring(rx, ry, count, fn, phase = 0) {
      for (let i = 0; i < count; i++) {
        const a = phase + (TAU * i) / count;
        fn({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }, i);
      }
    },
    rnd,
  };
  return ctx;
}

// ---- the outside of each fruit ----------------------------------------------------------------

function drawOutside(k: Ctx, pose: FruitPose): void {
  const { c, shape } = k;
  const rim = Math.max(1.5, pose.radius * 0.035);
  const wide = shape.outline;

  // Skin with a darker edge, then a soft lighter patch so it reads as round.
  k.g.poly(k.outline.flatMap((p) => { const w = k.at(p); return [w.x, w.y]; })).fill(c.skin).stroke({ width: rim, color: c.skinDark, join: 'round' });
  if (shape.kind === 'banana') k.poly(k.flesh, c.skinLight, 0.5);
  else if (shape.kind === 'starfruit') k.poly(shrink(wide, 0.78), c.skinLight, 0.25);
  else k.poly(shrink(wide, 0.82, -0.03, -0.04), c.skinLight, 0.26);

  const stem = (): void => {
    const base = { x: 0, y: k.top + 0.03 };
    k.line(base, { x: 0.05, y: k.top - 0.2 }, 0.05, 0x5a3d1a);
  };

  switch (shape.kind) {
    case 'orange':
      k.scatter(k.body, 38, (p) => k.dot(p.x, p.y, 0.012, c.skinDark, 0.5));
      k.dot(0, k.top + 0.07, 0.05, c.accent);
      break;
    case 'apple':
      stem();
      k.leaf({ x: 0.05, y: k.top - 0.12 }, -0.35, 0.3, 0.07, c.accent);
      break;
    case 'watermelon':
      for (const x0 of [-0.78, -0.54, -0.3, -0.06, 0.18, 0.42, 0.66]) {
        const e = columnExtent(wide, x0);
        if (!e) continue;
        const [lo, hi] = [e[0] + 0.05, e[1] - 0.05];
        const bow = x0 * 1.07;
        k.line({ x: x0, y: lo }, { x: bow, y: lo + (hi - lo) * 0.35 }, 0.065, c.skinDark, 0.65);
        k.line({ x: bow, y: lo + (hi - lo) * 0.35 }, { x: bow, y: lo + (hi - lo) * 0.65 }, 0.065, c.skinDark, 0.65);
        k.line({ x: bow, y: lo + (hi - lo) * 0.65 }, { x: x0, y: hi }, 0.065, c.skinDark, 0.65);
      }
      break;
    case 'lemon': {
      const left = wide.reduce((a, b) => (b.x < a.x ? b : a));
      const right = wide.reduce((a, b) => (b.x > a.x ? b : a));
      k.dot(left.x * 0.96, left.y, 0.05, c.skinLight);
      k.dot(right.x * 0.96, right.y, 0.05, c.skinLight);
      k.scatter(k.body, 40, (p) => k.dot(p.x, p.y, 0.011, c.skinDark, 0.4));
      break;
    }
    case 'pear':
      k.scatter(k.body, 28, (p) => k.dot(p.x, p.y, 0.014, c.detail, 0.55));
      stem();
      k.leaf({ x: 0.05, y: k.top - 0.1 }, -0.4, 0.28, 0.065, c.accent);
      break;
    case 'banana': {
      k.poly(k.flesh, c.skinDark, 0, { width: 0.02, color: c.skinDark, alpha: 0.45 });
      const left = wide.reduce((a, b) => (b.x < a.x ? b : a));
      const right = wide.reduce((a, b) => (b.x > a.x ? b : a));
      k.dot(left.x, left.y, 0.045, c.detail);
      k.dot(right.x, right.y, 0.05, c.detail);
      break;
    }
    case 'kiwi':
      k.scatter(k.body, 80, (p) => {
        const a = k.rnd(0, TAU);
        k.line(p, { x: p.x + Math.cos(a) * 0.05, y: p.y + Math.sin(a) * 0.05 }, 0.012, c.skinLight, 0.55);
      });
      break;
    case 'dragonfruit':
      for (let i = 0; i < wide.length; i += Math.floor(wide.length / 14)) {
        const p = wide[i]!;
        const n = outward(wide, i);
        k.leaf({ x: p.x * 0.97, y: p.y * 0.97 }, Math.atan2(n.y, n.x) + 0.45, 0.2, 0.06, c.accent);
      }
      break;
    case 'pineapple': {
      for (let row = 0, y = -1.1; y < 1.1; y += 0.2, row++) {
        for (let x = -1 + (row % 2) * 0.11; x < 1; x += 0.22) {
          if (!containsPoint(k.body, { x, y })) continue;
          k.poly([{ x, y: y - 0.085 }, { x: x + 0.075, y }, { x, y: y + 0.085 }, { x: x - 0.075, y }], c.skinLight, 0.5, { width: 0.012, color: c.skinDark, alpha: 0.7 });
        }
      }
      for (let i = 0; i < 7; i++) {
        const spread = i - 3;
        k.leaf({ x: spread * 0.05, y: k.top + 0.05 }, TOP + spread * 0.3, 0.4 - Math.abs(spread) * 0.04, 0.07, c.accent);
      }
      break;
    }
    case 'mango':
      for (const edge of [0.0, 0.2, 0.4, 0.6]) k.poly(shrink(wide.filter((p) => p.x > edge), 0.92), c.detail, 0.13);
      k.dot(0, k.top + 0.06, 0.04, c.skinDark, 0.8);
      break;
    case 'starfruit':
      k.ring(0.93, 0.93, 5, (p) => {
        k.line({ x: 0, y: 0 }, { x: p.x * 0.9, y: p.y * 0.9 }, 0.02, c.skinDark, 0.45);
        k.dot(p.x * 0.93, p.y * 0.93, 0.025, c.detail, 0.6);
      }, TOP);
      break;
    case 'pomegranate':
      k.scatter(k.body, 26, (p) => k.dot(p.x, p.y, 0.014, c.skinDark, 0.45));
      k.star({ x: 0, y: k.top + 0.05 }, 0.2, 0.08, 6, TOP, c.accent);
      k.dot(0, k.top + 0.06, 0.05, c.skinDark);
      break;
    case 'passionfruit':
      k.scatter(k.body, 54, (p) => k.dot(p.x, p.y, 0.012, c.skinLight, 0.55));
      k.dot(0, k.top + 0.05, 0.04, c.accent);
      break;
    case 'avocado':
      k.scatter(k.body, 64, (p) => k.dot(p.x, p.y, 0.02, c.skinLight, 0.2));
      stem();
      break;
    case 'papaya':
      k.scatter(k.body, 7, (p) => k.dot(p.x, p.y, k.rnd(0.07, 0.13), c.accent, 0.38));
      stem();
      break;
    case 'lychee':
      for (let row = 0, y = -1; y < 1; y += 0.15, row++) {
        for (let x = -1 + (row % 2) * 0.075; x < 1; x += 0.15) {
          if (!containsPoint(k.body, { x, y })) continue;
          k.dot(x, y, 0.055, c.skinDark, 0.22);
          k.dot(x - 0.012, y - 0.012, 0.035, c.skinLight, 0.35);
        }
      }
      k.dot(0, k.top + 0.05, 0.04, c.accent);
      break;
    case 'coconut':
      k.scatter(k.body, 100, (p) => {
        const a = k.rnd(0, TAU);
        k.line(p, { x: p.x + Math.cos(a) * 0.07, y: p.y + Math.sin(a) * 0.07 }, 0.014, c.skinDark, 0.55);
      });
      for (const [x, y] of [[-0.14, -0.48], [0.14, -0.48], [0, -0.33]] as const) {
        k.dot(x, y, 0.07, c.skinDark);
        k.dot(x, y, 0.035, 0x1a0f08);
      }
      break;
    case 'strawberry':
      k.scatter(k.body, 38, (p) => k.dot(p.x, p.y, 0.017, c.detail, 0.95));
      for (let i = 0; i < 6; i++) k.leaf({ x: 0, y: k.top + 0.06 }, TOP + (i - 2.5) * 0.5, 0.3, 0.08, c.accent);
      break;
    case 'persimmon':
      k.star({ x: 0, y: k.top + 0.06 }, 0.28, 0.1, 4, TOP + Math.PI / 4, c.accent);
      k.dot(0, k.top, 0.04, 0x5a3d1a);
      break;
  }

  // A glossy highlight.
  if (shape.kind !== 'banana' && shape.kind !== 'coconut' && shape.kind !== 'kiwi' && shape.kind !== 'pineapple') {
    const h = k.at({ x: -0.38, y: -0.4 });
    k.g.ellipse(h.x, h.y, pose.radius * 0.16, pose.radius * 0.08).fill({ color: 0xffffff, alpha: 0.24 });
  }
}

// ---- the inside of each fruit -----------------------------------------------------------------

function drawInside(k: Ctx, pose: FruitPose): void {
  const { c, shape } = k;
  const rim = Math.max(1.5, pose.radius * 0.035);
  const kind = shape.kind;

  k.g.poly(k.outline.flatMap((p) => { const w = k.at(p); return [w.x, w.y]; })).fill(c.skin).stroke({ width: rim, color: c.skinDark, join: 'round' });

  // The layer between skin and flesh.
  if (kind === 'watermelon') k.poly(shrink(k.outline, 0.94), c.accent);
  else if (kind === 'orange') k.poly(shrink(k.outline, 0.95), 0xf3deb0);
  else if (kind === 'lemon') k.poly(shrink(k.outline, 0.95), 0xe6d89c);
  else if (kind === 'passionfruit') k.poly(shrink(k.outline, 0.94), c.accent);
  else if (kind === 'avocado') k.poly(shrink(k.outline, 0.95), c.accent);

  k.poly(k.flesh, c.flesh);
  if (kind !== 'coconut') k.poly(shrink(k.flesh, 0.7), c.fleshLight, 0.3);

  /** Lines out from the middle, as fractions of the way to the edge of the flesh in each direction. */
  const spokes = (n: number, from: number, to: number, color: number, alpha: number, width = 0.018, phase = 0.2): void => {
    for (let i = 0; i < n; i++) {
      const a = phase + (TAU * i) / n;
      const reach = rayExtent(k.flesh, a);
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      k.line({ x: dir.x * reach * from, y: dir.y * reach * from }, { x: dir.x * reach * to, y: dir.y * reach * to }, width, color, alpha);
    }
  };
  /** Points around the middle at a fraction of the way to the edge of the flesh. */
  const edgeRing = (n: number, fraction: number, fn: (p: Vec, i: number) => void, phase = 0): void => {
    for (let i = 0; i < n; i++) {
      const a = phase + (TAU * i) / n;
      const reach = rayExtent(k.flesh, a) * fraction;
      fn({ x: Math.cos(a) * reach, y: Math.sin(a) * reach }, i);
    }
  };

  switch (kind) {
    case 'orange':
    case 'lemon':
      spokes(8, 0.1, 0.86, c.detail, 0.7);
      k.dot(0, 0, 0.05, c.detail, 0.9);
      break;
    case 'apple':
      k.ring(0.13, 0.13, 5, (p) => k.dot(p.x, p.y, 0.036, c.detail), TOP);
      k.g.circle(k.at({ x: 0, y: 0 }).x, k.at({ x: 0, y: 0 }).y, 0.22 * pose.radius).stroke({ width: 1.4, color: c.skinDark, alpha: 0.25 });
      break;
    case 'watermelon':
      k.scatter(shrink(k.flesh, 0.85), 13, (p) => k.dot(p.x, p.y, 0.032, c.detail));
      break;
    case 'pear':
      k.g.ellipse(k.at({ x: 0, y: 0.12 }).x, k.at({ x: 0, y: 0.12 }).y, 0.13 * pose.radius, 0.2 * pose.radius).stroke({ width: 1.4, color: c.skinDark, alpha: 0.25 });
      k.dot(-0.04, 0.16, 0.028, c.detail);
      k.dot(0.04, 0.2, 0.028, c.detail);
      break;
    case 'banana': {
      const middle = k.flesh.filter((p) => Math.abs(p.x) < 0.12);
      const my = middle.reduce((s, p) => s + p.y, 0) / Math.max(1, middle.length);
      for (const dx of [-0.12, 0, 0.12]) k.dot(dx, my, 0.02, c.detail);
      break;
    }
    case 'kiwi':
      spokes(26, 0.22, 0.8, c.fleshLight, 0.5, 0.014);
      edgeRing(20, 0.58, (p) => k.dot(p.x, p.y, 0.02, c.detail));
      k.g.ellipse(k.at({ x: 0, y: 0 }).x, k.at({ x: 0, y: 0 }).y, 0.2 * pose.radius, 0.17 * pose.radius).fill({ color: c.accent, alpha: 0.95 });
      break;
    case 'dragonfruit':
      k.scatter(shrink(k.flesh, 0.93), 110, (p) => k.dot(p.x, p.y, 0.011, c.detail));
      break;
    case 'pineapple':
      spokes(16, 0.28, 0.88, c.fleshLight, 0.55, 0.016);
      k.dot(0, 0, 0.16, c.fleshLight, 0.45);
      edgeRing(16, 0.9, (p) => k.dot(p.x, p.y, 0.022, c.detail, 0.8));
      break;
    case 'mango':
      k.poly(shrink(k.flesh, 0.55), c.accent, 0.85, { width: 0.014, color: c.fleshLight, alpha: 0.7 });
      break;
    case 'starfruit':
      k.ring(1, 1, 5, (p) => k.line({ x: 0, y: 0 }, { x: p.x * 0.78, y: p.y * 0.78 }, 0.016, c.fleshLight, 0.7), TOP);
      k.ring(0.2, 0.2, 5, (p) => k.dot(p.x, p.y, 0.022, c.detail), TOP + 0.6);
      break;
    case 'pomegranate':
      spokes(6, 0.05, 0.96, 0xe9dcc9, 1, 0.022, 0.3);
      k.scatter(shrink(k.flesh, 0.88), 78, (p) => {
        k.dot(p.x, p.y, 0.052, c.detail);
        k.dot(p.x - 0.014, p.y - 0.016, 0.018, 0xff8a9a, 0.9);
      });
      break;
    case 'passionfruit':
      k.scatter(shrink(k.flesh, 0.9), 26, (p) => {
        k.dot(p.x, p.y, 0.055, c.fleshLight, 0.55);
        k.dot(p.x, p.y, 0.028, c.detail);
      });
      break;
    case 'avocado':
      k.dot(0, 0.1, 0.28, c.detail);
      k.dot(-0.09, 0.03, 0.07, 0xb08050, 0.6);
      break;
    case 'papaya':
      k.poly(shrink(k.flesh, 0.4), 0xffc9a8, 0.55);
      k.scatter(shrink(k.flesh, 0.38), 26, (p) => k.dot(p.x, p.y, 0.03, c.detail));
      break;
    case 'lychee':
      k.dot(0, 0.05, 0.27, c.detail);
      k.dot(-0.08, -0.04, 0.07, 0xc08a6a, 0.8);
      break;
    case 'coconut':
      k.dot(0, 0, 0.45, c.detail, 0.9);
      k.dot(-0.12, -0.14, 0.09, 0xffffff, 0.45);
      break;
    case 'strawberry':
      spokes(10, 0.3, 0.9, c.fleshLight, 0.7, 0.02);
      k.dot(0, 0, 0.2, 0xfff0f2, 0.88);
      edgeRing(18, 0.9, (p) => k.dot(p.x, p.y, 0.017, c.detail));
      break;
    case 'persimmon':
      spokes(8, 0.1, 0.86, c.fleshLight, 0.5, 0.016, 0.4);
      k.ring(0.26, 0.2, 4, (p) => { k.dot(p.x, p.y, 0.05, c.detail); k.dot(p.x * 1.18, p.y * 1.18, 0.035, c.detail); }, 0.4);
      break;
  }
}

/**
 * Draws a fruit into `g`. `whole` is the outside (skin, stem, crown, pores), what you see until you
 * cut it; `cut` is the inside (rind, flesh, seeds), shown on the two halves. Everything is built
 * from the shape's unit-space outline, so the picture is exactly the polygon the cut is measured against.
 */
export function drawFruit(g: Graphics, shape: FruitShape, pose: FruitPose, view: FruitView = 'whole'): void {
  g.clear();
  const ctx = makeCtx(g, shape, pose);
  if (view === 'whole') drawOutside(ctx, pose);
  else drawInside(ctx, pose);
}
