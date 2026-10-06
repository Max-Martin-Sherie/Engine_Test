/** Workers mining minerals and carrying them home. */
import { AI, ECONOMY } from './config';
import { killEntity } from './entities';
import { gap, get, type Match } from './state';
import { hasPath, maintainPath, setPathToEntity, walk } from './units';
import type { Entity } from './types';

/** A worker counts as at a patch or hub when its edge is this close to it (corners make an exact touch unlikely). */
const ARRIVE_GAP = 0.5;

/** The nearest finished hub the worker's side owns. */
export function nearestDepot(m: Match, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const h of m.entities) {
    if (!h.alive || h.owner !== e.owner || h.type !== 'hub' || h.progress < 1) continue;
    const d = (h.x - e.x) * (h.x - e.x) + (h.y - e.y) * (h.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** How many of this player's workers are heading for each patch right now. */
function crowd(m: Match, owner: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const w of m.entities) {
    if (!w.alive || w.owner !== owner || w.type !== 'worker' || w.order.type !== 'gather') continue;
    counts.set(w.order.target, (counts.get(w.order.target) ?? 0) + 1);
  }
  return counts;
}

/** The least crowded patch near a point (within `reach` cells), or the nearest of any if the area is empty. */
export function leastBusyPatch(m: Match, owner: number, x: number, y: number, reach = 7): Entity | undefined {
  const counts = crowd(m, owner);
  let best: Entity | undefined;
  let bestScore = Infinity;
  for (const p of m.entities) {
    if (!p.alive || p.type !== 'minerals') continue;
    const d = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
    if (d > reach && best !== undefined) continue;
    const score = (counts.get(p.id) ?? 0) * 4 + d;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Starts a worker mining a patch (or the least busy one near it). */
export function startGather(m: Match, worker: Entity, patch: Entity): void {
  worker.order = { type: 'gather', target: patch.id, phase: 'toResource', timer: 0 };
  setPathToEntity(m, worker, patch);
}

/** The mining loop: walk to the patch, mine, walk to the hub, drop off, repeat. */
export function updateGather(m: Match, e: Entity): void {
  if (e.order.type !== 'gather') return;
  const order = e.order;

  if (order.phase === 'toResource') {
    let patch = get(m, order.target);
    if (patch === undefined) {
      patch = leastBusyPatch(m, e.owner, e.x, e.y, 14);
      if (patch === undefined) {
        e.order = { type: 'idle' };
        return;
      }
      order.target = patch.id;
      setPathToEntity(m, e, patch);
    }
    if (e.carry > 0 && gap(e, patch) > 2) {
      // Still carrying (the patch ran out on the way): take it home first.
      order.phase = 'toDepot';
      e.path = [];
      return;
    }
    if (gap(e, patch) <= ARRIVE_GAP) {
      e.path = [];
      order.phase = 'harvest';
      order.timer = ECONOMY.harvestTicks;
      return;
    }
    if (!hasPath(e)) setPathToEntity(m, e, patch);
    const moved = walk(m, e);
    maintainPath(m, e, patch.x, patch.y, moved);
    return;
  }

  if (order.phase === 'harvest') {
    const patch = get(m, order.target);
    if (patch === undefined) {
      order.phase = 'toResource';
      return;
    }
    order.timer -= 1;
    if (order.timer > 0) return;
    const take = Math.min(ECONOMY.carry, patch.amount);
    patch.amount -= take;
    e.carry = take;
    if (patch.amount <= 0) {
      m.events.push({ type: 'depleted', id: patch.id, x: patch.x, y: patch.y });
      killEntity(m, patch, -1);
    }
    order.phase = 'toDepot';
    e.path = [];
    return;
  }

  // toDepot
  const depot = nearestDepot(m, e);
  if (depot === undefined) {
    e.order = { type: 'idle' };
    return;
  }
  if (gap(e, depot) <= ARRIVE_GAP) {
    const p = m.players[e.owner];
    if (p !== undefined && e.carry > 0) {
      const level = p.ai ? AI[m.difficulty[e.owner as 0 | 1]].income : 1;
      const amount = Math.round(e.carry * level);
      p.minerals += amount;
      p.stats.mined += e.carry;
      m.events.push({ type: 'deposit', owner: e.owner, x: depot.x, y: depot.y, amount: e.carry });
    }
    e.carry = 0;
    e.path = [];
    // Pick the least busy patch near the one just mined.
    const last = m.byId.get(order.target);
    const near = last ?? e;
    const next = leastBusyPatch(m, e.owner, near.x, near.y);
    if (next !== undefined) order.target = next.id;
    order.phase = 'toResource';
    return;
  }
  if (!hasPath(e)) setPathToEntity(m, e, depot);
  const moved = walk(m, e);
  maintainPath(m, e, depot.x, depot.y, moved);
}
