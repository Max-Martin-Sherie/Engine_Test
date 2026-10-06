import { describe, expect, it } from 'vitest';
import { createPose, poseAlive, J, JOINTS, LINKS, UPPER_ARM, LOWER_ARM } from '../src/game/view/skeleton';
import { Ragdoll } from '../src/game/view/ragdoll';
import { emptyArena, setBox } from '../src/game/sim/testing';

const standing = (x = 24, z = 24, y = 0, yaw = 0): Float32Array => {
  const pose = createPose();
  poseAlive({ x, y, z, yaw, pitch: 0, vx: 0, vz: 0, stride: 0, onGround: true, gunLength: 0.6 }, pose);
  return pose.joints;
};

const dist = (j: Float32Array, a: number, b: number): number => Math.hypot(j[a * 3]! - j[b * 3]!, j[a * 3 + 1]! - j[b * 3 + 1]!, j[a * 3 + 2]! - j[b * 3 + 2]!);

const settle = (r: Ragdoll, arena = emptyArena(), seconds = 6): void => {
  for (let i = 0; i < seconds * 60 && !r.asleep; i++) r.step(arena);
};

describe('the skeleton', () => {
  it('stands the right way up with the head highest and the feet on the floor', () => {
    const j = standing();
    expect(j[J.head * 3 + 1]).toBeGreaterThan(1.55);
    expect(j[J.head * 3 + 1]).toBeLessThan(1.85);
    expect(j[J.anL * 3 + 1]).toBeLessThan(0.15);
    expect(j[J.anR * 3 + 1]).toBeLessThan(0.15);
    for (let i = 0; i < JOINTS; i++) expect(Number.isFinite(j[i * 3]! + j[i * 3 + 1]! + j[i * 3 + 2]!)).toBe(true);
  });

  it('keeps the right hand on the right: yaw 0 faces -z, so the right shoulder is at +x', () => {
    const j = standing();
    expect(j[J.shR * 3]!).toBeGreaterThan(j[J.shL * 3]!);
    // Turned a quarter to the left (positive yaw), it faces -x and its right is toward -z.
    const k = standing(24, 24, 0, Math.PI / 2);
    expect(k[J.shR * 3 + 2]!).toBeLessThan(k[J.shL * 3 + 2]!);
  });

  it('never stretches an arm past what it can reach while holding the gun', () => {
    const pose = createPose();
    for (const pitch of [-1.2, 0, 1.2]) {
      poseAlive({ x: 5, y: 0, z: 5, yaw: 0.7, pitch, vx: 3, vz: 3, stride: 3.1, onGround: true, gunLength: 0.9 }, pose);
      const j = pose.joints;
      expect(dist(j, J.shR, J.elR)).toBeCloseTo(UPPER_ARM, 2);
      expect(dist(j, J.elR, J.haR)).toBeCloseTo(LOWER_ARM, 2);
      expect(dist(j, J.shL, J.elL)).toBeCloseTo(UPPER_ARM, 2);
    }
  });

  it('swings the legs in opposite directions while running', () => {
    const pose = createPose();
    poseAlive({ x: 5, y: 0, z: 5, yaw: 0, pitch: 0, vx: 0, vz: -5, stride: 0.7, onGround: true, gunLength: 0.6 }, pose);
    const j = pose.joints;
    const left = j[J.anL * 3 + 2]! - j[J.hipL * 3 + 2]!;
    const right = j[J.anR * 3 + 2]! - j[J.hipR * 3 + 2]!;
    expect(Math.sign(left)).not.toBe(Math.sign(right));
  });
});

describe('the ragdoll', () => {
  it('falls to the floor and comes to rest', () => {
    const r = new Ragdoll(standing(), 0, 0, 0);
    settle(r);
    expect(r.asleep).toBe(true);
    for (let i = 0; i < JOINTS; i++) {
      expect(r.pos[i * 3 + 1]!).toBeGreaterThan(0.03);
      expect(r.pos[i * 3 + 1]!).toBeLessThan(0.6);
    }
  });

  it('keeps its bones their length, however it tumbles', () => {
    const r = new Ragdoll(standing(), 3, 2, -4);
    r.push(24, 1.5, 24, 1, 0.2, 0, 10, 1);
    const arena = emptyArena();
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      r.step(arena);
      for (const link of LINKS) {
        if (link.min !== link.max) continue;
        worst = Math.max(worst, Math.abs(dist(r.pos, link.a, link.b) - link.min));
      }
    }
    expect(worst).toBeLessThan(0.06);
  });

  it('is thrown the way it was shot', () => {
    const r = new Ragdoll(standing(), 0, 0, 0);
    r.push(24, 1.2, 24, 1, 0, 0, 8, 1);
    settle(r);
    expect(r.centre().x).toBeGreaterThan(25);
    const s = new Ragdoll(standing(), 0, 0, 0);
    s.push(24, 1.2, 24, 0, 0, -1, 8, 1);
    settle(s);
    expect(s.centre().z).toBeLessThan(23);
  });

  it('is blown away from an explosion, and more by a close one', () => {
    const near = new Ragdoll(standing(), 0, 0, 0);
    const far = new Ragdoll(standing(), 0, 0, 0);
    near.blast(22.5, 0.5, 24, 15, 5);
    far.blast(20.5, 0.5, 24, 15, 5);
    settle(near);
    settle(far);
    expect(near.centre().x).toBeGreaterThan(far.centre().x);
    expect(far.centre().x).toBeGreaterThan(24);
  });

  it('is stopped by a wall and does not end up inside it', () => {
    const arena = emptyArena();
    setBox(arena, 26, 20, 1, 9, 3);
    const r = new Ragdoll(standing(24.5, 24.5), 6, 1, 0);
    settle(r, arena);
    for (let i = 0; i < JOINTS; i++) expect(r.pos[i * 3]!).toBeLessThan(26.01);
  });

  it('lands on top of a crate it was thrown onto', () => {
    const arena = emptyArena();
    setBox(arena, 20, 20, 8, 8, 1);
    const r = new Ragdoll(standing(24, 24, 1), 0, 0, 0);
    settle(r, arena);
    expect(r.asleep).toBe(true);
    for (let i = 0; i < JOINTS; i++) expect(r.pos[i * 3 + 1]!).toBeGreaterThan(1.02);
  });

  it('stays inside the arena when thrown at the outer wall', () => {
    const r = new Ragdoll(standing(3, 24), -20, 3, 0);
    settle(r);
    for (let i = 0; i < JOINTS; i++) expect(r.pos[i * 3]!).toBeGreaterThan(0.9);
  });

  it('is deterministic for the same start', () => {
    const run = (): number[] => {
      const r = new Ragdoll(standing(), 1, 1, 1);
      r.push(24, 1.2, 24, 1, 0.2, 0.3, 6, 0.8);
      const arena = emptyArena();
      for (let i = 0; i < 120; i++) r.step(arena);
      return Array.from(r.pos);
    };
    expect(run()).toEqual(run());
  });
});

describe('a body that is shot standing still', () => {
  const lieDown = (power: number, head: boolean): Ragdoll => {
    const joints = standing();
    const r = new Ragdoll(joints, 0, 0, 0);
    r.limp(0, -1);
    const at = head ? J.head : J.spine;
    r.push(r.pos[at * 3]!, r.pos[at * 3 + 1]!, r.pos[at * 3 + 2]!, 0, 0.2, 1, power, 0.8);
    settle(r, emptyArena(), 5);
    return r;
  };

  it('does not stay upright, even when the shot is a weak one', () => {
    for (const [power, head] of [[2.4, false], [2.8, true], [1, false], [0, false]] as const) {
      const r = lieDown(power, head);
      expect(r.pos[J.head * 3 + 1]!, `power ${power}`).toBeLessThan(0.6);
      expect(r.pos[J.pelvis * 3 + 1]!, `power ${power}`).toBeLessThan(0.4);
    }
  });

  it('does not go to sleep while it is still standing up', () => {
    const r = new Ragdoll(standing(), 0, 0, 0);
    // No limp, no push: a perfectly balanced pose. It may stay up, but it must not be put to sleep in the air.
    for (let i = 0; i < 90; i++) r.step(emptyArena());
    if (r.pos[J.head * 3 + 1]! > 1.2) expect(r.asleep).toBe(false);
  });
});
