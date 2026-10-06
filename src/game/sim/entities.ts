/** Making entities, hurting them, and the ground they stand on. */
import { BUILDINGS, ECONOMY, UNITS, type BuildingType, type EntityType, type UnitType } from './config';
import { buildingStats, get, isBuilding, isResource, isUnit, unitStats, type Match } from './state';
import type { Entity } from './types';

/** The cells (inclusive) a building or resource of this type covers when its centre is at (x, y). */
export function footprint(type: EntityType, x: number, y: number): { x0: number; y0: number; x1: number; y1: number } {
  let w = 1;
  let h = 1;
  if (type in BUILDINGS) {
    w = BUILDINGS[type as BuildingType].w;
    h = BUILDINGS[type as BuildingType].h;
  } else if (type === 'geyser') {
    w = 3;
    h = 3;
  }
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - h / 2);
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

/** Moves a building's intended centre onto the grid: even sizes sit on a corner, odd sizes in a cell's middle. */
export function snapCentre(type: BuildingType, x: number, y: number): { x: number; y: number } {
  const { w, h } = BUILDINGS[type];
  return { x: w % 2 === 0 ? Math.round(x) : Math.floor(x) + 0.5, y: h % 2 === 0 ? Math.round(y) : Math.floor(y) + 0.5 };
}

export function newEntity(m: Match, type: EntityType, owner: number, x: number, y: number): Entity {
  let maxHp = 1;
  if (type in UNITS) maxHp = UNITS[type as UnitType].hp;
  else if (type in BUILDINGS) maxHp = BUILDINGS[type as BuildingType].hp;
  else maxHp = 1;
  return {
    id: m.nextId++,
    type,
    owner,
    x,
    y,
    px: x,
    py: y,
    fx: 0,
    fy: 1,
    hp: maxHp,
    maxHp,
    alive: true,
    order: { type: 'idle' },
    path: [],
    pathVersion: m.pathVersion,
    goalX: x,
    goalY: y,
    resume: null,
    retries: 0,
    cooldown: 0,
    carry: 0,
    stuck: 0,
    lastX: x,
    lastY: y,
    hurtAt: -1000,
    progress: 1,
    builder: -1,
    queue: [],
    rally: null,
    amount: type === 'minerals' ? ECONOMY.patchMinerals : 0,
  };
}

function setBlocked(m: Match, e: Entity, value: boolean): void {
  const f = footprint(e.type, e.x, e.y);
  const s = m.map.size;
  for (let y = f.y0; y <= f.y1; y++) {
    for (let x = f.x0; x <= f.x1; x++) {
      if (x < 0 || y < 0 || x >= s || y >= s) continue;
      m.blocked[y * s + x] = value ? 1 : (m.map.rock[y * s + x] ?? 0);
    }
  }
}

/** Puts an entity in the match. Buildings and resources block the ground they cover. */
export function addEntity(m: Match, e: Entity): Entity {
  m.entities.push(e);
  m.byId.set(e.id, e);
  if (!isUnit(e)) {
    setBlocked(m, e, true);
    m.pathVersion += 1;
  }
  m.events.push({ type: 'spawn', id: e.id, entity: e.type, owner: e.owner, x: e.x, y: e.y });
  return e;
}

export function spawnUnit(m: Match, type: UnitType, owner: number, x: number, y: number): Entity {
  return addEntity(m, newEntity(m, type, owner, x, y));
}

/** Removes an entity from play (its body is cleared out of the list a little later). */
export function killEntity(m: Match, e: Entity, killer: number): void {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  e.path = [];
  if (!isUnit(e)) {
    setBlocked(m, e, false);
    m.pathVersion += 1;
  }
  if (e.builder >= 0) {
    const worker = m.byId.get(e.builder);
    if (worker !== undefined && worker.alive && worker.order.type === 'construct' && worker.order.site === e.id) worker.order = { type: 'idle' };
  }
  if (isUnit(e) && e.order.type === 'construct') {
    const site = m.byId.get(e.order.site);
    if (site !== undefined && site.builder === e.id) site.builder = -1;
  }
  const loser = m.players[e.owner];
  const winner = killer >= 0 ? m.players[m.byId.get(killer)?.owner ?? -1] : undefined;
  if (loser !== undefined) {
    if (isUnit(e)) loser.stats.unitsLost += 1;
    else if (isBuilding(e)) loser.stats.buildingsLost += 1;
  }
  if (winner !== undefined && winner !== loser) {
    if (isUnit(e)) winner.stats.unitsKilled += 1;
    else if (isBuilding(e)) winner.stats.buildingsKilled += 1;
  }
  m.events.push({ type: 'death', id: e.id, entity: e.type, owner: e.owner, x: e.x, y: e.y, killer });
}

/** Damage after armour (at least 1). A building under construction takes it as normal. */
export function damage(m: Match, target: Entity, amount: number, attackerId: number): void {
  if (!target.alive || isResource(target)) return;
  const armor = isUnit(target) ? unitStats(target).armor : buildingStats(target).armor;
  target.hp -= Math.max(1, amount - armor);
  target.hurtAt = m.tick;
  const owner = target.owner;
  if (owner >= 0 && m.tick - (m.attackAlertAt[owner] ?? -1000) > 20 * 8) {
    m.attackAlertAt[owner] = m.tick;
    m.events.push({ type: 'alert', owner, kind: 'attack', x: target.x, y: target.y });
  }
  if (target.hp <= 0) killEntity(m, target, attackerId);
}

export const entityOwner = (m: Match, id: number): number => get(m, id)?.owner ?? -1;
