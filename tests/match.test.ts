import { describe, expect, it } from 'vitest';
import { ACTOR, MODES, PICKUP, WEAPONS, WEAPON_IDS, sec } from '../src/game/sim/config';
import { heightAt } from '../src/game/sim/arena';
import { createMatch, drainEvents, fingerprint, noInput, pickSpawn, place, stepMatch, type Input, type Match } from '../src/game/sim/testing';

const step = (m: Match, ticks = 1, input: Input = noInput()): void => {
  for (let i = 0; i < ticks; i++) {
    stepMatch(m, input);
    drainEvents(m);
  }
};

describe('setting a match up', () => {
  it('you are actor 0, the bots follow, everyone is alive, safe, on solid ground and armed with the starting guns', () => {
    const m = createMatch({ seed: 3, mode: 'ffa', difficulty: 'normal', bots: 5, human: true });
    expect(m.actors).toHaveLength(6);
    expect(m.human).toBe(0);
    expect(m.actors[0]!.human).toBe(true);
    expect(m.actors[0]!.brain).toBeNull();
    for (const a of m.actors.slice(1)) {
      expect(a.human).toBe(false);
      expect(a.brain).not.toBeNull();
    }
    for (const a of m.actors) {
      expect(a.alive).toBe(true);
      expect(a.protect).toBeGreaterThan(0);
      expect(a.health).toBe(ACTOR.health);
      expect(a.y).toBe(heightAt(m.arena, a.x, a.z));
      expect(a.weapons[0]!.owned && a.weapons[1]!.owned).toBe(true);
      expect(a.weapons[2]!.owned || a.weapons[3]!.owned || a.weapons[4]!.owned).toBe(false);
      expect(WEAPON_IDS[a.current]).toBe('rifle');
    }
    expect(new Set(m.actors.map((a) => a.name)).size).toBe(6);
  });

  it('bots only has no person', () => {
    const m = createMatch({ seed: 3, bots: 4, human: false });
    expect(m.actors).toHaveLength(4);
    expect(m.human).toBe(-1);
    expect(m.actors.every((a) => a.brain !== null)).toBe(true);
  });

  it('puts everyone on their own in a free-for-all, and splits two teams evenly in a team match', () => {
    const ffa = createMatch({ seed: 1, mode: 'ffa', bots: 5 });
    expect(new Set(ffa.actors.map((a) => a.team)).size).toBe(6);
    expect(ffa.scores).toHaveLength(6);
    const tdm = createMatch({ seed: 1, mode: 'tdm', bots: 5 });
    expect(tdm.actors.filter((a) => a.team === 0)).toHaveLength(3);
    expect(tdm.actors.filter((a) => a.team === 1)).toHaveLength(3);
    expect(tdm.actors[0]!.team).toBe(0);
    expect(tdm.scores).toEqual([0, 0]);
    expect(tdm.scoreLimit).toBe(MODES.tdm.scoreLimit);
  });

  it('starts a team on its own side of the arena', () => {
    for (const seed of [1, 2, 3]) {
      const m = createMatch({ seed, mode: 'tdm', bots: 5 });
      for (const a of m.actors) expect(a.x < m.arena.size / 2, `${a.name} team ${a.team}`).toBe(a.team === 0);
    }
  });

  it('never starts two people on top of each other', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = createMatch({ seed, mode: 'ffa', bots: 7 });
      for (const a of m.actors) for (const b of m.actors) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z), `seed ${seed}`).toBeGreaterThan(1.4);
    }
  });

  it('chooses a start away from the enemy and out of their sight', () => {
    const m = createMatch({ seed: 2, mode: 'ffa', bots: 1, human: true });
    const [you, enemy] = m.actors as [(typeof m.actors)[0], (typeof m.actors)[0]];
    const spots = m.arena.spawns;
    // The enemy stands on the first start: nobody should be put there or right beside it.
    place(m, enemy, spots[0]!.x, spots[0]!.z);
    for (let i = 0; i < 20; i++) {
      const s = pickSpawn(m, you);
      expect(Math.hypot(s.x - enemy.x, s.z - enemy.z)).toBeGreaterThan(8);
    }
  });
});

describe('pickups', () => {
  const near = (m: Match, kind: string) => m.pickups.find((p) => p.kind === kind)!;

  it('heal, only when hurt, and come back after a while', () => {
    const m = createMatch({ seed: 5, mode: 'ffa', bots: 1, human: true });
    const [a, b] = m.actors as [(typeof m.actors)[0], (typeof m.actors)[0]];
    b.brain = null;
    const p = near(m, 'health');
    place(m, b, 3.5, 3.5);
    place(m, a, p.x, p.z);
    a.health = 100;
    step(m, 2);
    expect(p.active).toBe(true); // full health: leaves it for someone else
    a.health = 30;
    step(m, 2);
    expect(a.health).toBe(30 + PICKUP.health);
    expect(p.active).toBe(false);
    place(m, a, 3.5, 20.5); // walk away, or you would just take it again
    step(m, sec(PICKUP.respawn['health']!) - 5);
    expect(p.active).toBe(false);
    step(m, 10);
    expect(p.active).toBe(true);
  });

  it('give armour, ammunition and the big guns', () => {
    const m = createMatch({ seed: 5, mode: 'ffa', bots: 1, human: true });
    const [a, b] = m.actors as [(typeof m.actors)[0], (typeof m.actors)[0]];
    b.brain = null;
    place(m, b, 3.5, 3.5);
    const grab = (kind: string): void => {
      const p = near(m, kind);
      p.active = true;
      place(m, a, p.x, p.z);
      a.protect = 0;
      step(m, 2);
    };
    grab('armor');
    expect(a.armor).toBe(PICKUP.armor);
    a.weapons[1]!.reserve = 10;
    grab('ammo');
    expect(a.weapons[1]!.reserve).toBe(10 + Math.round(WEAPONS.rifle.reserve * PICKUP.ammo));
    grab('rail');
    expect(a.weapons[3]).toMatchObject({ owned: true, mag: 4 });
    grab('rocket');
    expect(a.weapons[4]!.owned).toBe(true);
    grab('shotgun');
    expect(a.weapons[2]!.owned).toBe(true);
  });

  it('are taken by whoever gets there first, and only once', () => {
    const m = createMatch({ seed: 5, mode: 'ffa', bots: 2, human: true });
    const [a, b, c] = m.actors as [(typeof m.actors)[0], (typeof m.actors)[0], (typeof m.actors)[0]];
    b.brain = null;
    c.brain = null;
    const p = near(m, 'armor');
    place(m, a, p.x, p.z);
    place(m, b, p.x + 0.3, p.z);
    place(m, c, 3.5, 3.5);
    step(m, 3);
    expect(a.armor + b.armor).toBe(PICKUP.armor);
  });
});

describe('the clock and the score', () => {
  it('ends on time with the best score as winner, and a shared best score is a draw', () => {
    const m = createMatch({ seed: 1, mode: 'ffa', bots: 2, human: false });
    for (const a of m.actors) a.brain = null;
    m.scores[2] = 5;
    m.scores[1] = 2;
    m.timeLeft = 3;
    step(m, 5);
    expect(m.winner).toBe(2);
    const d = createMatch({ seed: 1, mode: 'tdm', bots: 3, human: false });
    for (const a of d.actors) a.brain = null;
    d.scores = [4, 4];
    d.timeLeft = 2;
    step(d, 4);
    expect(d.winner).toBe(-2);
  });

  it('counts the time down from the mode\'s length', () => {
    const m = createMatch({ seed: 1, mode: 'ffa', bots: 2, human: false });
    for (const a of m.actors) a.brain = null;
    expect(m.timeLeft).toBe(sec(MODES.ffa.time));
    step(m, 60);
    expect(m.timeLeft).toBe(sec(MODES.ffa.time) - 60);
  });
});

describe('a person\'s input', () => {
  it('is kept sane: nonsense numbers do no harm', () => {
    const m = createMatch({ seed: 2, mode: 'ffa', bots: 2, human: true });
    const a = m.actors[0]!;
    const bad: Input = { ...noInput(), moveX: Number.NaN, moveZ: 9999, yaw: Number.POSITIVE_INFINITY, pitch: Number.NaN, fire: true };
    for (let i = 0; i < 120; i++) {
      stepMatch(m, bad);
      drainEvents(m);
    }
    expect(Number.isFinite(a.x + a.y + a.z + a.yaw + a.pitch)).toBe(true);
    expect(Math.hypot(a.vx, a.vz)).toBeLessThanOrEqual(ACTOR.sprint + 0.01);
  });

  it('a match is the same every time from a seed and the same inputs, and differs for another seed', () => {
    const play = (seed: number): string => {
      const m = createMatch({ seed, mode: 'tdm', difficulty: 'normal', bots: 5, human: true });
      for (let i = 0; i < 600; i++) {
        stepMatch(m, { ...noInput(), moveZ: 1, yaw: i * 0.01, fire: i % 90 < 30 });
        drainEvents(m);
      }
      return fingerprint(m);
    };
    expect(play(4)).toBe(play(4));
    expect(play(4)).not.toBe(play(5));
  });
});
