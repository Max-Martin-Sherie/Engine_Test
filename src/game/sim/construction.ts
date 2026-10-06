/** Putting buildings up, and what they make once they stand. */
import { BUILDINGS, ECONOMY, UNITS, type BuildingType, type UnitType } from './config';
import { addEntity, footprint, killEntity, newEntity, snapCentre, spawnUnit } from './entities';
import { gap, get, isBuilding, isUnit, unitStats, type Match } from './state';
import { hasPath, maintainPath, setPath, setPathToEntity, walk } from './units';
import { fogAt } from './vision';
import type { Entity } from './types';

export interface Placement {
  ok: boolean;
  reason: string;
  /** Where it would stand (snapped to the grid, or onto the geyser). */
  x: number;
  y: number;
}

export function geyserAt(m: Match, x: number, y: number): Entity | undefined {
  return m.entities.find((e) => e.alive && e.type === 'geyser' && Math.abs(e.x - x) <= 1.5 && Math.abs(e.y - y) <= 1.5);
}

/** Does this player own a finished building of that type? */
export function hasBuilt(m: Match, owner: number, type: BuildingType): boolean {
  return m.entities.some((e) => e.alive && e.owner === owner && e.type === type && e.progress >= 1);
}

export const canAfford = (m: Match, owner: number, cost: { minerals: number; gas: number }): boolean => {
  const p = m.players[owner];
  return p !== undefined && p.minerals >= cost.minerals && p.gas >= cost.gas;
};

function spend(m: Match, owner: number, cost: { minerals: number; gas: number }, sign: 1 | -1): void {
  const p = m.players[owner];
  if (p === undefined) return;
  p.minerals -= cost.minerals * sign;
  p.gas -= cost.gas * sign;
}

/** Can this player put a building of this type here? (Money is checked separately.) */
export function checkPlacement(m: Match, owner: number, type: BuildingType, x: number, y: number): Placement {
  const stats = BUILDINGS[type];
  let { x: cx, y: cy } = snapCentre(type, x, y);
  const refinery = type === 'refinery';
  if (refinery) {
    const geyser = geyserAt(m, x, y);
    if (geyser === undefined) return { ok: false, reason: 'Needs a geyser', x: cx, y: cy };
    cx = geyser.x;
    cy = geyser.y;
    const taken = m.entities.some((e) => e.alive && e.type === 'refinery' && Math.abs(e.x - cx) < 1 && Math.abs(e.y - cy) < 1);
    if (taken) return { ok: false, reason: 'Already built on', x: cx, y: cy };
  }
  if (stats.requires !== null && !hasBuilt(m, owner, stats.requires)) {
    return { ok: false, reason: `Needs a ${BUILDINGS[stats.requires].name}`, x: cx, y: cy };
  }
  const f = footprint(type, cx, cy);
  const s = m.map.size;
  for (let yy = f.y0; yy <= f.y1; yy++) {
    for (let xx = f.x0; xx <= f.x1; xx++) {
      if (xx < 0 || yy < 0 || xx >= s || yy >= s) return { ok: false, reason: 'Off the map', x: cx, y: cy };
      if (m.map.rock[yy * s + xx] === 1) return { ok: false, reason: 'Blocked by rock', x: cx, y: cy };
      if (!refinery && m.blocked[yy * s + xx] === 1) return { ok: false, reason: 'Something is in the way', x: cx, y: cy };
    }
  }
  // A person cannot build in the dark; the computer does not scout and is allowed to.
  if (m.players[owner]?.ai !== true && fogAt(m, owner, cx, cy) < 1) return { ok: false, reason: 'Not explored yet', x: cx, y: cy };
  return { ok: true, reason: '', x: cx, y: cy };
}

/** Moves any units standing where a building is going up to just outside it. */
function evict(m: Match, type: BuildingType, cx: number, cy: number): void {
  const f = footprint(type, cx, cy);
  const left = f.x0;
  const right = f.x1 + 1;
  const top = f.y0;
  const bottom = f.y1 + 1;
  for (const u of m.entities) {
    if (!u.alive || !isUnit(u) || unitStats(u).air) continue;
    const r = unitStats(u).radius;
    if (u.x < left - r || u.x > right + r || u.y < top - r || u.y > bottom + r) continue;
    // The shortest way out of the box.
    const options: [number, number, number][] = [
      [u.x - (left - r - 0.05), left - r - 0.05, u.y],
      [right + r + 0.05 - u.x, right + r + 0.05, u.y],
      [u.y - (top - r - 0.05), u.x, top - r - 0.05],
      [bottom + r + 0.05 - u.y, u.x, bottom + r + 0.05],
    ];
    options.sort((a, b) => a[0] - b[0]);
    for (const [, nx, ny] of options) {
      const s = m.map.size;
      const cell = Math.floor(ny) * s + Math.floor(nx);
      if (nx > 0 && ny > 0 && nx < s && ny < s && m.map.rock[cell] === 0) {
        u.x = nx;
        u.y = ny;
        break;
      }
    }
    u.path = [];
  }
}

/** The distance from a point to the nearest edge of a footprint (0 inside it). */
export function gapToFootprint(type: BuildingType, cx: number, cy: number, px: number, py: number): number {
  const { w, h } = BUILDINGS[type];
  const dx = Math.max(0, Math.abs(px - cx) - w / 2);
  const dy = Math.max(0, Math.abs(py - cy) - h / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Starts building: takes the money, raises the (empty) building and sends the worker to work on it. */
function startBuilding(m: Match, worker: Entity, type: BuildingType, cx: number, cy: number): Entity | null {
  const stats = BUILDINGS[type];
  spend(m, worker.owner, stats.cost, 1);
  evict(m, type, cx, cy);
  const site = newEntity(m, type, worker.owner, cx, cy);
  site.progress = 0;
  site.hp = Math.max(1, stats.hp * 0.1);
  site.builder = worker.id;
  addEntity(m, site);
  m.events.push({ type: 'started', id: site.id, entity: type, owner: worker.owner, x: cx, y: cy });
  return site;
}

/** A worker on its way to a build spot. */
export function updateBuildOrder(m: Match, e: Entity): void {
  if (e.order.type !== 'build') return;
  const { building, x, y } = e.order;
  const near = gapToFootprint(building, x, y, e.x, e.y);
  if (near > 0.9) {
    if (!hasPath(e)) setPath(m, e, x, y);
    const moved = walk(m, e);
    maintainPath(m, e, x, y, moved);
    if (!hasPath(e) && near > 0.9 && e.stuck === 0 && e.retries === 0) {
      // Could not get any closer: give up.
      e.order = { type: 'idle' };
    }
    return;
  }
  const place = checkPlacement(m, e.owner, building, x, y);
  if (!place.ok) {
    m.events.push({ type: 'alert', owner: e.owner, kind: 'blocked', x, y });
    e.order = { type: 'idle' };
    return;
  }
  if (!canAfford(m, e.owner, BUILDINGS[building].cost)) {
    const p = m.players[e.owner];
    const short = p !== undefined && p.minerals < BUILDINGS[building].cost.minerals;
    m.events.push({ type: 'alert', owner: e.owner, kind: short ? 'minerals' : 'gas', x, y });
    e.order = { type: 'idle' };
    return;
  }
  const site = startBuilding(m, e, building, place.x, place.y);
  if (site === null) {
    e.order = { type: 'idle' };
    return;
  }
  e.path = [];
  e.order = { type: 'construct', site: site.id };
}

/** A worker building something. */
export function updateConstruct(m: Match, e: Entity): void {
  if (e.order.type !== 'construct') return;
  const site = get(m, e.order.site);
  if (site === undefined || site.progress >= 1 || !isBuilding(site) || (site.builder >= 0 && site.builder !== e.id && get(m, site.builder) !== undefined)) {
    e.order = { type: 'idle' };
    return;
  }
  const stats = BUILDINGS[site.type as BuildingType];
  site.builder = e.id;
  if (gap(e, site) > 1.4) {
    if (!hasPath(e)) setPathToEntity(m, e, site);
    const moved = walk(m, e);
    maintainPath(m, e, site.x, site.y, moved);
    return;
  }
  e.path = [];
  site.progress = Math.min(1, site.progress + 1 / stats.time);
  site.hp = Math.min(site.maxHp, site.hp + (stats.hp * 0.9) / stats.time);
  if (site.progress >= 1) {
    site.progress = 1;
    site.builder = -1;
    const p = m.players[site.owner];
    if (p !== undefined) p.stats.built += 1;
    m.events.push({ type: 'built', id: site.id, entity: site.type as BuildingType, owner: site.owner, x: site.x, y: site.y });
    e.order = { type: 'idle' };
  }
}

/** Cancels a building under construction (most of the money comes back). */
export function cancelConstruction(m: Match, site: Entity): boolean {
  if (!site.alive || !isBuilding(site) || site.progress >= 1) return false;
  const cost = BUILDINGS[site.type as BuildingType].cost;
  spend(m, site.owner, { minerals: Math.floor(cost.minerals * 0.75), gas: Math.floor(cost.gas * 0.75) }, -1);
  killEntity(m, site, -1);
  return true;
}

// ---- supply and production -------------------------------------------------------------

export function recomputeSupply(m: Match): void {
  for (const p of m.players) {
    p.supplyUsed = 0;
    p.supplyCap = 0;
  }
  for (const e of m.entities) {
    if (!e.alive || e.owner < 0) continue;
    const p = m.players[e.owner];
    if (p === undefined) continue;
    if (isUnit(e)) p.supplyUsed += unitStats(e).supply;
    else if (isBuilding(e)) {
      if (e.progress >= 1) p.supplyCap += BUILDINGS[e.type as BuildingType].supply;
      for (const item of e.queue) p.supplyUsed += UNITS[item.type].supply;
    }
  }
  for (const p of m.players) p.supplyCap = Math.min(p.supplyCap, ECONOMY.maxSupply);
}

/** A free place to put a new unit next to a building, as close as possible to where it is headed. */
function spawnSpot(m: Match, b: Entity, air: boolean): { x: number; y: number } {
  const f = footprint(b.type, b.x, b.y);
  const s = m.map.size;
  const towardX = b.rally?.x ?? b.x;
  const towardY = b.rally?.y ?? b.y + 20;
  let best = { x: b.x, y: f.y1 + 1.6 };
  let bestScore = Infinity;
  for (let ring = 0; ring < 2; ring++) {
    const left = f.x0 - 0.8 - ring;
    const right = f.x1 + 1.8 + ring;
    const top = f.y0 - 0.8 - ring;
    const bottom = f.y1 + 1.8 + ring;
    for (let t = left; t <= right; t += 0.75) {
      for (const y of [top, bottom]) consider(t, y);
    }
    for (let t = top; t <= bottom; t += 0.75) {
      for (const x of [left, right]) consider(x, t);
    }
    if (bestScore < Infinity) break;
  }
  function consider(x: number, y: number): void {
    if (x < 1 || y < 1 || x >= s - 1 || y >= s - 1) return;
    if (!air && m.blocked[Math.floor(y) * s + Math.floor(x)] === 1) return;
    const d = (x - towardX) * (x - towardX) + (y - towardY) * (y - towardY);
    if (d < bestScore) {
      bestScore = d;
      best = { x, y };
    }
  }
  return best;
}

/** What the unit does the moment it is made: walks to the rally point, or goes to work. */
function sendToRally(m: Match, b: Entity, u: Entity): void {
  if (b.rally === null) return;
  const patch = m.entities.find((e) => e.alive && e.type === 'minerals' && Math.abs(e.x - b.rally!.x) <= 0.9 && Math.abs(e.y - b.rally!.y) <= 0.9);
  if (u.type === 'worker' && patch !== undefined) {
    u.order = { type: 'gather', target: patch.id, phase: 'toResource', timer: 0 };
    setPath(m, u, patch.x, patch.y);
  } else {
    u.order = { type: 'move', x: b.rally.x, y: b.rally.y };
    setPath(m, u, b.rally.x, b.rally.y);
  }
}

/** Counts down the first item in each building's queue and makes the unit when it is done. */
export function updateProduction(m: Match): void {
  for (const b of m.entities) {
    if (!b.alive || !isBuilding(b) || b.progress < 1) continue;
    const item = b.queue[0];
    if (item === undefined) continue;
    item.left -= 1;
    if (item.left > 0) continue;
    b.queue.shift();
    const spot = spawnSpot(m, b, UNITS[item.type].air);
    const u = spawnUnit(m, item.type, b.owner, spot.x, spot.y);
    const p = m.players[b.owner];
    if (p !== undefined) p.stats.trained += 1;
    m.events.push({ type: 'trained', id: u.id, entity: item.type, owner: b.owner, x: spot.x, y: spot.y });
    sendToRally(m, b, u);
  }
}

/** Refineries make gas by themselves. */
export function updateRefineries(m: Match): void {
  for (const b of m.entities) {
    if (!b.alive || b.type !== 'refinery' || b.progress < 1) continue;
    const p = m.players[b.owner];
    if (p === undefined) continue;
    p.gasFraction += ECONOMY.refineryRate;
    if (p.gasFraction >= 1) {
      const whole = Math.floor(p.gasFraction);
      p.gas += whole;
      p.gasFraction -= whole;
    }
  }
}

export type { UnitType };
