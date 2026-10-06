import { describe, expect, it } from 'vitest';
import { BUILDINGS, ECONOMY, UNITS, cmdBuild, cmdCancelBuilding, cmdCancelTrain, cmdConstruct, cmdGather, cmdRally, cmdTrain, checkPlacement, footprint, snapCentre, type Match } from '../src/game/sim/testing';
import { all, building, find, openGround, quiet, reveal, rich, run, unit } from './helpers/world';

/** A fresh match with the first player's hub and its minerals. */
function base(): { m: Match; hub: ReturnType<typeof find> & object } {
  const m = quiet(1);
  const hub = find(m, 'hub', 0)!;
  return { m, hub };
}

const patchesOf = (m: Match, near: { x: number; y: number }) =>
  m.entities.filter((e) => e.alive && e.type === 'minerals' && Math.hypot(e.x - near.x, e.y - near.y) < 12);

describe('mining', () => {
  it('workers carry minerals home, and the money arrives in 5s', () => {
    const { m, hub } = base();
    const patch = patchesOf(m, hub)[0]!;
    const before = m.players[0]!.minerals;
    for (let i = 0; i < 4; i++) cmdGather(m, 0, [unit(m, 'worker', 0, hub.x, hub.y + 3 + i * 0.4).id], patch.id);
    const events = run(m, 60);
    const deposits = events.filter((e) => e.type === 'deposit');
    expect(deposits.length).toBeGreaterThanOrEqual(25);
    expect(deposits.every((d) => d.type === 'deposit' && d.amount === ECONOMY.carry)).toBe(true);
    const gained = m.players[0]!.minerals - before;
    expect(gained).toBe(deposits.length * ECONOMY.carry);
    expect(m.players[0]!.stats.mined).toBe(gained);
    expect(gained).toBeGreaterThan(130);
    expect(gained).toBeLessThan(400);
  });

  it('a patch runs out: it is gone, the ground is free again, and the workers move to another', () => {
    const { m, hub } = base();
    const patches = patchesOf(m, hub);
    const first = patches[0]!;
    first.amount = 5;
    const cell = Math.floor(first.y) * m.map.size + Math.floor(first.x);
    expect(m.blocked[cell]).toBe(1);
    const worker = unit(m, 'worker', 0, hub.x, hub.y + 3);
    cmdGather(m, 0, [worker.id], first.id);
    const events = run(m, 40);
    expect(events.some((e) => e.type === 'depleted' && e.id === first.id)).toBe(true);
    expect(first.alive).toBe(false);
    expect(m.blocked[cell]).toBe(0);
    // It kept working.
    expect(m.players[0]!.stats.mined).toBeGreaterThan(5);
    expect(worker.order.type).toBe('gather');
  });

  it('spreads workers over the patches instead of piling them on one', () => {
    const { m, hub } = base();
    const patch = patchesOf(m, hub)[3]!;
    const workers = Array.from({ length: 8 }, (_, i) => unit(m, 'worker', 0, hub.x + (i % 4) * 0.6, hub.y + 3 + Math.floor(i / 4) * 0.6));
    cmdGather(m, 0, workers.map((w) => w.id), patch.id);
    const counts = new Map<number, number>();
    for (const w of workers) if (w.order.type === 'gather') counts.set(w.order.target, (counts.get(w.order.target) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('a worker with no hub left keeps what it carries and waits', () => {
    const { m, hub } = base();
    const worker = unit(m, 'worker', 0, hub.x, hub.y + 3);
    cmdGather(m, 0, [worker.id], patchesOf(m, hub)[0]!.id);
    building(m, 'depot', 0, openGround(m, 0).x, openGround(m, 0).y); // keeps the match going
    hub.alive = false;
    run(m, 30);
    expect(worker.order.type).toBe('idle');
    expect(m.players[0]!.minerals).toBe(ECONOMY.startMinerals);
  });

  it('only workers can mine, and only minerals can be mined', () => {
    const { m, hub } = base();
    const trooper = unit(m, 'trooper', 0, hub.x, hub.y + 3);
    const patch = patchesOf(m, hub)[0]!;
    expect(cmdGather(m, 0, [trooper.id], patch.id).ok).toBe(false);
    expect(trooper.order.type).toBe('idle');
    const worker = unit(m, 'worker', 0, hub.x, hub.y + 3);
    expect(cmdGather(m, 0, [worker.id], hub.id).ok).toBe(false);
  });

  it('a refinery makes gas on its own, and not before it is finished', () => {
    const { m } = base();
    const geyser = m.entities.find((e) => e.type === 'geyser' && e.alive)!;
    const unfinished = building(m, 'refinery', 0, geyser.x, geyser.y, false);
    run(m, 10);
    expect(m.players[0]!.gas).toBe(0);
    unfinished.progress = 1;
    run(m, 30);
    expect(m.players[0]!.gas).toBeGreaterThanOrEqual(45);
    expect(m.players[0]!.gas).toBeLessThanOrEqual(50);
  });
});

describe('placing buildings', () => {
  it('snaps even-sized buildings to a corner and odd-sized ones to a cell middle', () => {
    expect(snapCentre('hub', 10.3, 20.8)).toEqual({ x: 10, y: 21 });
    expect(snapCentre('depot', 10.6, 20.2)).toEqual({ x: 11, y: 20 });
    expect(snapCentre('barracks', 10.3, 20.8)).toEqual({ x: 10.5, y: 20.5 });
    expect(footprint('hub', 10, 21)).toEqual({ x0: 8, y0: 19, x1: 11, y1: 22 });
    expect(footprint('barracks', 10.5, 20.5)).toEqual({ x0: 9, y0: 19, x1: 11, y1: 21 });
  });

  it('refuses rock, the edge of the map, other buildings and unexplored ground, and says why', () => {
    const { m, hub } = base();
    reveal(m, 0);
    const free = openGround(m, 0);
    expect(checkPlacement(m, 0, 'depot', free.x, free.y).ok).toBe(true);
    expect(checkPlacement(m, 0, 'depot', 0.5, 0.5)).toMatchObject({ ok: false, reason: 'Blocked by rock' });
    expect(checkPlacement(m, 0, 'depot', hub.x, hub.y)).toMatchObject({ ok: false, reason: 'Something is in the way' });
    const rock = Array.from(m.map.rock).findIndex((v, i) => v === 1 && i % m.map.size > 10 && i % m.map.size < 80 && Math.floor(i / m.map.size) > 10 && Math.floor(i / m.map.size) < 80);
    expect(checkPlacement(m, 0, 'depot', (rock % m.map.size) + 1, Math.floor(rock / m.map.size) + 1).ok).toBe(false);
    m.vision[0]!.fill(0);
    expect(checkPlacement(m, 0, 'depot', free.x, free.y)).toMatchObject({ ok: false, reason: 'Not explored yet' });
    expect(checkPlacement(m, 0, 'depot', 200, 200).ok).toBe(false);
  });

  it('needs the right building first: a factory wants a barracks, a refinery wants a geyser', () => {
    const { m } = base();
    reveal(m, 0);
    const free = openGround(m, 0);
    expect(checkPlacement(m, 0, 'factory', free.x, free.y)).toMatchObject({ ok: false, reason: 'Needs a Barracks' });
    expect(checkPlacement(m, 0, 'barracks', free.x, free.y).ok).toBe(true);
    expect(checkPlacement(m, 0, 'refinery', free.x, free.y)).toMatchObject({ ok: false, reason: 'Needs a geyser' });
    const geyser = m.entities.find((e) => e.type === 'geyser' && e.alive)!;
    reveal(m, 0);
    const spot = checkPlacement(m, 0, 'refinery', geyser.x + 0.3, geyser.y - 0.2);
    expect(spot).toMatchObject({ ok: true, x: geyser.x, y: geyser.y });
    building(m, 'refinery', 0, geyser.x, geyser.y);
    expect(checkPlacement(m, 0, 'refinery', geyser.x, geyser.y)).toMatchObject({ ok: false, reason: 'Already built on' });
    // A barracks that is still going up does not count as having one.
    building(m, 'barracks', 0, free.x, free.y, false);
    expect(checkPlacement(m, 0, 'factory', free.x + 10, free.y).reason).toBe('Needs a Barracks');
  });
});

describe('building', () => {
  it('the money is taken when the worker starts, the building rises over its build time, then it works', () => {
    const { m } = base();
    reveal(m, 0);
    const spot = openGround(m, 0);
    const worker = unit(m, 'worker', 0, spot.x - 6, spot.y);
    const minerals = m.players[0]!.minerals;
    const events: ReturnType<typeof run> = [];
    expect(cmdBuild(m, 0, worker.id, 'depot', spot.x, spot.y).ok).toBe(true);
    expect(m.players[0]!.minerals).toBe(minerals); // nothing yet: the worker is on its way
    expect(worker.order.type).toBe('build');
    events.push(...run(m, 8));
    const site = find(m, 'depot', 0)!;
    expect(site).toBeDefined();
    expect(site.progress).toBeLessThan(1);
    expect(m.players[0]!.minerals).toBe(minerals - BUILDINGS.depot.cost.minerals);
    expect(events.some((e) => e.type === 'started')).toBe(true);
    const capBefore = m.players[0]!.supplyCap;
    events.push(...run(m, 20));
    expect(site.progress).toBe(1);
    expect(events.some((e) => e.type === 'built' && e.id === site.id)).toBe(true);
    expect(m.players[0]!.supplyCap).toBe(capBefore + BUILDINGS.depot.supply);
    expect(worker.order.type).toBe('idle');
    // It blocks the ground it stands on.
    const f = footprint('depot', site.x, site.y);
    expect(m.blocked[f.y0 * m.map.size + f.x0]).toBe(1);
  });

  it('a building under construction does not give supply or train until it is finished, and gains health as it rises', () => {
    const { m } = base();
    const free = openGround(m, 0);
    const site = building(m, 'depot', 0, free.x, free.y, false);
    expect(m.players[0]!.supplyCap).toBe(BUILDINGS.hub.supply);
    const worker = unit(m, 'worker', 0, free.x - 3, free.y);
    expect(cmdConstruct(m, 0, [worker.id], site.id).ok).toBe(true);
    const hpAtStart = site.hp;
    run(m, 6);
    expect(site.hp).toBeGreaterThan(hpAtStart);
    expect(site.progress).toBeGreaterThan(0);
    expect(site.progress).toBeLessThan(1);
    run(m, 20);
    expect(site.progress).toBe(1);
    expect(site.hp).toBe(site.maxHp);
  });

  it('cannot afford it: the worker gives up, nothing is built, nothing is spent', () => {
    const { m } = base();
    reveal(m, 0);
    const spot = openGround(m, 0);
    m.players[0]!.minerals = 120;
    const worker = unit(m, 'worker', 0, spot.x - 4, spot.y);
    expect(cmdBuild(m, 0, worker.id, 'depot', spot.x, spot.y).ok).toBe(true);
    m.players[0]!.minerals = 40; // something else spent it on the way
    const events = run(m, 10);
    expect(events.some((e) => e.type === 'alert' && e.kind === 'minerals')).toBe(true);
    expect(find(m, 'depot', 0)).toBeUndefined();
    expect(m.players[0]!.minerals).toBe(40);
    expect(worker.order.type).toBe('idle');
  });

  it('a command to build is refused up front if it cannot work', () => {
    const { m } = base();
    reveal(m, 0);
    const spot = openGround(m, 0);
    const worker = unit(m, 'worker', 0, spot.x, spot.y);
    m.players[0]!.minerals = 20;
    expect(cmdBuild(m, 0, worker.id, 'depot', spot.x, spot.y)).toEqual({ ok: false, reason: 'Not enough minerals' });
    m.players[0]!.minerals = 500;
    expect(cmdBuild(m, 0, worker.id, 'factory', spot.x, spot.y)).toEqual({ ok: false, reason: 'Needs a Barracks' });
    const trooper = unit(m, 'trooper', 0, spot.x, spot.y);
    expect(cmdBuild(m, 0, trooper.id, 'depot', spot.x, spot.y).ok).toBe(false);
    expect(cmdBuild(m, 1, worker.id, 'depot', spot.x, spot.y).ok).toBe(false); // not their worker
  });

  it('units standing on the spot are moved out of the way', () => {
    const { m } = base();
    reveal(m, 0);
    const spot = openGround(m, 0);
    const worker = unit(m, 'worker', 0, spot.x - 5, spot.y);
    const standing = [unit(m, 'trooper', 0, spot.x, spot.y), unit(m, 'tank', 0, spot.x + 0.4, spot.y + 0.3)];
    cmdBuild(m, 0, worker.id, 'barracks', spot.x, spot.y);
    run(m, 6);
    const site = find(m, 'barracks', 0)!;
    expect(site).toBeDefined();
    const f = footprint('barracks', site.x, site.y);
    for (const u of standing) {
      const inside = u.x > f.x0 && u.x < f.x1 + 1 && u.y > f.y0 && u.y < f.y1 + 1;
      expect(inside, u.type).toBe(false);
    }
  });

  it('if the builder dies the building stops rising, and another worker can finish it', () => {
    const { m } = base();
    const free = openGround(m, 0);
    const site = building(m, 'depot', 0, free.x, free.y, false);
    const first = unit(m, 'worker', 0, free.x - 2, free.y);
    cmdConstruct(m, 0, [first.id], site.id);
    run(m, 4);
    const partway = site.progress;
    expect(partway).toBeGreaterThan(0);
    first.alive = false;
    run(m, 5);
    expect(site.progress).toBe(partway);
    const second = unit(m, 'worker', 0, free.x + 3, free.y);
    cmdConstruct(m, 0, [second.id], site.id);
    run(m, 20);
    expect(site.progress).toBe(1);
  });

  it('cancelling a building gives back most of the money and clears the ground', () => {
    const { m } = base();
    const free = openGround(m, 0);
    const site = building(m, 'barracks', 0, free.x, free.y, false);
    const minerals = m.players[0]!.minerals;
    expect(cmdCancelBuilding(m, 0, site.id).ok).toBe(true);
    expect(site.alive).toBe(false);
    expect(m.players[0]!.minerals).toBe(minerals + Math.floor(BUILDINGS.barracks.cost.minerals * 0.75));
    expect(m.blocked[Math.floor(free.y) * m.map.size + Math.floor(free.x)]).toBe(m.map.rock[Math.floor(free.y) * m.map.size + Math.floor(free.x)]);
    const done = building(m, 'depot', 0, free.x + 6, free.y);
    expect(cmdCancelBuilding(m, 0, done.id).ok).toBe(false);
  });
});

describe('training', () => {
  it('takes the money and the supply at once, makes the unit after its time, and it appears next to the building', () => {
    const { m, hub } = base();
    const before = { ...m.players[0]! };
    expect(cmdTrain(m, 0, hub.id, 'worker')).toEqual({ ok: true, reason: '' });
    expect(m.players[0]!.minerals).toBe(before.minerals - UNITS.worker.cost.minerals);
    run(m, 0.1);
    expect(m.players[0]!.supplyUsed).toBe(before.supplyUsed + 1);
    const events = run(m, 12.5);
    const made = events.find((e) => e.type === 'trained');
    expect(made).toBeDefined();
    const worker = find(m, 'worker', 0)!;
    expect(worker).toBeDefined();
    expect(Math.hypot(worker.x - hub.x, worker.y - hub.y)).toBeLessThan(4.5);
    expect(m.players[0]!.stats.trained).toBe(1);
  });

  it('refuses when short of minerals, gas or supply, and says which', () => {
    const { m, hub } = base();
    const barracks = building(m, 'barracks', 0, openGround(m, 0).x, openGround(m, 0).y);
    const factory = building(m, 'factory', 0, openGround(m, 0).x + 8, openGround(m, 0).y);
    m.players[0]!.minerals = 20;
    expect(cmdTrain(m, 0, hub.id, 'worker')).toEqual({ ok: false, reason: 'Not enough minerals' });
    m.players[0]!.minerals = 500;
    m.players[0]!.gas = 10;
    expect(cmdTrain(m, 0, factory.id, 'tank')).toEqual({ ok: false, reason: 'Not enough gas' });
    m.players[0]!.gas = 500;
    m.players[0]!.supplyUsed = m.players[0]!.supplyCap - 2;
    expect(cmdTrain(m, 0, factory.id, 'tank')).toEqual({ ok: false, reason: 'Need more depots' });
    expect(cmdTrain(m, 0, barracks.id, 'trooper').ok).toBe(true);
    expect(cmdTrain(m, 0, hub.id, 'trooper')).toEqual({ ok: false, reason: 'Cannot make that here' });
  });

  it('queues up to five, trains them one after another, and a full queue says no', () => {
    const { m, hub } = base();
    rich(m, 0);
    m.players[0]!.supplyCap = 50;
    for (let i = 0; i < ECONOMY.queueLimit; i++) expect(cmdTrain(m, 0, hub.id, 'worker').ok).toBe(true);
    expect(cmdTrain(m, 0, hub.id, 'worker')).toEqual({ ok: false, reason: 'Queue is full' });
    run(m, 12.5 * 2);
    expect(all(m, 'worker', 0)).toHaveLength(2);
  });

  it('cancelling an item gives the money back', () => {
    const { m, hub } = base();
    cmdTrain(m, 0, hub.id, 'worker');
    cmdTrain(m, 0, hub.id, 'worker');
    const minerals = m.players[0]!.minerals;
    expect(cmdCancelTrain(m, 0, hub.id, 1).ok).toBe(true);
    expect(m.players[0]!.minerals).toBe(minerals + 50);
    expect(hub.queue).toHaveLength(1);
    expect(cmdCancelTrain(m, 0, hub.id, 5).ok).toBe(false);
  });

  it('a building that is not finished cannot train, and nobody else can train at yours', () => {
    const { m } = base();
    const free = openGround(m, 0);
    const unfinished = building(m, 'barracks', 0, free.x, free.y, false);
    expect(cmdTrain(m, 0, unfinished.id, 'trooper')).toEqual({ ok: false, reason: 'Not ready' });
    const hub = find(m, 'hub', 0)!;
    expect(cmdTrain(m, 1, hub.id, 'worker').ok).toBe(false);
  });

  it('new units go to the rally point; workers sent to minerals start mining', () => {
    const { m, hub } = base();
    rich(m, 0);
    const patch = patchesOf(m, hub)[2]!;
    expect(cmdRally(m, 0, hub.id, patch.x, patch.y).ok).toBe(true);
    cmdTrain(m, 0, hub.id, 'worker');
    run(m, 13);
    const worker = find(m, 'worker', 0)!;
    expect(worker.order.type).toBe('gather');

    const barracks = building(m, 'barracks', 0, openGround(m, 0).x, openGround(m, 0).y);
    const gather = { x: openGround(m, 0).x + 5, y: openGround(m, 0).y };
    cmdRally(m, 0, barracks.id, gather.x, gather.y);
    cmdTrain(m, 0, barracks.id, 'trooper');
    run(m, 25);
    const trooper = find(m, 'trooper', 0)!;
    expect(Math.hypot(trooper.x - gather.x, trooper.y - gather.y)).toBeLessThan(2);
  });
});
