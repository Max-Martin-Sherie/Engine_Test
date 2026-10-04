export interface Vec {
  x: number;
  y: number;
}

/** A simple polygon (no self-intersections), any winding. */
export type Polygon = readonly Vec[];

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec): number => Math.hypot(a.x, a.y);

export function signedArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export function area(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: Polygon): Vec {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const w = p.x * q.y - q.x * p.y;
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (a === 0) return { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Largest distance from the origin to any vertex. */
export function boundingRadius(poly: Polygon): number {
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p.x, p.y));
  return r;
}

export function translate(poly: Polygon, dx: number, dy: number): Vec[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function scale(poly: Polygon, factor: number): Vec[] {
  return poly.map((p) => ({ x: p.x * factor, y: p.y * factor }));
}

/** Rotates by `angle` radians, scales, then moves to (x, y). */
export function place(poly: Polygon, x: number, y: number, angle: number, factor = 1): Vec[] {
  const cos = Math.cos(angle) * factor;
  const sin = Math.sin(angle) * factor;
  return poly.map((p) => ({ x: x + p.x * cos - p.y * sin, y: y + p.x * sin + p.y * cos }));
}

/** Even-odd point-in-polygon test. */
export function containsPoint(poly: Polygon, point: Vec): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[i]!;
    const q = poly[j]!;
    if (p.y > point.y !== q.y > point.y && point.x < ((q.x - p.x) * (point.y - p.y)) / (q.y - p.y) + p.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Signed distance of `p` from the infinite line through a and b: positive on the left of a -> b
 * (in a y-down world that is the visually "right"; only consistency matters).
 */
export function sideOf(a: Vec, b: Vec, p: Vec): number {
  const d = sub(b, a);
  const n = length(d);
  return n === 0 ? 0 : cross(d, sub(p, a)) / n;
}

/**
 * Where the infinite line a -> b crosses the polygon's edges, as parameters t along the line
 * (t = 0 at a, t = 1 at b). A vertex lying exactly on the line counts as being on the positive
 * side, so it is counted once consistently.
 */
export function lineCrossings(poly: Polygon, a: Vec, b: Vec): number[] {
  const d = sub(b, a);
  const len2 = dot(d, d);
  const ts: number[] = [];
  if (len2 === 0) return ts;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dp = sideOf(a, b, p);
    const dq = sideOf(a, b, q);
    if (dp >= 0 !== dq >= 0) {
      const s = dp / (dp - dq);
      const hit = { x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s };
      ts.push(dot(sub(hit, a), d) / len2);
    }
  }
  return ts;
}

/**
 * The part of the polygon on one side of the line a -> b (Sutherland-Hodgman). Works for concave
 * polygons too; when several pieces end up on one side they are joined by zero-width bridges
 * along the line, which does not change the area.
 */
export function clipToSide(poly: Polygon, a: Vec, b: Vec, side: 1 | -1): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dp = side * sideOf(a, b, p);
    const dq = side * sideOf(a, b, q);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const s = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s });
    }
  }
  return out;
}

/** Areas on each side of the line a -> b. */
export function splitAreas(poly: Polygon, a: Vec, b: Vec): { left: number; right: number } {
  return {
    left: area(clipToSide(poly, a, b, 1)),
    right: area(clipToSide(poly, a, b, -1)),
  };
}

/**
 * The line at `angle` (radians) that splits the polygon into two equal areas, as two points far
 * enough out that a drag between them fully crosses the polygon. Found by bisection, so it works
 * for any shape, concave ones included. Used by tests and tooling to make a perfect cut.
 * `spread` scales how far the endpoints sit from the fruit: 1 puts them just outside it (handy for
 * an on-screen drag), the default 3 is generously far.
 */
export function bisectingLine(poly: Polygon, angle: number, margin = 30, spread = 3): { a: Vec; b: Vec } {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const c = centroid(poly); // measure from the polygon itself, wherever it sits in the world
  let reach = 0;
  for (const p of poly) {
    const rel = sub(p, c);
    reach = Math.max(reach, Math.abs(dot(rel, normal)), Math.abs(dot(rel, dir)));
  }
  reach += margin;
  const through = (offset: number): { a: Vec; b: Vec } => {
    const o = { x: c.x + normal.x * offset, y: c.y + normal.y * offset };
    const far = reach * spread;
    return {
      a: { x: o.x - dir.x * far, y: o.y - dir.y * far },
      b: { x: o.x + dir.x * far, y: o.y + dir.y * far },
    };
  };
  const diff = (offset: number): number => {
    const { a, b } = through(offset);
    const s = splitAreas(poly, a, b);
    return s.left - s.right;
  };
  let lo = -reach;
  let hi = reach;
  const sign = Math.sign(diff(lo)) || 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(diff(mid)) === sign) lo = mid;
    else hi = mid;
  }
  return through((lo + hi) / 2);
}
