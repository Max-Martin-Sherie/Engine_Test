import { describe, expect, it } from 'vitest';
import { ACTOR, ARENA, DT } from '../src/game/sim/config';
import { generateArena } from '../src/game/sim/arena';
import { heightUnder, lineOfSight, lookDir, moveActor, raycastWorld, rayVsCylinder, wrapAngle } from '../src/game/sim/physics';
import { createMatch, noInput, place, setBox, useArena, emptyArena, type Actor, type Input, type Match, type MatchEvent } from '../src/game/sim/testing';

/** One body alone in an empty arena. */
function alone(): { m: Match; a: Actor; events: MatchEvent[] } {
  const m = createMatch({ seed: 1, human: true, bots: 1 });
  useArena(m, emptyArena());
  place(m, m.actors[0]!, 24.5, 24.5);
  return { m, a: m.actors[0]!, events: [] };
}

function walk(m: Match, a: Actor, input: Partial<Input>, seconds: number, events: MatchEvent[] = []): void {
  const i = { ...noInput(), yaw: a.yaw, ...input };
  for (let n = 0; n < Math.round(seconds / DT); n++) moveActor(m.arena, a, i, DT, events);
}

describe('looking and turning', () => {
  it('yaw 0 looks along -z, a positive yaw turns left, a positive pitch looks up', () => {
    const f = lookDir(0, 0);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    const left = lookDir(Math.PI / 2, 0);
    expect(left.x).toBeCloseTo(-1);
    expect(left.z).toBeCloseTo(0);
    expect(lookDir(0, Math.PI / 4).y).toBeGreaterThan(0.7);
    expect(Math.hypot(...Object.values(lookDir(1.1, 0.4)))).toBeCloseTo(1);
  });

  it('wraps angles into -pi..pi', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
    expect(wrapAngle(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 5);
    expect(wrapAngle(0.3)).toBeCloseTo(0.3);
  });
});

describe('walking, jumping, falling', () => {
  it('walks forward at walking speed, faster when sprinting, and stops when the stick is let go', () => {
    const { m, a } = alone();
    walk(m, a, { moveZ: 1 }, 2);
    expect(Math.hypot(a.vx, a.vz)).toBeCloseTo(ACTOR.walk, 1);
    expect(a.z).toBeLessThan(24.5 - ACTOR.walk * 1.7); // forward is -z
    expect(Math.abs(a.x - 24.5)).toBeLessThan(0.01);
    walk(m, a, { moveZ: 1, sprint: true }, 1.5);
    expect(Math.hypot(a.vx, a.vz)).toBeCloseTo(ACTOR.sprint, 1);
    walk(m, a, {}, 1);
    expect(Math.hypot(a.vx, a.vz)).toBeLessThan(0.05);
  });

  it('strafes right with +x at yaw 0, backs up, and moves no faster diagonally', () => {
    const { m, a } = alone();
    walk(m, a, { moveX: 1 }, 1);
    expect(a.x).toBeGreaterThan(24.5 + 3);
    place(m, a, 24.5, 24.5);
    walk(m, a, { moveZ: -1 }, 1);
    expect(a.z).toBeGreaterThan(24.5 + 3);
    place(m, a, 24.5, 24.5);
    walk(m, a, { moveX: 1, moveZ: 1 }, 2);
    expect(Math.hypot(a.vx, a.vz)).toBeLessThanOrEqual(ACTOR.walk + 0.05);
  });

  it('turns with the head: forward is wherever you look', () => {
    const { m, a } = alone();
    place(m, a, 24.5, 24.5, Math.PI / 2);
    walk(m, a, { moveZ: 1, yaw: Math.PI / 2 }, 1);
    expect(a.x).toBeLessThan(24.5 - 3);
    expect(Math.abs(a.z - 24.5)).toBeLessThan(0.05);
  });

  it('jumps about a metre, hangs in the air about two thirds of a second, and lands', () => {
    const { m, a, events } = alone();
    let top = 0;
    let airTicks = 0;
    const jump = { ...noInput(), jump: true };
    moveActor(m.arena, a, jump, DT, events);
    expect(a.onGround).toBe(false);
    expect(events.some((e) => e.type === 'jump')).toBe(true);
    for (let i = 0; i < 120 && !a.onGround; i++) {
      moveActor(m.arena, a, noInput(), DT, events);
      top = Math.max(top, a.y);
      airTicks += 1;
    }
    expect(top).toBeGreaterThan(1.05);
    expect(top).toBeLessThan(1.3);
    expect(airTicks / 60).toBeGreaterThan(0.55);
    expect(airTicks / 60).toBeLessThan(0.8);
    expect(a.y).toBe(0);
    expect(events.some((e) => e.type === 'land')).toBe(true);
  });

  it('falls off a ledge and lands hard enough to be heard', () => {
    const { m, a, events } = alone();
    setBox(m.arena, 20, 20, 10, 10, 2);
    place(m, a, 24.5, 24.5);
    expect(a.y).toBe(2);
    walk(m, a, { moveZ: 1 }, 2, events);
    expect(a.y).toBe(0);
    expect(events.some((e) => e.type === 'land' && e.speed > 5)).toBe(true);
  });
});

describe('walls, steps and crates', () => {
  it('stops at a wall and slides along it', () => {
    const { m, a } = alone();
    setBox(m.arena, 24, 10, 1, 10, ARENA.wall);
    place(m, a, 20.5, 15.5);
    walk(m, a, { moveX: 1 }, 2);
    expect(a.x).toBeCloseTo(24 - ACTOR.radius, 1);
    // Pushing into it at an angle, you keep going along it.
    place(m, a, 20.5, 15.5);
    walk(m, a, { moveX: 1, moveZ: 1 }, 1);
    expect(a.x).toBeLessThanOrEqual(24 - ACTOR.radius + 0.01);
    expect(a.z).toBeLessThan(15.5 - 2); // forward is -z
  });

  it('walks up steps of half a metre but not a wall of 0.7', () => {
    const { m, a } = alone();
    setBox(m.arena, 20, 20, 5, 5, 0.5);
    place(m, a, 18.5, 22.5);
    walk(m, a, { moveX: 1 }, 1);
    expect(a.y).toBe(0.5);
    expect(a.x).toBeGreaterThan(20.5);
    setBox(m.arena, 30, 20, 5, 5, 0.7);
    place(m, a, 28.5, 22.5);
    walk(m, a, { moveX: 1 }, 1);
    expect(a.y).toBe(0);
    expect(a.x).toBeLessThan(30);
  });

  it('jumps onto a one metre crate and stands on it, and can walk off it again', () => {
    const { m, a } = alone();
    setBox(m.arena, 26, 24, 2, 2, 1);
    place(m, a, 24.5, 24.9);
    // Run at it and jump.
    const run: Partial<Input> = { moveX: 1, yaw: 0 };
    walk(m, a, run, 0.22);
    walk(m, a, { ...run, jump: true }, 0.05);
    walk(m, a, run, 0.7);
    expect(a.y).toBe(1);
    expect(a.onGround).toBe(true);
    expect(a.x).toBeGreaterThan(26);
    // Walk off the far side: back down to the floor.
    walk(m, a, { moveX: 1 }, 1);
    expect(a.y).toBe(0);
  });

  it('cannot jump onto a two metre block', () => {
    const { m, a } = alone();
    setBox(m.arena, 26, 24, 2, 2, 2);
    place(m, a, 24.5, 24.9);
    walk(m, a, { moveX: 1, jump: true }, 0.05);
    walk(m, a, { moveX: 1 }, 1.5);
    expect(a.y).toBe(0);
    expect(a.x).toBeLessThan(26);
  });

  it('measures what is under a body: the tallest column its circle touches', () => {
    const arena = emptyArena();
    setBox(arena, 10, 10, 1, 1, 1.5);
    expect(heightUnder(arena, 10.5, 10.5, 0.35)).toBe(1.5);
    expect(heightUnder(arena, 9.7, 10.5, 0.35)).toBe(1.5); // the edge of the circle touches it
    expect(heightUnder(arena, 9.5, 10.5, 0.35)).toBe(0);
    expect(heightUnder(arena, 0.5, 5, 0.35)).toBe(ARENA.wall);
  });

  it('never ends up inside a column or out of the arena, whatever it is told to do', () => {
    const arena = generateArena(7);
    const m = createMatch({ seed: 7, human: true, bots: 1 });
    useArena(m, arena);
    const a = m.actors[0]!;
    place(m, a, arena.spawns[0]!.x, arena.spawns[0]!.z);
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const events: MatchEvent[] = [];
    let input = noInput();
    for (let i = 0; i < 20000; i++) {
      if (i % 20 === 0) input = { ...noInput(), moveX: rnd() * 2 - 1, moveZ: rnd() * 2 - 1, yaw: rnd() * 6.28, jump: rnd() < 0.3, sprint: rnd() < 0.5 };
      moveActor(arena, a, input, DT, events);
      expect(Number.isFinite(a.x + a.y + a.z)).toBe(true);
      expect(a.x).toBeGreaterThan(1);
      expect(a.x).toBeLessThan(arena.size - 1);
      expect(a.z).toBeGreaterThan(1);
      expect(a.z).toBeLessThan(arena.size - 1);
      expect(heightUnder(arena, a.x, a.z, ACTOR.radius * 0.9), `tick ${i}`).toBeLessThanOrEqual(a.y + 1e-3);
    }
  });
});

describe('rays through the world', () => {
  it('hit a wall at the right distance with the right face, and the floor and a top', () => {
    const arena = emptyArena();
    setBox(arena, 30, 20, 1, 10, ARENA.wall);
    const side = raycastWorld(arena, 20, 1.5, 24.5, 1, 0, 0, 100)!;
    expect(side.t).toBeCloseTo(10);
    expect([side.nx, side.ny, side.nz]).toEqual([-1, 0, 0]);
    const floor = raycastWorld(arena, 20, 2, 24.5, 0, -1, 0, 100)!;
    expect(floor.t).toBeCloseTo(2);
    expect(floor.ny).toBe(1);
    setBox(arena, 10, 10, 2, 2, 1);
    const top = raycastWorld(arena, 10.5, 5, 10.5, 0, -1, 0, 100)!;
    expect(top.t).toBeCloseTo(4);
    expect(top.ny).toBe(1);
    expect(raycastWorld(arena, 20, 1.5, 24.5, 1, 0, 0, 5)).toBeNull(); // too short to reach
  });

  it('pass over a low crate and are stopped by a tall wall', () => {
    const arena = emptyArena();
    setBox(arena, 24, 20, 1, 10, 1);
    // A level shot at 1.6 m goes over a one metre crate (and is too short here to reach the far wall).
    const level = raycastWorld(arena, 20, 1.6, 24.5, 1, 0, 0, 12);
    expect(level).toBeNull();
    // At knee height the crate stops it.
    const low = raycastWorld(arena, 20, 0.6, 24.5, 1, 0, 0, 12)!;
    expect(low.t).toBeCloseTo(4);
    // Aimed down at a crate from above lands on its top.
    const d = Math.hypot(4, 0.5);
    const down = raycastWorld(arena, 20, 1.8, 24.5, 4 / d, -0.5 / d, 0, 20)!;
    expect(down.ny).toBe(1);
  });

  it('agree with stepping along the ray in tiny steps, for many random rays in a real arena', () => {
    const arena = generateArena(5);
    let seed = 99;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      const ox = 4 + rnd() * 40;
      const oz = 4 + rnd() * 40;
      const oy = 0.3 + rnd() * 2.5;
      const yaw = rnd() * 6.283;
      const pitch = (rnd() - 0.55) * 1.2;
      const d = lookDir(yaw, pitch);
      const max = 60;
      const fast = raycastWorld(arena, ox, oy, oz, d.x, d.y, d.z, max);
      // Brute force.
      let slow: number | null = null;
      for (let t = 0; t <= max; t += 0.01) {
        const x = ox + d.x * t;
        const y = oy + d.y * t;
        const z = oz + d.z * t;
        const h = Math.floor(x) < 0 || Math.floor(z) < 0 || Math.floor(x) >= arena.size || Math.floor(z) >= arena.size ? ARENA.wall : arena.heights[Math.floor(z) * arena.size + Math.floor(x)]!;
        if (y <= Math.max(0, h)) {
          slow = t;
          break;
        }
      }
      if (slow === null) expect(fast === null || fast.t >= max - 0.02, `ray ${i}`).toBe(true);
      else {
        hits += 1;
        expect(fast, `ray ${i} should hit`).not.toBeNull();
        expect(Math.abs(fast!.t - slow), `ray ${i}`).toBeLessThan(0.03);
      }
    }
    expect(hits).toBeGreaterThan(300);
  });

  it('see over low cover and not through walls (line of sight)', () => {
    const arena = emptyArena();
    setBox(arena, 24, 10, 1, 10, 1);
    expect(lineOfSight(arena, 20, 1.6, 15, 28, 1.6, 15)).toBe(true);
    expect(lineOfSight(arena, 20, 0.5, 15, 28, 0.5, 15)).toBe(false);
    setBox(arena, 24, 10, 1, 10, ARENA.wall);
    expect(lineOfSight(arena, 20, 1.6, 15, 28, 1.6, 15)).toBe(false);
    expect(lineOfSight(arena, 20, 1.6, 15, 22, 1.6, 15)).toBe(true);
  });
});

describe('rays against a body', () => {
  it('hit the middle, miss to the side, report the height, and hit the top and bottom', () => {
    const hit = rayVsCylinder(0, 1, 10, 0, 0, -1, 0, 0, 0, 0.4, 1.8, 50)!;
    expect(hit.t).toBeCloseTo(9.6);
    expect(hit.y).toBeCloseTo(1);
    expect(rayVsCylinder(0.5, 1, 10, 0, 0, -1, 0, 0, 0, 0.4, 1.8, 50)).toBeNull();
    expect(rayVsCylinder(0.3, 1, 10, 0, 0, -1, 0, 0, 0, 0.4, 1.8, 50)).not.toBeNull();
    expect(rayVsCylinder(0, 1, 10, 0, 0, -1, 0, 0, 0, 0.4, 1.8, 5)).toBeNull(); // too far
    const over = rayVsCylinder(0, 5, 0, 0, -1, 0, 0, 0, 0, 0.4, 1.8, 50)!; // straight down onto the head
    expect(over.t).toBeCloseTo(3.2);
    expect(over.y).toBeCloseTo(1.8);
    expect(rayVsCylinder(0, 1, 10, 0, 0, 1, 0, 0, 0, 0.4, 1.8, 50)).toBeNull(); // pointing away
    expect(rayVsCylinder(0, 2.5, 10, 0, 0, -1, 0, 0, 0, 0.4, 1.8, 50)).toBeNull(); // over the head
  });
});
