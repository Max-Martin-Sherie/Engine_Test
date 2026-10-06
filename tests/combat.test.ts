import { describe, expect, it } from 'vitest';
import { BUILDINGS, UNITS, canTarget, cmdAttack, cmdHold, cmdMove, cmdStop, damage, type MatchEvent } from '../src/game/sim/testing';
import { ARENA, building, find, quiet, run, unit } from './helpers/world';

const { x: X, y: Y } = ARENA;
const shots = (events: MatchEvent[]) => events.filter((e): e is Extract<MatchEvent, { type: 'shot' }> => e.type === 'shot');

describe('who can hit what', () => {
  it('follows the air and ground flags of the weapon', () => {
    const m = quiet(1, true);
    const trooper = unit(m, 'trooper', 0, X, Y);
    const tank = unit(m, 'tank', 0, X + 3, Y);
    const skiff = unit(m, 'skiff', 0, X + 6, Y);
    const enemyTrooper = unit(m, 'trooper', 1, X, Y + 4);
    const enemySkiff = unit(m, 'skiff', 1, X + 3, Y + 4);
    expect(canTarget(trooper, enemySkiff)).toBe(true);
    expect(canTarget(tank, enemySkiff)).toBe(false);
    expect(canTarget(tank, enemyTrooper)).toBe(true);
    expect(canTarget(skiff, enemyTrooper)).toBe(true);
    expect(canTarget(enemySkiff, tank)).toBe(true);
    // Never your own side, never nobody's things.
    expect(canTarget(trooper, tank)).toBe(false);
    const patch = m.entities.find((e) => e.type === 'minerals')!;
    expect(canTarget(trooper, patch)).toBe(false);
    // A building only shoots when it is finished and armed.
    const turret = building(m, 'turret', 0, X + 10.5, Y + 0.5, false);
    expect(canTarget(turret, enemyTrooper)).toBe(false);
    turret.progress = 1;
    expect(canTarget(turret, enemyTrooper)).toBe(true);
    expect(canTarget(building(m, 'depot', 0, X + 14, Y), enemyTrooper)).toBe(false);
  });

  it('refuses an attack order a unit cannot carry out', () => {
    const m = quiet(1, true);
    const tank = unit(m, 'tank', 0, X, Y);
    const trooper = unit(m, 'trooper', 0, X + 2, Y);
    const skiff = unit(m, 'skiff', 1, X + 6, Y);
    const own = unit(m, 'trooper', 0, X + 4, Y);
    expect(cmdAttack(m, 0, [tank.id], skiff.id)).toEqual({ ok: false, reason: 'Cannot attack that' });
    expect(tank.order.type).toBe('idle');
    expect(cmdAttack(m, 0, [tank.id, trooper.id], skiff.id).ok).toBe(true);
    expect(trooper.order.type).toBe('attack');
    expect(tank.order.type).toBe('idle');
    expect(cmdAttack(m, 0, [trooper.id], own.id)).toEqual({ ok: false, reason: 'Not a target' });
    expect(cmdAttack(m, 0, [trooper.id], m.entities.find((e) => e.type === 'minerals')!.id).ok).toBe(false);
    expect(cmdAttack(m, 0, [trooper.id], 999999).ok).toBe(false);
  });
});

describe('damage', () => {
  it('is reduced by armor but never below one', () => {
    const m = quiet(1, true);
    const tank = unit(m, 'tank', 0, X, Y);
    const worker = unit(m, 'worker', 0, X + 5, Y);
    damage(m, tank, 7, -1);
    expect(tank.hp).toBe(UNITS.tank.hp - (7 - UNITS.tank.armor));
    damage(m, worker, 7, -1);
    expect(worker.hp).toBe(UNITS.worker.hp - 7);
    damage(m, tank, 0.4, -1);
    expect(tank.hp).toBe(UNITS.tank.hp - 6 - 1);
    const turret = building(m, 'turret', 0, X + 10.5, Y + 0.5);
    damage(m, turret, 5, -1);
    expect(turret.hp).toBe(BUILDINGS.turret.hp - (5 - BUILDINGS.turret.armor));
  });

  it('kills at zero health: one death event, the books updated, the supply given back', () => {
    const m = quiet(1, true);
    const victim = unit(m, 'tank', 1, X, Y);
    const killer = unit(m, 'trooper', 0, X + 30, Y);
    expect(m.players[1]!.supplyUsed).toBe(UNITS.tank.supply);
    victim.hp = 3;
    damage(m, victim, 10, killer.id);
    expect(victim.alive).toBe(false);
    const events = run(m, 0.1);
    expect(events.filter((e) => e.type === 'death' && e.id === victim.id)).toHaveLength(1);
    expect(m.players[1]!.stats.unitsLost).toBe(1);
    expect(m.players[0]!.stats.unitsKilled).toBe(1);
    expect(m.players[1]!.supplyUsed).toBe(0);
    damage(m, victim, 10, killer.id); // a dead thing cannot die twice
    expect(m.players[1]!.stats.unitsLost).toBe(1);
    run(m, 11); // dead entities are swept out now and then
    expect(m.byId.has(victim.id)).toBe(false);
  });

  it('a tank hits the target hard and its neighbours for half, but never its own side or far-off units', () => {
    const m = quiet(1, true);
    const tank = unit(m, 'tank', 0, X - 6, Y);
    const friend = unit(m, 'worker', 0, X - 0.2, Y + 1.2);
    // Workers cannot shoot back and stand still when idle, so only the splash hurts them.
    const target = unit(m, 'worker', 1, X, Y);
    const near = unit(m, 'worker', 1, X + 0.8, Y);
    const edge = unit(m, 'worker', 1, X, Y + 1.1);
    const far = unit(m, 'worker', 1, X + 3, Y);
    cmdAttack(m, 0, [tank.id], target.id);
    const events = run(m, 0.15);
    expect(shots(events).filter((s) => s.from === tank.id)).toHaveLength(1);
    const hp = UNITS.worker.hp;
    expect(target.hp).toBe(hp - 30);
    expect(near.hp).toBe(hp - 15);
    expect(edge.hp).toBe(hp - 15);
    expect(far.hp).toBe(hp);
    expect(friend.hp).toBe(hp);
  });
});

describe('fights', () => {
  it('idle units pick a fight with enemies near them, and the bigger group wins', () => {
    const m = quiet(1, true);
    const mine = [0, 1, 2].map((i) => unit(m, 'trooper', 0, X - 4, Y - 1 + i));
    const lone = unit(m, 'trooper', 1, X + 3, Y);
    run(m, 10);
    expect(lone.alive).toBe(false);
    expect(mine.every((t) => t.alive)).toBe(true);
    expect(m.players[0]!.stats.unitsKilled).toBe(1);
    expect(mine.every((t) => t.order.type === 'idle')).toBe(true);
  });

  it('ignore enemies that are far away', () => {
    const m = quiet(1, true);
    const a = unit(m, 'trooper', 0, X - 12, Y);
    const b = unit(m, 'worker', 1, X + 12, Y);
    const start = { x: a.x, y: a.y };
    run(m, 10);
    expect(b.hp).toBe(UNITS.worker.hp);
    expect(a.x).toBe(start.x);
    expect(a.order.type).toBe('idle');
  });

  it('close in on an enemy that is in sight but out of range, then shoot it', () => {
    const m = quiet(1, true);
    const a = unit(m, 'trooper', 0, X - 4, Y);
    const b = unit(m, 'worker', 1, X + 4, Y);
    cmdAttack(m, 0, [a.id], b.id);
    const first = shots(run(m, 6))[0];
    expect(first).toBeDefined();
    expect(a.x).toBeGreaterThan(X - 4.5);
    run(m, 10);
    expect(b.alive).toBe(false);
  });

  it('shoot the things that shoot back first, then units, then buildings', () => {
    const m = quiet(1, true);
    const shooter = unit(m, 'trooper', 0, X, Y);
    cmdHold(m, 0, [shooter.id]);
    const depot = building(m, 'depot', 1, X + 2, Y + 2);
    const worker = unit(m, 'worker', 1, X + 1.8, Y);
    const trooper = unit(m, 'trooper', 1, X + 4, Y);
    cmdHold(m, 1, [trooper.id]);
    const mine = (events: MatchEvent[]) => shots(events).find((s) => s.from === shooter.id)!;
    expect(mine(run(m, 0.05)).to).toBe(trooper.id);
    trooper.alive = false;
    shooter.cooldown = 0;
    expect(mine(run(m, 0.05)).to).toBe(worker.id);
    worker.alive = false;
    shooter.cooldown = 0;
    expect(mine(run(m, 0.05)).to).toBe(depot.id);
  });

  it('holding ground shoots what is in range but never walks', () => {
    const m = quiet(1, true);
    const a = unit(m, 'trooper', 0, X, Y);
    const b = unit(m, 'worker', 1, X + 7, Y);
    cmdHold(m, 0, [a.id]);
    run(m, 5);
    expect(b.hp).toBe(UNITS.worker.hp);
    expect(a.x).toBe(X);
    expect(a.order.type).toBe('hold');
    b.x = X + 4;
    run(m, 1);
    expect(b.hp).toBeLessThan(UNITS.worker.hp);
    expect(a.x).toBe(X);
    expect(cmdStop(m, 0, [a.id]).ok).toBe(true);
    expect(a.order.type).toBe('idle');
  });

  it('an attack-move stops to deal with what it meets, then carries on to where it was going', () => {
    const m = quiet(1, true);
    const a = unit(m, 'trooper', 0, X - 12, Y);
    const b = unit(m, 'worker', 1, X - 4, Y + 1);
    cmdMove(m, 0, [a.id], X + 10, Y, true);
    expect(a.order.type).toBe('attackMove');
    const events = run(m, 20);
    expect(shots(events).some((s) => s.from === a.id && s.to === b.id)).toBe(true);
    expect(b.alive).toBe(false);
    expect(a.order.type).toBe('idle');
    expect(Math.hypot(a.x - (X + 10), a.y - Y)).toBeLessThan(2);
  });

  it('a plain move walks past enemies without stopping to fight', () => {
    const m = quiet(1, true);
    const a = unit(m, 'trooper', 0, X - 12, Y);
    const b = unit(m, 'worker', 1, X - 4, Y + 3);
    cmdMove(m, 0, [a.id], X + 10, Y);
    const events = run(m, 9);
    expect(shots(events).filter((s) => s.from === a.id)).toHaveLength(0);
    expect(b.hp).toBe(UNITS.worker.hp);
    expect(Math.hypot(a.x - (X + 10), a.y - Y)).toBeLessThan(2);
  });

  it('a unit under attack that is just walking is not forced to fight, but is hurt', () => {
    const m = quiet(1, true);
    const walker = unit(m, 'worker', 0, X, Y);
    const hunter = unit(m, 'trooper', 1, X + 3, Y);
    cmdMove(m, 0, [walker.id], X - 20, Y);
    run(m, 4);
    expect(walker.hp).toBeLessThan(UNITS.worker.hp);
    expect(walker.order.type === 'move' || !walker.alive).toBe(true);
    expect(hunter.alive).toBe(true);
  });

  it('a finished turret defends its ground; an unfinished one does nothing', () => {
    const m = quiet(1, true);
    const turret = building(m, 'turret', 0, X + 0.5, Y + 0.5, false);
    const intruder = unit(m, 'worker', 1, X + 5, Y); // a worker cannot shoot back from there
    cmdHold(m, 1, [intruder.id]);
    run(m, 5);
    expect(intruder.hp).toBe(UNITS.worker.hp);
    turret.progress = 1;
    run(m, 1);
    expect(intruder.hp).toBeLessThan(UNITS.worker.hp);
  });

  it('air units fly straight over rock and reach where ground units cannot', () => {
    const m = quiet(1);
    const skiff = unit(m, 'skiff', 0, 20, 20);
    cmdMove(m, 0, [skiff.id], 70, 70);
    expect(skiff.path).toEqual([70, 70]);
    run(m, 20);
    expect(Math.hypot(skiff.x - 70, skiff.y - 70)).toBeLessThan(2);
  });
});

describe('winning', () => {
  it('the side that loses its last building loses; the match then stops', () => {
    const m = quiet(1);
    const hub = find(m, 'hub', 1)!;
    damage(m, hub, 99999, find(m, 'hub', 0)!.id);
    expect(hub.alive).toBe(false);
    const events = run(m, 2);
    expect(events.filter((e) => e.type === 'victory')).toEqual([{ type: 'victory', winner: 0 }]);
    expect(m.winner).toBe(0);
    expect(m.players[1]!.defeated).toBe(true);
    const tick = m.tick;
    run(m, 1);
    expect(m.tick).toBe(tick);
  });

  it('units alone do not keep a side alive', () => {
    const m = quiet(1);
    unit(m, 'tank', 1, X, Y);
    damage(m, find(m, 'hub', 1)!, 99999, -1);
    run(m, 2);
    expect(m.winner).toBe(0);
  });
});
