/**
 * The fighters: people made of a few instanced shapes (limbs, joints, armour, a helmet, a gun), drawn from sixteen joint
 * positions. While someone lives the joints come from `skeleton` (a walk cycle, arms holding the gun where the head looks);
 * when someone dies the same joints are handed to a `Ragdoll`, so the body carries on falling from the pose and speed it
 * had, thrown by the shot that killed it. Facing is the simulation's yaw, in the Three.js camera's convention.
 */
import * as THREE from 'three';
import { WEAPON_IDS, type WeaponId } from '../sim/config';
import type { Actor, Match } from '../sim';
import { actorColor } from './palette';
import { Ragdoll } from './ragdoll';
import { J, JOINTS, createPose, poseAlive, type Pose } from './skeleton';

const SUIT = 0x2b3345;
const ARMOR = 0x76829c;
const DARK = 0x1a202e;
const GLOVE = 0x3a4256;

/** The length and thickness of each gun in the hands, and its colour. */
export const GUN_LENGTH: Record<WeaponId, number> = { pistol: 0.3, rifle: 0.62, shotgun: 0.7, rail: 0.95, rocket: 0.85 };
const GUN_THICK: Record<WeaponId, number> = { pistol: 0.07, rifle: 0.1, shotgun: 0.1, rail: 0.11, rocket: 0.2 };
const GUN_TONE: Record<WeaponId, number> = { pistol: 0x4a5670, rifle: 0x3a4560, shotgun: 0x7a5e44, rail: 0x5a46a0, rocket: 0x5e7048 };

/** How hard a killing shot throws the body (metres a second at the point it struck). */
const SHOT_POWER: Record<WeaponId, number> = { pistol: 2.4, rifle: 2.8, shotgun: 7, rail: 10, rocket: 5 };
const BLAST_POWER = 15;
const BLAST_RADIUS = 5;

/** A killing shot, as the view remembers it: which way it came from and what kind it was. */
export interface Impulse {
  weapon: WeaponId;
  /** The way the shot travelled, as an angle on the floor: (sin, cos) is the direction in (x, z). */
  fromYaw: number;
  damage: number;
  head: boolean;
}

export interface Characters {
  group: THREE.Group;
  /** Poses everyone and steps the ragdolls. `hurt` is how long (seconds) each body should still flash from a recent hit. */
  update(match: Match, viewer: number, alpha: number, dt: number, hurt: ReadonlyMap<number, number>): void;
  /** Remembers the shot that has just killed `victim`, to throw the body when it falls. */
  noteHit(victim: number, hit: Impulse): void;
  /** Turns an actor that has just died into a ragdoll. */
  kill(match: Match, id: number): void;
  /** An explosion: bodies already down and bodies about to fall are thrown from it. */
  blast(x: number, y: number, z: number): void;
  /** Where a ragdoll's head is, or null if that actor is not down. */
  head(id: number): { x: number; y: number; z: number } | null;
  /** Forgets every body (a new match). */
  reset(): void;
  dispose(): void;
}

interface Body {
  pose: Pose;
  ragdoll: Ragdoll | null;
  clock: number;
  weapon: WeaponId;
  note: Impulse | null;
}

const CAPACITY = 16;
/** How many of each shape one body needs. */
const PER = { limbs: 9, balls: 9, boxes: 7, glows: 2 };
/** A ragdoll is seen for this long, shrinking away over the last part of it. */
const CORPSE_LIFE = 2.7;
const CORPSE_FADE = 0.8;
const STEP = 1 / 60;

export function createCharacters(litMaterial: THREE.Material, glowMaterial: THREE.Material): Characters {
  const group = new THREE.Group();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const sphere = new THREE.SphereGeometry(1, 12, 9);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const make = (geometry: THREE.BufferGeometry, material: THREE.Material, per: number): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY * per);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  };
  const limbs = make(cylinder, litMaterial, PER.limbs);
  const balls = make(sphere, litMaterial, PER.balls);
  const boxes = make(box, litMaterial, PER.boxes);
  const glows = make(box, glowMaterial, PER.glows);
  const shadow = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
    CAPACITY,
  );
  shadow.frustumCulled = false;
  shadow.count = 0;
  shadow.renderOrder = 1;
  group.add(shadow);
  const meshes = [limbs, balls, boxes, glows, shadow];

  const bodies = new Map<number, Body>();
  let frame = 0;
  const blasts: { x: number; y: number; z: number; frame: number }[] = [];

  // Scratch values, so drawing allocates nothing.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const dir = new THREE.Vector3();
  const P: THREE.Vector3[] = [];
  for (let i = 0; i < JOINTS; i++) P.push(new THREE.Vector3());
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const O = new THREE.Vector3();
  const drawn = new Float32Array(JOINTS * 3);
  const counts = { limbs: 0, balls: 0, boxes: 0, glows: 0, shadow: 0 };
  let flash = 0;
  let flicker = 1;

  const paint = (mesh: THREE.InstancedMesh, i: number, hex: number, bright = 1): void => {
    color.setHex(hex).multiplyScalar(flicker * bright);
    if (flash > 0) color.lerp(white, flash * 0.8);
    mesh.setColorAt(i, color);
  };

  /** A cylinder from a to b. */
  const limb = (a: THREE.Vector3, b: THREE.Vector3, radius: number, hex: number): void => {
    dir.subVectors(b, a);
    const length = dir.length();
    if (length < 1e-5) return;
    q.setFromUnitVectors(up, dir.divideScalar(length));
    m.compose(pos.addVectors(a, b).multiplyScalar(0.5), q, scale.set(radius, length, radius));
    limbs.setMatrixAt(counts.limbs, m);
    paint(limbs, counts.limbs, hex);
    counts.limbs += 1;
  };

  const ball = (at: THREE.Vector3, radius: number, hex: number, squash = 1): void => {
    m.compose(at, q.identity(), scale.set(radius, radius * squash, radius));
    balls.setMatrixAt(counts.balls, m);
    paint(balls, counts.balls, hex);
    counts.balls += 1;
  };

  /** Sets the frame X (right), Y (up), Z (back) from two directions. */
  const frameOf = (rx: number, ry: number, rz: number, ux: number, uy: number, uz: number): void => {
    X.set(rx, ry, rz).normalize();
    Y.set(ux, uy, uz);
    Y.addScaledVector(X, -Y.dot(X)).normalize();
    Z.crossVectors(X, Y);
  };

  /** A box in the current frame: its centre is `c` moved (ox, oy, oz) along the frame's axes. */
  const part = (mesh: THREE.InstancedMesh, which: 'boxes' | 'glows', c: THREE.Vector3, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, hex: number, bright = 1): void => {
    O.copy(c).addScaledVector(X, ox).addScaledVector(Y, oy).addScaledVector(Z, oz);
    m.makeBasis(X, Y, Z);
    m.scale(scale.set(sx, sy, sz));
    m.setPosition(O);
    mesh.setMatrixAt(counts[which], m);
    paint(mesh, counts[which], hex, bright);
    counts[which] += 1;
  };

  const mid = new THREE.Vector3();

  /** Draws one person from sixteen joints, `k` times its size (below 1 as a body shrinks away). */
  function drawBody(joints: Float32Array, k: number, team: number, weapon: WeaponId, gun: { x: number; y: number; z: number; dx: number; dy: number; dz: number }): void {
    let cx = 0;
    let cz = 0;
    let floorY = 1e9;
    for (let i = 0; i < JOINTS; i++) {
      cx += joints[i * 3]!;
      cz += joints[i * 3 + 2]!;
      floorY = Math.min(floorY, joints[i * 3 + 1]!);
    }
    cx /= JOINTS;
    cz /= JOINTS;
    for (let i = 0; i < JOINTS; i++) {
      // Shrinking is toward the point on the floor below the body.
      drawn[i * 3] = cx + (joints[i * 3]! - cx) * k;
      drawn[i * 3 + 1] = floorY + (joints[i * 3 + 1]! - floorY) * k;
      drawn[i * 3 + 2] = cz + (joints[i * 3 + 2]! - cz) * k;
      P[i]!.set(drawn[i * 3]!, drawn[i * 3 + 1]!, drawn[i * 3 + 2]!);
    }
    const pelvis = P[J.pelvis]!;
    const spine = P[J.spine]!;
    const neck = P[J.neck]!;
    const head = P[J.head]!;

    // Arms and legs.
    limb(P[J.shL]!, P[J.elL]!, 0.055 * k, team);
    limb(P[J.shR]!, P[J.elR]!, 0.055 * k, team);
    limb(P[J.elL]!, P[J.haL]!, 0.048 * k, GLOVE);
    limb(P[J.elR]!, P[J.haR]!, 0.048 * k, GLOVE);
    limb(P[J.hipL]!, P[J.knL]!, 0.082 * k, SUIT);
    limb(P[J.hipR]!, P[J.knR]!, 0.082 * k, SUIT);
    limb(P[J.knL]!, P[J.anL]!, 0.066 * k, ARMOR);
    limb(P[J.knR]!, P[J.anR]!, 0.066 * k, ARMOR);
    limb(neck, head, 0.05 * k, SUIT);

    // Joints: pauldrons, elbows, knees, hands, and the helmet.
    ball(P[J.shL]!, 0.095 * k, team);
    ball(P[J.shR]!, 0.095 * k, team);
    ball(P[J.elL]!, 0.058 * k, ARMOR);
    ball(P[J.elR]!, 0.058 * k, ARMOR);
    ball(P[J.knL]!, 0.08 * k, ARMOR);
    ball(P[J.knR]!, 0.08 * k, ARMOR);
    ball(P[J.haL]!, 0.055 * k, GLOVE);
    ball(P[J.haR]!, 0.055 * k, GLOVE);
    ball(head, 0.135 * k, ARMOR, 1.06);

    // Pelvis.
    frameOf(joints[J.hipR * 3]! - joints[J.hipL * 3]!, joints[J.hipR * 3 + 1]! - joints[J.hipL * 3 + 1]!, joints[J.hipR * 3 + 2]! - joints[J.hipL * 3 + 2]!, spine.x - pelvis.x, spine.y - pelvis.y, spine.z - pelvis.z);
    part(boxes, 'boxes', pelvis, 0, 0.02 * k, 0, 0.35 * k, 0.17 * k, 0.21 * k, DARK);
    // Trunk, armour, pack.
    frameOf(joints[J.shR * 3]! - joints[J.shL * 3]!, joints[J.shR * 3 + 1]! - joints[J.shL * 3 + 1]!, joints[J.shR * 3 + 2]! - joints[J.shL * 3 + 2]!, neck.x - pelvis.x, neck.y - pelvis.y, neck.z - pelvis.z);
    mid.lerpVectors(pelvis, neck, 0.52);
    part(boxes, 'boxes', mid, 0, 0, 0, 0.36 * k, 0.5 * k, 0.2 * k, SUIT);
    mid.lerpVectors(pelvis, neck, 0.7);
    part(boxes, 'boxes', mid, 0, 0, -0.012 * k, 0.4 * k, 0.26 * k, 0.235 * k, team);
    mid.lerpVectors(pelvis, neck, 0.6);
    part(boxes, 'boxes', mid, 0, 0, 0.16 * k, 0.24 * k, 0.32 * k, 0.1 * k, DARK);
    mid.lerpVectors(pelvis, neck, 0.72);
    part(glows, 'glows', mid, 0, 0.02 * k, -0.135 * k, 0.12 * k, 0.03 * k, 0.012 * k, 0xffffff, 1);
    const fx = -Z.x;
    const fy = -Z.y;
    const fz = -Z.z;

    // The head: a glowing visor on the front of the helmet.
    frameOf(joints[J.shR * 3]! - joints[J.shL * 3]!, joints[J.shR * 3 + 1]! - joints[J.shL * 3 + 1]!, joints[J.shR * 3 + 2]! - joints[J.shL * 3 + 2]!, head.x - neck.x, head.y - neck.y, head.z - neck.z);
    part(glows, 'glows', head, 0, 0.012 * k, -0.115 * k, 0.17 * k, 0.055 * k, 0.05 * k, team, 1);

    // Feet, pointing the way the body faces.
    for (const [knee, ankle] of [
      [J.knL, J.anL],
      [J.knR, J.anR],
    ] as const) {
      const a = P[ankle]!;
      const kn = P[knee]!;
      Y.subVectors(kn, a);
      X.set(fy * Y.z - fz * Y.y, fz * Y.x - fx * Y.z, fx * Y.y - fy * Y.x);
      if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
      frameOf(X.x, X.y, X.z, Y.x, Y.y, Y.z);
      part(boxes, 'boxes', a, 0, -0.025 * k, -0.065 * k, 0.13 * k, 0.1 * k, 0.29 * k, DARK);
    }

    // The gun.
    const length = GUN_LENGTH[weapon];
    const thick = GUN_THICK[weapon];
    dir.set(gun.dx, gun.dy, gun.dz).normalize();
    q.setFromUnitVectors(forward, dir);
    pos.set(cx + (gun.x - cx) * k, floorY + (gun.y - floorY) * k, cz + (gun.z - cz) * k);
    m.compose(pos, q, scale.set(thick * k, thick * 1.2 * k, length * k));
    boxes.setMatrixAt(counts.boxes, m);
    paint(boxes, counts.boxes, GUN_TONE[weapon]);
    counts.boxes += 1;
  }

  const poseOf = (a: Actor, x: number, y: number, z: number, body: Body): void => {
    const id = WEAPON_IDS[a.current] ?? 'rifle';
    body.weapon = id;
    poseAlive({ x, y, z, yaw: a.yaw, pitch: a.pitch, vx: a.vx, vz: a.vz, stride: a.stride, onGround: a.onGround, gunLength: GUN_LENGTH[id] }, body.pose);
  };

  const bodyOf = (id: number): Body => {
    let body = bodies.get(id);
    if (body === undefined) {
      body = { pose: createPose(), ragdoll: null, clock: 0, weapon: 'rifle', note: null };
      bodies.set(id, body);
    }
    return body;
  };

  const fall = (a: Actor, body: Body): void => {
    poseOf(a, a.x, a.y, a.z, body);
    const r = new Ragdoll(body.pose.joints, a.vx, Math.max(a.vy, -4), a.vz);
    body.ragdoll = r;
    body.clock = 0;
    const note = body.note;
    body.note = null;
    // Slack from the first moment, in the direction the shot came (or the way the body faced).
    if (note !== null) r.limp(Math.sin(note.fromYaw), Math.cos(note.fromYaw));
    else r.limp(-Math.sin(a.yaw), -Math.cos(a.yaw));
    if (note !== null) {
      const dx = Math.sin(note.fromYaw);
      const dz = Math.cos(note.fromYaw);
      const power = SHOT_POWER[note.weapon] * (note.head ? 1.25 : 1);
      const at = note.head ? J.head : J.spine;
      r.push(r.pos[at * 3]!, r.pos[at * 3 + 1]!, r.pos[at * 3 + 2]!, dx, 0.2, dz, power, 0.8);
      // A second shove at an ankle, so the body spins as it goes.
      const foot = Math.random() < 0.5 ? J.anL : J.anR;
      r.push(r.pos[foot * 3]!, r.pos[foot * 3 + 1]!, r.pos[foot * 3 + 2]!, dz, 0.1, -dx, power * 0.35, 0.5);
    }
    for (const b of blasts) if (b.frame === frame) r.blast(b.x, b.y, b.z, BLAST_POWER, BLAST_RADIUS);
  };

  return {
    group,

    update(match, viewer, alpha, dt, hurt) {
      counts.limbs = counts.boxes = counts.balls = counts.glows = counts.shadow = 0;
      const teamMode = match.mode === 'tdm';
      for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i]!.frame <= frame) blasts.splice(i, 1);
      frame += 1;
      let n = 0;
      for (const a of match.actors) {
        const body = bodyOf(a.id);
        if (a.alive) {
          body.ragdoll = null;
          body.note = null;
        } else if (body.ragdoll === null) fall(a, body);

        const team = actorColor(a.id, a.team, teamMode);
        flash = Math.min(1, (hurt.get(a.id) ?? 0) / 0.12);
        if (n >= CAPACITY) break;

        const r = body.ragdoll;
        if (r !== null) {
          // Fixed steps, however fast frames come.
          body.clock = Math.min(body.clock + dt, STEP * 5);
          while (body.clock >= STEP) {
            r.step(match.arena);
            body.clock -= STEP;
          }
          const age = r.age;
          if (a.id !== viewer && age > CORPSE_LIFE) continue;
          const k = a.id === viewer ? 1 : Math.max(0.001, Math.min(1, (CORPSE_LIFE - age) / CORPSE_FADE));
          flicker = 1;
          // The gun stays in the hands: pointing along the forearm, or from one hand to the other.
          const rx = r.pos[J.haR * 3]!;
          const ry = r.pos[J.haR * 3 + 1]!;
          const rz = r.pos[J.haR * 3 + 2]!;
          let gx = r.pos[J.haL * 3]! - rx;
          let gy = r.pos[J.haL * 3 + 1]! - ry;
          let gz = r.pos[J.haL * 3 + 2]! - rz;
          if (gx * gx + gy * gy + gz * gz < 0.0064) {
            gx = rx - r.pos[J.elR * 3]!;
            gy = ry - r.pos[J.elR * 3 + 1]!;
            gz = rz - r.pos[J.elR * 3 + 2]!;
          }
          const gl = Math.hypot(gx, gy, gz) || 1;
          gx /= gl;
          gy /= gl;
          gz /= gl;
          const half = GUN_LENGTH[body.weapon] / 2 - 0.1;
          drawBody(r.pos, k, team, body.weapon, { x: rx + gx * half, y: ry + gy * half, z: rz + gz * half, dx: gx, dy: gy, dz: gz });
          let low = 1e9;
          for (let j = 0; j < JOINTS; j++) low = Math.min(low, r.pos[j * 3 + 1]!);
          const c = r.centre();
          m.compose(pos.set(c.x, Math.max(0, low - 0.06) + 0.03, c.z), q.identity(), scale.set(1.15 * k, 1, 1.15 * k));
          shadow.setMatrixAt(counts.shadow++, m);
          n += 1;
          continue;
        }
        if (a.id === viewer) continue;

        const x = a.px + (a.x - a.px) * alpha;
        const y = a.py + (a.y - a.py) * alpha;
        const z = a.pz + (a.z - a.pz) * alpha;
        poseOf(a, x, y, z, body);
        // A flicker while spawn protection lasts.
        flicker = a.protect > 0 && Math.floor(match.tick / 5) % 2 === 0 ? 0.55 : 1;
        drawBody(body.pose.joints, 1, team, body.weapon, body.pose.gun);
        m.compose(pos.set(x, y + 0.03, z), q.identity(), scale.set(0.95, 1, 0.95));
        shadow.setMatrixAt(counts.shadow++, m);
        n += 1;
      }
      limbs.count = counts.limbs;
      balls.count = counts.balls;
      boxes.count = counts.boxes;
      glows.count = counts.glows;
      shadow.count = counts.shadow;
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },

    noteHit(victim, hit) {
      bodyOf(victim).note = hit;
    },

    kill(match, id) {
      const a = match.actors[id];
      if (a === undefined) return;
      const body = bodyOf(id);
      if (body.ragdoll === null) fall(a, body);
    },

    blast(x, y, z) {
      blasts.push({ x, y, z, frame });
      for (const body of bodies.values()) body.ragdoll?.blast(x, y, z, BLAST_POWER, BLAST_RADIUS);
    },

    head(id) {
      const r = bodies.get(id)?.ragdoll;
      if (r === null || r === undefined) return null;
      return { x: r.pos[J.head * 3]!, y: r.pos[J.head * 3 + 1]!, z: r.pos[J.head * 3 + 2]! };
    },

    reset() {
      bodies.clear();
      blasts.length = 0;
    },

    dispose() {
      cylinder.dispose();
      sphere.dispose();
      box.dispose();
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

/** Where an actor's muzzle is, for effects: along the way it is looking from the chest, as far as its gun reaches. */
export function muzzlePoint(a: Actor): { x: number; y: number; z: number } {
  const id = WEAPON_IDS[a.current] ?? 'rifle';
  const c = Math.cos(a.pitch);
  const len = 0.3 + GUN_LENGTH[id];
  return {
    x: a.x + -Math.sin(a.yaw) * c * len + Math.cos(a.yaw) * 0.1,
    y: a.y + 1.28 + Math.sin(a.pitch) * len,
    z: a.z + -Math.cos(a.yaw) * c * len - Math.sin(a.yaw) * 0.1,
  };
}
