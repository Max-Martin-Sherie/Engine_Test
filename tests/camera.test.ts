import { describe, expect, it } from 'vitest';
import { createRig, deadView, firstPerson, landed, zoomedFov } from '../src/game/camera';
import { ACTOR } from '../src/game/sim/config';
import { createMatch } from '../src/game/sim';

const someone = () => {
  const m = createMatch({ seed: 2, mode: 'ffa', bots: 1, human: true });
  const a = m.actors[0]!;
  a.x = a.px = 10;
  a.z = a.pz = 10;
  a.y = a.py = 0;
  a.yaw = 0.5;
  a.pitch = 0.1;
  a.vx = a.vz = 0;
  return a;
};

describe('the player view', () => {
  it('sits at eye height, looking where the player looks', () => {
    const a = someone();
    const p = firstPerson(createRig(), a, 1, 1 / 60, 78, 1, 0);
    expect(p.x).toBeCloseTo(10, 2);
    expect(p.y).toBeCloseTo(ACTOR.eye, 2);
    expect(p.yaw).toBe(0.5);
    expect(p.pitch).toBe(0.1);
    expect(p.fov).toBeCloseTo(78, 4);
  });

  it('is smooth between ticks', () => {
    const a = someone();
    a.px = 9;
    const p = firstPerson(createRig(), a, 0.5, 1 / 60, 78, 1, 0);
    expect(p.x).toBeCloseTo(9.5, 2);
  });

  it('zooms in when aiming, by the weapon zoom, and eases there', () => {
    const a = someone();
    a.aiming = true;
    const rig = createRig();
    const first = firstPerson(rig, a, 1, 1 / 60, 80, 3, 0);
    expect(first.fov).toBeLessThan(80);
    expect(first.fov).toBeGreaterThan(zoomedFov(80, 3));
    let p = first;
    for (let i = 0; i < 120; i++) p = firstPerson(rig, a, 1, 1 / 60, 80, 3, 0);
    expect(p.fov).toBeCloseTo(zoomedFov(80, 3), 1);
    a.aiming = false;
    for (let i = 0; i < 120; i++) p = firstPerson(rig, a, 1, 1 / 60, 80, 3, 0);
    expect(p.fov).toBeCloseTo(80, 1);
  });

  it('zooms by the stated factor: a zoom of 2 halves the tangent of the view', () => {
    expect(Math.tan((zoomedFov(80, 2) * Math.PI) / 360)).toBeCloseTo(Math.tan((80 * Math.PI) / 360) / 2, 6);
    expect(zoomedFov(80, 1)).toBeCloseTo(80, 6);
    expect(zoomedFov(80, 0.5)).toBeCloseTo(80, 6);
  });

  it('bobs while running and not while standing', () => {
    const a = someone();
    const rig = createRig();
    const heights: number[] = [];
    a.vx = 5;
    for (let i = 0; i < 90; i++) {
      a.stride += 0.07;
      heights.push(firstPerson(rig, a, 1, 1 / 60, 78, 1, 0).y);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.02);
    const still = someone();
    const still2 = createRig();
    const ys: number[] = [];
    for (let i = 0; i < 90; i++) {
      still.stride += 0.07;
      ys.push(firstPerson(still2, still, 1, 1 / 60, 78, 1, 0).y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9);
  });

  it('dips on a hard landing and recovers; a soft one does nothing', () => {
    const a = someone();
    const rig = createRig();
    landed(rig, 2);
    expect(rig.dip).toBe(0);
    landed(rig, 12);
    expect(rig.dip).toBeGreaterThan(0.1);
    const low = firstPerson(rig, a, 1, 1 / 60, 78, 1, 0).y;
    expect(low).toBeLessThan(ACTOR.eye - 0.1);
    for (let i = 0; i < 60; i++) firstPerson(rig, a, 1, 1 / 60, 78, 1, 0);
    expect(firstPerson(rig, a, 1, 1 / 60, 78, 1, 0).y).toBeCloseTo(ACTOR.eye, 2);
  });

  it('leans into a strafe', () => {
    const a = someone();
    const rig = createRig();
    let p = firstPerson(rig, a, 1, 1 / 60, 78, 1, 1);
    for (let i = 0; i < 60; i++) p = firstPerson(rig, a, 1, 1 / 60, 78, 1, 1);
    expect(p.roll).toBeLessThan(-0.01);
  });
});

describe('the view after dying', () => {
  it('sits at the head and turns to face the killer', () => {
    const rig = createRig();
    rig.yaw = 0;
    rig.pitch = 0;
    let p = deadView(rig, { x: 10, y: 0.3, z: 10 }, { x: 10, y: 1, z: 0 }, 1 / 60, 78);
    for (let i = 0; i < 180; i++) p = deadView(rig, { x: 10, y: 0.3, z: 10 }, { x: 10, y: 1, z: 0 }, 1 / 60, 78);
    // The killer is straight ahead (-z): yaw 0.
    expect(Math.abs(p.yaw)).toBeLessThan(0.01);
    expect(p.pitch).toBeGreaterThan(0);
    const q = createRig();
    let r = deadView(q, { x: 10, y: 0.3, z: 10 }, { x: 0, y: 0.3, z: 10 }, 1 / 60, 78);
    for (let i = 0; i < 240; i++) r = deadView(q, { x: 10, y: 0.3, z: 10 }, { x: 0, y: 0.3, z: 10 }, 1 / 60, 78);
    // The killer is at -x: yaw +pi/2 (turning left from facing -z).
    expect(r.yaw).toBeCloseTo(Math.PI / 2, 1);
    expect(r.x).toBe(10);
  });

  it('keeps looking where it was when there is nobody to look at', () => {
    const rig = createRig();
    rig.yaw = 1.2;
    rig.pitch = -0.2;
    const p = deadView(rig, { x: 1, y: 0.2, z: 1 }, null, 1 / 60, 78);
    expect(p.yaw).toBe(1.2);
    expect(p.pitch).toBe(-0.2);
  });

  it('turns the short way round', () => {
    const rig = createRig();
    rig.yaw = 3.0;
    // The target is just past +pi: the short way is further positive, not back through zero.
    let p = deadView(rig, { x: 0, y: 1, z: 0 }, { x: 0.1, y: 1, z: 5 }, 1 / 60, 78);
    const first = p.yaw;
    for (let i = 0; i < 5; i++) p = deadView(rig, { x: 0, y: 1, z: 0 }, { x: 0.1, y: 1, z: 5 }, 1 / 60, 78);
    expect(p.yaw).toBeGreaterThan(first - 1e-9);
  });
});
