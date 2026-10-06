/** One tick of thinking for a unit: what its current order asks of it. */
import { acquire, endAttack, fire, updateAttack, updateHold, weaponOf } from './combat';
import { updateBuildOrder, updateConstruct } from './construction';
import { updateGather } from './economy';
import { gap, type Match } from './state';
import { hasPath, maintainPath, setPath, walk } from './units';
import type { Entity } from './types';

/** How far from its destination a unit counts as arrived (cells). */
const ARRIVED = 0.6;

function updateMove(m: Match, e: Entity): void {
  if (e.order.type !== 'move') return;
  if (!hasPath(e)) {
    e.order = { type: 'idle' };
    return;
  }
  const moved = walk(m, e);
  maintainPath(m, e, e.order.x, e.order.y, moved);
  if (!hasPath(e)) e.order = { type: 'idle' };
}

function updateAttackMove(m: Match, e: Entity): void {
  if (e.order.type !== 'attackMove') return;
  const { x, y } = e.order;
  const armed = weaponOf(e) !== null && e.type !== 'worker';
  if (armed && (m.tick + e.id) % 3 === 0) {
    const target = acquire(m, e, false);
    if (target !== null) {
      e.resume = { x, y };
      e.order = { type: 'attack', target: target.id, auto: true };
      return;
    }
  }
  if (!hasPath(e)) {
    const dx = x - e.x;
    const dy = y - e.y;
    if (dx * dx + dy * dy > ARRIVED * ARRIVED * 4 && e.retries < 5) {
      e.retries += 1;
      setPath(m, e, x, y);
    } else {
      e.order = { type: 'idle' };
      e.retries = 0;
    }
    return;
  }
  const moved = walk(m, e);
  maintainPath(m, e, x, y, moved);
}

function updateIdle(m: Match, e: Entity): void {
  if (weaponOf(e) === null || e.type === 'worker') return;
  if ((m.tick + e.id) % 4 !== 0) return;
  const target = acquire(m, e, false);
  if (target !== null) e.order = { type: 'attack', target: target.id, auto: true };
}

/** Advances one unit by one tick. */
export function updateUnit(m: Match, e: Entity): void {
  if (e.cooldown > 0) e.cooldown -= 1;
  switch (e.order.type) {
    case 'idle':
      updateIdle(m, e);
      break;
    case 'hold':
      updateHold(m, e);
      break;
    case 'move':
      updateMove(m, e);
      break;
    case 'attackMove':
      updateAttackMove(m, e);
      break;
    case 'attack':
      updateAttack(m, e);
      break;
    case 'gather':
      updateGather(m, e);
      break;
    case 'build':
      updateBuildOrder(m, e);
      break;
    case 'construct':
      updateConstruct(m, e);
      break;
  }
}

export { endAttack, fire, gap };
