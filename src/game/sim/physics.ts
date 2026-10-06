/**
 * Moving and shooting through the arena. Bodies are upright cylinders; the world is a heightfield of one-metre
 * columns, so a body's footprint is a circle laid over a few cells and "what is under me" is the tallest of them.
 */
import { ACTOR, ARENA } from './config';
import { cellHeight, type Arena } from './arena';
import type { Actor, Input, MatchEvent } from './types';

const TWO_PI = Math.PI * 2;

/** The way a head is turned, as a unit vector (the Three.js camera's convention: yaw 0 looks along -z). */
export function lookDir(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

export const clampPitch = (pitch: number): number => Math.min(Math.PI / 2 - 0.02, Math.max(-Math.PI / 2 + 0.02, pitch));

/** An angle brought into -PI..PI. */
export function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  if (r < -Math.PI) r += TWO_PI;
  return r;
}

export const eyeHeight = (a: Actor): number => a.y + ACTOR.eye;

/** The tallest column a circle at (x, z) overlaps. */
export function heightUnder(arena: Arena, x: number, z: number, radius: number): number {
  const x0 = Math.floor(x - radius);
  const x1 = Math.floor(x + radius);
  const z0 = Math.floor(z - radius);
  const z1 = Math.floor(z + radius);
  let top = 0;
  const r2 = radius * radius;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const h = cellHeight(arena, cx, cz);
      if (h <= top) continue;
      const nx = Math.min(cx + 1, Math.max(cx, x));
      const nz = Math.min(cz + 1, Math.max(cz, z));
      if ((nx - x) * (nx - x) + (nz - z) * (nz - z) < r2) top = h;
    }
  }
  return top;
}

/** Moves a body along one axis in small steps, stopping at anything it cannot step onto. Returns whether it got all the way. */
function slide(arena: Arena, a: Actor, dx: number, dz: number): boolean {
  const length = Math.abs(dx) + Math.abs(dz);
  if (length < 1e-9) return true;
  const steps = Math.max(1, Math.ceil(length / 0.25));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    const nx = a.x + sx;
    const nz = a.z + sz;
    const top = heightUnder(arena, nx, nz, ACTOR.radius);
    // A walker steps up a low ledge; someone in the air must already be above it.
    const reach = a.onGround ? ACTOR.step : 0.02;
    if (top > a.y + reach) return false;
    a.x = nx;
    a.z = nz;
    if (a.onGround && top > a.y) a.y = top;
  }
  return true;
}

/** Pushes a body that ended up inside a column (spawned there, shoved by an explosion) out to the nearest open spot. */
function unstick(arena: Arena, a: Actor): void {
  if (heightUnder(arena, a.x, a.z, ACTOR.radius * 0.9) <= a.y + ACTOR.step) return;
  for (let r = 0.25; r <= 3; r += 0.25) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * TWO_PI;
      const x = a.x + Math.cos(ang) * r;
      const z = a.z + Math.sin(ang) * r;
      if (heightUnder(arena, x, z, ACTOR.radius * 0.9) <= a.y + ACTOR.step) {
        a.x = x;
        a.z = z;
        return;
      }
    }
  }
}

/**
 * One tick of walking, jumping and falling. The wanted velocity comes from the input and the way the body faces; the
 * real velocity closes on it quickly on the ground and slowly in the air.
 */
export function moveActor(arena: Arena, a: Actor, input: Input, dt: number, events: MatchEvent[]): void {
  a.px = a.x;
  a.py = a.y;
  a.pz = a.z;
  a.yaw = input.yaw;
  a.pitch = clampPitch(input.pitch);

  // Where the stick says to go, turned to the way the body faces.
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  let mx = input.moveX;
  let mz = input.moveZ;
  const stick = Math.hypot(mx, mz);
  if (stick > 1) {
    mx /= stick;
    mz /= stick;
  }
  const speed = (input.sprint && mz > 0.3 ? ACTOR.sprint : ACTOR.walk) * (input.aim ? 0.6 : 1);
  const wishX = (-sy * mz + cy * mx) * speed;
  const wishZ = (-cy * mz - sy * mx) * speed;
  const response = 1 - Math.exp(-(a.onGround ? ACTOR.groundResponse : ACTOR.airResponse) * dt);
  a.vx += (wishX - a.vx) * response;
  a.vz += (wishZ - a.vz) * response;

  if (input.jump && a.onGround) {
    a.vy = ACTOR.jump;
    a.onGround = false;
    events.push({ type: 'jump', actor: a.id });
  }
  a.vy = Math.max(-ACTOR.terminal, a.vy - ACTOR.gravity * dt);

  // Horizontal, one axis at a time so a body slides along a wall rather than stopping dead.
  if (!slide(arena, a, a.vx * dt, 0)) a.vx = 0;
  if (!slide(arena, a, 0, a.vz * dt)) a.vz = 0;

  // Vertical.
  const wasAirborne = !a.onGround;
  a.y += a.vy * dt;
  const floor = heightUnder(arena, a.x, a.z, ACTOR.radius);
  if (a.y <= floor + 1e-4) {
    if (wasAirborne && a.vy < -3) events.push({ type: 'land', actor: a.id, speed: -a.vy });
    a.y = floor;
    if (a.vy < 0) a.vy = 0;
    a.onGround = true;
  } else {
    a.onGround = false;
  }
  unstick(arena, a);

  // The legs: a phase that moves with the ground speed.
  if (a.onGround) a.stride += Math.hypot(a.vx, a.vz) * dt * 1.35;
}

// ---- rays ----------------------------------------------------------------------------------------------------------

export interface WorldHit {
  /** Distance along the ray. */
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * The first thing a ray meets in the world: a column (its side or its top) or the floor. `d` is a unit vector.
 * Walks the cells the ray passes through, so it costs about the length of the ray in metres.
 */
export function raycastWorld(arena: Arena, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): WorldHit | null {
  const tFloor = dy < -1e-9 && oy > 0 ? oy / -dy : Infinity;
  let cx = Math.floor(ox);
  let cz = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(dx) > 1e-12 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaZ = Math.abs(dz) > 1e-12 ? 1 / Math.abs(dz) : Infinity;
  let tMaxX = Math.abs(dx) > 1e-12 ? (dx > 0 ? cx + 1 - ox : ox - cx) * tDeltaX : Infinity;
  let tMaxZ = Math.abs(dz) > 1e-12 ? (dz > 0 ? cz + 1 - oz : oz - cz) * tDeltaZ : Infinity;
  let t = 0;
  let axis = -1;
  const limit = Math.min(maxDist, tFloor);
  for (let guard = 0; guard < 400; guard++) {
    const h = cellHeight(arena, cx, cz);
    const tExit = Math.min(tMaxX, tMaxZ, limit);
    if (h > 0) {
      const yEnter = oy + dy * t;
      const yExit = oy + dy * tExit;
      if (yEnter <= h) {
        // Entered through the side (or started inside).
        if (axis === 0) return { t, nx: -stepX, ny: 0, nz: 0 };
        if (axis === 1) return { t, nx: 0, ny: 0, nz: -stepZ };
        return { t, nx: -dx, ny: -dy, nz: -dz };
      }
      if (yExit < h && dy < 0) {
        return { t: (h - oy) / dy, nx: 0, ny: 1, nz: 0 };
      }
    }
    if (tExit >= limit) break;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      axis = 0;
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      axis = 1;
    }
    if (cx < 0 || cz < 0 || cx >= arena.size || cz >= arena.size) return null;
  }
  if (tFloor <= maxDist) return { t: tFloor, nx: 0, ny: 1, nz: 0 };
  return null;
}

export interface BodyHit {
  t: number;
  /** Height of the hit above the body's feet. */
  y: number;
}

/** Where a ray (unit direction) meets an upright cylinder, if it does within `maxT`. */
export function rayVsCylinder(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  maxT: number,
): BodyHit | null {
  let best = Infinity;
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  const r2 = radius * radius;
  if (a > 1e-12) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - r2;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t0 = (-b - root) / (2 * a);
      const t1 = (-b + root) / (2 * a);
      for (const t of [t0, t1]) {
        if (t < 0 || t > maxT || t >= best) continue;
        const y = oy + dy * t;
        if (y >= cy && y <= cy + height) best = t;
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const plane of [cy, cy + height]) {
      const t = (plane - oy) / dy;
      if (t < 0 || t > maxT || t >= best) continue;
      const x = px + dx * t;
      const z = pz + dz * t;
      if (x * x + z * z <= r2) best = t;
    }
  }
  if (best === Infinity) return null;
  return { t: best, y: oy + dy * best - cy };
}

/** Can a point see another (nothing solid between them)? */
export function lineOfSight(arena: Arena, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const hit = raycastWorld(arena, ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit === null || hit.t >= dist - 1e-3;
}

export { ARENA };
