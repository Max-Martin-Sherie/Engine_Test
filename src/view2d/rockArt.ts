import type { Graphics } from 'pixi.js';
import { createRng, nextFloat } from '../core/rng';
import { COLORS, mixColor } from './palette';

/** Cheap integer hash so a rock's look is a pure function of its sim id. */
function hashId(id: number): number {
  let h = Math.imul(id + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface RockLook {
  /** Starting rotation in radians. */
  angle0: number;
  /** Rotation speed in radians per second. */
  spin: number;
}

const LIGHT_ANGLE = -2.3; // light comes from the upper left

/**
 * Draws a bevelled, low-poly stone centred on (0, 0) into `g`, deterministically from its id:
 * a flat top face inside a ring of side facets, each lit by how much it faces the light.
 * The outline stays within the sim radius, so the forgiving hitbox reads as fair.
 */
export function drawRock(g: Graphics, id: number, radius: number): RockLook {
  const rng = createRng(hashId(id));
  const palette = nextFloat(rng) < 0.5 ? COLORS.coral : COLORS.amber;
  const sides = 7 + Math.floor(nextFloat(rng) * 3);
  const inset = 0.5 + nextFloat(rng) * 0.12; // how far the top face sits inside the rim

  const outerX: number[] = [];
  const outerY: number[] = [];
  const innerX: number[] = [];
  const innerY: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + (nextFloat(rng) - 0.5) * 0.45) / sides) * Math.PI * 2;
    const rad = radius * (0.8 + 0.2 * nextFloat(rng));
    const ox = Math.cos(a) * rad;
    const oy = Math.sin(a) * rad;
    outerX.push(ox);
    outerY.push(oy);
    // The top face is nudged toward the light so the lit side looks thin and the shaded side deep.
    const k = inset * (0.9 + 0.2 * nextFloat(rng));
    innerX.push(ox * k + Math.cos(LIGHT_ANGLE) * radius * 0.1);
    innerY.push(oy * k + Math.sin(LIGHT_ANGLE) * radius * 0.1);
  }

  const shade = (facing: number): number => {
    const t = 0.5 + 0.5 * Math.cos(facing - LIGHT_ANGLE);
    return t < 0.5
      ? mixColor(palette.dark, palette.base, t * 2)
      : mixColor(palette.base, palette.light, (t - 0.5) * 2);
  };

  g.clear();
  // Silhouette first, so antialiasing seams between facets show the dark tone, not the field.
  const outline: number[] = [];
  for (let i = 0; i < sides; i++) outline.push(outerX[i] ?? 0, outerY[i] ?? 0);
  g.poly(outline).fill(palette.dark);

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const x1 = outerX[i] ?? 0;
    const y1 = outerY[i] ?? 0;
    const x2 = outerX[j] ?? 0;
    const y2 = outerY[j] ?? 0;
    const facing = Math.atan2(y1 + y2, x1 + x2);
    g.poly([x1, y1, x2, y2, innerX[j] ?? 0, innerY[j] ?? 0, innerX[i] ?? 0, innerY[i] ?? 0]).fill(
      shade(facing),
    );
  }

  const top: number[] = [];
  for (let i = 0; i < sides; i++) top.push(innerX[i] ?? 0, innerY[i] ?? 0);
  g.poly(top).fill(mixColor(palette.base, palette.light, 0.3));

  return {
    angle0: nextFloat(rng) * Math.PI * 2,
    spin: (nextFloat(rng) - 0.5) * 1.6,
  };
}
