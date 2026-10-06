import { describe, expect, it } from 'vitest';
import { ACTOR, ARENA, BOTS, WEAPON_IDS, type Difficulty } from '../src/game/sim/config';
import { createBrain } from '../src/game/sim/bots';
import { heightUnder } from '../src/game/sim/physics';
import { createMatch, drainEvents, emptyArena, giveWeapon, place, setBox, stepMatch, useArena, type Actor, type Match } from '../src/game/sim/testing';

const run = (m: Match, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    stepMatch(m);
    drainEvents(m);
  }
};

/** Two bots in an empty arena: the first fights, the second is a dummy that stands still. */
function pair(difficulty: Difficulty = 'hard', distance = 12): { m: Match; bot: Actor; dummy: Actor } {
  const m = createMatch({ seed: 1, mode: 'ffa', difficulty, bots: 2, human: false });
  useArena(m, emptyArena());
  const [bot, dummy] = m.actors as [Actor, Actor];
  dummy.brain = null;
  place(m, bot, 24.5, 34.5, 0);
  place(m, dummy, 24.5, 34.5 - distance, 0);
  m.events.length = 0;
  return { m, bot, dummy };
}

describe('what a bot can see and hear', () => {
  it('spots someone in front of it in the open, takes a moment, then shoots them', () => {
    const { m, bot, dummy } = pair('normal');
    run(m, 0.25);
    expect(dummy.health).toBe(100); // it has not reacted yet
    run(m, 1.2);
    expect(bot.brain!.target).toBe(dummy.id);
    expect(dummy.health).toBeLessThan(100);
    expect(bot.shots).toBeGreaterThan(0);
    run(m, 8);
    expect(bot.kills).toBeGreaterThanOrEqual(1); // and finishes the job
  });

  it('does not see through a wall, and does not shoot what it cannot see', () => {
    const { m, bot, dummy } = pair('hard');
    setBox(m.arena, 20, 27, 10, 1, ARENA.wall);
    run(m, 6);
    expect(bot.brain!.visible).toBe(false);
    expect(dummy.health).toBe(100);
  });

  it('does not notice someone behind it, far away and quiet', () => {
    const { m, bot, dummy } = pair('hard', 30);
    place(m, bot, 24.5, 20.5, 0); // looking away (-z) from the dummy at +z
    place(m, dummy, 24.5, 20.5 + 30, Math.PI);
    run(m, 1);
    expect(bot.brain!.target).toBe(-1);
  });

  it('turns toward gunfire it hears and goes to look', () => {
    const { m, bot, dummy } = pair('hard', 25);
    place(m, bot, 24.5, 20.5, 0);
    place(m, dummy, 24.5, 20.5 + 18, Math.PI); // behind the bot
    for (let i = 0; i < 120; i++) {
      if (i % 10 === 0) m.sounds.push({ x: dummy.x, z: dummy.z, tick: m.tick, owner: dummy.id, team: dummy.team });
      stepMatch(m);
      drainEvents(m);
    }
    expect(bot.brain!.target).toBe(dummy.id);
    // It turned around to face the noise (the dummy is behind it, toward +z).
    expect(Math.abs(Math.atan2(Math.sin(bot.yaw - Math.PI), Math.cos(bot.yaw - Math.PI)))).toBeLessThan(0.4);
  });
});

describe('what a bot does about it', () => {
  it('picks the shotgun for a close fight and the railgun for a long one', () => {
    const close = pair('hard', 4);
    const heldDuring = (p: ReturnType<typeof pair>): Set<string> => {
      const held = new Set<string>();
      for (let i = 0; i < 60 * 8 && p.dummy.alive; i++) {
        stepMatch(p.m);
        drainEvents(p.m);
        if (p.dummy.alive) held.add(WEAPON_IDS[p.bot.current] ?? '');
      }
      return held;
    };
    giveWeapon(close.bot, 'shotgun');
    giveWeapon(close.bot, 'rail');
    expect(heldDuring(close).has('shotgun')).toBe(true);
    const far = pair('hard', 36);
    giveWeapon(far.bot, 'shotgun');
    giveWeapon(far.bot, 'rail');
    expect(heldDuring(far).has('rail')).toBe(true);
  });

  it('keeps moving while it shoots, and does not stand still to be hit', () => {
    const { m, bot } = pair('hard', 12);
    let moved = 0;
    let last = { x: bot.x, z: bot.z };
    for (let i = 0; i < 360; i++) {
      stepMatch(m);
      drainEvents(m);
      if (i % 30 === 0) {
        moved += Math.hypot(bot.x - last.x, bot.z - last.z);
        last = { x: bot.x, z: bot.z };
      }
    }
    expect(moved).toBeGreaterThan(8);
  });

  it('reloads an empty gun when nobody is around', () => {
    const { m, bot, dummy } = pair('normal', 12);
    dummy.alive = false;
    dummy.respawnAt = 1e9; // nobody else about
    bot.weapons[1]!.mag = 3;
    run(m, 6);
    expect(bot.weapons[1]!.mag).toBe(30);
  });

  it('goes for health when it is hurt and there is some', () => {
    const m = createMatch({ seed: 4, mode: 'ffa', difficulty: 'normal', bots: 2, human: false });
    const [bot, other] = m.actors as [Actor, Actor];
    other.brain = null;
    place(m, other, 4.5, 4.5, 0);
    const health = m.pickups.find((p) => p.kind === 'health')!;
    place(m, bot, health.x > 24 ? health.x - 14 : health.x + 14, health.z, 0);
    bot.health = 20;
    run(m, 20);
    expect(bot.health).toBeGreaterThan(20);
  });

  it('gets about: a bot on its own walks the arena, over and up and around, and is not stuck', () => {
    for (const seed of [1, 2, 3]) {
      const m = createMatch({ seed, mode: 'ffa', difficulty: 'normal', bots: 3, human: false });
      const dummies = m.actors.slice(1);
      for (const d of dummies) {
        d.brain = null;
        place(m, d, 3.5 + d.id, 3.5, 0); // out of the way, in a corner (and out of sight: the walls)
      }
      const bot = m.actors[0]!;
      let travelled = 0;
      let still = 0;
      let worstStill = 0;
      let last = { x: bot.x, z: bot.z };
      const cells = new Set<number>();
      for (let i = 0; i < 60 * 60; i++) {
        stepMatch(m);
        drainEvents(m);
        if (!bot.alive) continue;
        cells.add(Math.floor(bot.z) * 100 + Math.floor(bot.x));
        if (i % 60 === 59) {
          const d = Math.hypot(bot.x - last.x, bot.z - last.z);
          travelled += d;
          still = d < 0.5 ? still + 1 : 0;
          worstStill = Math.max(worstStill, still);
          last = { x: bot.x, z: bot.z };
        }
      }
      expect(travelled, `seed ${seed}`).toBeGreaterThan(120);
      expect(cells.size, `seed ${seed}`).toBeGreaterThan(60);
      expect(worstStill, `seed ${seed}`).toBeLessThan(8);
    }
  });
});

describe('whole matches', () => {
  it('between bots finish, with a winner, and the books balance', () => {
    for (const [seed, mode, difficulty] of [[1, 'ffa', 'normal'], [2, 'tdm', 'normal'], [3, 'ffa', 'easy'], [4, 'tdm', 'hard']] as const) {
      const m = createMatch({ seed, mode, difficulty, bots: 6, human: false });
      while (m.winner === -1 && m.tick < 60 * 400) {
        stepMatch(m);
        drainEvents(m);
      }
      expect(m.winner, `${mode} ${difficulty}`).not.toBe(-1);
      const kills = m.actors.reduce((s, a) => s + a.kills, 0);
      const deaths = m.actors.reduce((s, a) => s + a.deaths, 0);
      expect(deaths).toBeGreaterThanOrEqual(kills);
      expect(kills).toBeGreaterThan(8);
      expect(deaths - kills, 'only suicides make the difference').toBeLessThan(kills * 0.2 + 3);
      const total = m.scores.reduce((s, v) => s + v, 0);
      expect(total).toBeLessThanOrEqual(kills);
      expect(total).toBeGreaterThan(kills - 8);
    }
  });

  it('never break the rules: finite, inside the arena and out of the walls, health and ammunition in range', () => {
    for (const [seed, mode] of [[5, 'ffa'], [6, 'tdm']] as const) {
      const m = createMatch({ seed, mode, difficulty: 'hard', bots: 7, human: false });
      for (let i = 0; i < 60 * 180; i++) {
        stepMatch(m);
        drainEvents(m);
        if (i % 20 !== 0) continue;
        for (const a of m.actors) {
          expect(Number.isFinite(a.x + a.y + a.z + a.vx + a.vy + a.vz + a.yaw + a.pitch), `${a.name} tick ${i}`).toBe(true);
          expect(a.health).toBeLessThanOrEqual(ACTOR.health);
          expect(a.armor).toBeLessThanOrEqual(ACTOR.armorMax);
          for (const w of a.weapons) {
            expect(w.mag).toBeGreaterThanOrEqual(0);
            expect(w.reserve).toBeGreaterThanOrEqual(0);
          }
          if (!a.alive) continue;
          expect(a.x).toBeGreaterThan(0.5);
          expect(a.x).toBeLessThan(m.arena.size - 0.5);
          expect(a.z).toBeGreaterThan(0.5);
          expect(a.z).toBeLessThan(m.arena.size - 0.5);
          expect(heightUnder(m.arena, a.x, a.z, ACTOR.radius * 0.9), `${a.name} inside a wall at tick ${i}`).toBeLessThanOrEqual(a.y + 0.01);
        }
      }
    }
  });

  it('are the same every time from the same seed', () => {
    const play = (seed: number): string => {
      const m = createMatch({ seed, mode: 'ffa', difficulty: 'normal', bots: 5, human: false });
      run(m, 40);
      return m.actors.map((a) => `${a.x.toFixed(3)},${a.z.toFixed(3)},${a.kills},${Math.round(a.health)}`).join('|');
    };
    expect(play(9)).toBe(play(9));
    expect(play(9)).not.toBe(play(10));
  });
});

describe('the difficulty levels', () => {
  /** A team match with one level on the even team and another on the odd team. */
  function versus(seed: number, evens: Difficulty, odds: Difficulty): { evens: number; odds: number } {
    const m = createMatch({ seed, mode: 'tdm', difficulty: 'normal', bots: 6, human: false });
    for (const a of m.actors) a.brain = createBrain(a.id % 2 === 0 ? evens : odds);
    while (m.winner === -1 && m.tick < 60 * 300) {
      stepMatch(m);
      drainEvents(m);
    }
    const sum = (parity: number): number => m.actors.filter((a) => a.id % 2 === parity).reduce((s, a) => s + a.kills, 0);
    return { evens: sum(0), odds: sum(1) };
  }
  const total = (a: Difficulty, b: Difficulty, seeds: number[]): { a: number; b: number } => {
    let first = 0;
    let second = 0;
    for (const seed of seeds) {
      const r = versus(seed, a, b);
      first += r.evens;
      second += r.odds;
      const swapped = versus(seed, b, a); // the sides swapped, so the map's sides cancel out
      first += swapped.odds;
      second += swapped.evens;
    }
    return { a: first, b: second };
  };

  it('are told apart: easy is slow and sloppy, hard is quick and sharp', () => {
    expect(BOTS.easy.reaction).toBeGreaterThan(BOTS.normal.reaction);
    expect(BOTS.normal.reaction).toBeGreaterThan(BOTS.hard.reaction);
    expect(BOTS.easy.aimError).toBeGreaterThan(BOTS.normal.aimError);
    expect(BOTS.normal.aimError).toBeGreaterThan(BOTS.hard.aimError);
    expect(BOTS.easy.turn).toBeLessThan(BOTS.hard.turn);
  });

  it('hard beats easy handsomely, and normal beats easy', () => {
    const hard = total('hard', 'easy', [1, 2, 3, 4]);
    expect(hard.a).toBeGreaterThan(hard.b * 1.6);
    const normal = total('normal', 'easy', [1, 2, 3, 4]);
    expect(normal.a).toBeGreaterThan(normal.b * 1.2);
  });

  it('hard beats normal', () => {
    const r = total('hard', 'normal', [1, 2, 3, 4]);
    expect(r.a).toBeGreaterThan(r.b * 1.1);
  });

  it('equal bots are an even fight: neither side is favoured by being first', () => {
    const r = total('normal', 'normal', [1, 2, 3, 4, 5, 6]);
    expect(r.a / r.b).toBeGreaterThan(0.8);
    expect(r.a / r.b).toBeLessThan(1.25);
  });
});

describe('cost', () => {
  it('eight bots cost well under a millisecond a tick', () => {
    const m = createMatch({ seed: 2, mode: 'ffa', difficulty: 'hard', bots: 8, human: false });
    run(m, 5); // warm up
    const start = performance.now();
    run(m, 20);
    expect((performance.now() - start) / (20 * 60)).toBeLessThan(0.5);
  });
});
