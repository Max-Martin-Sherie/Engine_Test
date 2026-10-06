/**
 * Where the eye is and which way it looks: the player's own view with a little bob, a dip on landing, a lean when
 * strafing and the zoom of aiming down the sights; and, once dead, a view that follows the falling body and turns to
 * whoever did it. Pure (it makes numbers; the world draws them).
 */
import { ACTOR, DEG } from './sim/config';
import { wrapAngle } from './sim';
import type { Actor } from './sim';
import type { CameraPose } from './view';

export interface Rig {
  /** 0..1 how far the sights are up (eased). */
  aim: number;
  /** How much the walk shakes the view right now (0..1, eased). */
  bob: number;
  /** A drop of the eye after a hard landing (metres), healing quickly. */
  dip: number;
  /** The lean into a strafe (radians, eased). */
  roll: number;
  /** The dead view's heading. */
  yaw: number;
  pitch: number;
  /** Seconds spent in the dead view. */
  dead: number;
}

export const createRig = (): Rig => ({ aim: 0, bob: 0, dip: 0, roll: 0, yaw: 0, pitch: 0, dead: 0 });

/** A vertical field of view zoomed in by `zoom` (2 shows half as much). */
export const zoomedFov = (fov: number, zoom: number): number => (2 * Math.atan(Math.tan((fov * DEG) / 2) / Math.max(1, zoom))) / DEG;

const ease = (value: number, target: number, rate: number, dt: number): number => value + (target - value) * (1 - Math.exp(-rate * dt));

/** A hard landing dips the eye. */
export function landed(rig: Rig, speed: number): void {
  rig.dip = Math.min(0.2, Math.max(rig.dip, (speed - 3) * 0.018));
}

/** The view from a living player's eyes. `alpha` is how far into the next tick we are. */
export function firstPerson(rig: Rig, a: Actor, alpha: number, dt: number, fov: number, zoom: number, strafe: number): CameraPose {
  const x = a.px + (a.x - a.px) * alpha;
  const y = a.py + (a.y - a.py) * alpha;
  const z = a.pz + (a.z - a.pz) * alpha;
  const speed = Math.hypot(a.vx, a.vz);
  rig.aim = ease(rig.aim, a.aiming ? 1 : 0, 14, dt);
  rig.bob = ease(rig.bob, a.onGround ? Math.min(1, speed / 5) : 0, 8, dt);
  rig.dip = Math.max(0, rig.dip - dt * 0.7);
  rig.roll = ease(rig.roll, -strafe * 0.018, 7, dt);
  rig.dead = 0;
  const bob = Math.sin(a.stride * 4.4) * 0.028 * rig.bob * (1 - rig.aim * 0.6);
  const sway = Math.cos(a.stride * 2.2) * 0.012 * rig.bob;
  const lateral = Math.cos(a.yaw) * sway;
  const along = -Math.sin(a.yaw) * sway;
  rig.yaw = a.yaw;
  rig.pitch = a.pitch;
  return {
    x: x + lateral,
    y: y + ACTOR.eye + bob - rig.dip,
    z: z + along,
    yaw: a.yaw,
    pitch: a.pitch,
    roll: rig.roll,
    fov: zoomedFov(fov, 1 + (zoom - 1) * rig.aim),
  };
}

/**
 * The view from a body that has fallen: at its head, turning to look at what killed it (or staying where it was looking).
 * `target` is where to look, if there is anything.
 */
export function deadView(rig: Rig, head: { x: number; y: number; z: number }, target: { x: number; y: number; z: number } | null, dt: number, fov: number): CameraPose {
  rig.dead += dt;
  rig.aim = ease(rig.aim, 0, 10, dt);
  rig.roll = ease(rig.roll, 0.22, 2, dt);
  if (target !== null) {
    const dx = target.x - head.x;
    const dz = target.z - head.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(target.y - head.y, Math.hypot(dx, dz));
    const turn = 1 - Math.exp(-3.5 * dt);
    rig.yaw += wrapAngle(wantYaw - rig.yaw) * turn;
    rig.pitch += (wantPitch - rig.pitch) * turn;
  }
  return { x: head.x, y: head.y + 0.06, z: head.z, yaw: rig.yaw, pitch: Math.max(-1.2, Math.min(1.2, rig.pitch)), roll: rig.roll, fov };
}
