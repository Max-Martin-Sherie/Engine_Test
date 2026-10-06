/**
 * The short-lived things: tracers, sparks, flashes, smoke, rings on the floor and marks on the walls. Each kind is one
 * pool of instances (a single draw call however many are alive). Nothing here is game state; it decorates events.
 */
import * as THREE from 'three';
import { COLORS } from './palette';
import { makeDecalTexture, makeGlowTexture } from './textures';

const TRACERS = 96;
const SPARKS = 700;
const FLASHES = 120;
const SMOKE = 80;
const RINGS = 24;
const DECALS = 140;

interface Tracer {
  alive: boolean;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  life: number;
  max: number;
  color: number;
  width: number;
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
interface Flash {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: number;
}
interface Ring {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: number;
}
interface Decal {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  size: number;
  age: number;
  hot: boolean;
}

const scratch = {
  m: new THREE.Matrix4(),
  pos: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  dir: new THREE.Vector3(),
  color: new THREE.Color(),
  xAxis: new THREE.Vector3(1, 0, 0),
  zAxis: new THREE.Vector3(0, 0, 1),
  n: new THREE.Vector3(),
};

export interface Effects {
  readonly group: THREE.Group;
  /** How long each body should still flash from a hit (seconds). */
  readonly hurt: ReadonlyMap<number, number>;
  tracer(weapon: string, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void;
  /** A bullet landing: sparks, a mark on a wall, a flinch on a body. */
  impact(kind: 'world' | 'actor', x: number, y: number, z: number, nx: number, ny: number, nz: number, victim: number): void;
  muzzle(x: number, y: number, z: number, weapon: string, size?: number): void;
  explosion(x: number, y: number, z: number): void;
  death(x: number, y: number, z: number, color: number): void;
  spawn(x: number, y: number, z: number, color: number): void;
  pickup(x: number, y: number, z: number, color: number): void;
  /** Drawn every frame for the rockets in flight (and their smoke). */
  rocket(x: number, y: number, z: number): void;
  update(dt: number, camera: THREE.Camera): void;
  /** Forgets everything (a new match). */
  clear(): void;
  dispose(): void;
}

const rand = (): number => Math.random();

export function createEffects(): Effects {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const ringGeometry = new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2);
  const glowTexture = makeGlowTexture();
  const decalTexture = makeDecalTexture();

  const additive = (map: THREE.Texture | null): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color: 0xffffff, map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  const tracerMesh = new THREE.InstancedMesh(box, additive(null), TRACERS);
  const sparkMesh = new THREE.InstancedMesh(box, additive(null), SPARKS);
  const flashMesh = new THREE.InstancedMesh(plane, additive(glowTexture), FLASHES);
  const ringMesh = new THREE.InstancedMesh(ringGeometry, additive(null), RINGS);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: glowTexture, transparent: true, opacity: 0.5, depthWrite: false });
  const smokeMesh = new THREE.InstancedMesh(plane, smokeMaterial, SMOKE);
  const decalMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: decalTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const decalMesh = new THREE.InstancedMesh(plane, decalMaterial, DECALS);
  for (const mesh of [tracerMesh, sparkMesh, flashMesh, ringMesh, smokeMesh, decalMesh]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, scratch.color.setHex(0xffffff));
    group.add(mesh);
  }
  flashMesh.renderOrder = 4;
  tracerMesh.renderOrder = 3;
  sparkMesh.renderOrder = 3;
  smokeMesh.renderOrder = 2;
  ringMesh.renderOrder = 2;
  decalMesh.renderOrder = 1;

  const tracers: Tracer[] = Array.from({ length: TRACERS }, () => ({ alive: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, life: 0, max: 1, color: 0, width: 0.03 }));
  const sparks: Spark[] = Array.from({ length: SPARKS }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.05, color: 0, gravity: 0 }));
  const flashes: Flash[] = Array.from({ length: FLASHES }, () => ({ alive: false, x: 0, y: 0, z: 0, life: 0, max: 1, size: 0.3, grow: 0, color: 0 }));
  const smokes: Flash[] = Array.from({ length: SMOKE }, () => ({ alive: false, x: 0, y: 0, z: 0, life: 0, max: 1, size: 0.3, grow: 0, color: 0 }));
  const rings: Ring[] = Array.from({ length: RINGS }, () => ({ alive: false, x: 0, y: 0, z: 0, r0: 0, r1: 1, life: 0, max: 1, color: 0 }));
  const decals: Decal[] = Array.from({ length: DECALS }, () => ({ alive: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, size: 0.2, age: 0, hot: false }));
  let tracerCursor = 0;
  let sparkCursor = 0;
  let flashCursor = 0;
  let smokeCursor = 0;
  let ringCursor = 0;
  let decalCursor = 0;
  const hurt = new Map<number, number>();

  function addSparks(x: number, y: number, z: number, count: number, speed: number, up: number, size: number, life: number, color: number, gravity = 9, nx = 0, ny = 0, nz = 0): void {
    for (let i = 0; i < count; i++) {
      const s = sparks[sparkCursor]!;
      sparkCursor = (sparkCursor + 1) % SPARKS;
      const k = speed * (0.35 + rand() * 0.65);
      s.alive = true;
      s.x = x;
      s.y = y;
      s.z = z;
      // Scatter around the surface's normal (or all round if there is none).
      s.vx = (rand() - 0.5) * k + nx * k * 0.7;
      s.vy = (rand() * 0.8 + 0.2) * up * (0.5 + rand() * 0.5) + ny * k * 0.7;
      s.vz = (rand() - 0.5) * k + nz * k * 0.7;
      s.life = life * (0.6 + rand() * 0.4);
      s.max = s.life;
      s.size = size * (0.6 + rand() * 0.7);
      s.color = color;
      s.gravity = gravity;
    }
  }
  function addFlash(x: number, y: number, z: number, size: number, grow: number, life: number, color: number): void {
    const f = flashes[flashCursor]!;
    flashCursor = (flashCursor + 1) % FLASHES;
    Object.assign(f, { alive: true, x, y, z, life, max: life, size, grow, color });
  }
  function addSmoke(x: number, y: number, z: number, size: number, grow: number, life: number): void {
    const f = smokes[smokeCursor]!;
    smokeCursor = (smokeCursor + 1) % SMOKE;
    Object.assign(f, { alive: true, x, y, z, life, max: life, size, grow, color: 0x6a7085 });
  }
  function addRing(x: number, y: number, z: number, r0: number, r1: number, life: number, color: number): void {
    const r = rings[ringCursor]!;
    ringCursor = (ringCursor + 1) % RINGS;
    Object.assign(r, { alive: true, x, y, z, r0, r1, life, max: life, color });
  }

  return {
    group,
    hurt,

    tracer(weapon, fx, fy, fz, tx, ty, tz) {
      const t = tracers[tracerCursor]!;
      tracerCursor = (tracerCursor + 1) % TRACERS;
      const heavy = weapon === 'rail';
      Object.assign(t, { alive: true, fx, fy, fz, tx, ty, tz, life: heavy ? 0.35 : 0.07, max: heavy ? 0.35 : 0.07, color: COLORS.tracer[weapon] ?? 0xffffff, width: heavy ? 0.07 : weapon === 'shotgun' ? 0.02 : 0.03 });
    },

    impact(kind, x, y, z, nx, ny, nz, victim) {
      if (kind === 'actor') {
        hurt.set(victim, 0.14);
        addSparks(x, y, z, 7, 3.2, 2.4, 0.05, 0.4, 0x7ae8ff, 8);
        addFlash(x, y, z, 0.28, 1.2, 0.1, 0xbff4ff);
        return;
      }
      addSparks(x, y, z, 6, 4, 2.8, 0.04, 0.35, 0xffc27a, 9, nx, ny, nz);
      addFlash(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, 0.22, 0.8, 0.07, 0xffe0a8);
      const d = decals[decalCursor]!;
      decalCursor = (decalCursor + 1) % DECALS;
      Object.assign(d, { alive: true, x: x + nx * 0.015, y: y + ny * 0.015, z: z + nz * 0.015, nx, ny, nz, size: 0.16 + rand() * 0.1, age: 0, hot: true });
    },

    muzzle(x, y, z, weapon, size = 0.5) {
      addFlash(x, y, z, size * (weapon === 'shotgun' || weapon === 'rocket' ? 1.5 : 1), 0, 0.05, weapon === 'rail' ? 0xcaa8ff : 0xffe7a0);
    },

    explosion(x, y, z) {
      addFlash(x, y, z, 1.2, 9, 0.28, 0xffb050);
      addFlash(x, y, z, 0.7, 6, 0.2, 0xfff0c0);
      addRing(x, Math.max(0.08, y > 0.4 ? 0.08 : y), z, 0.3, 4.2, 0.45, 0xffa050);
      addSparks(x, y, z, 40, 9, 8, 0.12, 0.9, 0xffa040, 10);
      addSparks(x, y, z, 18, 5, 5, 0.1, 1.2, 0xff5a2a, 8);
      for (let i = 0; i < 8; i++) addSmoke(x + (rand() - 0.5) * 1.2, y + rand() * 0.8, z + (rand() - 0.5) * 1.2, 0.8, 2.4, 1 + rand() * 0.7);
    },

    death(x, y, z, color) {
      addSparks(x, y + 1, z, 26, 5.5, 5, 0.09, 0.8, color, 9);
      addSparks(x, y + 1, z, 14, 4, 4, 0.07, 1, 0xffffff, 9);
      addFlash(x, y + 1, z, 0.9, 3, 0.2, color);
      addRing(x, y + 0.05, z, 0.2, 1.8, 0.4, color);
    },

    spawn(x, y, z, color) {
      addRing(x, y + 0.06, z, 0.2, 1.4, 0.55, color);
      addRing(x, y + 0.06, z, 1.4, 0.2, 0.45, color);
      addSparks(x, y + 0.2, z, 12, 1.4, 4, 0.05, 0.7, color, -2);
    },

    pickup(x, y, z, color) {
      addRing(x, y + 0.1, z, 0.2, 1.1, 0.4, color);
      addSparks(x, y + 0.5, z, 10, 2, 3, 0.05, 0.5, color, 3);
    },

    rocket(x, y, z) {
      addFlash(x, y, z, 0.5, -1, 0.06, 0xffc070);
      addSmoke(x, y, z, 0.22, 0.9, 0.7);
      addSparks(x, y, z, 1, 0.8, 0.2, 0.05, 0.3, 0xffa040, 2);
    },

    update(dt, camera) {
      for (const [id, left] of hurt) {
        if (left - dt <= 0) hurt.delete(id);
        else hurt.set(id, left - dt);
      }

      // Tracers: a thin box from muzzle to hit that fades.
      let n = 0;
      for (const t of tracers) {
        if (!t.alive) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.alive = false;
          continue;
        }
        scratch.dir.set(t.tx - t.fx, t.ty - t.fy, t.tz - t.fz);
        const len = scratch.dir.length() || 1;
        scratch.dir.divideScalar(len);
        scratch.pos.set((t.fx + t.tx) / 2, (t.fy + t.ty) / 2, (t.fz + t.tz) / 2);
        scratch.q.setFromUnitVectors(scratch.xAxis, scratch.dir);
        const fade = t.life / t.max;
        scratch.scale.set(len, t.width * (0.5 + fade * 0.5), t.width * (0.5 + fade * 0.5));
        scratch.m.compose(scratch.pos, scratch.q, scratch.scale);
        tracerMesh.setMatrixAt(n, scratch.m);
        tracerMesh.setColorAt(n, scratch.color.setHex(t.color).multiplyScalar(fade));
        n += 1;
      }
      tracerMesh.count = n;

      // Sparks.
      n = 0;
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
        if (s.y < 0.03) {
          s.y = 0.03;
          s.vy = Math.abs(s.vy) * 0.3;
          s.vx *= 0.5;
          s.vz *= 0.5;
        }
        const fade = s.life / s.max;
        scratch.pos.set(s.x, s.y, s.z);
        scratch.scale.setScalar(s.size * (0.4 + fade * 0.6));
        scratch.q.identity();
        scratch.m.compose(scratch.pos, scratch.q, scratch.scale);
        sparkMesh.setMatrixAt(n, scratch.m);
        sparkMesh.setColorAt(n, scratch.color.setHex(s.color).multiplyScalar(0.3 + fade * 0.7));
        n += 1;
      }
      sparkMesh.count = n;

      // Flashes and smoke face the camera.
      const face = (list: Flash[], mesh: THREE.InstancedMesh, additiveGlow: boolean): void => {
        let k = 0;
        for (const f of list) {
          if (!f.alive) continue;
          f.life -= dt;
          if (f.life <= 0) {
            f.alive = false;
            continue;
          }
          const t = 1 - f.life / f.max;
          const size = Math.max(0.02, f.size + f.grow * t);
          scratch.pos.set(f.x, f.y, f.z);
          scratch.scale.setScalar(size);
          scratch.m.compose(scratch.pos, camera.quaternion, scratch.scale);
          mesh.setMatrixAt(k, scratch.m);
          mesh.setColorAt(k, scratch.color.setHex(f.color).multiplyScalar(additiveGlow ? 1 - t * t : 1 - t));
          k += 1;
        }
        mesh.count = k;
      };
      face(flashes, flashMesh, true);
      face(smokes, smokeMesh, false);

      // Rings flat on the floor.
      n = 0;
      for (const r of rings) {
        if (!r.alive) continue;
        r.life -= dt;
        if (r.life <= 0) {
          r.alive = false;
          continue;
        }
        const t = 1 - r.life / r.max;
        const radius = r.r0 + (r.r1 - r.r0) * Math.sqrt(t);
        scratch.pos.set(r.x, r.y, r.z);
        scratch.scale.set(radius, 1, radius);
        scratch.q.identity();
        scratch.m.compose(scratch.pos, scratch.q, scratch.scale);
        ringMesh.setMatrixAt(n, scratch.m);
        ringMesh.setColorAt(n, scratch.color.setHex(r.color).multiplyScalar(1 - t));
        n += 1;
      }
      ringMesh.count = n;

      // Marks on the walls fade away last.
      n = 0;
      for (const d of decals) {
        if (!d.alive) continue;
        d.age += dt;
        if (d.age > 24) {
          d.alive = false;
          continue;
        }
        scratch.n.set(d.nx, d.ny, d.nz);
        scratch.q.setFromUnitVectors(scratch.zAxis, scratch.n);
        scratch.pos.set(d.x, d.y, d.z);
        scratch.scale.setScalar(d.size * (d.age < 0.1 ? 0.6 + d.age * 4 : 1));
        scratch.m.compose(scratch.pos, scratch.q, scratch.scale);
        decalMesh.setMatrixAt(n, scratch.m);
        decalMesh.setColorAt(n, scratch.color.setScalar(Math.max(0, Math.min(1, (24 - d.age) / 6))));
        n += 1;
      }
      decalMesh.count = n;

      for (const mesh of [tracerMesh, sparkMesh, flashMesh, smokeMesh, ringMesh, decalMesh]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },

    clear() {
      for (const list of [tracers, sparks, flashes, smokes, rings, decals]) for (const e of list) e.alive = false;
      hurt.clear();
    },

    dispose() {
      box.dispose();
      plane.dispose();
      ringGeometry.dispose();
      glowTexture.dispose();
      decalTexture.dispose();
      for (const mesh of [tracerMesh, sparkMesh, flashMesh, smokeMesh, ringMesh, decalMesh]) mesh.dispose();
    },
  };
}
