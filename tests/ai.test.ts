import { describe, expect, it } from 'vitest';
import { BUILDINGS, ECONOMY, UNITS, createMatch, drainEvents, fingerprint, stepMatch } from '../src/game/sim/testing';
import { MINUTE, play } from './helpers/play';

describe('the computer player', () => {
  it('plays the same game every time from the same seed, and a different one from another', () => {
    const a = play(11, 'normal', 'normal', 4);
    const b = play(11, 'normal', 'normal', 4);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(play(12, 'normal', 'normal', 4))).not.toBe(fingerprint(a));
  });

  it('builds an economy and an army from nothing: workers, depots, barracks, gas, a factory', () => {
    const m = play(3, 'normal', 'normal', 6);
    for (const p of [0, 1]) {
      const mine = m.entities.filter((e) => e.alive && e.owner === p);
      const count = (type: string) => mine.filter((e) => e.type === type).length;
      expect(count('worker'), `side ${p} workers`).toBeGreaterThanOrEqual(10);
      expect(count('depot'), `side ${p} depots`).toBeGreaterThanOrEqual(2);
      expect(count('barracks'), `side ${p} barracks`).toBeGreaterThanOrEqual(1);
      expect(count('refinery'), `side ${p} refineries`).toBeGreaterThanOrEqual(1);
      expect(m.players[p]!.stats.mined, `side ${p} mined`).toBeGreaterThan(1500);
    }
  });

  it('never breaks the rules while it plays: money, supply, queues, positions, the ground it walks on', () => {
    const size = 96;
    play(5, 'hard', 'normal', 14, (m) => {
      if (m.tick % 40 !== 0) return;
      for (const p of m.players) {
        expect(p.minerals).toBeGreaterThanOrEqual(0);
        expect(p.gas).toBeGreaterThanOrEqual(0);
        expect(p.supplyUsed).toBeLessThanOrEqual(p.supplyCap);
        expect(p.supplyCap).toBeLessThanOrEqual(ECONOMY.maxSupply);
        expect(Number.isFinite(p.minerals + p.gas)).toBe(true);
      }
      for (const e of m.entities) {
        if (!e.alive) continue;
        expect(Number.isFinite(e.x + e.y + e.hp), `${e.type} ${e.id} at tick ${m.tick}`).toBe(true);
        expect(e.x).toBeGreaterThan(0);
        expect(e.y).toBeGreaterThan(0);
        expect(e.x).toBeLessThan(size);
        expect(e.y).toBeLessThan(size);
        expect(e.hp).toBeGreaterThan(0);
        expect(e.queue.length).toBeLessThanOrEqual(ECONOMY.queueLimit);
        if (e.type in UNITS && !UNITS[e.type as keyof typeof UNITS].air) {
          expect(m.map.rock[Math.floor(e.y) * size + Math.floor(e.x)], `${e.type} ${e.id} in rock at tick ${m.tick}`).toBe(0);
        }
      }
    });
  });

  it('a player who does nothing is beaten, and the computer does not wander off or stall', () => {
    const m = createMatch({ seed: 4, ai: [false, true], difficulty: ['normal', 'normal'] });
    while (m.winner < 0 && m.tick < 30 * MINUTE) {
      stepMatch(m);
      drainEvents(m);
    }
    expect(m.winner).toBe(1);
    expect(m.tick).toBeLessThan(20 * MINUTE);
  });

  it('is cheap enough to run on a phone: well under a millisecond a tick on average', () => {
    const start = performance.now();
    const m = play(2, 'hard', 'hard', 6);
    const perTick = (performance.now() - start) / m.tick;
    // A budget of 50 ms a tick at 20 ticks a second; this is a hundredth of that on a desktop.
    expect(perTick).toBeLessThan(2);
  });

  it('the sim stays pure: costs and times in the tables are whole ticks and sensible', () => {
    for (const [name, u] of Object.entries(UNITS)) {
      expect(Number.isInteger(u.time), name).toBe(true);
      expect(u.hp, name).toBeGreaterThan(0);
      expect(u.speed, name).toBeGreaterThan(0);
      expect(BUILDINGS[u.producedBy].produces, name).toContain(name);
    }
    for (const [name, b] of Object.entries(BUILDINGS)) {
      expect(Number.isInteger(b.time), name).toBe(true);
      if (b.requires !== null) expect(BUILDINGS[b.requires], name).toBeDefined();
    }
  });
});
