import { describe, expect, it } from 'vitest';
import { UNITS, cmdAttack, cmdBuild, cmdCancelBuilding, cmdCancelTrain, cmdConstruct, cmdGather, cmdHold, cmdMove, cmdRally, cmdStop, cmdTrain, footprint } from '../src/game/sim/testing';
import { ARENA, building, find, openGround, quiet, reveal, rich, run, unit } from './helpers/world';

const { x: X, y: Y } = ARENA;

describe('who may give which orders', () => {
  it('a player cannot command the other side', () => {
    const m = quiet(1, true);
    const mine = unit(m, 'trooper', 0, X, Y);
    const theirs = unit(m, 'trooper', 1, X + 20, Y);
    cmdMove(m, 0, [mine.id], X - 5, Y);
    expect(cmdMove(m, 1, [mine.id], X + 5, Y)).toEqual({ ok: false, reason: 'No units' });
    expect(cmdStop(m, 1, [mine.id]).ok).toBe(false);
    expect(cmdHold(m, 1, [mine.id]).ok).toBe(false);
    expect(cmdAttack(m, 1, [mine.id], theirs.id).ok).toBe(false);
    expect(mine.order.type).toBe('move');
    // Even a mixed list only moves what the player owns.
    cmdMove(m, 1, [mine.id, theirs.id], X + 25, Y);
    expect(theirs.order.type).toBe('move');
    expect(mine.order).toEqual({ type: 'move', x: expect.any(Number), y: Y });
    expect((mine.order as { x: number }).x).toBeLessThan(X);
  });

  it('a player cannot touch the other side\'s buildings', () => {
    const m = quiet(1);
    const hub = find(m, 'hub', 0)!;
    const barracks = building(m, 'barracks', 0, openGround(m, 0).x, openGround(m, 0).y);
    const site = building(m, 'depot', 0, openGround(m, 0).x + 6, openGround(m, 0).y, false);
    rich(m, 1);
    const worker = unit(m, 'worker', 1, openGround(m, 1).x, openGround(m, 1).y);
    expect(cmdTrain(m, 1, hub.id, 'worker').ok).toBe(false);
    expect(cmdTrain(m, 1, barracks.id, 'trooper').ok).toBe(false);
    expect(cmdRally(m, 1, hub.id, 30, 30).ok).toBe(false);
    expect(cmdCancelBuilding(m, 1, site.id).ok).toBe(false);
    expect(cmdCancelTrain(m, 1, hub.id, 0).ok).toBe(false);
    expect(cmdConstruct(m, 1, [worker.id], site.id).ok).toBe(false);
    expect(site.alive).toBe(true);
    expect(hub.rally).toBeNull();
    expect(cmdBuild(m, 1, unit(m, 'worker', 0, 30, 30).id, 'depot', 40, 40).ok).toBe(false);
  });

  it('commands with bad ids do nothing and do not throw', () => {
    const m = quiet(1);
    for (const id of [-1, 0, 123456, Number.NaN]) {
      expect(cmdMove(m, 0, [id], 10, 10).ok).toBe(false);
      expect(cmdStop(m, 0, [id]).ok).toBe(false);
      expect(cmdGather(m, 0, [id], id).ok).toBe(false);
      expect(cmdTrain(m, 0, id, 'worker').ok).toBe(false);
      expect(cmdRally(m, 0, id, 1, 1).ok).toBe(false);
      expect(cmdCancelBuilding(m, 0, id).ok).toBe(false);
    }
    expect(cmdMove(m, 5, [1], 10, 10).ok).toBe(false);
  });
});

describe('moving', () => {
  it('walks at the unit\'s speed and stops when it gets there', () => {
    const m = quiet(1, true);
    const t = unit(m, 'trooper', 0, X - 5, Y);
    cmdMove(m, 0, [t.id], X + 5, Y);
    run(m, 2);
    expect(t.x).toBeGreaterThan(X - 5 + UNITS.trooper.speed * 20 * 2 * 0.8);
    expect(t.x).toBeLessThan(X - 5 + UNITS.trooper.speed * 20 * 2 * 1.2);
    run(m, 3);
    expect(t.order.type).toBe('idle');
    expect(Math.abs(t.x - (X + 5))).toBeLessThan(0.7);
  });

  it('keeps a clicked point inside the map', () => {
    const m = quiet(1, true);
    const t = unit(m, 'skiff', 0, X, Y);
    cmdMove(m, 0, [t.id], -50, 500);
    const o = t.order as { x: number; y: number };
    expect(o.x).toBeGreaterThanOrEqual(1.5);
    expect(o.y).toBeLessThanOrEqual(m.map.size - 1.5);
  });

  it('only fighters attack-move: a worker just walks', () => {
    const m = quiet(1, true);
    const w = unit(m, 'worker', 0, X, Y);
    const t = unit(m, 'trooper', 0, X, Y + 3);
    cmdMove(m, 0, [w.id, t.id], X + 10, Y, true);
    expect(w.order.type).toBe('move');
    expect(t.order.type).toBe('attackMove');
  });

  it('a group gets a spot each, spread out, none inside rock or a building', () => {
    const m = quiet(1, true);
    const group = Array.from({ length: 14 }, (_, i) => unit(m, 'trooper', 0, X - 8 + (i % 7) * 0.9, Y - 3 + Math.floor(i / 7) * 0.9));
    cmdMove(m, 0, group.map((u) => u.id), X + 10, Y);
    const spots = group.map((u) => u.order as { x: number; y: number });
    const keys = new Set(spots.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`));
    expect(keys.size).toBe(group.length);
    for (const s of spots) expect(Math.hypot(s.x - (X + 10), s.y - Y)).toBeLessThan(7);
    run(m, 12);
    for (const u of group) expect(u.order.type).toBe('idle');
    let closest = Infinity;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) closest = Math.min(closest, Math.hypot(group[i]!.x - group[j]!.x, group[i]!.y - group[j]!.y));
    }
    expect(closest).toBeGreaterThan(0.6);
  });

  it('finds a way around buildings', () => {
    const m = quiet(1, true);
    reveal(m, 0);
    for (let i = 0; i < 6; i++) building(m, 'barracks', 0, X + 0.5, Y - 7.5 + i * 3);
    const t = unit(m, 'tank', 0, X - 8, Y);
    cmdMove(m, 0, [t.id], X + 8, Y);
    run(m, 14);
    expect(Math.hypot(t.x - (X + 8), t.y - Y)).toBeLessThan(1.5);
    const f = footprint('barracks', X + 0.5, Y + 0.5);
    expect(t.x < f.x0 || t.x > f.x1 + 1).toBe(true);
  });

  it('units do not walk through each other when one stands in the way', () => {
    const m = quiet(1, true);
    const blocker = unit(m, 'tank', 0, X, Y);
    const walker = unit(m, 'trooper', 0, X - 6, Y);
    cmdMove(m, 0, [walker.id], X + 6, Y);
    run(m, 8);
    expect(Math.hypot(walker.x - blocker.x, walker.y - blocker.y)).toBeGreaterThan(0.7);
    expect(Math.hypot(walker.x - (X + 6), walker.y - Y)).toBeLessThan(2.5);
  });
});
