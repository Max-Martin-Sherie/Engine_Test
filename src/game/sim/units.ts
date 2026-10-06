/** Walking: routes, steps along them, and keeping units from standing on each other. */
import { COMBAT } from './config';
import { halfSize, isAir, isUnit, unitStats, type Match } from './state';
import type { Entity } from './types';

/** Face toward a point (as a unit vector). */
export function faceToward(e: Entity, x: number, y: number): void {
  const dx = x - e.x;
  const dy = y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 1e-6) {
    e.fx = dx / d;
    e.fy = dy / d;
  }
}

/** Finds a way to (x, y) and sets it as the unit's path. Returns false if there is nowhere to go. */
export function setPath(m: Match, e: Entity, x: number, y: number): boolean {
  e.goalX = x;
  e.goalY = y;
  e.pathVersion = m.pathVersion;
  e.stuck = 0;
  if (isAir(e)) {
    e.path = [x, y];
    return true;
  }
  const route = m.pathfinder.find(m.blocked, e.x, e.y, x, y, unitStats(e).radius);
  if (route === null) {
    e.path = [];
    return false;
  }
  e.path = route.points;
  return true;
}

/**
 * The point to walk to in order to reach a building or resource: the nearest spot just outside it, on the side the unit
 * is coming from (not the centre, which is blocked and would make every unit pick the same face).
 */
export function approachPoint(e: Entity, target: Entity): { x: number; y: number } {
  const { hw, hh } = halfSize(target);
  const margin = 0.5;
  return {
    x: Math.min(target.x + hw + margin, Math.max(target.x - hw - margin, e.x)),
    y: Math.min(target.y + hh + margin, Math.max(target.y - hh - margin, e.y)),
  };
}

/** Sets the path to the nearest approach to an entity. */
export function setPathToEntity(m: Match, e: Entity, target: Entity): boolean {
  if (isUnit(target)) return setPath(m, e, target.x, target.y);
  const p = approachPoint(e, target);
  return setPath(m, e, p.x, p.y);
}

/** Does this entity still have somewhere to walk? */
export const hasPath = (e: Entity): boolean => e.path.length >= 2;

/**
 * Walks along the path for one tick. Returns how far it got. A step into a blocked cell is refused (a building
 * went up on the route), and the route is found again.
 */
export function walk(m: Match, e: Entity): number {
  if (!hasPath(e)) return 0;
  const stats = unitStats(e);
  let budget = stats.speed;
  let moved = 0;
  const s = m.map.size;
  const air = stats.air;
  while (budget > 1e-9 && e.path.length >= 2) {
    const wx = e.path[0] ?? e.x;
    const wy = e.path[1] ?? e.y;
    const dx = wx - e.x;
    const dy = wy - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      if (!air && m.blocked[Math.floor(wy) * s + Math.floor(wx)] === 1) {
        e.path = [];
        break;
      }
      e.x = wx;
      e.y = wy;
      e.path.splice(0, 2);
      budget -= d;
      moved += d;
      if (d > 1e-6) {
        e.fx = dx / d;
        e.fy = dy / d;
      }
    } else {
      const nx = e.x + (dx / d) * budget;
      const ny = e.y + (dy / d) * budget;
      if (!air && m.blocked[Math.floor(ny) * s + Math.floor(nx)] === 1) {
        e.path = [];
        break;
      }
      e.x = nx;
      e.y = ny;
      e.fx = dx / d;
      e.fy = dy / d;
      moved += budget;
      budget = 0;
    }
  }
  return moved;
}

/**
 * Keeps a unit going: re-finds the route (to where it was last sent) when a building has gone up, and when it has
 * been stuck too long.
 */
export function maintainPath(m: Match, e: Entity, _destX: number, _destY: number, moved: number): void {
  if (isAir(e)) return;
  if (hasPath(e) && e.pathVersion !== m.pathVersion) setPath(m, e, e.goalX, e.goalY);
  if (hasPath(e)) {
    if (moved < unitStats(e).speed * 0.25) e.stuck += 1;
    else {
      e.stuck = 0;
      e.retries = 0;
    }
    if (e.stuck >= COMBAT.stuckTicks) {
      e.stuck = 0;
      e.retries += 1;
      if (e.retries > 4) {
        e.path = [];
        e.retries = 0;
      } else setPath(m, e, e.goalX, e.goalY);
    }
  }
}

/** Rebuilds the table of which units are near which. */
export function bucketUnits(m: Match): void {
  m.buckets.clear();
  for (const e of m.entities) {
    if (!e.alive || !isUnit(e)) continue;
    const key = (Math.floor(e.x / 2) << 8) | Math.floor(e.y / 2);
    const list = m.buckets.get(key);
    if (list === undefined) m.buckets.set(key, [e.id]);
    else list.push(e.id);
  }
}

/** Ids of the units whose bucket is within `reach` cells of a point (a superset: callers check the real distance). */
export function nearbyIds(m: Match, x: number, y: number, reach: number): number[] {
  const out: number[] = [];
  const x0 = Math.floor((x - reach) / 2);
  const x1 = Math.floor((x + reach) / 2);
  const y0 = Math.floor((y - reach) / 2);
  const y1 = Math.floor((y + reach) / 2);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = m.buckets.get(((cx & 0xff) << 8) | (cy & 0xff));
      if (list !== undefined) for (const id of list) out.push(id);
    }
  }
  return out;
}

/** Pushes overlapping units apart (ground with ground, air with air). Units that are settled give way less. */
export function separate(m: Match): void {
  const s = m.map.size;
  for (const a of m.entities) {
    if (!a.alive || !isUnit(a)) continue;
    const ra = unitStats(a).radius;
    const airA = isAir(a);
    for (const id of nearbyIds(m, a.x, a.y, 2)) {
      if (id <= a.id) continue;
      const b = m.byId.get(id);
      if (b === undefined || !b.alive || isAir(b) !== airA) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const reach = ra + unitStats(b).radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      let d = Math.sqrt(d2);
      let nx: number;
      let ny: number;
      if (d < 1e-4) {
        // Exactly on top of each other: split along a direction from their ids.
        nx = a.id % 2 === 0 ? 1 : -1;
        ny = b.id % 2 === 0 ? 1 : -1;
        d = 0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }
      const overlap = (reach - d) * COMBAT.separation;
      // A unit with nowhere to be gives way more than one that is on the move.
      const aBusy = hasPath(a) ? 0.5 : 1;
      const bBusy = hasPath(b) ? 0.5 : 1;
      const total = aBusy + bBusy;
      const moveA = overlap * (aBusy / total) * 2;
      const moveB = overlap * (bBusy / total) * 2;
      const ax = a.x - nx * moveA;
      const ay = a.y - ny * moveA;
      const bx = b.x + nx * moveB;
      const by = b.y + ny * moveB;
      if (airA || m.blocked[Math.floor(ay) * s + Math.floor(ax)] === 0) {
        a.x = ax;
        a.y = ay;
      }
      if (airA || m.blocked[Math.floor(by) * s + Math.floor(bx)] === 0) {
        b.x = bx;
        b.y = by;
      }
    }
  }
}
