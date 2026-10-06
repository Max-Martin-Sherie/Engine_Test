/**
 * The short-lived things: tracers and shells, sparks, rings on the ground. Three pools of instanced shapes, each a
 * single draw call however many are alive. Nothing here is the game's state; it only decorates events.
 */
import * as THREE from 'three';
import type { EntityType } from '../sim';
import { COLORS } from './palette';

const BEAMS = 192;
const SPARKS = 900;
const RINGS = 80;

interface Beam {
  alive: boolean;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  t: number;
  dur: number;
  len: number;
  width: number;
  color: number;
  /** Burst of sparks where it lands. */
  impact: number;
  blast: number;
}

interface Spark {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: number;
  gravity: number;
}

interface Ring {
  alive: boolean;
  x: number;
  z: number;
  r0: number;
  r1: number;
  t: number;
  dur: number;
  color: number;
}

const scratch = {
  matrix: new THREE.Matrix4(),
  pos: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  dir: new THREE.Vector3(),
  color: new THREE.Color(),
  xAxis: new THREE.Vector3(1, 0, 0),
  zero: new THREE.Matrix4().makeScale(0, 0, 0),
};

export interface Effects {
  readonly group: THREE.Group;
  /** A shot: `fy`/`ty` are map y (three's z). Heights are in cells above the ground. */
  shot(weapon: string, fx: number, fy: number, fromAir: boolean, tx: number, ty: number, toAir: boolean): void;
  death(type: EntityType, x: number, y: number, team: number, big: boolean): void;
  ping(x: number, y: number, kind: 'move' | 'attack' | 'rally' | 'alert'): void;
  deposit(x: number, y: number): void;
  built(x: number, y: number, size: number, team: number): void;
  update(dt: number): void;
}

export function createEffects(sparkMaterial: THREE.Material): Effects {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ringGeometry = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);

  const beamMesh = new THREE.InstancedMesh(box, sparkMaterial, BEAMS);
  const sparkMesh = new THREE.InstancedMesh(box, sparkMaterial, SPARKS);
  const ringMesh = new THREE.InstancedMesh(ringGeometry, sparkMaterial, RINGS);
  for (const mesh of [beamMesh, sparkMesh, ringMesh]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, scratch.color.setHex(0xffffff));
    group.add(mesh);
  }
  ringMesh.renderOrder = 2;
  beamMesh.renderOrder = 3;
  sparkMesh.renderOrder = 3;

  const beams: Beam[] = Array.from({ length: BEAMS }, () => ({ alive: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 0, dur: 1, len: 1, width: 0.1, color: 0, impact: 0, blast: 0 }));
  const sparks: Spark[] = Array.from({ length: SPARKS }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, color: 0, gravity: 0 }));
  const rings: Ring[] = Array.from({ length: RINGS }, () => ({ alive: false, x: 0, z: 0, r0: 0, r1: 1, t: 0, dur: 1, color: 0 }));
  let beamCursor = 0;
  let sparkCursor = 0;
  let ringCursor = 0;

  function addBeam(b: Omit<Beam, 'alive' | 't'>): void {
    const slot = beams[beamCursor]!;
    beamCursor = (beamCursor + 1) % BEAMS;
    Object.assign(slot, b, { alive: true, t: 0 });
  }

  function addSpark(x: number, y: number, z: number, speed: number, up: number, size: number, life: number, color: number, gravity = 9): void {
    const slot = sparks[sparkCursor]!;
    sparkCursor = (sparkCursor + 1) % SPARKS;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.35 + Math.random() * 0.65);
    slot.alive = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = Math.cos(a) * s;
    slot.vz = Math.sin(a) * s;
    slot.vy = up * (0.4 + Math.random() * 0.6);
    slot.life = life * (0.6 + Math.random() * 0.4);
    slot.max = slot.life;
    slot.size = size * (0.6 + Math.random() * 0.6);
    slot.color = color;
    slot.gravity = gravity;
  }

  function addRing(x: number, z: number, r0: number, r1: number, dur: number, color: number): void {
    const slot = rings[ringCursor]!;
    ringCursor = (ringCursor + 1) % RINGS;
    Object.assign(slot, { alive: true, x, z, r0, r1, t: 0, dur, color });
  }

  return {
    group,

    shot(weapon, fx, fy, fromAir, tx, ty, toAir) {
      const color = COLORS.tracer[weapon] ?? 0xffffff;
      const fh = fromAir ? 2.2 : weapon === 'tank' ? 0.85 : weapon === 'turret' ? 1.1 : 0.55;
      const th = toAir ? 2.2 : 0.5;
      const dx = tx - fx;
      const dz = ty - fy;
      const dist = Math.hypot(dx, dz) || 1;
      if (weapon === 'tank') {
        addBeam({ fx, fy: fh, fz: fy, tx, ty: th, tz: ty, dur: Math.min(0.32, 0.08 + dist * 0.03), len: 0.9, width: 0.22, color, impact: 10, blast: 1 });
        for (let i = 0; i < 6; i++) addSpark(fx + (dx / dist) * 0.8, fh, fy + (dz / dist) * 0.8, 3, 1.5, 0.12, 0.25, 0xffd18a, 3);
      } else if (weapon === 'skiff' || weapon === 'turret') {
        addBeam({ fx, fy: fh, fz: fy, tx, ty: th, tz: ty, dur: 0.07, len: Math.min(dist, 3.2), width: 0.07, color, impact: 3, blast: 0 });
      } else {
        addBeam({ fx, fy: fh, fz: fy, tx, ty: th, tz: ty, dur: Math.min(0.14, 0.04 + dist * 0.014), len: 0.6, width: 0.05, color, impact: weapon === 'worker' ? 2 : 3, blast: 0 });
      }
    },

    death(type, x, y, team, big) {
      const teamColor = COLORS.team[team === 1 ? 1 : 0];
      const isBuilding = big;
      const count = isBuilding ? 70 : type === 'tank' ? 34 : type === 'skiff' ? 28 : 14;
      const spread = isBuilding ? 5.5 : 3.2;
      const h = isBuilding ? 0.8 : type === 'skiff' ? 2.2 : 0.4;
      for (let i = 0; i < count; i++) {
        const hot = i % 3 === 0 ? 0xffd27a : i % 3 === 1 ? 0xff8a3a : teamColor;
        addSpark(x, h, y, spread, isBuilding ? 7 : 4.5, isBuilding ? 0.3 : 0.17, isBuilding ? 1.1 : 0.7, hot, 9);
      }
      addRing(x, y, 0.3, isBuilding ? 4.2 : type === 'tank' ? 2.4 : 1.4, isBuilding ? 0.7 : 0.45, 0xffa65a);
    },

    ping(x, y, kind) {
      const color = kind === 'attack' ? COLORS.enemy : kind === 'alert' ? 0xff3b3b : kind === 'rally' ? COLORS.neutral : COLORS.select;
      if (kind === 'alert') {
        addRing(x, y, 0.5, 4, 0.9, color);
        addRing(x, y, 0.5, 2.6, 0.7, color);
      } else {
        addRing(x, y, 0.15, kind === 'attack' ? 1.1 : 0.9, 0.45, color);
        addRing(x, y, 0.05, kind === 'attack' ? 0.55 : 0.45, 0.45, color);
      }
    },

    deposit(x, y) {
      for (let i = 0; i < 5; i++) addSpark(x, 0.9, y, 0.9, 2.6, 0.09, 0.45, COLORS.mineral, 6);
    },

    built(x, y, size, team) {
      addRing(x, y, size * 0.3, size * 0.9, 0.7, COLORS.team[team === 1 ? 1 : 0]);
      for (let i = 0; i < 14; i++) addSpark(x, 0.3, y, size * 0.9, 3, 0.12, 0.7, 0xffffff, 6);
    },

    update(dt) {
      // Beams: a bar travelling from the shooter to the target.
      let count = 0;
      for (const b of beams) {
        if (!b.alive) continue;
        b.t += dt;
        const k = b.t / b.dur;
        if (k >= 1) {
          b.alive = false;
          for (let i = 0; i < b.impact; i++) addSpark(b.tx, b.ty, b.tz, 2.4, 2.6, 0.1, 0.35, b.color, 8);
          if (b.blast > 0) addRing(b.tx, b.tz, 0.2, 1.7, 0.4, 0xffb060);
          continue;
        }
        const head = Math.min(1, k * 1.0);
        const hx = b.fx + (b.tx - b.fx) * head;
        const hy = b.fy + (b.ty - b.fy) * head;
        const hz = b.fz + (b.tz - b.fz) * head;
        scratch.dir.set(b.tx - b.fx, b.ty - b.fy, b.tz - b.fz);
        const total = scratch.dir.length() || 1;
        scratch.dir.divideScalar(total);
        const len = Math.min(b.len, total * head + 0.01);
        scratch.pos.set(hx - scratch.dir.x * len * 0.5, hy - scratch.dir.y * len * 0.5, hz - scratch.dir.z * len * 0.5);
        scratch.quat.setFromUnitVectors(scratch.xAxis, scratch.dir);
        scratch.scale.set(len, b.width, b.width);
        scratch.matrix.compose(scratch.pos, scratch.quat, scratch.scale);
        beamMesh.setMatrixAt(count, scratch.matrix);
        beamMesh.setColorAt(count, scratch.color.setHex(b.color));
        count += 1;
      }
      beamMesh.count = count;
      beamMesh.instanceMatrix.needsUpdate = true;
      if (beamMesh.instanceColor !== null) beamMesh.instanceColor.needsUpdate = true;

      // Sparks.
      count = 0;
      for (const s of sparks) {
        if (!s.alive) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.alive = false;
          continue;
        }
        s.vy -= s.gravity * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        if (s.y < 0.04) {
          s.y = 0.04;
          s.vy = Math.abs(s.vy) * 0.25;
          s.vx *= 0.6;
          s.vz *= 0.6;
        }
        const fade = s.life / s.max;
        scratch.pos.set(s.x, s.y, s.z);
        scratch.scale.setScalar(s.size * (0.4 + fade * 0.6));
        scratch.quat.identity();
        scratch.matrix.compose(scratch.pos, scratch.quat, scratch.scale);
        sparkMesh.setMatrixAt(count, scratch.matrix);
        sparkMesh.setColorAt(count, scratch.color.setHex(s.color).multiplyScalar(0.25 + fade * 0.75));
        count += 1;
      }
      sparkMesh.count = count;
      sparkMesh.instanceMatrix.needsUpdate = true;
      if (sparkMesh.instanceColor !== null) sparkMesh.instanceColor.needsUpdate = true;

      // Rings on the ground.
      count = 0;
      for (const r of rings) {
        if (!r.alive) continue;
        r.t += dt;
        const k = r.t / r.dur;
        if (k >= 1) {
          r.alive = false;
          continue;
        }
        const radius = r.r0 + (r.r1 - r.r0) * Math.sqrt(k);
        scratch.pos.set(r.x, 0.09, r.z);
        scratch.scale.set(radius, 1, radius);
        scratch.quat.identity();
        scratch.matrix.compose(scratch.pos, scratch.quat, scratch.scale);
        ringMesh.setMatrixAt(count, scratch.matrix);
        ringMesh.setColorAt(count, scratch.color.setHex(r.color).multiplyScalar(1 - k));
        count += 1;
      }
      ringMesh.count = count;
      ringMesh.instanceMatrix.needsUpdate = true;
      if (ringMesh.instanceColor !== null) ringMesh.instanceColor.needsUpdate = true;
    },
  };
}
