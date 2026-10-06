import { describe, expect, it } from 'vitest';
import {
  SELECTION_LIMIT,
  armyOf,
  attackMoveAt,
  buttonForKey,
  cancelQueued,
  cardFor,
  centreOf,
  clearSelection,
  clockText,
  createSession,
  idleWorkers,
  orderAt,
  placeAt,
  placementAt,
  pressCard,
  rallyTo,
  recallGroup,
  select,
  selection,
  selectionInfo,
  setGroup,
  toggleSelected,
} from '../src/game/session';
import { ECONOMY, UNITS } from '../src/game/sim/testing';
import { ARENA, building, find, openGround, quiet, reveal, rich, run, unit } from './helpers/world';

const { x: X, y: Y } = ARENA;

/** A quiet arena match with a session for player 0. */
function setup() {
  const m = quiet(1, true);
  return { m, s: createSession(m, 0) };
}

describe('selecting', () => {
  it('replaces the selection, or adds to it', () => {
    const { m, s } = setup();
    const a = unit(m, 'trooper', 0, X, Y);
    const b = unit(m, 'trooper', 0, X + 2, Y);
    select(s, [a.id]);
    expect([...s.selected]).toEqual([a.id]);
    select(s, [b.id], true);
    expect([...s.selected].sort()).toEqual([a.id, b.id].sort());
    select(s, [b.id]);
    expect([...s.selected]).toEqual([b.id]);
    toggleSelected(s, b.id);
    expect(s.selected.size).toBe(0);
    toggleSelected(s, a.id);
    expect([...s.selected]).toEqual([a.id]);
  });

  it('never mixes units and buildings', () => {
    const { m, s } = setup();
    const u = unit(m, 'trooper', 0, X, Y);
    const b = building(m, 'barracks', 0, X + 5.5, Y + 0.5);
    select(s, [u.id, b.id]);
    expect([...s.selected]).toEqual([u.id]);
    select(s, [b.id], true);
    expect([...s.selected]).toEqual([u.id]);
    select(s, [b.id]);
    expect([...s.selected]).toEqual([b.id]);
  });

  it('shows what is not yours only one at a time, and cannot add it to your own', () => {
    const { m, s } = setup();
    const mine = unit(m, 'trooper', 0, X, Y);
    const theirs = unit(m, 'trooper', 1, X + 3, Y);
    const theirs2 = unit(m, 'trooper', 1, X + 4, Y);
    select(s, [theirs.id, theirs2.id]);
    expect([...s.selected]).toEqual([theirs.id]);
    select(s, [mine.id]);
    select(s, [theirs.id], true);
    expect([...s.selected]).toEqual([theirs.id]);
    const patch = m.entities.find((e) => e.type === 'minerals')!;
    select(s, [patch.id]);
    expect([...s.selected]).toEqual([patch.id]);
  });

  it('holds only so many, ignores the dead, and forgets them', () => {
    const { m, s } = setup();
    const crowd = Array.from({ length: SELECTION_LIMIT + 10 }, (_, i) => unit(m, 'worker', 0, 10 + (i % 20), 30 + Math.floor(i / 20)));
    select(s, crowd.map((e) => e.id));
    expect(s.selected.size).toBe(SELECTION_LIMIT);
    crowd[0]!.alive = false;
    expect(selection(s)).toHaveLength(SELECTION_LIMIT - 1);
    expect(s.selected.size).toBe(SELECTION_LIMIT - 1);
    clearSelection(s);
    expect(s.selected.size).toBe(0);
  });

  it('remembers groups, and a group forgets its dead', () => {
    const { m, s } = setup();
    const a = unit(m, 'trooper', 0, X, Y);
    const b = unit(m, 'tank', 0, X + 2, Y);
    select(s, [a.id, b.id]);
    setGroup(s, 3);
    clearSelection(s);
    expect(recallGroup(s, 3).map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    b.alive = false;
    expect(recallGroup(s, 3).map((e) => e.id)).toEqual([a.id]);
    expect(recallGroup(s, 4)).toEqual([]);
    expect(centreOf([a])).toEqual({ x: X, y: Y });
    expect(centreOf([])).toBeNull();
  });

  it('knows the idle workers and the army', () => {
    const { m, s } = setup();
    const w = unit(m, 'worker', 0, X, Y);
    const busy = unit(m, 'worker', 0, X + 2, Y);
    busy.order = { type: 'move', x: X, y: Y };
    const t = unit(m, 'trooper', 0, X + 4, Y);
    unit(m, 'tank', 1, X + 30, Y);
    expect(idleWorkers(s).map((e) => e.id)).toEqual([w.id]);
    expect(armyOf(s).map((e) => e.id)).toEqual([t.id]);
  });
});

describe('the command card', () => {
  const ids = (s: ReturnType<typeof setup>['s']) => cardFor(s).filter((b) => b.id !== '').map((b) => b.id);

  it('is always nine slots, and empty with nothing selected', () => {
    const { s } = setup();
    expect(cardFor(s)).toHaveLength(9);
    expect(ids(s)).toEqual([]);
  });

  it('gives fighters move, stop, hold and attack; workers also build and mine, but do not attack-move', () => {
    const { m, s } = setup();
    const t = unit(m, 'trooper', 0, X, Y);
    select(s, [t.id]);
    expect(ids(s)).toEqual(['move', 'stop', 'hold', 'attackMove']);
    const w = unit(m, 'worker', 0, X + 2, Y);
    select(s, [w.id]);
    expect(ids(s)).toEqual(['move', 'stop', 'hold', 'buildMenu', 'mine']);
    select(s, [w.id, t.id]);
    expect(ids(s)).toEqual(['move', 'stop', 'hold', 'attackMove', 'buildMenu', 'mine']);
  });

  it('has hotkeys that find their buttons', () => {
    const { m, s } = setup();
    select(s, [unit(m, 'trooper', 0, X, Y).id]);
    const card = cardFor(s);
    expect(buttonForKey(card, 'a')?.id).toBe('attackMove');
    expect(buttonForKey(card, 'S')?.id).toBe('stop');
    expect(buttonForKey(card, 'z')).toBeUndefined();
    expect(buttonForKey(card, 'Escape')).toBeUndefined();
  });

  it('a worker\'s build menu lists the buildings, with costs, and says why one cannot be built', () => {
    const { m, s } = setup();
    select(s, [unit(m, 'worker', 0, X, Y).id]);
    m.players[0]!.minerals = 120;
    pressCard(s, 'buildMenu');
    expect(s.menu).toBe('build');
    const card = cardFor(s);
    const get = (id: string) => card.find((b) => b.id === id)!;
    expect(get('build:depot')).toMatchObject({ enabled: true, cost: '100', hotkey: 'D' });
    expect(get('build:barracks')).toMatchObject({ enabled: false, hint: 'Not enough minerals' });
    expect(get('build:factory')).toMatchObject({ enabled: false, hint: 'Needs a Barracks' });
    expect(get('build:airfield').cost).toBe('150/100');
    expect(card.find((b) => b.id === 'back')).toBeDefined();
    pressCard(s, 'back');
    expect(s.menu).toBe('root');
  });

  it('a building shows what it makes; a queue adds cancel; one going up only cancels', () => {
    const { m, s } = setup();
    const hub = find(m, 'hub', 0)!;
    select(s, [hub.id]);
    expect(ids(s)).toEqual(['train:worker', 'rally']);
    pressCard(s, 'train:worker');
    expect(ids(s)).toEqual(['train:worker', 'rally', 'cancelTrain']);
    const site = building(m, 'barracks', 0, X + 0.5, Y + 0.5, false);
    select(s, [site.id]);
    expect(ids(s)).toEqual(['cancelBuild']);
    const done = building(m, 'depot', 0, X + 8, Y);
    select(s, [done.id]);
    expect(ids(s)).toEqual([]);
  });

  it('placing and targeting modes show only confirm or cancel', () => {
    const { m, s } = setup();
    select(s, [unit(m, 'worker', 0, X, Y).id]);
    pressCard(s, 'buildMenu');
    m.players[0]!.minerals = 500;
    expect(pressCard(s, 'build:depot').ok).toBe(true);
    expect(s.mode).toEqual({ kind: 'place', building: 'depot' });
    expect(ids(s)).toEqual(['confirm', 'cancel']);
    pressCard(s, 'cancel');
    expect(s.mode.kind).toBe('none');
    expect(s.menu).toBe('build');
    pressCard(s, 'attackMove');
    expect(ids(s)).toEqual(['cancel']);
  });

  it('refuses to start placing what cannot be built', () => {
    const { m, s } = setup();
    select(s, [unit(m, 'worker', 0, X, Y).id]);
    expect(pressCard(s, 'build:factory')).toMatchObject({ ok: false, reason: 'Needs a Barracks' });
    m.players[0]!.minerals = 10;
    expect(pressCard(s, 'build:depot')).toMatchObject({ ok: false, reason: 'Not enough minerals' });
    expect(s.mode.kind).toBe('none');
  });
});

describe('training and cancelling', () => {
  it('queues at the building, takes the money, and says why when it cannot', () => {
    const { m, s } = setup();
    const hub = find(m, 'hub', 0)!;
    select(s, [hub.id]);
    const before = m.players[0]!.minerals;
    expect(pressCard(s, 'train:worker')).toMatchObject({ ok: true, sound: 'train' });
    expect(m.players[0]!.minerals).toBe(before - UNITS.worker.cost.minerals);
    expect(hub.queue).toHaveLength(1);
    m.players[0]!.minerals = 10;
    expect(pressCard(s, 'train:worker')).toMatchObject({ ok: false, reason: 'Not enough minerals' });
    const card = cardFor(s).find((b) => b.id === 'train:worker')!;
    expect(card).toMatchObject({ enabled: false, hint: 'Not enough minerals' });
  });

  it('with several buildings selected, the least busy one takes the order', () => {
    const { m, s } = setup();
    rich(m, 0);
    m.players[0]!.supplyCap = 100;
    const a = building(m, 'barracks', 0, X + 0.5, Y + 0.5);
    const b = building(m, 'barracks', 0, X + 6.5, Y + 0.5);
    select(s, [a.id, b.id]);
    pressCard(s, 'train:trooper');
    pressCard(s, 'train:trooper');
    pressCard(s, 'train:trooper');
    expect([a.queue.length, b.queue.length].sort()).toEqual([1, 2]);
  });

  it('cancels a queued unit and gives the money back; cancels a building going up', () => {
    const { m, s } = setup();
    const hub = find(m, 'hub', 0)!;
    select(s, [hub.id]);
    pressCard(s, 'train:worker');
    pressCard(s, 'train:worker');
    const minerals = m.players[0]!.minerals;
    expect(cancelQueued(s, 1).ok).toBe(true);
    expect(m.players[0]!.minerals).toBe(minerals + 50);
    pressCard(s, 'cancelTrain');
    expect(hub.queue).toHaveLength(0);
    expect(cancelQueued(s, 0).ok).toBe(false);

    const site = building(m, 'barracks', 0, X + 0.5, Y + 0.5, false);
    select(s, [site.id]);
    expect(pressCard(s, 'cancelBuild').ok).toBe(true);
    expect(site.alive).toBe(false);
    expect(s.selected.size).toBe(0);
  });
});

describe('what a click means', () => {
  it('on the ground: move; the group spreads out', () => {
    const { m, s } = setup();
    const a = unit(m, 'trooper', 0, X, Y);
    const b = unit(m, 'trooper', 0, X + 1, Y);
    select(s, [a.id, b.id]);
    const out = orderAt(s, undefined, X + 10, Y);
    expect(out).toMatchObject({ ok: true, ping: { kind: 'move', x: X + 10, y: Y } });
    expect(a.order.type).toBe('move');
    expect(b.order.type).toBe('move');
    const spot = (u: typeof a) => `${(u.order as { x: number }).x},${(u.order as { y: number }).y}`;
    expect(spot(a)).not.toBe(spot(b));
  });

  it('on an enemy: attack with whoever can hit it, the rest walk up', () => {
    const { m, s } = setup();
    const trooper = unit(m, 'trooper', 0, X, Y);
    const tank = unit(m, 'tank', 0, X + 2, Y);
    const skiff = unit(m, 'skiff', 1, X + 12, Y);
    const grunt = unit(m, 'trooper', 1, X + 12, Y + 3);
    select(s, [trooper.id, tank.id]);
    expect(orderAt(s, skiff, skiff.x, skiff.y)).toMatchObject({ ok: true, sound: 'attack', ping: { kind: 'attack' } });
    expect(trooper.order).toMatchObject({ type: 'attack', target: skiff.id });
    expect(tank.order.type).toBe('attackMove'); // cannot shoot up: it walks toward it
    orderAt(s, grunt, grunt.x, grunt.y);
    expect(tank.order).toMatchObject({ type: 'attack', target: grunt.id });
  });

  it('on minerals: workers mine, others just walk there', () => {
    const { m, s } = setup();
    const w = unit(m, 'worker', 0, X, Y);
    const t = unit(m, 'trooper', 0, X + 1, Y);
    const patch = m.entities.find((e) => e.type === 'minerals')!;
    select(s, [w.id, t.id]);
    orderAt(s, patch, patch.x, patch.y);
    expect(w.order.type).toBe('gather');
    expect(t.order.type).toBe('move');
  });

  it('on a building going up: a worker helps build it', () => {
    const { m, s } = setup();
    const w = unit(m, 'worker', 0, X, Y);
    const site = building(m, 'depot', 0, X + 6, Y, false);
    select(s, [w.id]);
    expect(orderAt(s, site, site.x, site.y)).toMatchObject({ ok: true, sound: 'build' });
    expect(w.order).toEqual({ type: 'construct', site: site.id });
  });

  it('with a building selected: sets its rally point (and nothing for a depot)', () => {
    const { m, s } = setup();
    const b = building(m, 'barracks', 0, X + 0.5, Y + 0.5);
    select(s, [b.id]);
    expect(orderAt(s, undefined, X + 9, Y + 4)).toMatchObject({ ok: true, ping: { kind: 'rally' } });
    expect(b.rally).toEqual({ x: X + 9, y: Y + 4 });
    const depot = building(m, 'depot', 0, X + 14, Y);
    select(s, [depot.id]);
    expect(orderAt(s, undefined, X + 9, Y).ok).toBe(false);
    expect(depot.rally).toBeNull();
    clearSelection(s);
    expect(orderAt(s, undefined, X, Y)).toMatchObject({ ok: false, reason: 'Nothing selected' });
  });

  it('rally on minerals sends new workers to mine', () => {
    const { m, s } = setup();
    const hub = find(m, 'hub', 0)!;
    const patch = m.entities.filter((e) => e.type === 'minerals').sort((p, q) => Math.hypot(p.x - hub.x, p.y - hub.y) - Math.hypot(q.x - hub.x, q.y - hub.y))[0]!;
    select(s, [hub.id]);
    pressCard(s, 'rally');
    expect(s.mode.kind).toBe('rally');
    expect(rallyTo(s, patch.x, patch.y, patch).ok).toBe(true);
    expect(s.mode.kind).toBe('none');
    pressCard(s, 'train:worker');
    run(m, 13);
    expect(find(m, 'worker', 0)!.order.type).toBe('gather');
  });

  it('attack-move needs units, and ends the mode', () => {
    const { m, s } = setup();
    expect(attackMoveAt(s, X, Y)).toMatchObject({ ok: false });
    const t = unit(m, 'trooper', 0, X, Y);
    select(s, [t.id]);
    pressCard(s, 'attackMove');
    expect(attackMoveAt(s, X + 8, Y)).toMatchObject({ ok: true, ping: { kind: 'attack' } });
    expect(t.order.type).toBe('attackMove');
    expect(s.mode.kind).toBe('none');
  });

  it('Mine sends the selected workers to the nearest patch; stop and hold do what they say', () => {
    const { m, s } = setup();
    const hub = find(m, 'hub', 0)!;
    const w = unit(m, 'worker', 0, hub.x, hub.y + 3.2);
    select(s, [w.id]);
    expect(pressCard(s, 'mine').ok).toBe(true);
    expect(w.order.type).toBe('gather');
    pressCard(s, 'stop');
    expect(w.order.type).toBe('idle');
    pressCard(s, 'hold');
    expect(w.order.type).toBe('hold');
  });
});

describe('placing a building', () => {
  it('uses the nearest worker, ends the mode, and starts the order', () => {
    const { m, s } = setup();
    reveal(m, 0);
    const spot = openGround(m, 0);
    const near = unit(m, 'worker', 0, spot.x - 4, spot.y);
    const far = unit(m, 'worker', 0, spot.x - 14, spot.y);
    select(s, [near.id, far.id]);
    expect(placeAt(s, spot.x, spot.y)).toMatchObject({ ok: false, reason: 'Nothing to build' });
    m.players[0]!.minerals = 500;
    pressCard(s, 'buildMenu');
    pressCard(s, 'build:depot');
    const out = placeAt(s, spot.x, spot.y);
    expect(out).toMatchObject({ ok: true, sound: 'build' });
    expect(near.order.type).toBe('build');
    expect(far.order.type).toBe('idle');
    expect(s.mode.kind).toBe('none');
    expect(s.menu).toBe('root');
  });

  it('can stay in the mode to place several, and fails with the reason on bad ground', () => {
    const { m, s } = setup();
    reveal(m, 0);
    const spot = openGround(m, 0);
    select(s, [unit(m, 'worker', 0, spot.x - 3, spot.y).id]);
    m.players[0]!.minerals = 900;
    pressCard(s, 'build:depot');
    expect(placeAt(s, spot.x, spot.y, true).ok).toBe(true);
    expect(s.mode.kind).toBe('place');
    expect(placeAt(s, 0.5, 0.5)).toMatchObject({ ok: false, reason: 'Blocked by rock' });
    expect(placementAt(s, 'depot', spot.x, spot.y).ok).toBe(true);
    m.players[0]!.minerals = 0;
    expect(placeAt(s, spot.x + 6, spot.y)).toMatchObject({ ok: false, reason: 'Not enough minerals' });
  });

  it('needs a worker selected', () => {
    const { m, s } = setup();
    reveal(m, 0);
    const spot = openGround(m, 0);
    select(s, [unit(m, 'trooper', 0, spot.x - 3, spot.y).id]);
    s.mode = { kind: 'place', building: 'depot' };
    expect(placeAt(s, spot.x, spot.y)).toMatchObject({ ok: false, reason: 'Select a worker first' });
  });
});

describe('what the selection panel shows', () => {
  it('is nothing for nothing', () => {
    const { s } = setup();
    expect(selectionInfo(s)).toBeNull();
  });

  it('describes one unit, one building (with its queue and progress), a resource and an enemy', () => {
    const { m, s } = setup();
    const t = unit(m, 'tank', 0, X, Y);
    select(s, [t.id]);
    expect(selectionInfo(s)).toMatchObject({ title: 'Tank', hp: 1, hpText: `${UNITS.tank.hp} / ${UNITS.tank.hp}`, team: 0, items: [] });
    expect(selectionInfo(s)!.lines.join(' ')).toContain('splash');

    const hub = find(m, 'hub', 0)!;
    select(s, [hub.id]);
    pressCard(s, 'train:worker');
    run(m, 6);
    const info = selectionInfo(s)!;
    expect(info.title).toBe('Hub');
    expect(info.queue).toHaveLength(1);
    expect(info.queue[0]!.progress).toBeGreaterThan(0.3);
    expect(info.queue[0]!.progress).toBeLessThan(0.7);

    const site = building(m, 'barracks', 0, X + 8.5, Y + 0.5, false);
    site.progress = 0.4;
    select(s, [site.id]);
    expect(selectionInfo(s)!.building).toBeCloseTo(0.4);

    const patch = m.entities.find((e) => e.type === 'minerals')!;
    select(s, [patch.id]);
    expect(selectionInfo(s)!.lines[0]).toBe(`${ECONOMY.patchMinerals} minerals left`);

    const enemy = unit(m, 'trooper', 1, X + 20, Y);
    select(s, [enemy.id]);
    expect(selectionInfo(s)).toMatchObject({ title: 'Trooper', team: 1 });
  });

  it('summarises a group, with an icon for each member', () => {
    const { m, s } = setup();
    const list = [unit(m, 'trooper', 0, X, Y), unit(m, 'trooper', 0, X + 2, Y), unit(m, 'tank', 0, X + 4, Y)];
    select(s, list.map((e) => e.id));
    const info = selectionInfo(s)!;
    expect(info.title).toBe('3 selected');
    expect(info.lines[0]).toBe('2 Troopers, 1 Tank');
    expect(info.items.map((i) => i.icon)).toEqual(['trooper', 'trooper', 'tank']);
  });

  it('formats the clock', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(20 * 75)).toBe('1:15');
    expect(clockText(20 * 3600 + 20 * 5)).toBe('60:05');
  });
});
