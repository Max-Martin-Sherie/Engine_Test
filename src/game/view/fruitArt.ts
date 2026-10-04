import type { Graphics } from 'pixi.js';
import type { FruitShape, Vec } from '../sim';
import { FRUIT_COLORS, type FruitColors } from './palette';

/** Where and how large to draw a fruit. radius 0..1 shapes are multiplied by `radius`. */
export interface FruitPose {
  x: number;
  y: number;
  rotation: number;
  radius: number;
}

const flat = (pts: readonly Vec[], map: (p: Vec) => Vec): number[] => pts.flatMap((p) => {
  const q = map(p);
  return [q.x, q.y];
});

/**
 * Draws a fruit into `g`: skin, flesh and the details that make each kind recognisable. Everything
 * is built from the shape's unit-space outline, so the picture is exactly the polygon the cut is
 * measured against.
 */
export function drawFruit(g: Graphics, shape: FruitShape, pose: FruitPose): void {
  const colors: FruitColors = FRUIT_COLORS[shape.kind] ?? FRUIT_COLORS['orange']!;
  const cos = Math.cos(pose.rotation) * pose.radius;
  const sin = Math.sin(pose.rotation) * pose.radius;
  /** Unit-space point -> world point. */
  const at = (p: Vec): Vec => ({ x: pose.x + p.x * cos - p.y * sin, y: pose.y + p.x * sin + p.y * cos });
  const dot = (p: Vec, r: number, color: number, alpha = 1): void => {
    const w = at(p);
    g.circle(w.x, w.y, r * pose.radius).fill({ color, alpha });
  };

  g.clear();
  const rim = Math.max(1.5, pose.radius * 0.035);

  // Skin, with a darker edge.
  g.poly(flat(shape.outline, at)).fill(colors.skin).stroke({ width: rim, color: colors.skinDark, join: 'round' });

  if (shape.kind === 'watermelon') {
    // A pale band of rind between the green skin and the red flesh.
    g.poly(flat(shape.outline.map((p) => ({ x: p.x * 0.94, y: p.y * 0.94 })), at)).fill(0xe3f4c1);
  }

  // Flesh.
  g.poly(flat(shape.inner, at)).fill(colors.flesh);

  // A soft lighter core, so the flesh is not flat.
  g.poly(flat(shape.inner.map((p) => ({ x: p.x * 0.72, y: p.y * 0.72 })), at)).fill({ color: colors.fleshLight, alpha: 0.35 });

  switch (shape.kind) {
    case 'orange':
    case 'lemon': {
      // Segment lines out from the middle.
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8 + 0.2;
        const from = at({ x: Math.cos(a) * 0.08, y: Math.sin(a) * 0.08 });
        const to = at({ x: Math.cos(a) * 0.72 * (shape.kind === 'lemon' ? 1.1 : 1), y: Math.sin(a) * 0.72 * (shape.kind === 'lemon' ? 0.8 : 1) });
        g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: Math.max(1, pose.radius * 0.02), color: colors.detail, alpha: 0.7 });
      }
      dot({ x: 0, y: 0 }, 0.05, colors.detail, 0.9);
      break;
    }
    case 'apple': {
      for (const [x, y] of [[-0.08, 0.02], [0.08, 0.02], [0, 0.14]] as const) dot({ x, y }, 0.035, colors.detail);
      break;
    }
    case 'pear': {
      for (const [x, y] of [[-0.05, 0.22], [0.05, 0.28]] as const) dot({ x, y }, 0.03, colors.detail);
      break;
    }
    case 'watermelon': {
      for (const [x, y] of [[-0.45, -0.1], [-0.22, 0.12], [0.02, -0.14], [0.26, 0.1], [0.5, -0.08], [-0.05, 0.3], [0.3, -0.3], [-0.3, -0.34]] as const) {
        dot({ x, y }, 0.034, colors.detail);
      }
      break;
    }
    case 'banana': {
      // Dark tips at both ends of the crescent.
      const left = shape.outline.reduce((a, b) => (b.x < a.x ? b : a));
      const right = shape.outline.reduce((a, b) => (b.x > a.x ? b : a));
      dot(left, 0.045, colors.detail);
      dot(right, 0.045, colors.detail);
      break;
    }
  }

  // A glossy highlight.
  if (shape.kind !== 'banana') {
    const h = at({ x: -0.38, y: -0.4 });
    g.ellipse(h.x, h.y, pose.radius * 0.16, pose.radius * 0.08).fill({ color: 0xffffff, alpha: 0.28 });
  }

  // A stem on the fruit that have one (the top of the shape is its smallest y).
  if (shape.kind === 'apple' || shape.kind === 'pear') {
    const top = shape.outline.reduce((a, b) => (b.y < a.y ? b : a));
    const base = at({ x: top.x, y: top.y + 0.03 });
    const tip = at({ x: top.x + 0.05, y: top.y - 0.2 });
    g.moveTo(base.x, base.y).lineTo(tip.x, tip.y).stroke({ width: Math.max(2, pose.radius * 0.05), color: 0x5a3d1a, cap: 'round' });
    const leaf = at({ x: top.x + 0.16, y: top.y - 0.12 });
    g.ellipse(leaf.x, leaf.y, pose.radius * 0.13, pose.radius * 0.06).fill(0x55b83a);
  }
}
