/** The things lying about: health, armour, ammunition and the three big guns. Each is a few boxes that spin and bob. */
import * as THREE from 'three';
import type { Match, PickupKind } from '../sim';
import { COLORS } from './palette';

interface PartSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  color: number;
  glow?: boolean;
  /** Stays put instead of spinning with the rest. */
  fixed?: boolean;
}

const KIND_COLOR: Record<PickupKind, number> = {
  health: COLORS.health,
  armor: COLORS.armor,
  ammo: COLORS.ammo,
  shotgun: 0xffa24a,
  rail: 0xb48cff,
  rocket: 0xff7a3a,
};

const PARTS: Record<PickupKind, PartSpec[]> = {
  health: [
    { w: 0.4, h: 0.4, d: 0.4, x: 0, y: 0, z: 0, color: 0xdfe8ff },
    { w: 0.54, h: 0.13, d: 0.13, x: 0, y: 0, z: 0, color: COLORS.health, glow: true },
    { w: 0.13, h: 0.54, d: 0.13, x: 0, y: 0, z: 0, color: COLORS.health, glow: true },
    { w: 0.13, h: 0.13, d: 0.54, x: 0, y: 0, z: 0, color: COLORS.health, glow: true },
  ],
  armor: [
    { w: 0.46, h: 0.54, d: 0.2, x: 0, y: 0, z: 0, color: 0x2a62c0 },
    { w: 0.32, h: 0.4, d: 0.24, x: 0, y: 0, z: 0, color: COLORS.armor, glow: true },
  ],
  ammo: [
    { w: 0.5, h: 0.3, d: 0.3, x: 0, y: 0, z: 0, color: 0x4a4a32 },
    { w: 0.1, h: 0.34, d: 0.34, x: 0, y: 0, z: 0, color: COLORS.ammo, glow: true },
    { w: 0.1, h: 0.34, d: 0.34, x: 0.18, y: 0, z: 0, color: COLORS.ammo, glow: true },
  ],
  shotgun: [
    { w: 0.72, h: 0.13, d: 0.15, x: 0, y: 0, z: 0, color: 0x4a3a2c },
    { w: 0.3, h: 0.14, d: 0.16, x: 0.12, y: 0, z: 0, color: KIND_COLOR.shotgun, glow: true },
    { w: 0.06, h: 3, d: 0.06, x: 0, y: 1.2, z: 0, color: KIND_COLOR.shotgun, glow: true, fixed: true },
  ],
  rail: [
    { w: 0.95, h: 0.1, d: 0.12, x: 0, y: 0, z: 0, color: 0x2f2858 },
    { w: 0.5, h: 0.05, d: 0.14, x: -0.08, y: 0.05, z: 0, color: KIND_COLOR.rail, glow: true },
    { w: 0.06, h: 3, d: 0.06, x: 0, y: 1.2, z: 0, color: KIND_COLOR.rail, glow: true, fixed: true },
  ],
  rocket: [
    { w: 0.86, h: 0.22, d: 0.22, x: 0, y: 0, z: 0, color: 0x3a4a30 },
    { w: 0.16, h: 0.24, d: 0.24, x: 0.38, y: 0, z: 0, color: KIND_COLOR.rocket, glow: true },
    { w: 0.06, h: 3, d: 0.06, x: 0, y: 1.2, z: 0, color: KIND_COLOR.rocket, glow: true, fixed: true },
  ],
};

export interface Pickups {
  group: THREE.Group;
  update(match: Match, time: number): void;
  dispose(): void;
}

export function createPickups(match: Match, litMaterial: THREE.Material, glowMaterial: THREE.Material): Pickups {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ringGeometry = new THREE.RingGeometry(0.55, 0.68, 28).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false });

  const byKind = new Map<PickupKind, number[]>();
  match.pickups.forEach((p, i) => byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), i]));

  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, Math.max(1, match.pickups.length));
  rings.frustumCulled = false;
  group.add(rings);
  const meshes: { kind: PickupKind; spec: PartSpec; mesh: THREE.InstancedMesh; indices: number[] }[] = [];
  for (const [kind, indices] of byKind) {
    for (const spec of PARTS[kind]) {
      const mesh = new THREE.InstancedMesh(box, spec.glow === true ? glowMaterial : litMaterial, indices.length);
      mesh.frustumCulled = false;
      mesh.setColorAt(0, new THREE.Color(spec.color));
      group.add(mesh);
      meshes.push({ kind, spec, mesh, indices });
    }
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const offset = new THREE.Vector3();

  return {
    group,

    update(current, time) {
      current.pickups.forEach((p, i) => {
        pos.set(p.x, p.y + 0.04, p.z);
        scale.set(1, 1, 1);
        m.compose(pos, q.identity(), scale);
        rings.setMatrixAt(i, m);
        rings.setColorAt(i, color.setHex(KIND_COLOR[p.kind]).multiplyScalar(p.active ? 1 : 0.15));
      });
      rings.count = current.pickups.length;
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor !== null) rings.instanceColor.needsUpdate = true;

      for (const { spec, mesh, indices } of meshes) {
        indices.forEach((pi, slot) => {
          const p = current.pickups[pi]!;
          if (!p.active) {
            m.makeScale(0, 0, 0);
            mesh.setMatrixAt(slot, m);
            return;
          }
          const spin = time * 1.7 + pi;
          const bob = p.y + 0.85 + Math.sin(time * 2.4 + pi) * 0.1;
          q.setFromAxisAngle(up, spec.fixed === true ? 0 : spin);
          offset.set(spec.x, spec.y, spec.z);
          if (spec.fixed !== true) offset.applyQuaternion(q);
          pos.set(p.x + offset.x, spec.fixed === true ? p.y + spec.y : bob + offset.y, p.z + offset.z);
          scale.set(spec.w, spec.h, spec.d);
          m.compose(pos, q, scale);
          mesh.setMatrixAt(slot, m);
          mesh.setColorAt(slot, color.setHex(spec.color));
        });
        mesh.count = indices.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },

    dispose() {
      box.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      rings.dispose();
      for (const { mesh } of meshes) mesh.dispose();
    },
  };
}
