import { describe, expect, it } from 'vitest';
import { ACTOR, ARENA, DT, MODES, WEAPONS, WEAPON_IDS, sec } from '../src/game/sim/config';
import { lookDir } from '../src/game/sim/physics';
import { canHurt, damageActor, falloff, giveWeapon, spreadOf } from '../src/game/sim/weapons';
import { createMatch, drainEvents, emptyArena, noInput, place, setBox, stepMatch, useArena, type Actor, type Input, type Match, type MatchEvent } from '../src/game/sim/testing';

/** A shooter (actor 0, "you") and a dummy that stands still, ten metres ahead (-z) in an empty arena. */
function duel(options: { mode?: 'ffa' | 'tdm'; distance?: number } = {}): { m: Match; a: Actor; b: Actor } {
  const m = createMatch({ seed: 1, mode: options.mode ?? 'ffa', human: true, bots: 1 });
  useArena(m, emptyArena());
  const a = m.actors[0]!;
  const b = m.actors[1]!;
  b.brain = null;
  b.human = false;
  place(m, a, 24.5, 34.5, 0);
  place(m, b, 24.5, 34.5 - (options.distance ?? 10), 0);
  m.events.length = 0;
  return { m, a, b };
}

/** Points the shooter's head at a height on the target. */
function aim(a: Actor, b: Actor, height: number): Input {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return { ...noInput(), yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(b.y + height - (a.y + ACTOR.eye), Math.hypot(dx, dz)) };
}

const step = (m: Match, input: Input, ticks = 1): MatchEvent[] => {
  const out: MatchEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepMatch(m, input);
    out.push(...drainEvents(m));
  }
  return out;
};

const use = (a: Actor, id: (typeof WEAPON_IDS)[number]): void => {
  giveWeapon(a, id, 1);
  a.current = WEAPON_IDS.indexOf(id);
  a.equipping = 0;
};

describe('damage from a bullet', () => {
  it('falls off between the near and far distance, and no further', () => {
    const rifle = WEAPONS.rifle;
    expect(falloff(rifle, 5)).toBe(rifle.damage);
    expect(falloff(rifle, rifle.falloffStart)).toBe(rifle.damage);
    expect(falloff(rifle, (rifle.falloffStart + rifle.falloffEnd) / 2)).toBeCloseTo(rifle.damage * (1 + rifle.minFraction) / 2, 5);
    expect(falloff(rifle, 500)).toBeCloseTo(rifle.damage * rifle.minFraction);
    expect(falloff(WEAPONS.rail, 150)).toBe(WEAPONS.rail.damage);
  });

  it('takes health by the gun: a body shot, a headshot and a leg shot', () => {
    for (const [height, expected] of [[1.1, 12], [1.6, 12 * 1.8], [0.4, 12 * 0.85]] as const) {
      const { m, a, b } = duel();
      a.weapons[1]!.mag = 30;
      step(m, { ...aim(a, b, height), fire: true });
      expect(b.health, `height ${height}`).toBeCloseTo(100 - expected, 3);
      expect(a.hits).toBe(1);
      expect(a.shots).toBe(1);
    }
  });

  it('a headshot counts as one', () => {
    const { m, a, b } = duel();
    step(m, { ...aim(a, b, 1.62), fire: true });
    expect(a.headshots).toBe(1);
    expect(b.health).toBeLessThan(80);
  });

  it('armour soaks up 60% of it until it runs out', () => {
    const { m, a, b } = duel();
    b.armor = 100;
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.armor).toBeCloseTo(100 - 12 * ACTOR.armorAbsorb, 3);
    expect(b.health).toBeCloseTo(100 - 12 * (1 - ACTOR.armorAbsorb), 3);
    b.armor = 2;
    b.health = 100;
    const before = a.cooldown;
    a.cooldown = 0;
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.armor).toBe(0);
    expect(b.health).toBeCloseTo(100 - (12 - 2), 3);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('does nothing to someone who has just spawned, and the shot is still used', () => {
    const { m, a, b } = duel();
    b.protect = sec(2);
    const events = step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.health).toBe(100);
    expect(a.shots).toBe(1);
    expect(events.some((e) => e.type === 'bullet' && e.hit === 'actor')).toBe(true);
  });

  it('is stopped by a wall, and a bullet over a low crate gets through', () => {
    const { m, a, b } = duel();
    setBox(m.arena, 24, 27, 1, 1, ARENA.wall);
    const events = step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.health).toBe(100);
    expect(events.find((e) => e.type === 'bullet')).toMatchObject({ hit: 'world' });
    setBox(m.arena, 24, 27, 1, 1, 0.8);
    a.cooldown = 0;
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.health).toBeLessThan(100);
  });

  it('misses a body off to the side', () => {
    const { m, a, b } = duel();
    b.x += 1.5;
    step(m, { ...aim(a, { ...b, x: b.x - 1.5 }, 1.1), fire: true });
    expect(b.health).toBe(100);
  });

  it('a team cannot hurt itself, but you can hurt yourself', () => {
    const { m, a, b } = duel({ mode: 'tdm' });
    b.team = a.team;
    expect(canHurt(a, b)).toBe(false);
    expect(canHurt(a, a)).toBe(true);
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.health).toBe(100);
    b.team = 1 - a.team;
    expect(canHurt(a, b)).toBe(true);
    expect(damageActor(m, b, 10, a, 'rifle', false, a.x, a.z)).toBe(10);
  });
});

describe('firing, ammunition and reloading', () => {
  it('fires the rifle about eleven times a second while the trigger is held, and uses a round each', () => {
    const { m, a, b } = duel();
    const start = a.weapons[1]!.mag;
    const events = step(m, { ...aim(a, b, 1.1), fire: true }, 60);
    const shots = events.filter((e) => e.type === 'fire').length;
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(12);
    expect(a.weapons[1]!.mag).toBe(start - shots);
  });

  it('keeps firing a single-shot gun while the button is held, at its own pace (kind to a touch screen)', () => {
    const { m, a, b } = duel();
    use(a, 'pistol');
    const shots = step(m, { ...aim(a, b, 1.1), fire: true }, 60).filter((e) => e.type === 'fire').length;
    expect(shots).toBeGreaterThanOrEqual(4);
    expect(shots).toBeLessThanOrEqual(5);
  });

  it('reloads by itself when the magazine runs dry, takes the time it should, and moves rounds from the reserve', () => {
    const { m, a, b } = duel();
    const slot = a.weapons[1]!;
    slot.mag = 1;
    const reserve = slot.reserve;
    const events = step(m, { ...aim(a, b, 1.1), fire: true }, 20);
    expect(events.some((e) => e.type === 'reload')).toBe(true);
    expect(a.reloading).toBeGreaterThan(0);
    expect(slot.mag).toBe(0);
    step(m, { ...noInput(), yaw: a.yaw }, sec(WEAPONS.rifle.reload) + 2);
    expect(a.reloading).toBe(0);
    expect(slot.mag).toBe(WEAPONS.rifle.magazine);
    expect(slot.reserve).toBe(reserve - WEAPONS.rifle.magazine);
  });

  it('cannot fire while reloading, and reloading a part-empty magazine only tops it up', () => {
    const { m, a } = duel();
    const slot = a.weapons[1]!;
    slot.mag = 20;
    const reserve = slot.reserve;
    step(m, { ...noInput(), reload: true });
    expect(a.reloading).toBeGreaterThan(0);
    const fired = step(m, { ...noInput(), fire: true }, 10).filter((e) => e.type === 'fire').length;
    expect(fired).toBe(0);
    step(m, noInput(), sec(WEAPONS.rifle.reload) + 2);
    expect(slot.mag).toBe(30);
    expect(slot.reserve).toBe(reserve - 10);
  });

  it('the pistol never runs out of spare rounds', () => {
    const { m, a } = duel();
    use(a, 'pistol');
    const slot = a.weapons[0]!;
    slot.mag = 0;
    step(m, { ...noInput(), reload: true }, sec(WEAPONS.pistol.reload) + 3);
    expect(slot.mag).toBe(12);
    expect(slot.reserve).toBe(Infinity);
  });

  it('does not reload with a full magazine or nothing in reserve', () => {
    const { m, a } = duel();
    expect(step(m, { ...noInput(), reload: true }).some((e) => e.type === 'reload')).toBe(false);
    a.weapons[1]!.mag = 0;
    a.weapons[1]!.reserve = 0;
    expect(step(m, { ...noInput(), reload: true, fire: true }).some((e) => e.type === 'reload')).toBe(false);
  });

  it('switches to a gun you have, after it comes up; ignores one you do not have', () => {
    const { m, a, b } = duel();
    const events = step(m, { ...aim(a, b, 1.1), switchTo: 2 });
    expect(a.current).toBe(1);
    expect(events.some((e) => e.type === 'switch')).toBe(false);
    giveWeapon(a, 'shotgun');
    const events2 = step(m, { ...aim(a, b, 1.1), switchTo: 2 });
    expect(a.current).toBe(2);
    expect(events2.find((e) => e.type === 'switch')).toMatchObject({ weapon: 'shotgun' });
    // Not usable until it is up.
    const early = step(m, { ...aim(a, b, 1.1), fire: true }, 10).filter((e) => e.type === 'fire').length;
    expect(early).toBe(0);
    const later = step(m, { ...aim(a, b, 1.1), fire: true }, sec(WEAPONS.shotgun.equip)).filter((e) => e.type === 'fire').length;
    expect(later).toBeGreaterThanOrEqual(1);
  });

  it('gives and tops up ammunition without going over the most carried', () => {
    const { a } = duel();
    giveWeapon(a, 'rail', 0.5);
    expect(a.weapons[3]).toMatchObject({ owned: true, mag: 4, reserve: 10 });
    giveWeapon(a, 'rail', 0.5);
    giveWeapon(a, 'rail', 0.5);
    expect(a.weapons[3]!.reserve).toBe(WEAPONS.rail.reserve);
  });
});

describe('where the bullets go', () => {
  const angleOf = (e: MatchEvent, a: Actor): number => {
    if (e.type !== 'bullet') return 0;
    const dx = e.tx - a.x;
    const dy = e.ty - (a.y + ACTOR.eye);
    const dz = e.tz - a.z;
    const len = Math.hypot(dx, dy, dz);
    const look = lookDir(a.yaw, a.pitch);
    return Math.acos(Math.min(1, (dx * look.x + dy * look.y + dz * look.z) / len)) * (180 / Math.PI);
  };

  it('stay inside the cone, which is wider on the move, in the air and after a burst, and narrower when aiming', () => {
    const spread = (setup: (a: Actor) => void, input: Partial<Input> = {}): number => {
      const { m, a } = duel();
      // A wall far enough away that every bullet lands on it.
      let worst = 0;
      for (let n = 0; n < 150; n++) {
        a.weapons[0]!.mag = 12;
        a.cooldown = 0;
        a.bloom = 0;
        setup(a);
        use(a, 'pistol');
        a.cooldown = 0;
        const events = step(m, { ...noInput(), yaw: 0, pitch: 0, fire: true, ...input });
        for (const e of events) if (e.type === 'bullet') worst = Math.max(worst, angleOf(e, a));
      }
      return worst;
    };
    const still = spread(() => undefined);
    expect(still).toBeLessThanOrEqual(WEAPONS.pistol.spread + 0.2);
    expect(still).toBeGreaterThan(0.1);
    const moving = spread((a) => {
      a.vz = -ACTOR.sprint;
    });
    expect(moving).toBeGreaterThan(still + 0.3);
    const aimed = spread(() => undefined, { aim: true });
    expect(aimed).toBeLessThan(still);
    const airborne = spread((a) => {
      a.y = 3;
      a.onGround = false;
    });
    expect(airborne).toBeGreaterThan(still + 0.5);
  });

  it('grow while an automatic gun is held down, and settle again', () => {
    const { m, a, b } = duel();
    step(m, { ...aim(a, b, 1.1), fire: true }, 40);
    expect(a.bloom).toBeGreaterThan(1);
    expect(spreadOf(a)).toBeGreaterThan(WEAPONS.rifle.spread + 1);
    step(m, noInput(), 90);
    expect(a.bloom).toBe(0);
  });

  it('are ten pellets in a shotgun blast, inside the cone, hurting a lot up close and little far away', () => {
    const near = duel({ distance: 3 });
    use(near.a, 'shotgun');
    const events = step(near.m, { ...aim(near.a, near.b, 1.1), fire: true });
    const pellets = events.filter((e) => e.type === 'bullet');
    expect(pellets).toHaveLength(10);
    for (const p of pellets) expect(angleOf(p, near.a)).toBeLessThanOrEqual(WEAPONS.shotgun.spread + 0.2);
    expect(100 - near.b.health).toBeGreaterThan(55);
    const far = duel({ distance: 22 });
    use(far.a, 'shotgun');
    step(far.m, { ...aim(far.a, far.b, 1.1), fire: true });
    expect(100 - far.b.health).toBeLessThan(25);
  });

  it('a railgun does ninety to the body, and a headshot kills', () => {
    const body = duel({ distance: 30 });
    use(body.a, 'rail');
    step(body.m, { ...aim(body.a, body.b, 1.1), fire: true });
    expect(body.b.health).toBeCloseTo(10, 0);
    const head = duel({ distance: 30 });
    use(head.a, 'rail');
    const events = step(head.m, { ...aim(head.a, head.b, 1.6), fire: true });
    expect(head.b.alive).toBe(false);
    expect(events.find((e) => e.type === 'kill')).toMatchObject({ killer: 0, victim: 1, weapon: 'rail', head: true });
  });
});

describe('rockets', () => {
  it('fly at their speed, burst on a wall with a blast, and are gone', () => {
    const { m, a } = duel();
    use(a, 'rocket');
    setBox(m.arena, 20, 14, 10, 1, ARENA.wall);
    // Twenty metres of flight at thirty a second.
    const events = step(m, { ...noInput(), yaw: 0, pitch: 0, fire: true });
    expect(m.projectiles).toHaveLength(1);
    expect(events.some((e) => e.type === 'rocket')).toBe(true);
    const speed = Math.hypot(m.projectiles[0]!.vx, m.projectiles[0]!.vy, m.projectiles[0]!.vz);
    expect(speed).toBeCloseTo(WEAPONS.rocket.projectile!.speed, 1);
    const after = step(m, noInput(), 90);
    const boom = after.find((e) => e.type === 'explosion');
    expect(boom).toBeDefined();
    expect(m.projectiles).toHaveLength(0);
    if (boom?.type === 'explosion') expect(boom.z).toBeGreaterThan(15); // on this side of the wall
  });

  it('hurt more the nearer they burst, hurt the one who fired them half as much, and shove', () => {
    const { m, a, b } = duel();
    use(a, 'rocket');
    // A wall behind the target for it to hit, the target close to it.
    setBox(m.arena, 20, 20, 10, 1, ARENA.wall);
    place(m, b, 24.5, 21.6, 0);
    place(m, a, 24.5, 30.5, 0);
    step(m, { ...noInput(), yaw: 0, pitch: -0.02, fire: true });
    // Step to the moment of the blast: the shove is a burst of speed that friction then takes away.
    let burst = false;
    for (let i = 0; i < 90 && !burst; i++) burst = step(m, noInput()).some((e) => e.type === 'explosion');
    expect(burst).toBe(true);
    const hurt = 100 - b.health;
    expect(hurt).toBeGreaterThan(40);
    expect(Math.hypot(b.vx, b.vz, b.vy)).toBeGreaterThan(3); // shoved
    // At arm's length from yourself: your own rocket hurts you, but less.
    const mine = duel();
    use(mine.a, 'rocket');
    setBox(mine.m.arena, 20, 31, 10, 1, ARENA.wall);
    place(mine.m, mine.a, 24.5, 33, 0);
    place(mine.m, mine.b, 5.5, 5.5, 0);
    step(mine.m, { ...noInput(), yaw: 0, pitch: 0, fire: true });
    step(mine.m, noInput(), 30);
    const self = 100 - mine.a.health;
    expect(self).toBeGreaterThan(5);
    expect(self).toBeLessThan(hurt);
  });

  it('a wall between you and the blast shields you', () => {
    const { m, a, b } = duel();
    use(a, 'rocket');
    setBox(m.arena, 20, 20, 10, 1, ARENA.wall); // the target wall
    setBox(m.arena, 26, 20, 1, 6, ARENA.wall); // a shield, beside where it lands
    place(m, a, 24.5, 30.5, 0);
    place(m, b, 28.0, 21.5, 0);
    step(m, { ...noInput(), yaw: 0, pitch: -0.02, fire: true });
    step(m, noInput(), 60);
    expect(b.health).toBe(100);
  });
});

describe('kills, scores and coming back', () => {
  it('count for the killer, in a free-for-all', () => {
    const { m, a, b } = duel();
    b.health = 10;
    const events = step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(a.streak).toBe(1);
    expect(b.deaths).toBe(1);
    expect(m.scores[a.id]).toBe(1);
    expect(events.find((e) => e.type === 'kill')).toMatchObject({ killer: 0, victim: 1 });
    expect(events.find((e) => e.type === 'death')).toMatchObject({ actor: 1, killer: 0 });
  });

  it('count for the team, in a team match', () => {
    const { m, a, b } = duel({ mode: 'tdm' });
    b.health = 10;
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(m.scores).toEqual([1, 0]);
  });

  it('a suicide takes a point off', () => {
    const { m, a } = duel();
    m.scores[a.id] = 3;
    a.health = 5;
    use(a, 'rocket');
    setBox(m.arena, 24, 33, 1, 1, ARENA.wall);
    place(m, a, 24.5, 34.5, 0);
    step(m, { ...noInput(), yaw: 0, pitch: 0, fire: true });
    step(m, noInput(), 20);
    expect(a.alive).toBe(false);
    expect(m.scores[a.id]).toBe(2);
    expect(a.kills).toBe(0);
  });

  it('come back after three seconds with full health, the starting guns and a moment of safety', () => {
    const { m, a, b } = duel();
    b.health = 1;
    giveWeapon(b, 'rocket');
    step(m, { ...aim(a, b, 1.1), fire: true });
    expect(b.alive).toBe(false);
    step(m, noInput(), sec(ACTOR.respawn) - 5);
    expect(b.alive).toBe(false);
    const events = step(m, noInput(), 10);
    expect(b.alive).toBe(true);
    expect(events.some((e) => e.type === 'spawn' && e.actor === 1)).toBe(true);
    expect(b.health).toBe(100);
    expect(b.armor).toBe(0);
    expect(b.weapons[4]!.owned).toBe(false);
    expect(b.weapons[0]!.owned && b.weapons[1]!.owned).toBe(true);
    expect(b.protect).toBeGreaterThan(0);
  });

  it('end the match at the score limit, and nothing happens after', () => {
    const { m, a, b } = duel();
    m.scores[a.id] = MODES.ffa.scoreLimit - 1;
    b.health = 1;
    const events = step(m, { ...aim(a, b, 1.1), fire: true });
    expect(m.winner).toBe(a.id);
    expect(events.find((e) => e.type === 'end')).toMatchObject({ winner: a.id });
    const tick = m.tick;
    step(m, noInput(), 30);
    expect(m.tick).toBe(tick);
  });

  it('end at the time limit with the best score, or a draw if it is shared', () => {
    const one = duel();
    one.m.scores[1] = 4;
    one.m.scores[0] = 2;
    one.m.timeLeft = 2;
    step(one.m, noInput(), 3);
    expect(one.m.winner).toBe(1);
    const tie = duel();
    tie.m.scores[0] = 3;
    tie.m.scores[1] = 3;
    tie.m.timeLeft = 2;
    step(tie.m, noInput(), 3);
    expect(tie.m.winner).toBe(-2);
  });
});

describe('tick length', () => {
  it('is a sixtieth of a second', () => {
    expect(DT).toBeCloseTo(1 / 60);
  });
});
