/**
 * The 3D world: a Three.js canvas laid under the engine's transparent 2D layer. It draws the arena, the robots, the
 * pickups, the rockets and the effects from a camera pose the flow gives it, then the gun in your hands on top. It reads
 * the match and never changes it.
 */
import * as THREE from 'three';
import type { WorldSize } from '../../engine/core/config';
import type { Fit } from '../../engine/core/layout';
import type { Match, WeaponId } from '../sim';
import { buildArena, createPanelMaterial, makeSky, type ArenaMesh } from './arenaMesh';
import { createCharacters, type Characters } from './characters';
import { createEffects, type Effects } from './effects';
import { COLORS } from './palette';
import { createPickups, type Pickups } from './pickups';
import { makeTileTexture } from './textures';
import { createViewmodel, type ViewmodelInput } from './viewmodel';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** The Three.js camera's convention: yaw 0 looks along -z, a positive yaw turns left, a positive pitch looks up. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

export interface DrawInput {
  match: Match;
  /** The actor whose eyes these are (hidden from view), or -1 when watching from outside. */
  viewer: number;
  pose: CameraPose;
  /** How far into the next tick we are (0..1). */
  alpha: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Seconds since the game began, for animation. */
  time: number;
  /** The gun in hand, or null when there is none to show (watching, or dead). */
  gun: ViewmodelInput | null;
}

export interface World3d {
  readonly canvas: HTMLCanvasElement;
  readonly effects: Effects;
  /** The people: who has fallen, thrown by what. */
  readonly characters: Characters;
  /** Builds the arena and the pickups of a match (and clears the old ones). */
  load(match: Match): void;
  layout(fit: Fit): void;
  draw(input: DrawInput): void;
  /** The gun kicks (when you fire). */
  kick(weapon: WeaponId): void;
  /** Draws at this fraction (0.5 .. 1) of the usual resolution: the flow lowers it on a device that cannot keep up. */
  setQuality(scale: number): void;
  /** Where a point in the world lands on the screen (engine world coordinates), or null if it is behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  dispose(): void;
}

export function createWorld3d(host: HTMLElement, world: WorldSize): World3d {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const maxRatio = coarse ? 1.5 : 2;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setClearColor(COLORS.skyTop, 1);
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.display = 'block';
  canvas.dataset['layer'] = 'world3d';
  host.insertBefore(canvas, host.firstChild);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 44, 130);
  scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x39486c, 2.3));
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.6);
  sun.position.set(-16, 30, 10);
  scene.add(sun);
  const sky = makeSky();
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(78, world.width / world.height, 0.05, 220);
  const viewmodel = createViewmodel();
  const effects = createEffects();
  scene.add(effects.group);

  const tile = makeTileTexture();
  const lit = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const characters: Characters = createCharacters(lit, glow);
  scene.add(characters.group);

  // Rockets in flight.
  const rocketGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rocketMesh = new THREE.InstancedMesh(rocketGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }), 12);
  rocketMesh.frustumCulled = false;
  rocketMesh.count = 0;
  rocketMesh.setColorAt(0, new THREE.Color(0xffa14a));
  scene.add(rocketMesh);

  let arena: ArenaMesh | null = null;
  let pickups: Pickups | null = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastRatio = 0;
  let lastScale = 0;
  let quality = 1;
  const kicks = { pitch: 0, shake: 0 };
  let loaded = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const d = new THREE.Vector3();
  const xAxis = new THREE.Vector3(0, 0, -1);
  const projectVec = new THREE.Vector3();

  return {
    canvas,
    effects,
    characters,

    load(match) {
      arena?.dispose();
      if (arena !== null) scene.remove(arena.group);
      pickups?.dispose();
      if (pickups !== null) scene.remove(pickups.group);
      arena = buildArena(match.arena, tile);
      scene.add(arena.group);
      pickups = createPickups(match, lit, glow);
      scene.add(pickups.group);
      effects.clear();
      characters.reset();
      loaded = true;
    },

    layout(fit) {
      const width = Math.max(2, Math.round(world.width * fit.scale));
      const height = Math.max(2, Math.round(world.height * fit.scale));
      const ratio = Math.min(window.devicePixelRatio || 1, maxRatio) * quality;
      if (width !== lastWidth || height !== lastHeight || fit.scale !== lastScale || ratio !== lastRatio) {
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        viewmodel.setAspect(width / height);
        lastWidth = width;
        lastHeight = height;
        lastScale = fit.scale;
        lastRatio = ratio;
      }
      canvas.style.left = `${Math.round(fit.offsetX)}px`;
      canvas.style.top = `${Math.round(fit.offsetY)}px`;
    },

    draw(input) {
      if (!loaded) return;
      const { match, viewer, pose, alpha, dt, time, gun } = input;

      // The camera.
      kicks.pitch *= Math.exp(-9 * dt);
      kicks.shake *= Math.exp(-6 * dt);
      const shakeX = (Math.random() - 0.5) * kicks.shake;
      const shakeY = (Math.random() - 0.5) * kicks.shake;
      camera.position.set(pose.x, pose.y, pose.z);
      camera.rotation.set(pose.pitch + kicks.pitch + shakeY * 0.02, pose.yaw + shakeX * 0.02, pose.roll, 'YXZ');
      if (Math.abs(camera.fov - pose.fov) > 0.01) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      sky.position.copy(camera.position);

      pickups?.update(match, time);
      characters.update(match, viewer, alpha, dt, effects.hurt);

      // Rockets, and their smoke.
      let n = 0;
      for (const r of match.projectiles) {
        if (n >= 12) break;
        const x = r.x + r.vx * alpha * (1 / 60);
        const y = r.y + r.vy * alpha * (1 / 60);
        const z = r.z + r.vz * alpha * (1 / 60);
        d.set(r.vx, r.vy, r.vz).normalize();
        q.setFromUnitVectors(xAxis, d);
        m.compose(p.set(x, y, z), q, s.set(0.13, 0.13, 0.55));
        rocketMesh.setMatrixAt(n, m);
        effects.rocket(x, y, z);
        n += 1;
      }
      rocketMesh.count = n;
      rocketMesh.instanceMatrix.needsUpdate = true;

      effects.update(dt, camera);

      renderer.clear();
      renderer.render(scene, camera);
      if (gun !== null) {
        viewmodel.setVisible(true);
        viewmodel.update(gun);
        renderer.clearDepth();
        renderer.render(viewmodel.scene, viewmodel.camera);
      }
    },

    kick(weapon) {
      viewmodel.kick(weapon);
      kicks.pitch += weapon === 'shotgun' ? 0.035 : weapon === 'rail' ? 0.04 : weapon === 'rocket' ? 0.03 : weapon === 'rifle' ? 0.007 : 0.012;
      kicks.shake += weapon === 'shotgun' || weapon === 'rocket' || weapon === 'rail' ? 0.5 : 0.1;
    },

    setQuality(scale) {
      quality = Math.min(1, Math.max(0.5, scale));
    },

    project(x, y, z) {
      projectVec.set(x, y, z).project(camera);
      if (projectVec.z > 1 || projectVec.z < -1) return null;
      return { x: (projectVec.x + 1) * 0.5 * world.width, y: (1 - projectVec.y) * 0.5 * world.height };
    },

    dispose() {
      arena?.dispose();
      pickups?.dispose();
      characters.dispose();
      effects.dispose();
      viewmodel.dispose();
      tile.dispose();
      rocketGeometry.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export { createPanelMaterial };
