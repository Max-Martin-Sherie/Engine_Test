/** Shooting: who can hit whom, finding targets, firing, and fights. */
import { BUILDINGS, COMBAT, UNITS, type BuildingType, type UnitType, type Weapon } from './config';
import { damage } from './entities';
import { gap, get, isAir, isBuilding, isUnit, type Match } from './state';
import { hasPath, maintainPath, nearbyIds, setPath, setPathToEntity, walk, faceToward } from './units';
import { canSee } from './vision';
import type { Entity } from './types';

export function weaponOf(e: Entity): Weapon | null {
  if (isUnit(e)) return UNITS[e.type as UnitType].weapon;
  if (isBuilding(e) && e.progress >= 1) return BUILDINGS[e.type as BuildingType].weapon;
  return null;
}

/** Can this entity's weapon hit that one? */
export function canTarget(attacker: Entity, target: Entity): boolean {
  const w = weaponOf(attacker);
  if (w === null || !target.alive || target.owner < 0 || target.owner === attacker.owner) return false;
  if (!isUnit(target) && !isBuilding(target)) return false;
  return isAir(target) ? w.air : w.ground;
}

/** Lower is more urgent: things that shoot back first, then other units, then buildings. */
function priority(target: Entity): number {
  if (isUnit(target)) return weaponOf(target) !== null && target.type !== 'worker' ? 0 : 1;
  return weaponOf(target) !== null ? 0 : 2;
}

/** The best enemy within `reach` (edge to edge) that the entity can see and hit. */
export function findTarget(m: Match, e: Entity, reach: number): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const consider = (t: Entity): void => {
    if (!canTarget(e, t) || !canSee(m, e.owner, t)) return;
    const d = gap(e, t);
    if (d > reach) return;
    const score = priority(t) * 1000 + d * 10 + (t.id % 7) * 0.001;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  };
  for (const id of nearbyIds(m, e.x, e.y, reach + 2)) {
    const t = m.byId.get(id);
    if (t !== undefined && t.alive) consider(t);
  }
  for (const t of m.entities) if (t.alive && !isUnit(t)) consider(t);
  return best;
}

/** One shot: damage (and splash), the event the picture uses, and the wait before the next one. */
export function fire(m: Match, e: Entity, target: Entity): void {
  const w = weaponOf(e);
  if (w === null) return;
  e.cooldown = w.cooldown;
  faceToward(e, target.x, target.y);
  const tx = target.x;
  const ty = target.y;
  const air = isAir(target);
  m.events.push({ type: 'shot', from: e.id, to: target.id, fx: e.x, fy: e.y, tx, ty, weapon: e.type, owner: e.owner, air });
  damage(m, target, w.damage, e.id);
  if (w.splash !== undefined && !air) {
    for (const id of nearbyIds(m, tx, ty, w.splash + 1)) {
      if (id === target.id) continue;
      const other = m.byId.get(id);
      if (other === undefined || !other.alive || other.owner === e.owner || other.owner < 0 || isAir(other)) continue;
      const dx = other.x - tx;
      const dy = other.y - ty;
      if (dx * dx + dy * dy <= w.splash * w.splash) damage(m, other, w.damage * 0.5, e.id);
    }
  }
}

/** What an idle (or attack-moving) unit would pick a fight with. */
export function acquire(m: Match, e: Entity, hold: boolean): Entity | null {
  const w = weaponOf(e);
  if (w === null) return null;
  return findTarget(m, e, hold ? w.range : w.range + COMBAT.acquireExtra);
}

/** An attack order has ended (the target died or got away): go back to what the unit was doing, or stop. */
export function endAttack(m: Match, e: Entity): void {
  e.path = [];
  if (e.resume !== null) {
    const { x, y } = e.resume;
    e.resume = null;
    e.order = { type: 'attackMove', x, y };
    setPath(m, e, x, y);
  } else {
    e.order = { type: 'idle' };
  }
}

/** Advances an attack order: close in, then shoot when the weapon is ready. */
export function updateAttack(m: Match, e: Entity): void {
  if (e.order.type !== 'attack') return;
  const target = get(m, e.order.target);
  const w = weaponOf(e);
  if (target === undefined || w === null || !canTarget(e, target) || !canSee(m, e.owner, target)) {
    endAttack(m, e);
    return;
  }
  const d = gap(e, target);
  if (d <= w.range) {
    e.path = [];
    faceToward(e, target.x, target.y);
    if (e.cooldown <= 0) fire(m, e, target);
    return;
  }
  if (e.order.auto && d > w.range + COMBAT.acquireExtra + 2) {
    endAttack(m, e);
    return;
  }
  // Out of range: walk toward it, finding the way again if it has moved.
  const moved = target.x - e.goalX;
  const movedY = target.y - e.goalY;
  if (!hasPath(e) || moved * moved + movedY * movedY > COMBAT.chaseRepath * COMBAT.chaseRepath) setPathToEntity(m, e, target);
  const step = walk(m, e);
  maintainPath(m, e, target.x, target.y, step);
}

/** Holding ground: shoot what is in range, never move. */
export function updateHold(m: Match, e: Entity): void {
  const w = weaponOf(e);
  if (w === null) return;
  const target = (m.tick + e.id) % 3 === 0 || e.cooldown <= 0 ? acquire(m, e, true) : null;
  if (target !== null && e.cooldown <= 0) fire(m, e, target);
}

/** A turret (or any armed building) shooting at what comes near. */
export function updateTurret(m: Match, e: Entity): void {
  if (e.cooldown > 0) e.cooldown -= 1;
  const w = weaponOf(e);
  if (w === null || e.cooldown > 0) return;
  const target = findTarget(m, e, w.range);
  if (target !== null) fire(m, e, target);
}
