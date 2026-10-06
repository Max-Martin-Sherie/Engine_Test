/** The ground and the rock: built once for a map, from nothing but its seed. */
import * as THREE from 'three';
import { createRng, nextFloat } from '../../engine/core/rng';
import type { GameMap } from '../sim';

const ROCK_COLORS = [0x4a4458, 0x57506b, 0x3e3b4e, 0x625a76, 0x484055];
const PX_PER_CELL = 12;

/** A cheap hash of a cell to a number in [0, 1), so rock heights do not need a random stream. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 1013, 0x27d4eb2d) ^ Math.imul(y + 7919, 0x165667b1) ^ Math.imul(salt + 31, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The ground as a picture: tiles of slightly different tone, soft patches, and a paler pad under each base. */
export function makeGroundTexture(map: GameMap): THREE.CanvasTexture {
  const size = map.size;
  const px = size * PX_PER_CELL;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('No 2D canvas for the ground texture');
  const rng = createRng(0x9e3779b1 ^ (map.bases.length * 977) ^ (map.bases[0]?.x ?? 0) * 131 ^ (map.bases[0]?.y ?? 0) * 17);

  ctx.fillStyle = '#323a4d';
  ctx.fillRect(0, 0, px, px);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tone = hash(x, y, 1);
      const lift = Math.round(-4 + tone * 18);
      const warm = Math.round((hash(x, y, 2) - 0.5) * 6);
      ctx.fillStyle = `rgb(${52 + lift + warm}, ${60 + lift}, ${76 + lift - warm})`;
      ctx.fillRect(x * PX_PER_CELL, y * PX_PER_CELL, PX_PER_CELL, PX_PER_CELL);
    }
  }

  // Large soft patches, so the plain looks less like a grid.
  for (let i = 0; i < 70; i++) {
    const cx = nextFloat(rng) * px;
    const cy = nextFloat(rng) * px;
    const r = (3 + nextFloat(rng) * 9) * PX_PER_CELL;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = nextFloat(rng) < 0.5;
    grad.addColorStop(0, warm ? 'rgba(96, 82, 70, 0.20)' : 'rgba(54, 92, 104, 0.18)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Faint tile lines, every cell.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= size; i++) {
    ctx.moveTo(i * PX_PER_CELL + 0.5, 0);
    ctx.lineTo(i * PX_PER_CELL + 0.5, px);
    ctx.moveTo(0, i * PX_PER_CELL + 0.5);
    ctx.lineTo(px, i * PX_PER_CELL + 0.5);
  }
  ctx.stroke();
  // Stronger lines every eight cells, to read distances by.
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.07)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= size; i += 8) {
    ctx.moveTo(i * PX_PER_CELL, 0);
    ctx.lineTo(i * PX_PER_CELL, px);
    ctx.moveTo(0, i * PX_PER_CELL);
    ctx.lineTo(px, i * PX_PER_CELL);
  }
  ctx.stroke();

  // A paler pad under every base.
  for (const b of map.bases) {
    const cx = b.x * PX_PER_CELL;
    const cy = b.y * PX_PER_CELL;
    const r = (b.start >= 0 ? 9 : 7) * PX_PER_CELL;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
    grad.addColorStop(0, b.start >= 0 ? 'rgba(120, 150, 200, 0.34)' : 'rgba(120, 150, 200, 0.2)');
    grad.addColorStop(1, 'rgba(120, 150, 200, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export interface Terrain {
  group: THREE.Group;
  dispose(): void;
}

/** The rock as a field of instanced blocks, taller toward the map's edge. */
export function buildTerrain(map: GameMap, ground: THREE.Material, rockMaterial: THREE.Material): Terrain {
  const size = map.size;
  const group = new THREE.Group();

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), ground);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(size / 2, 0, size / 2);
  group.add(plane);

  // Beyond the map: dark, never lit up.
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(size + 160, size + 160), new THREE.MeshBasicMaterial({ color: 0x03050a }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(size / 2, -0.05, size / 2);
  group.add(outer);

  const cells: { x: number; y: number; h: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (map.rock[y * size + x] !== 1) continue;
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      const h = edge ? 3.6 + hash(x, y, 3) * 0.8 : 0.9 + hash(x, y, 4) * 1.5;
      cells.push({ x, y, h });
    }
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const rocks = new THREE.InstancedMesh(geometry, rockMaterial, Math.max(1, cells.length));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  cells.forEach((c, i) => {
    matrix.compose(new THREE.Vector3(c.x + 0.5, c.h / 2, c.y + 0.5), new THREE.Quaternion(), new THREE.Vector3(1.02, c.h, 1.02));
    rocks.setMatrixAt(i, matrix);
    const base = ROCK_COLORS[Math.floor(hash(c.x, c.y, 5) * ROCK_COLORS.length)] ?? ROCK_COLORS[0]!;
    color.setHex(base).multiplyScalar(0.8 + (c.h / 4.4) * 0.45);
    rocks.setColorAt(i, color);
  });
  rocks.count = cells.length;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor !== null) rocks.instanceColor.needsUpdate = true;
  rocks.frustumCulled = false;
  group.add(rocks);

  return {
    group,
    dispose() {
      geometry.dispose();
      plane.geometry.dispose();
      outer.geometry.dispose();
      (outer.material as THREE.Material).dispose();
      rocks.dispose();
    },
  };
}
