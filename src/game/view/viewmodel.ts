/**
 * The gun in your hands. It is drawn in its own little scene on top of the world (so it never pokes into a wall) and
 * moves as one: it bobs as you walk, lags as you turn, kicks when it fires, drops for a reload and a switch, tilts as
 * you sprint and slides to the middle when you aim.
 */
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../sim/config';
import { makeGlowTexture } from './textures';

export interface ViewmodelInput {
  weapon: WeaponId;
  /** 0 hip, 1 fully aimed. */
  aim: number;
  speed: number;
  stride: number;
  onGround: boolean;
  sprinting: boolean;
  /** 0 when not reloading, else how far through it is (0..1). */
  reload: number;
  /** 1 when the gun is up, less right after switching. */
  equip: number;
  /** How far the head turned this frame (radians), for the gun to lag behind. */
  lookYaw: number;
  lookPitch: number;
  dt: number;
}

export interface Viewmodel {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(input: ViewmodelInput): void;
  kick(weapon: WeaponId): void;
  setVisible(visible: boolean): void;
  setAspect(aspect: number): void;
  dispose(): void;
}

interface Piece {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  color: number;
  glow?: boolean;
  /** A cylinder along z instead of a box. */
  round?: boolean;
}

const BODY = 0x2b3347;
const TRIM = 0x4a5878;

/** Each gun as a few boxes. The origin is where the hand holds it; the muzzle points to -z. */
const MODELS: Record<WeaponId, { pieces: Piece[]; muzzle: [number, number, number] }> = {
  pistol: {
    pieces: [
      { w: 0.05, h: 0.07, d: 0.27, x: 0, y: 0.03, z: -0.13, color: BODY },
      { w: 0.045, h: 0.12, d: 0.06, x: 0, y: -0.05, z: 0.02, color: TRIM },
      { w: 0.052, h: 0.012, d: 0.2, x: 0, y: 0.068, z: -0.14, color: 0x35e0ff, glow: true },
    ],
    muzzle: [0, 0.03, -0.3],
  },
  rifle: {
    pieces: [
      { w: 0.07, h: 0.1, d: 0.5, x: 0, y: 0.02, z: -0.22, color: BODY },
      { w: 0.032, h: 0.032, d: 0.3, x: 0, y: 0.03, z: -0.56, color: TRIM, round: true },
      { w: 0.06, h: 0.11, d: 0.18, x: 0, y: -0.01, z: 0.1, color: TRIM },
      { w: 0.05, h: 0.17, d: 0.07, x: 0, y: -0.12, z: -0.18, color: BODY },
      { w: 0.03, h: 0.04, d: 0.12, x: 0, y: 0.085, z: -0.1, color: TRIM },
      { w: 0.074, h: 0.02, d: 0.34, x: 0, y: 0.04, z: -0.24, color: 0x35e0ff, glow: true },
    ],
    muzzle: [0, 0.03, -0.72],
  },
  shotgun: {
    pieces: [
      { w: 0.08, h: 0.1, d: 0.5, x: 0, y: 0.02, z: -0.2, color: 0x4a3a2c },
      { w: 0.034, h: 0.034, d: 0.46, x: -0.028, y: 0.035, z: -0.5, color: TRIM, round: true },
      { w: 0.034, h: 0.034, d: 0.46, x: 0.028, y: 0.035, z: -0.5, color: TRIM, round: true },
      { w: 0.09, h: 0.07, d: 0.16, x: 0, y: -0.05, z: -0.3, color: 0x2b2118 },
      { w: 0.06, h: 0.12, d: 0.22, x: 0, y: -0.02, z: 0.14, color: 0x4a3a2c },
      { w: 0.084, h: 0.014, d: 0.3, x: 0, y: 0.074, z: -0.2, color: 0xffa24a, glow: true },
    ],
    muzzle: [0, 0.035, -0.76],
  },
  rail: {
    pieces: [
      { w: 0.08, h: 0.1, d: 0.7, x: 0, y: 0.02, z: -0.3, color: 0x2f2858 },
      { w: 0.025, h: 0.025, d: 0.62, x: -0.05, y: 0.03, z: -0.64, color: TRIM },
      { w: 0.025, h: 0.025, d: 0.62, x: 0.05, y: 0.03, z: -0.64, color: TRIM },
      { w: 0.05, h: 0.05, d: 0.2, x: 0, y: 0.1, z: -0.2, color: 0x1a1a2a, round: true },
      { w: 0.064, h: 0.016, d: 0.5, x: 0, y: 0.075, z: -0.36, color: 0xb48cff, glow: true },
      { w: 0.07, h: 0.12, d: 0.2, x: 0, y: -0.01, z: 0.14, color: 0x3a3068 },
    ],
    muzzle: [0, 0.03, -0.98],
  },
  rocket: {
    pieces: [
      { w: 0.17, h: 0.17, d: 0.85, x: 0, y: 0.03, z: -0.3, color: 0x3a4a30, round: true },
      { w: 0.21, h: 0.21, d: 0.1, x: 0, y: 0.03, z: -0.72, color: 0x242c1e, round: true },
      { w: 0.05, h: 0.12, d: 0.06, x: 0, y: -0.1, z: -0.1, color: BODY },
      { w: 0.05, h: 0.12, d: 0.06, x: 0, y: -0.1, z: -0.4, color: BODY },
      { w: 0.18, h: 0.18, d: 0.03, x: 0, y: 0.03, z: -0.77, color: 0xff7a3a, glow: true, round: true },
    ],
    muzzle: [0, 0.03, -0.86],
  },
};

/** Where each gun sits on the screen: hip and aimed, as (right, down, forward). */
const HIP: THREE.Vector3 = new THREE.Vector3(0.2, -0.2, -0.34);
const AIMED: Record<WeaponId, THREE.Vector3> = {
  pistol: new THREE.Vector3(0, -0.09, -0.3),
  rifle: new THREE.Vector3(0, -0.1, -0.32),
  shotgun: new THREE.Vector3(0, -0.095, -0.3),
  rail: new THREE.Vector3(0, -0.12, -0.3),
  rocket: new THREE.Vector3(0, -0.14, -0.28),
};

export function createViewmodel(): Viewmodel {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.02, 5);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30384c, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(-0.4, 1, 0.6);
  scene.add(key);

  const root = new THREE.Group();
  scene.add(root);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 14).rotateX(Math.PI / 2);
  const glowTexture = makeGlowTexture();
  const lit = new Map<number, THREE.MeshLambertMaterial>();
  const glow = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (color: number, isGlow: boolean): THREE.Material => {
    if (isGlow) {
      let g = glow.get(color);
      if (g === undefined) glow.set(color, (g = new THREE.MeshBasicMaterial({ color })));
      return g;
    }
    let l = lit.get(color);
    if (l === undefined) lit.set(color, (l = new THREE.MeshLambertMaterial({ color })));
    return l;
  };

  const guns = new Map<WeaponId, THREE.Group>();
  const flashes = new Map<WeaponId, THREE.Mesh>();
  for (const id of Object.keys(MODELS) as WeaponId[]) {
    const g = new THREE.Group();
    for (const p of MODELS[id].pieces) {
      const mesh = new THREE.Mesh(p.round === true ? tube : box, materialFor(p.color, p.glow === true));
      mesh.scale.set(p.w, p.h, p.d);
      mesh.position.set(p.x, p.y, p.z);
      g.add(mesh);
    }
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTexture, color: id === 'rail' ? 0xcaa8ff : 0xffe7a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(...MODELS[id].muzzle);
    flash.scale.setScalar(id === 'shotgun' || id === 'rocket' ? 0.55 : 0.36);
    flash.visible = false;
    g.add(flash);
    flashes.set(id, flash);
    g.visible = false;
    root.add(g);
    guns.set(id, g);
  }

  let shown: WeaponId = 'rifle';
  let visible = true;
  const recoil = { back: 0, pitch: 0, yaw: 0, flash: 0, bobX: 0, bobY: 0 };
  const sway = { x: 0, y: 0 };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();

  return {
    scene,
    camera,

    update(i) {
      if (i.weapon !== shown) {
        guns.get(shown)!.visible = false;
        shown = i.weapon;
      }
      const gun = guns.get(shown)!;
      gun.visible = visible;
      const dt = Math.min(i.dt, 0.05);

      // Settle the kick; the gun lags behind a turn and catches up.
      const decay = Math.exp(-14 * dt);
      recoil.back *= decay;
      recoil.pitch *= Math.exp(-11 * dt);
      recoil.yaw *= Math.exp(-11 * dt);
      recoil.flash = Math.max(0, recoil.flash - dt);
      sway.x += (-i.lookYaw * 0.55 - sway.x) * Math.min(1, dt * 12);
      sway.y += (-i.lookPitch * 0.45 - sway.y) * Math.min(1, dt * 12);
      sway.x = Math.max(-0.16, Math.min(0.16, sway.x));
      sway.y = Math.max(-0.12, Math.min(0.12, sway.y));

      const move = Math.min(1, i.speed / 6);
      const bobAmount = i.onGround ? move : 0.2;
      const stride = i.stride * 2.2;
      const aim = i.aim;
      pos.copy(HIP).lerp(AIMED[shown], aim);
      pos.x += Math.cos(stride) * 0.012 * bobAmount * (1 - aim * 0.8);
      pos.y += Math.abs(Math.sin(stride)) * 0.016 * bobAmount * (1 - aim * 0.8);
      pos.z += recoil.back;

      // Dropped for a reload or after switching.
      const reloadLower = i.reload > 0 ? Math.sin(Math.min(1, i.reload) * Math.PI) : 0;
      const equipLower = 1 - Math.max(0, Math.min(1, i.equip));
      pos.y += -0.2 * reloadLower - 0.3 * equipLower;
      pos.x += 0.05 * reloadLower;
      const sprint = i.sprinting && i.onGround ? Math.min(1, move) : 0;
      pos.x += 0.06 * sprint;
      pos.y -= 0.04 * sprint;

      euler.set(recoil.pitch + sway.y + reloadLower * 0.5 - sprint * 0.2, recoil.yaw + sway.x + sprint * 0.55 + reloadLower * -0.2, sprint * -0.25 + reloadLower * 0.3 + sway.x * 0.4);
      root.position.copy(pos);
      root.rotation.copy(euler);

      const flash = flashes.get(shown)!;
      flash.visible = visible && recoil.flash > 0;
      if (flash.visible) flash.rotation.z = recoil.flash * 40;
    },

    kick(weapon) {
      const def = WEAPONS[weapon];
      recoil.back += 0.02 + def.kick * 0.012;
      recoil.pitch += (0.02 + def.kick * 0.012) * (1 + Math.random() * 0.3);
      recoil.yaw += (Math.random() - 0.5) * 0.02 * (1 + def.kick * 0.3);
      recoil.flash = 0.05;
    },

    setVisible(v) {
      visible = v;
    },

    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },

    dispose() {
      box.dispose();
      tube.dispose();
      glowTexture.dispose();
      for (const m of lit.values()) m.dispose();
      for (const m of glow.values()) m.dispose();
    },
  };
}
