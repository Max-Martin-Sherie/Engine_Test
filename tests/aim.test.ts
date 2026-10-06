import { describe, expect, it } from 'vitest';
import { CONE, assistLook, crosshairOnEnemy, findAimTarget } from '../src/game/aim';
import { DEG } from '../src/game/sim/config';
import { createMatch, stepMatch } from '../src/game/sim';
import { emptyArena, place, setBox, useArena } from '../src/game/sim/testing';

function scene(): { m: ReturnType<typeof createMatch>; me: ReturnType<typeof createMatch>['actors'][number]; foe: ReturnType<typeof createMatch>['actors'][number] } {
  const m = createMatch({ seed: 5, mode: 'ffa', bots: 1, human: true });
  useArena(m, emptyArena());
  const me = m.actors[0]!;
  const foe = m.actors[1]!;
  place(m, me, 24.5, 32.5, 0);
  place(m, foe, 24.5, 22.5, 0);
  me.protect = 0;
  foe.protect = 0;
  return { m, me, foe };
}

describe('finding who to help aim at', () => {
  it('finds an enemy straight ahead, at no angle', () => {
    const { m, me } = scene();
    const t = findAimTarget(m, me, 0, 0);
    expect(t).not.toBeNull();
    expect(t!.id).toBe(1);
    expect(t!.distance).toBeCloseTo(10, 0);
    expect(Math.abs(t!.dYaw)).toBeLessThan(1e-6);
  });

  it('says to turn left (positive yaw) for an enemy on the left', () => {
    const { m, me, foe } = scene();
    place(m, foe, 23.5, 22.5, 0);
    const t = findAimTarget(m, me, 0, 0);
    expect(t).not.toBeNull();
    expect(t!.dYaw).toBeGreaterThan(0);
    place(m, foe, 25.5, 22.5, 0);
    expect(findAimTarget(m, me, 0, 0)!.dYaw).toBeLessThan(0);
  });

  it('says to look up for an enemy standing higher', () => {
    const { m, me, foe } = scene();
    setBox(m.arena, 24, 22, 1, 1, 2);
    place(m, foe, 24.5, 22.5, 0);
    expect(foe.y).toBe(2);
    expect(findAimTarget(m, me, 0, 0)!.dPitch).toBeGreaterThan(0);
  });

  it('ignores an enemy outside the cone, behind a wall, a teammate and someone safe', () => {
    const { m, me, foe } = scene();
    place(m, foe, 30.5, 22.5, 0);
    expect(findAimTarget(m, me, 0, 0)).toBeNull();
    place(m, foe, 24.5, 22.5, 0);
    setBox(m.arena, 24, 27, 1, 1, 3);
    expect(findAimTarget(m, me, 0, 0)).toBeNull();
    setBox(m.arena, 24, 27, 1, 1, 0);
    expect(findAimTarget(m, me, 0, 0)).not.toBeNull();
    foe.protect = 60;
    expect(findAimTarget(m, me, 0, 0)).toBeNull();
    foe.protect = 0;
    foe.team = me.team;
    expect(findAimTarget(m, me, 0, 0)).toBeNull();
  });

  it('prefers the enemy nearer the crosshair', () => {
    const { m, me } = scene();
    const m2 = createMatch({ seed: 5, mode: 'ffa', bots: 2, human: true });
    useArena(m2, emptyArena());
    const a = m2.actors[0]!;
    place(m2, a, 24.5, 32.5, 0);
    place(m2, m2.actors[1]!, 24.9, 22.5, 0);
    place(m2, m2.actors[2]!, 24.5, 22.5, 0);
    for (const x of m2.actors) x.protect = 0;
    expect(findAimTarget(m2, a, 0, 0)!.id).toBe(2);
    void m;
    void me;
  });
});

describe('the aim assist', () => {
  const target = (angle: number): { id: number; dYaw: number; dPitch: number; angle: number; distance: number } => ({ id: 1, dYaw: angle, dPitch: 0, angle, distance: 10 });

  it('changes nothing with no target or with the assist off', () => {
    expect(assistLook(0.1, 0.02, null, { strength: 1, turning: true, firing: true }, 1 / 60)).toEqual({ dYaw: 0.1, dPitch: 0.02 });
    expect(assistLook(0.1, 0.02, target(0.02), { strength: 0, turning: true, firing: true }, 1 / 60)).toEqual({ dYaw: 0.1, dPitch: 0.02 });
  });

  it('slows a turn near the target, more the nearer it is, and not at all at the edge of the cone', () => {
    const edge = assistLook(0.1, 0, target(CONE), { strength: 1, turning: false, firing: false }, 1 / 60);
    expect(edge.dYaw).toBeCloseTo(0.1, 6);
    const mid = assistLook(0.1, 0, target(CONE / 2), { strength: 1, turning: false, firing: false }, 1 / 60);
    const near = assistLook(0.1, 0, target(0.001), { strength: 1, turning: false, firing: false }, 1 / 60);
    expect(mid.dYaw).toBeLessThan(0.1);
    expect(near.dYaw).toBeLessThan(mid.dYaw);
    expect(near.dYaw).toBeGreaterThan(0.045);
  });

  it('drifts toward the target while turning or firing, and not when still', () => {
    const t = target(3 * DEG);
    const still = assistLook(0, 0, t, { strength: 1, turning: false, firing: false }, 1 / 60);
    expect(still.dYaw).toBe(0);
    const firing = assistLook(0, 0, t, { strength: 1, turning: false, firing: true }, 1 / 60);
    expect(firing.dYaw).toBeGreaterThan(0);
    const turning = assistLook(0, 0, t, { strength: 1, turning: true, firing: false }, 1 / 60);
    expect(turning.dYaw).toBeGreaterThan(0);
    const weaker = assistLook(0, 0, t, { strength: 0.4, turning: true, firing: false }, 1 / 60);
    expect(weaker.dYaw).toBeLessThan(turning.dYaw);
  });

  it('never drifts past the target', () => {
    const t = target(0.0002);
    const r = assistLook(0, 0, t, { strength: 1, turning: true, firing: true }, 1);
    expect(r.dYaw).toBeLessThanOrEqual(0.0002 + 1e-9);
  });

  it('pulls a player onto a target in a second or so', () => {
    const { m, me } = scene();
    place(m, m.actors[1]!, 24.5 - 0.9, 22.5, 0);
    let yaw = 0;
    let pitch = 0;
    for (let i = 0; i < 90; i++) {
      const t = findAimTarget(m, me, yaw, pitch);
      const r = assistLook(0, 0, t, { strength: 1, turning: false, firing: true }, 1 / 60);
      yaw += r.dYaw;
      pitch += r.dPitch;
    }
    const t = findAimTarget(m, me, yaw, pitch);
    expect(t).not.toBeNull();
    expect(t!.angle).toBeLessThan(1.2 * DEG);
  });
});

describe('the crosshair on an enemy', () => {
  it('is true on an enemy and false beside one', () => {
    const { m, me } = scene();
    expect(crosshairOnEnemy(m, me, 0, 0)).toBe(true);
    expect(crosshairOnEnemy(m, me, 0.2, 0)).toBe(false);
    expect(crosshairOnEnemy(m, me, 0, 0.4)).toBe(false);
  });

  it('is false with a wall between, and for a teammate', () => {
    const { m, me, foe } = scene();
    setBox(m.arena, 24, 27, 1, 1, 3);
    expect(crosshairOnEnemy(m, me, 0, 0)).toBe(false);
    setBox(m.arena, 24, 27, 1, 1, 0);
    foe.team = me.team;
    expect(crosshairOnEnemy(m, me, 0, 0)).toBe(false);
  });

  it('does not change the match', () => {
    const { m, me } = scene();
    const before = m.tick;
    crosshairOnEnemy(m, me, 0, 0);
    findAimTarget(m, me, 0, 0);
    expect(m.tick).toBe(before);
    stepMatch(m);
    expect(m.tick).toBe(before + 1);
  });
});
