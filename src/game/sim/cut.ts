import { containsPoint, lineCrossings, splitAreas, type Polygon, type Vec } from './geometry';
import { length, sub } from './geometry';

/**
 * Why a drag did not count as a cut (it costs nothing in Classic):
 *  - short:   barely moved, probably a tap
 *  - miss:    the line does not touch the fruit
 *  - partial: the line touches it but the drag did not go fully across (it started or stopped
 *             on the fruit, or stopped before the far edge)
 */
export type CancelReason = 'short' | 'miss' | 'partial';

export type CutEvaluation =
  | { kind: 'cancel'; reason: CancelReason }
  | {
      kind: 'cut';
      /** Fraction (0..1) of the fruit's area on one side of the line; the other side is 1 - this. */
      fraction: number;
      /** Distance from a perfect 50/50, in percentage points (0 = perfect, 50 = nothing on one side). */
      deviation: number;
    };

/**
 * Judges a drag from `a` to `b` against a fruit. A cut needs the drag to go fully across: both
 * ends outside the fruit and every point where the line crosses the fruit's edge inside the drag.
 * The fruit is then split by the infinite line through a and b and the two sides' areas compared.
 */
export function evaluateCut(fruit: Polygon, a: Vec, b: Vec, minLength: number): CutEvaluation {
  if (length(sub(b, a)) < minLength) return { kind: 'cancel', reason: 'short' };

  const crossings = lineCrossings(fruit, a, b);
  if (crossings.length < 2) return { kind: 'cancel', reason: 'miss' };

  const first = Math.min(...crossings);
  const last = Math.max(...crossings);
  if (first < 0 || last > 1 || containsPoint(fruit, a) || containsPoint(fruit, b)) {
    return { kind: 'cancel', reason: 'partial' };
  }

  const { left, right } = splitAreas(fruit, a, b);
  const total = left + right;
  if (total <= 0) return { kind: 'cancel', reason: 'miss' };
  const fraction = left / total;
  return { kind: 'cut', fraction, deviation: Math.abs(fraction - 0.5) * 100 };
}

/** True if the segment a -> b touches a circle (used for bombs). */
export function segmentHitsCircle(a: Vec, b: Vec, center: Vec, radius: number): boolean {
  const d = sub(b, a);
  const len2 = d.x * d.x + d.y * d.y;
  let t = len2 === 0 ? 0 : ((center.x - a.x) * d.x + (center.y - a.y) * d.y) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + d.x * t - center.x;
  const py = a.y + d.y * t - center.y;
  return px * px + py * py <= radius * radius;
}
