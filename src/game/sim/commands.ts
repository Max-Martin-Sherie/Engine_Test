/**
 * Everything a player (or the AI) can tell the match to do. Each command checks the player really owns what it
 * touches, so a tampered request can only ever do what that player could do anyway.
 */
import { BUILDINGS, ECONOMY, UNITS, type BuildingType, type UnitType } from './config';
import { cancelConstruction, canAfford, checkPlacement, geyserAt, hasBuilt, type Placement } from './construction';
import { leastBusyPatch, startGather } from './economy';
import { get, isAir, isBuilding, isUnit, unitStats, type Match } from './state';
import { setPath } from './units';
import type { Entity } from './types';

export interface Result {
  ok: boolean;
  reason: string;
}

const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true, reason: '' };

/** The player's own, living units among these ids. */
export function ownUnits(m: Match, player: number, ids: readonly number[]): Entity[] {
  const out: Entity[] = [];
  for (const id of ids) {
    const e = get(m, id);
    if (e !== undefined && e.owner === player && isUnit(e)) out.push(e);
  }
  return out;
}

/** Spreads a group around a point: each unit gets its own place, the nearest ones first. */
function formation(m: Match, units: readonly Entity[], x: number, y: number): { x: number; y: number }[] {
  const count = units.length;
  if (count === 1) return [{ x, y }];
  const s = m.map.size;
  const spacing = 1.15;
  const reach = Math.ceil(Math.sqrt(count)) + 3;
  const spots: { x: number; y: number; d: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const px = x + dx * spacing;
      const py = y + dy * spacing;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      if (cx < 0 || cy < 0 || cx >= s || cy >= s) continue;
      if (m.blocked[cy * s + cx] === 1) continue;
      spots.push({ x: px, y: py, d: dx * dx + dy * dy + (dx + dy * 7) * 0.0001 });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  const chosen = spots.slice(0, count);
  // Give each unit the spot that suits it: the units nearest the target take the front spots.
  const order = units.map((u, i) => ({ i, d: (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const result: { x: number; y: number }[] = new Array<{ x: number; y: number }>(count);
  order.forEach((entry, rank) => {
    result[entry.i] = chosen[rank] ?? { x, y };
  });
  return result;
}

function clearOrderState(e: Entity): void {
  e.resume = null;
  e.retries = 0;
  e.stuck = 0;
}

/** Walk (or attack-move) the units to a point. */
export function cmdMove(m: Match, player: number, ids: readonly number[], x: number, y: number, attack = false): Result {
  const units = ownUnits(m, player, ids);
  if (units.length === 0) return fail('No units');
  const s = m.map.size;
  const tx = Math.min(s - 1.5, Math.max(1.5, x));
  const ty = Math.min(s - 1.5, Math.max(1.5, y));
  const spots = formation(m, units, tx, ty);
  units.forEach((u, i) => {
    const spot = spots[i] ?? { x: tx, y: ty };
    clearOrderState(u);
    // Workers cannot attack-move: they just walk.
    u.order = attack && u.type !== 'worker' ? { type: 'attackMove', x: spot.x, y: spot.y } : { type: 'move', x: spot.x, y: spot.y };
    setPath(m, u, spot.x, spot.y);
  });
  return OK;
}

export function cmdStop(m: Match, player: number, ids: readonly number[]): Result {
  const units = ownUnits(m, player, ids);
  for (const u of units) {
    clearOrderState(u);
    u.order = { type: 'idle' };
    u.path = [];
  }
  return units.length > 0 ? OK : fail('No units');
}

export function cmdHold(m: Match, player: number, ids: readonly number[]): Result {
  const units = ownUnits(m, player, ids);
  for (const u of units) {
    clearOrderState(u);
    u.order = { type: 'hold' };
    u.path = [];
  }
  return units.length > 0 ? OK : fail('No units');
}

/** Attack a specific enemy. */
export function cmdAttack(m: Match, player: number, ids: readonly number[], targetId: number): Result {
  const target = get(m, targetId);
  if (target === undefined || target.owner === player || target.owner < 0) return fail('Not a target');
  let any = false;
  for (const u of ownUnits(m, player, ids)) {
    const w = UNITS[u.type as UnitType].weapon;
    if (w === null) continue;
    if (isAir(target) ? !w.air : !w.ground) continue;
    clearOrderState(u);
    u.order = { type: 'attack', target: targetId, auto: false };
    setPath(m, u, target.x, target.y);
    any = true;
  }
  return any ? OK : fail('Cannot attack that');
}

/** Send workers to mine. */
export function cmdGather(m: Match, player: number, ids: readonly number[], resourceId: number): Result {
  const patch = get(m, resourceId);
  if (patch === undefined || patch.type !== 'minerals') return fail('Not minerals');
  let any = false;
  for (const w of ownUnits(m, player, ids)) {
    if (w.type !== 'worker') continue;
    clearOrderState(w);
    const pick = leastBusyPatch(m, player, patch.x, patch.y, 5) ?? patch;
    startGather(m, w, pick);
    any = true;
  }
  return any ? OK : fail('Only workers mine');
}

/** Where a building would go, and whether the player may put it there and can afford it. */
export function planBuilding(m: Match, player: number, type: BuildingType, x: number, y: number): Placement {
  const place = checkPlacement(m, player, type, x, y);
  if (!place.ok) return place;
  const cost = BUILDINGS[type].cost;
  if (!canAfford(m, player, cost)) {
    const p = m.players[player];
    return { ...place, ok: false, reason: p !== undefined && p.minerals < cost.minerals ? 'Not enough minerals' : 'Not enough gas' };
  }
  return place;
}

/** Order a worker to put a building down. The money is taken when the worker starts. */
export function cmdBuild(m: Match, player: number, workerId: number, type: BuildingType, x: number, y: number): Result {
  const worker = get(m, workerId);
  if (worker === undefined || worker.owner !== player || worker.type !== 'worker') return fail('Needs a worker');
  const place = planBuilding(m, player, type, x, y);
  if (!place.ok) return fail(place.reason);
  clearOrderState(worker);
  worker.order = { type: 'build', building: type, x: place.x, y: place.y };
  setPath(m, worker, place.x, place.y);
  return OK;
}

/** Order workers to keep building an unfinished building. */
export function cmdConstruct(m: Match, player: number, ids: readonly number[], siteId: number): Result {
  const site = get(m, siteId);
  if (site === undefined || site.owner !== player || !isBuilding(site) || site.progress >= 1) return fail('Nothing to build');
  const workers = ownUnits(m, player, ids).filter((w) => w.type === 'worker');
  const worker = workers[0];
  if (worker === undefined) return fail('Needs a worker');
  clearOrderState(worker);
  worker.order = { type: 'construct', site: siteId };
  setPath(m, worker, site.x, site.y);
  return OK;
}

/** Queue a unit at a building. Money and supply are taken at once. */
export function cmdTrain(m: Match, player: number, buildingId: number, type: UnitType): Result {
  const b = get(m, buildingId);
  if (b === undefined || b.owner !== player || !isBuilding(b) || b.progress < 1) return fail('Not ready');
  if (!BUILDINGS[b.type as BuildingType].produces.includes(type)) return fail('Cannot make that here');
  if (b.queue.length >= ECONOMY.queueLimit) return fail('Queue is full');
  const stats = UNITS[type];
  const p = m.players[player];
  if (p === undefined) return fail('No player');
  if (p.minerals < stats.cost.minerals) {
    m.events.push({ type: 'alert', owner: player, kind: 'minerals', x: b.x, y: b.y });
    return fail('Not enough minerals');
  }
  if (p.gas < stats.cost.gas) {
    m.events.push({ type: 'alert', owner: player, kind: 'gas', x: b.x, y: b.y });
    return fail('Not enough gas');
  }
  if (p.supplyUsed + stats.supply > p.supplyCap) {
    m.events.push({ type: 'alert', owner: player, kind: 'supply', x: b.x, y: b.y });
    return fail('Need more depots');
  }
  p.minerals -= stats.cost.minerals;
  p.gas -= stats.cost.gas;
  p.supplyUsed += stats.supply;
  b.queue.push({ type, left: stats.time });
  return OK;
}

/** Take an item out of a queue and give the money back. */
export function cmdCancelTrain(m: Match, player: number, buildingId: number, index: number): Result {
  const b = get(m, buildingId);
  if (b === undefined || b.owner !== player || !isBuilding(b)) return fail('Not a building');
  const item = b.queue[index];
  if (item === undefined) return fail('Nothing there');
  b.queue.splice(index, 1);
  const p = m.players[player];
  if (p !== undefined) {
    p.minerals += UNITS[item.type].cost.minerals;
    p.gas += UNITS[item.type].cost.gas;
  }
  return OK;
}

/** Stop building something and get most of the money back. */
export function cmdCancelBuilding(m: Match, player: number, siteId: number): Result {
  const site = get(m, siteId);
  if (site === undefined || site.owner !== player) return fail('Not yours');
  return cancelConstruction(m, site) ? OK : fail('Already finished');
}

/** Where new units from this building go. A rally point on minerals sends workers to mine. */
export function cmdRally(m: Match, player: number, buildingId: number, x: number, y: number): Result {
  const b = get(m, buildingId);
  if (b === undefined || b.owner !== player || !isBuilding(b)) return fail('Not a building');
  b.rally = { x, y };
  return OK;
}

export { geyserAt, hasBuilt, unitStats };
