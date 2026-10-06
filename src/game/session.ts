/**
 * What the player is doing with a match: what is selected, what mode the next click is in, and what each button and
 * click means. It turns the player's intent into the sim's commands. No DOM and no drawing: the controls call it with
 * plain numbers, the flow reads it to fill the HUD, and the tests drive it directly.
 */
import {
  BUILDINGS,
  ECONOMY,
  UNITS,
  buildingStats,
  checkPlacement,
  cmdAttack,
  cmdBuild,
  cmdCancelBuilding,
  cmdCancelTrain,
  cmdConstruct,
  cmdGather,
  cmdHold,
  cmdMove,
  cmdRally,
  cmdStop,
  cmdTrain,
  get,
  isAir,
  isBuilding,
  isUnit,
  planBuilding,
  typeName,
  unitStats,
  type BuildingType,
  type Entity,
  type Match,
  type Placement,
  type UnitType,
} from './sim';
import type { CardButton, SelectionInfo } from './ui';

export type Mode =
  | { kind: 'none' }
  | { kind: 'move' }
  | { kind: 'attackMove' }
  | { kind: 'rally' }
  | { kind: 'place'; building: BuildingType };

export type Menu = 'root' | 'build';

export interface Session {
  readonly match: Match;
  readonly player: number;
  readonly selected: Set<number>;
  readonly groups: Map<number, number[]>;
  mode: Mode;
  menu: Menu;
  /** Where the player was last told they were under attack. */
  lastAlert: { x: number; y: number } | null;
}

export interface Outcome {
  ok: boolean;
  /** Why it did not work: shown to the player. */
  reason: string;
  /** Where to show a marker on the ground. */
  ping: { kind: 'move' | 'attack' | 'rally'; x: number; y: number } | null;
  /** What it sounded like: the flow plays the matching sound. */
  sound: 'order' | 'attack' | 'train' | 'build' | 'select' | 'error' | null;
}

const OK = (extra: Partial<Outcome> = {}): Outcome => ({ ok: true, reason: '', ping: null, sound: 'order', ...extra });
const FAIL = (reason: string): Outcome => ({ ok: false, reason, ping: null, sound: 'error' });

/** The most units one selection holds. */
export const SELECTION_LIMIT = 48;

export function createSession(match: Match, player = 0): Session {
  return { match, player, selected: new Set(), groups: new Map(), mode: { kind: 'none' }, menu: 'root', lastAlert: null };
}

// ---- selection ------------------------------------------------------------------------------

/** The selected things that are still alive, dropping the rest from the selection. */
export function selection(s: Session): Entity[] {
  const out: Entity[] = [];
  for (const id of [...s.selected]) {
    const e = get(s.match, id);
    if (e === undefined) s.selected.delete(id);
    else out.push(e);
  }
  return out;
}

export const ownUnitsOf = (s: Session, list: readonly Entity[] = selection(s)): Entity[] => list.filter((e) => e.owner === s.player && isUnit(e));
export const ownBuildingsOf = (s: Session, list: readonly Entity[] = selection(s)): Entity[] => list.filter((e) => e.owner === s.player && isBuilding(e));

/**
 * Replaces the selection (or adds to it). Units and buildings do not mix, and anything that is not yours is only ever
 * selected alone, to be looked at.
 */
export function select(s: Session, ids: readonly number[], additive = false): void {
  s.mode = { kind: 'none' };
  s.menu = 'root';
  const fresh = ids.map((id) => get(s.match, id)).filter((e): e is Entity => e !== undefined);
  const mine = fresh.filter((e) => e.owner === s.player && (isUnit(e) || isBuilding(e)));
  if (mine.length === 0) {
    s.selected.clear();
    const other = fresh[0];
    if (other !== undefined) s.selected.add(other.id);
    return;
  }
  const base = additive ? selection(s).filter((e) => e.owner === s.player) : [];
  const result: Entity[] = [...base];
  const wantUnits = isUnit(base[0] ?? mine[0]!);
  for (const e of mine) {
    if (result.length >= SELECTION_LIMIT) break;
    if (isUnit(e) === wantUnits && !result.includes(e)) result.push(e);
  }
  s.selected.clear();
  for (const e of result) s.selected.add(e.id);
}

export function toggleSelected(s: Session, id: number): void {
  if (s.selected.has(id)) s.selected.delete(id);
  else select(s, [id], true);
}

export function clearSelection(s: Session): void {
  s.selected.clear();
  s.mode = { kind: 'none' };
  s.menu = 'root';
}

/** Workers doing nothing. */
export function idleWorkers(s: Session): Entity[] {
  return s.match.entities.filter((e) => e.alive && e.owner === s.player && e.type === 'worker' && e.order.type === 'idle');
}

/** Every fighting unit. */
export function armyOf(s: Session): Entity[] {
  return s.match.entities.filter((e) => e.alive && e.owner === s.player && isUnit(e) && e.type !== 'worker');
}

export function setGroup(s: Session, n: number): void {
  const ids = ownUnitsOf(s).map((e) => e.id);
  if (ids.length > 0) s.groups.set(n, ids);
}

/** The living members of a group, or none. */
export function recallGroup(s: Session, n: number): Entity[] {
  const live = (s.groups.get(n) ?? []).map((id) => get(s.match, id)).filter((e): e is Entity => e !== undefined);
  s.groups.set(n, live.map((e) => e.id));
  return live;
}

/** The middle of some entities. */
export function centreOf(list: readonly Entity[]): { x: number; y: number } | null {
  if (list.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const e of list) {
    x += e.x;
    y += e.y;
  }
  return { x: x / list.length, y: y / list.length };
}

// ---- orders from a click --------------------------------------------------------------------

const isEnemy = (s: Session, e: Entity): boolean => e.owner >= 0 && e.owner !== s.player;

/** A right click (or a tap with units selected): the meaning depends on what is under it. */
export function orderAt(s: Session, target: Entity | undefined, x: number, y: number): Outcome {
  const m = s.match;
  const list = selection(s);
  const units = ownUnitsOf(s, list);
  const buildings = ownBuildingsOf(s, list);

  if (units.length > 0) {
    const ids = units.map((u) => u.id);
    if (target !== undefined && isEnemy(s, target)) {
      const air = isAir(target);
      const able = units.filter((u) => {
        const w = UNITS[u.type as UnitType].weapon;
        return w !== null && (air ? w.air : w.ground);
      });
      const ableIds = able.map((u) => u.id);
      if (ableIds.length > 0) cmdAttack(m, s.player, ableIds, target.id);
      const rest = ids.filter((id) => !ableIds.includes(id));
      if (rest.length > 0) cmdMove(m, s.player, rest, target.x, target.y, true);
      return OK({ ping: { kind: 'attack', x: target.x, y: target.y }, sound: 'attack' });
    }
    if (target !== undefined && target.type === 'minerals') {
      const workers = units.filter((u) => u.type === 'worker').map((u) => u.id);
      const others = units.filter((u) => u.type !== 'worker').map((u) => u.id);
      if (workers.length > 0) cmdGather(m, s.player, workers, target.id);
      if (others.length > 0) cmdMove(m, s.player, others, target.x, target.y);
      return OK({ ping: { kind: 'move', x: target.x, y: target.y } });
    }
    if (target !== undefined && target.owner === s.player && isBuilding(target) && target.progress < 1) {
      const workers = units.filter((u) => u.type === 'worker').map((u) => u.id);
      if (workers.length > 0) {
        const result = cmdConstruct(m, s.player, workers, target.id);
        if (result.ok) return OK({ ping: { kind: 'move', x: target.x, y: target.y }, sound: 'build' });
      }
    }
    const result = cmdMove(m, s.player, ids, x, y);
    return result.ok ? OK({ ping: { kind: 'move', x, y } }) : FAIL(result.reason);
  }

  if (buildings.length > 0) {
    let any = false;
    for (const b of buildings) {
      if (b.progress >= 1 && buildingStats(b).produces.length > 0 && cmdRally(m, s.player, b.id, x, y).ok) any = true;
    }
    return any ? OK({ ping: { kind: 'rally', x, y } }) : FAIL('Nothing to command');
  }
  return FAIL('Nothing selected');
}

/** Attack-move: walk there and fight whatever is met on the way. */
export function attackMoveAt(s: Session, x: number, y: number): Outcome {
  const ids = ownUnitsOf(s).map((u) => u.id);
  if (ids.length === 0) return FAIL('Select some units first');
  const result = cmdMove(s.match, s.player, ids, x, y, true);
  s.mode = { kind: 'none' };
  return result.ok ? OK({ ping: { kind: 'attack', x, y }, sound: 'attack' }) : FAIL(result.reason);
}

/** Move (the Move button, then a click). */
export function moveTo(s: Session, x: number, y: number): Outcome {
  s.mode = { kind: 'none' };
  return orderAt(s, undefined, x, y);
}

/** Set the rally point of the selected buildings. */
export function rallyTo(s: Session, x: number, y: number, target?: Entity): Outcome {
  s.mode = { kind: 'none' };
  const at = target !== undefined && target.type === 'minerals' ? { x: target.x, y: target.y } : { x, y };
  let any = false;
  for (const b of ownBuildingsOf(s)) if (b.progress >= 1 && cmdRally(s.match, s.player, b.id, at.x, at.y).ok) any = true;
  return any ? OK({ ping: { kind: 'rally', x: at.x, y: at.y } }) : FAIL('Nothing to set');
}

/** Where the building would go for a click, and whether it can. */
export function placementAt(s: Session, type: BuildingType, x: number, y: number): Placement {
  return planBuilding(s.match, s.player, type, x, y);
}

/** The worker that should build: the idle one nearest, else the nearest. */
function builderFor(s: Session, x: number, y: number): Entity | undefined {
  const workers = ownUnitsOf(s).filter((u) => u.type === 'worker');
  let best: Entity | undefined;
  let bestScore = Infinity;
  for (const w of workers) {
    const d = (w.x - x) * (w.x - x) + (w.y - y) * (w.y - y);
    const score = d + (w.order.type === 'idle' ? 0 : 400) + (w.order.type === 'build' || w.order.type === 'construct' ? 400 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

/** Put the building being placed down. On success the mode ends. */
export function placeAt(s: Session, x: number, y: number, keepMode = false): Outcome {
  if (s.mode.kind !== 'place') return FAIL('Nothing to build');
  const type = s.mode.building;
  const place = planBuilding(s.match, s.player, type, x, y);
  if (!place.ok) return FAIL(place.reason);
  const worker = builderFor(s, place.x, place.y);
  if (worker === undefined) return FAIL('Select a worker first');
  const result = cmdBuild(s.match, s.player, worker.id, type, place.x, place.y);
  if (!result.ok) return FAIL(result.reason);
  if (!keepMode) {
    s.mode = { kind: 'none' };
    s.menu = 'root';
  }
  return OK({ ping: { kind: 'move', x: place.x, y: place.y }, sound: 'build' });
}

// ---- buttons --------------------------------------------------------------------------------

const BLANK: CardButton = { id: '', label: '', hotkey: '', icon: '', cost: '', enabled: false, active: false, hint: '' };

const costText = (minerals: number, gas: number): string => (gas > 0 ? `${minerals}/${gas}` : minerals > 0 ? String(minerals) : '');

/** Why a unit cannot be queued at a building right now, or ''. */
function trainReason(s: Session, building: Entity, type: UnitType): string {
  const p = s.match.players[s.player];
  const stats = UNITS[type];
  if (p === undefined) return 'No player';
  if (building.queue.length >= ECONOMY.queueLimit) return 'Queue is full';
  if (p.minerals < stats.cost.minerals) return 'Not enough minerals';
  if (p.gas < stats.cost.gas) return 'Not enough gas';
  if (p.supplyUsed + stats.supply > p.supplyCap) return 'Need more depots';
  return '';
}

/** Which building a "train" button queues at: the one among the selected that has the shortest queue. */
function producerFor(s: Session, type: UnitType): Entity | undefined {
  let best: Entity | undefined;
  for (const b of ownBuildingsOf(s)) {
    if (b.progress < 1 || !buildingStats(b).produces.includes(type)) continue;
    if (best === undefined || b.queue.length < best.queue.length) best = b;
  }
  return best;
}

const BUILD_MENU: readonly { type: BuildingType; key: string }[] = [
  { type: 'depot', key: 'D' },
  { type: 'barracks', key: 'B' },
  { type: 'refinery', key: 'R' },
  { type: 'factory', key: 'F' },
  { type: 'airfield', key: 'A' },
  { type: 'turret', key: 'T' },
  { type: 'hub', key: 'H' },
];

function buildReason(s: Session, type: BuildingType): string {
  const stats = BUILDINGS[type];
  const p = s.match.players[s.player];
  if (p === undefined) return 'No player';
  if (stats.requires !== null && !s.match.entities.some((e) => e.alive && e.owner === s.player && e.type === stats.requires && e.progress >= 1)) {
    return `Needs a ${BUILDINGS[stats.requires].name}`;
  }
  if (p.minerals < stats.cost.minerals) return 'Not enough minerals';
  if (p.gas < stats.cost.gas) return 'Not enough gas';
  return '';
}

const button = (id: string, label: string, hotkey: string, icon: string, cost = '', hint = '', enabled = true, active = false): CardButton => ({ id, label, hotkey, icon, cost, hint, enabled, active });

/** The nine buttons for what is selected and the mode the player is in. */
export function cardFor(s: Session): CardButton[] {
  const slots: CardButton[] = Array.from({ length: 9 }, () => ({ ...BLANK }));
  const put = (slot: number, b: CardButton): void => {
    slots[slot] = b;
  };
  const list = selection(s);
  const units = ownUnitsOf(s, list);
  const buildings = ownBuildingsOf(s, list);

  if (s.mode.kind === 'place') {
    put(0, button('confirm', 'Build here', 'Enter', 'confirm', '', 'Place the building where the outline is'));
    put(8, button('cancel', 'Cancel', 'Esc', 'cancel'));
    return slots;
  }
  if (s.mode.kind !== 'none') {
    put(8, button('cancel', 'Cancel', 'Esc', 'cancel'));
    return slots;
  }

  if (units.length > 0) {
    const workers = units.some((u) => u.type === 'worker');
    const fighters = units.some((u) => u.type !== 'worker');
    if (s.menu === 'build' && workers) {
      BUILD_MENU.forEach((entry, i) => {
        const stats = BUILDINGS[entry.type];
        const reason = buildReason(s, entry.type);
        put(i, button(`build:${entry.type}`, stats.name, entry.key, entry.type, costText(stats.cost.minerals, stats.cost.gas), reason !== '' ? reason : stats.blurb, reason === ''));
      });
      put(8, button('back', 'Back', 'Esc', 'back'));
      return slots;
    }
    put(0, button('move', 'Move', 'M', 'move', '', 'Right click does the same'));
    put(1, button('stop', 'Stop', 'S', 'stop'));
    put(2, button('hold', 'Hold', 'H', 'hold', '', 'Stand and shoot, never chase'));
    if (fighters) put(3, button('attackMove', 'Attack', 'A', 'attack', '', 'Move, fighting whatever you meet'));
    if (workers) {
      put(4, button('buildMenu', 'Build', 'B', 'build', '', 'Raise a building'));
      put(5, button('mine', 'Mine', 'G', 'gather', '', 'Mine the nearest minerals'));
    }
    return slots;
  }

  const building = buildings[0];
  if (building !== undefined) {
    if (building.progress < 1) {
      put(8, button('cancelBuild', 'Cancel', 'X', 'cancel', '', 'Stop building: most of the money comes back'));
      return slots;
    }
    const stats = buildingStats(building);
    stats.produces.forEach((type, i) => {
      const u = UNITS[type];
      const reason = producerFor(s, type) !== undefined ? trainReason(s, producerFor(s, type)!, type) : 'Not ready';
      put(i, button(`train:${type}`, u.name, ['Q', 'W', 'E'][i] ?? '', type, costText(u.cost.minerals, u.cost.gas), reason !== '' ? reason : u.blurb, reason === ''));
    });
    if (stats.produces.length > 0) {
      put(3, button('rally', 'Rally', 'R', 'rally', '', 'Where new units go'));
      if (building.queue.length > 0) put(4, button('cancelTrain', 'Cancel', 'X', 'cancel', '', 'Take the last unit out of the queue'));
    }
  }
  return slots;
}

/** The button a key press means, if any. */
export function buttonForKey(buttons: readonly CardButton[], key: string): CardButton | undefined {
  const wanted = key.length === 1 ? key.toUpperCase() : key === 'Enter' ? 'Enter' : key === 'Escape' ? 'Esc' : key;
  return buttons.find((b) => b.id !== '' && b.hotkey === wanted);
}

/** Does what a card button says. */
export function pressCard(s: Session, id: string): Outcome {
  const m = s.match;
  const units = ownUnitsOf(s);
  const ids = units.map((u) => u.id);
  switch (id) {
    case 'move':
      s.mode = { kind: 'move' };
      return OK({ sound: 'select' });
    case 'attackMove':
      s.mode = { kind: 'attackMove' };
      return OK({ sound: 'select' });
    case 'rally':
      s.mode = { kind: 'rally' };
      return OK({ sound: 'select' });
    case 'stop':
      cmdStop(m, s.player, ids);
      return OK();
    case 'hold':
      cmdHold(m, s.player, ids);
      return OK();
    case 'buildMenu':
      s.menu = 'build';
      return OK({ sound: 'select' });
    case 'back':
    case 'cancel':
      s.mode = { kind: 'none' };
      s.menu = id === 'back' ? 'root' : s.menu;
      return OK({ sound: 'select' });
    case 'mine': {
      const workers = units.filter((u) => u.type === 'worker');
      const first = workers[0];
      if (first === undefined) return FAIL('Select a worker');
      const patch = nearestMinerals(s, first.x, first.y);
      if (patch === undefined) return FAIL('No minerals left');
      cmdGather(m, s.player, workers.map((w) => w.id), patch.id);
      return OK({ ping: { kind: 'move', x: patch.x, y: patch.y } });
    }
    case 'cancelBuild': {
      const site = ownBuildingsOf(s).find((b) => b.progress < 1);
      if (site === undefined) return FAIL('Nothing to cancel');
      const result = cmdCancelBuilding(m, s.player, site.id);
      if (result.ok) s.selected.delete(site.id);
      return result.ok ? OK() : FAIL(result.reason);
    }
    case 'cancelTrain': {
      const building = ownBuildingsOf(s).find((b) => b.queue.length > 0);
      if (building === undefined) return FAIL('Nothing queued');
      const result = cmdCancelTrain(m, s.player, building.id, building.queue.length - 1);
      return result.ok ? OK() : FAIL(result.reason);
    }
    default:
  }
  if (id.startsWith('train:')) {
    const type = id.slice('train:'.length) as UnitType;
    const producer = producerFor(s, type);
    if (producer === undefined) return FAIL('Not ready');
    const result = cmdTrain(m, s.player, producer.id, type);
    return result.ok ? OK({ sound: 'train' }) : FAIL(result.reason);
  }
  if (id.startsWith('build:')) {
    const type = id.slice('build:'.length) as BuildingType;
    const reason = buildReason(s, type);
    if (reason !== '') return FAIL(reason);
    s.mode = { kind: 'place', building: type };
    return OK({ sound: 'select' });
  }
  return FAIL('Unknown command');
}

/** Queue a unit by its hotkey-less name (used by tests and the AI-free debug hooks). */
export function nearestMinerals(s: Session, x: number, y: number): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of s.match.entities) {
    if (!e.alive || e.type !== 'minerals') continue;
    const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Removes an item from the training queue of the (single) selected building. */
export function cancelQueued(s: Session, index: number): Outcome {
  const building = ownBuildingsOf(s)[0];
  if (building === undefined) return FAIL('Nothing selected');
  const result = cmdCancelTrain(s.match, s.player, building.id, index);
  return result.ok ? OK() : FAIL(result.reason);
}

// ---- what to show of the selection ----------------------------------------------------------

const weaponLine = (type: UnitType): string => {
  const w = UNITS[type].weapon;
  if (w === null) return 'Unarmed';
  const hits = w.air && w.ground ? 'ground and air' : w.air ? 'air only' : 'ground only';
  return `Damage ${w.damage}${w.splash !== undefined ? ' (splash)' : ''} · Range ${w.range} · ${hits}`;
};

/** What the selection panel shows, or null when nothing is selected. */
export function selectionInfo(s: Session): SelectionInfo | null {
  const list = selection(s);
  const first = list[0];
  if (first === undefined) return null;
  const team = first.owner;

  if (list.length > 1) {
    const counts = new Map<string, number>();
    for (const e of list) counts.set(typeName(e.type), (counts.get(typeName(e.type)) ?? 0) + 1);
    const summary = [...counts.entries()].map(([name, n]) => `${n} ${name}${n > 1 ? 's' : ''}`).join(', ');
    return {
      title: `${list.length} selected`,
      lines: [summary],
      icon: first.type,
      hp: -1,
      hpText: '',
      building: -1,
      team,
      items: list.map((e) => ({ id: e.id, icon: e.type, name: typeName(e.type), frac: e.hp / e.maxHp })),
      queue: [],
    };
  }

  const e = first;
  const lines: string[] = [];
  let queue: SelectionInfo['queue'] = [];
  let hp = -1;
  let hpText = '';
  let building = -1;

  if (isUnit(e)) {
    const stats = unitStats(e);
    lines.push(weaponLine(e.type as UnitType), `Armor ${stats.armor} · Sight ${stats.vision}${stats.air ? ' · Flying' : ''}`);
    if (e.type === 'worker' && e.carry > 0) lines.push(`Carrying ${e.carry} minerals`);
    hp = e.hp / e.maxHp;
    hpText = `${Math.ceil(e.hp)} / ${e.maxHp}`;
  } else if (isBuilding(e)) {
    const stats = buildingStats(e);
    lines.push(stats.blurb);
    if (stats.weapon !== null) lines.push(`Damage ${stats.weapon.damage} · Range ${stats.weapon.range}`);
    hp = e.hp / e.maxHp;
    hpText = `${Math.ceil(e.hp)} / ${e.maxHp}`;
    if (e.progress < 1) building = e.progress;
    if (e.owner === s.player) {
      queue = e.queue.map((item, i) => ({ icon: item.type, progress: i === 0 ? 1 - item.left / UNITS[item.type].time : 0 }));
    }
  } else if (e.type === 'minerals') {
    lines.push(`${Math.max(0, Math.ceil(e.amount))} minerals left`, 'Workers mine these');
  } else {
    lines.push('A vent of gas', 'Build a refinery on it');
  }
  return { title: typeName(e.type), lines, icon: e.type, hp, hpText, building, team, items: [], queue };
}

/** "m:ss" for a tick count. */
export function clockText(tick: number, tps = 20): string {
  const seconds = Math.floor(tick / tps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export { checkPlacement };
