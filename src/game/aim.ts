/**
 * Help for aiming with a thumb. A phone cannot aim like a mouse, so when an enemy is near the crosshair the view slows
 * down (it is easier to stay on them) and drifts toward them while you are turning or firing. It never fires for you
 * unless auto-fire is on, and it never turns to someone you cannot see. Pure: it reads the match and returns numbers.
 */
import { ACTOR, DEG } from './sim/config';
import { canHurt, lineOfSight, lookDir, raycastWorld, rayVsCylinder, wrapAngle, weaponDef } from './sim';
import type { Actor, Match } from './sim';

/** The part of an enemy the assist aims at: the chest. */
export const CHEST = 1.1;
/** How far from the crosshair an enemy can be and still help (radians). */
export const CONE = 9 * DEG;

export interface AimTarget {
  id: number;
  /** How far to turn to face the enemy: yaw (positive is left, as in the simulation) and pitch (positive is up). */
  dYaw: number;
  dPitch: number;
  /** The angle between where you look and the enemy, radians. */
  angle: number;
  distance: number;
}

/** The visible enemy nearest the crosshair within the cone, or null. */
export function findAimTarget(m: Match, me: Actor, yaw: number, pitch: number, cone = CONE, maxDistance = 70): AimTarget | null {
  const ex = me.x;
  const ey = me.y + ACTOR.eye;
  const ez = me.z;
  let best: AimTarget | null = null;
  for (const e of m.actors) {
    if (!e.alive || e.id === me.id || !canHurt(me, e) || e.protect > 0) continue;
    const dx = e.x - ex;
    const dy = e.y + CHEST - ey;
    const dz = e.z - ez;
    const flat = Math.hypot(dx, dz);
    const distance = Math.hypot(flat, dy);
    if (distance > maxDistance || distance < 0.5) continue;
    const dYaw = wrapAngle(Math.atan2(-dx, -dz) - yaw);
    const dPitch = Math.atan2(dy, flat) - pitch;
    const angle = Math.hypot(dYaw * Math.cos(pitch + dPitch), dPitch);
    if (angle > cone || (best !== null && angle >= best.angle)) continue;
    if (!lineOfSight(m.arena, ex, ey, ez, e.x, e.y + CHEST, e.z)) continue;
    best = { id: e.id, dYaw, dPitch, angle, distance };
  }
  return best;
}

export interface AssistOptions {
  /** 0 .. 1; 0 turns the help off. */
  strength: number;
  /** The player is turning the view right now. */
  turning: boolean;
  firing: boolean;
}

/**
 * Adjusts a turn of the view (`dYaw`, `dPitch`, radians) for the enemy near the crosshair: smaller turns near them, and
 * a drift toward them while turning or firing. Returns the turn to apply.
 */
export function assistLook(dYaw: number, dPitch: number, target: AimTarget | null, options: AssistOptions, dt: number): { dYaw: number; dPitch: number } {
  if (target === null || options.strength <= 0) return { dYaw, dPitch };
  const closeness = Math.max(0, 1 - target.angle / CONE);
  // Slow the hand down near the target so it is easier to stop on them.
  const slow = 1 - 0.5 * options.strength * closeness;
  let ny = dYaw * slow;
  let np = dPitch * slow;
  if (options.turning || options.firing) {
    // Drift toward them, at most to them.
    const rate = 110 * DEG * options.strength * closeness * closeness * dt;
    const along = Math.hypot(target.dYaw, target.dPitch);
    if (along > 1e-6) {
      const move = Math.min(along, rate);
      ny += (target.dYaw / along) * move;
      np += (target.dPitch / along) * move;
    }
  }
  return { dYaw: ny, dPitch: np };
}

/** Is the crosshair on an enemy right now (the first thing the bullet would meet is a person)? Used by auto-fire. */
export function crosshairOnEnemy(m: Match, me: Actor, yaw: number, pitch: number): boolean {
  const range = Math.min(weaponDef(me).range, 90);
  const ex = me.x;
  const ey = me.y + ACTOR.eye;
  const ez = me.z;
  const d = lookDir(yaw, pitch);
  const wall = raycastWorld(m.arena, ex, ey, ez, d.x, d.y, d.z, range);
  const reach = wall === null ? range : wall.t;
  for (const e of m.actors) {
    if (!e.alive || e.id === me.id || !canHurt(me, e) || e.protect > 0) continue;
    if (rayVsCylinder(ex, ey, ez, d.x, d.y, d.z, e.x, e.y, e.z, ACTOR.hitRadius, ACTOR.height, reach) !== null) return true;
  }
  return false;
}
