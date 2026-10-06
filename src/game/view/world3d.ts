/**
 * The 3D world: a Three.js canvas laid under the engine's transparent 2D layer. It owns the camera, draws the map and
 * every entity as instanced solids, applies the fog of war, and answers "what is under this screen point?" for the
 * controls. It reads the match and never changes it.
 *
 * Screen points here are in the engine's world coordinates (640 x 360 for a landscape game), the same space the 2D layer
 * and `view.clientToWorld` use, so no pixel maths leaks out of this file.
 */
import * as THREE from 'three';
import type { WorldSize } from '../../engine/core/config';
import type { Fit } from '../../engine/core/layout';
import { BUILDINGS, canSee, halfSize, isAir, isBuilding, isUnit, snapCentre, type BuildingType, type Entity, type EntityType, type GameMap, type Match } from '../sim';
import { createEffects, type Effects } from './effects';
import { createFogMap, createMaterials, type FogMap, type Materials } from './materials';
import { MODELS, heightOf, type Model, type Part, type Shape } from './models';
import { COLORS, hpColor } from './palette';
import { buildTerrain, makeGroundTexture, type Terrain } from './terrain';

const PITCH = (56 * Math.PI) / 180;
const FOV = 34;
/** The camera's target sits this far above the middle of the screen (a fraction of its height): the bottom panel covers the lower part. */
const VIEW_SHIFT = 0.1;
export const ZOOM_MIN = 11;
export const ZOOM_MAX = 40;

const UNIT_CAPACITY = 256;
const BUILDING_CAPACITY = 96;
const RESOURCE_CAPACITY = 80;

export interface CameraState {
  /** The map point at the middle of the screen. */
  x: number;
  y: number;
  /** Distance from the ground point: smaller is closer. */
  zoom: number;
}

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  valid: boolean;
}

export interface DrawInput {
  match: Match;
  /** Whose eyes: fog and what can be seen. */
  player: number;
  /** Fog of war on; off shows everything (the menu's demo). */
  fog: boolean;
  /** How far we are into the next sim tick (0..1). */
  alpha: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Seconds since the game began, for animation. */
  time: number;
  selected: ReadonlySet<number>;
  hover: number | null;
  ghost: Ghost | null;
  /** Health bars on everything, not only what is selected, hurt or going up. */
  allBars: boolean;
}

/** A health or progress bar to draw in the 2D layer, in the engine's world coordinates. */
export interface Bar {
  x: number;
  y: number;
  w: number;
  frac: number;
  color: number;
  /** A second, thinner bar under it (construction or training progress), 0..1; negative for none. */
  progress: number;
}

export interface Frame {
  bars: Bar[];
}

export interface Screen2D {
  x: number;
  y: number;
}

export interface World3d {
  readonly canvas: HTMLCanvasElement;
  readonly effects: Effects;
  readonly cam: CameraState;
  load(map: GameMap): void;
  layout(fit: Fit): void;
  draw(input: DrawInput): Frame;
  /** The map point under a screen point, or null if the ray misses the ground. */
  groundAt(sx: number, sy: number): Screen2D | null;
  /** Where a map point (and height above the ground) lands on the screen. */
  project(x: number, y: number, h?: number): Screen2D | null;
  /** Where the middle of an entity's body is on the screen (a flyer is drawn high above its shadow). */
  projectEntity(e: Entity): Screen2D | null;
  /** The entity under a screen point (units first, then buildings, then resources). `slop` widens the target for fingers. */
  pick(match: Match, player: number, fog: boolean, sx: number, sy: number, slop?: number): Entity | null;
  /** The player's own units (or, failing that, buildings) whose middle is inside the screen rectangle. */
  boxSelect(match: Match, player: number, x0: number, y0: number, x1: number, y1: number): Entity[];
  /** The four map points at the corners of the screen. */
  viewQuad(): Screen2D[];
  /** Keeps the camera over the map. */
  clampCamera(): void;
  /** Draws at this fraction (0.5 .. 1) of the usual resolution: the flow lowers it on a device that cannot keep up. */
  setQuality(scale: number): void;
  /** How bright the fog leaves a map cell right now, 0 (black) to 1 (clear). For tests. */
  fogBrightness(x: number, y: number): number;
  dispose(): void;
}

const GEOMETRIES: Record<Shape, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cone: () => new THREE.ConeGeometry(0.5, 1, 14),
  sphere: () => new THREE.SphereGeometry(0.5, 14, 10),
  oct: () => new THREE.OctahedronGeometry(0.5),
  dome: () => {
    const g = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 2, 1);
    g.translate(0, -0.5, 0);
    return g;
  },
};

interface PartMesh {
  mesh: THREE.InstancedMesh;
  part: Part;
  local: THREE.Matrix4;
  /** The part's fixed colour, when it has one. */
  fixed: THREE.Color | null;
  count: number;
  capacity: number;
}

const tmp = {
  m: new THREE.Matrix4(),
  base: new THREE.Matrix4(),
  baseSpin: new THREE.Matrix4(),
  pos: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  qid: new THREE.Quaternion(),
  euler: new THREE.Euler(),
  color: new THREE.Color(),
  white: new THREE.Color(0xffffff),
  yAxis: new THREE.Vector3(0, 1, 0),
  ray: new THREE.Raycaster(),
  v2: new THREE.Vector2(),
  v3: new THREE.Vector3(),
};

function partMatrix(part: Part): THREE.Matrix4 {
  tmp.euler.set(0, part.rotY ?? 0, part.rotZ ?? 0, 'XYZ');
  tmp.q.setFromEuler(tmp.euler);
  return new THREE.Matrix4().compose(new THREE.Vector3(part.x, part.y, part.z), tmp.q.clone(), new THREE.Vector3(part.w, part.h, part.d));
}

const teamColor = (owner: number): number => COLORS.team[owner === 1 ? 1 : 0];
const teamDarkColor = (owner: number): number => COLORS.teamDark[owner === 1 ? 1 : 0];

/** The shortest signed turn from one angle to another. */
function turnBetween(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createWorld3d(host: HTMLElement, world: WorldSize): World3d {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const maxRatio = coarse ? 1.5 : 2;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setClearColor(COLORS.sky, 1);
  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.display = 'block';
  canvas.dataset['layer'] = 'world3d';
  host.insertBefore(canvas, host.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x3a3358, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-14, 26, 9);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(FOV, world.width / world.height, 0.5, 220);
  const cam: CameraState = { x: 48, y: 48, zoom: 26 };

  let mapSize = 96;
  let fogMap: FogMap = createFogMap(mapSize);
  let materials: Materials = createMaterials(fogMap.texture, mapSize, null);
  let terrain: Terrain | null = null;
  let groundTexture: THREE.Texture | null = null;
  let loaded = false;

  const effects = createEffects(materials.spark);
  scene.add(effects.group);

  // ---- instanced rigs ------------------------------------------------------------------------
  const geometryCache = new Map<Shape, THREE.BufferGeometry>();
  const geometryFor = (shape: Shape): THREE.BufferGeometry => {
    let g = geometryCache.get(shape);
    if (g === undefined) {
      g = GEOMETRIES[shape]();
      geometryCache.set(shape, g);
    }
    return g;
  };

  const rigGroup = new THREE.Group();
  scene.add(rigGroup);
  const rigs = new Map<EntityType, PartMesh[]>();
  const allParts: PartMesh[] = [];

  function buildRigs(): void {
    for (const part of allParts) {
      rigGroup.remove(part.mesh);
      part.mesh.dispose();
    }
    allParts.length = 0;
    rigs.clear();
    for (const [type, model] of Object.entries(MODELS) as [EntityType, Model][]) {
      const capacity = type === 'minerals' ? RESOURCE_CAPACITY : type === 'geyser' ? 24 : isUnitType(type) ? UNIT_CAPACITY : BUILDING_CAPACITY;
      const list: PartMesh[] = [];
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(geometryFor(part.shape), part.glow === true ? materials.glow : materials.lit, capacity);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.setColorAt(0, tmp.white);
        rigGroup.add(mesh);
        const fixed = typeof part.color === 'number' ? new THREE.Color(part.color) : null;
        const entry: PartMesh = { mesh, part, local: partMatrix(part), fixed, count: 0, capacity };
        list.push(entry);
        allParts.push(entry);
      }
      rigs.set(type, list);
    }
  }
  const isUnitType = (type: EntityType): boolean => type === 'worker' || type === 'trooper' || type === 'tank' || type === 'skiff';

  // Shadows, selection frames and rally flags.
  const shadowDisc = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2), materials.shadow, UNIT_CAPACITY);
  const shadowRect = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), materials.shadow, BUILDING_CAPACITY + RESOURCE_CAPACITY);
  const ringMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.88, 1, 36).rotateX(-Math.PI / 2), materials.flat, 128);
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-0.5, -0.5);
  frameShape.lineTo(0.5, -0.5);
  frameShape.lineTo(0.5, 0.5);
  frameShape.lineTo(-0.5, 0.5);
  frameShape.lineTo(-0.5, -0.5);
  const hole = new THREE.Path();
  hole.moveTo(-0.46, -0.46);
  hole.lineTo(-0.46, 0.46);
  hole.lineTo(0.46, 0.46);
  hole.lineTo(0.46, -0.46);
  hole.lineTo(-0.46, -0.46);
  frameShape.holes.push(hole);
  const frameGeometry = new THREE.ShapeGeometry(frameShape).rotateX(-Math.PI / 2);
  const frameMesh = new THREE.InstancedMesh(frameGeometry, materials.flat, 64);
  const poleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), materials.lit, 32);
  const flagMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.26, 0.04), materials.lit, 32);
  shadowDisc.renderOrder = 1;
  shadowRect.renderOrder = 1;
  ringMesh.renderOrder = 2;
  frameMesh.renderOrder = 2;
  for (const mesh of [shadowDisc, shadowRect, ringMesh, frameMesh, poleMesh, flagMesh]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, tmp.white);
    scene.add(mesh);
  }

  // The building about to be placed.
  const ghostGroup = new THREE.Group();
  ghostGroup.visible = false;
  scene.add(ghostGroup);
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: COLORS.placeOk, transparent: true, opacity: 0.5, depthWrite: false });
  const ghostFrameMaterial = new THREE.MeshBasicMaterial({ color: COLORS.placeOk, transparent: true, opacity: 0.95, depthWrite: false });
  const ghostFrame = new THREE.Mesh(frameGeometry, ghostFrameMaterial);
  ghostFrame.renderOrder = 4;
  let ghostType: BuildingType | null = null;
  const ghostParts = new THREE.Group();
  ghostGroup.add(ghostParts, ghostFrame);

  function setGhostType(type: BuildingType): void {
    ghostParts.clear();
    for (const part of MODELS[type].parts) {
      const mesh = new THREE.Mesh(geometryFor(part.shape), ghostMaterial);
      mesh.position.set(part.x, part.y, part.z);
      tmp.euler.set(0, part.rotY ?? 0, part.rotZ ?? 0, 'XYZ');
      mesh.quaternion.setFromEuler(tmp.euler);
      mesh.scale.set(part.w, part.h, part.d);
      ghostParts.add(mesh);
    }
    ghostType = type;
  }

  buildRigs();

  // ---- state kept between frames -----------------------------------------------------------------
  const yaws = new Map<number, number>();
  let fogTick = -1;
  let fogShown: boolean | null = null;
  let frameNumber = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastScale = 0;
  let lastRatio = 0;
  let quality = 1;

  function updateCamera(): void {
    const d = cam.zoom;
    camera.position.set(cam.x, Math.sin(PITCH) * d, cam.y + Math.cos(PITCH) * d);
    camera.lookAt(cam.x, 0, cam.y);
    camera.updateMatrixWorld();
  }

  function clampCamera(): void {
    cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom));
    const margin = 3;
    cam.x = Math.min(mapSize - margin, Math.max(margin, cam.x));
    cam.y = Math.min(mapSize - margin, Math.max(margin, cam.y));
  }

  /** Screen (engine world) coordinates to a ray hitting the horizontal plane at `h`. */
  function intersect(sx: number, sy: number, h: number): Screen2D | null {
    tmp.v2.set((sx / world.width) * 2 - 1, 1 - (sy / world.height) * 2);
    tmp.ray.setFromCamera(tmp.v2, camera);
    const o = tmp.ray.ray.origin;
    const d = tmp.ray.ray.direction;
    if (d.y > -1e-5) return null;
    const t = (h - o.y) / d.y;
    if (t < 0) return null;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  function project(x: number, y: number, h = 0): Screen2D | null {
    tmp.v3.set(x, h, y).project(camera);
    if (tmp.v3.z > 1 || tmp.v3.z < -1) return null;
    return { x: (tmp.v3.x + 1) * 0.5 * world.width, y: (1 - tmp.v3.y) * 0.5 * world.height };
  }

  function visibleTo(m: Match, player: number, fog: boolean, e: Entity): boolean {
    return e.alive && (e.owner === player || !fog || canSee(m, player, e));
  }

  function resolveColor(entry: PartMesh, owner: number, out: THREE.Color): THREE.Color {
    if (entry.fixed !== null) return out.copy(entry.fixed);
    return out.setHex(entry.part.color === 'team' ? teamColor(owner) : teamDarkColor(owner));
  }

  function draw(input: DrawInput): Frame {
    const { match: m, player, fog, alpha, dt, time, selected, hover, ghost, allBars } = input;
    frameNumber += 1;
    updateCamera();

    // ---- fog -----------------------------------------------------------------------------
    if (fog) {
      if (fogShown !== true) {
        fogMap.set(m.vision[player] ?? null, true);
        fogShown = true;
        fogTick = m.visionTick;
      } else if (m.visionTick !== fogTick) {
        // The sim recomputed what can be seen: show it (whichever frame notices first, however slow the frames).
        fogMap.set(m.vision[player] ?? null);
        fogTick = m.visionTick;
      }
    } else if (fogShown !== false) {
      fogMap.set(null, true);
      fogShown = false;
    }
    fogMap.update(dt);

    // ---- entities --------------------------------------------------------------------------
    const bars: Bar[] = [];
    let shadowDiscs = 0;
    let shadowRects = 0;
    let rings = 0;
    let frames = 0;
    let flags = 0;
    const turnRate = 14 * dt;

    for (const e of m.entities) {
      if (!visibleTo(m, player, fog, e)) continue;
      const model = MODELS[e.type];
      const rig = rigs.get(e.type);
      if (rig === undefined) continue;
      const unit = isUnit(e);
      const ix = unit ? e.px + (e.x - e.px) * alpha : e.x;
      const iy = unit ? e.py + (e.y - e.py) * alpha : e.y;

      // Facing: turn toward the sim's facing at a limited rate.
      let yaw = yaws.get(e.id);
      const wanted = Math.atan2(-e.fy, e.fx);
      if (yaw === undefined) yaw = wanted;
      else {
        const turn = turnBetween(yaw, wanted);
        yaw += Math.abs(turn) <= turnRate ? turn : Math.sign(turn) * turnRate;
      }
      if (unit || e.type === 'turret') yaws.set(e.id, yaw);

      const moving = unit && Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.004;
      let lift = model.altitude ?? 0;
      if (isAir(e)) lift += Math.sin(time * 2.2 + e.id) * 0.12;
      else if (moving && e.type !== 'tank') lift += Math.abs(Math.sin(time * 11 + e.id)) * 0.05;

      const size = model.scale?.(e) ?? 1;
      const grow = e.progress < 1 ? 0.18 + 0.82 * e.progress : 1;
      tmp.pos.set(ix, lift, iy);
      tmp.scale.set(size, size * grow, size);
      tmp.q.setFromAxisAngle(tmp.yAxis, yaw);
      tmp.baseSpin.compose(tmp.pos, tmp.q, tmp.scale);
      tmp.base.compose(tmp.pos, tmp.qid, tmp.scale);

      const hurt = Math.max(0, 1 - (m.tick - e.hurtAt + alpha) / 5);
      const dim = e.progress < 1 ? 0.62 + 0.38 * e.progress : 1;

      for (const entry of rig) {
        if (entry.count >= entry.capacity) continue;
        if (entry.part.show !== undefined && !entry.part.show(e)) continue;
        tmp.m.multiplyMatrices(unit || entry.part.spin === true ? tmp.baseSpin : tmp.base, entry.local);
        entry.mesh.setMatrixAt(entry.count, tmp.m);
        resolveColor(entry, e.owner, tmp.color);
        if (dim < 1) tmp.color.multiplyScalar(dim);
        if (hurt > 0) tmp.color.lerp(tmp.white, hurt * 0.55);
        entry.mesh.setColorAt(entry.count, tmp.color);
        entry.count += 1;
      }

      // Shadow.
      if (unit) {
        if (shadowDiscs < UNIT_CAPACITY) {
          const r = halfSize(e).hw * 2.3 * (isAir(e) ? 0.75 : 1);
          tmp.pos.set(ix + (isAir(e) ? 0.35 : 0), 0.03, iy + (isAir(e) ? 0.35 : 0));
          tmp.scale.set(r, 1, r);
          tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
          shadowDisc.setMatrixAt(shadowDiscs, tmp.m);
          shadowDiscs += 1;
        }
      } else if (shadowRects < BUILDING_CAPACITY + RESOURCE_CAPACITY) {
        const h = halfSize(e);
        tmp.pos.set(ix + 0.1, 0.03, iy + 0.1);
        tmp.scale.set(h.hw * 2 * 1.08, 1, h.hh * 2 * 1.08);
        tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
        shadowRect.setMatrixAt(shadowRects, tmp.m);
        shadowRects += 1;
      }

      // Selection and hover.
      const isSelected = selected.has(e.id);
      const isHover = hover === e.id;
      if (isSelected || isHover) {
        const color = e.owner === player ? COLORS.select : e.owner < 0 ? COLORS.neutral : COLORS.enemy;
        if (unit) {
          if (rings < 128) {
            const r = halfSize(e).hw * 1.45;
            tmp.pos.set(ix, 0.06, iy);
            tmp.scale.set(r, 1, r);
            tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
            ringMesh.setMatrixAt(rings, tmp.m);
            ringMesh.setColorAt(rings, tmp.color.setHex(color).multiplyScalar(isSelected ? 1 : 0.8));
            rings += 1;
          }
        } else if (frames < 64) {
          const h = halfSize(e);
          tmp.pos.set(ix, 0.06, iy);
          tmp.scale.set(h.hw * 2 + 0.2, 1, h.hh * 2 + 0.2);
          tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
          frameMesh.setMatrixAt(frames, tmp.m);
          frameMesh.setColorAt(frames, tmp.color.setHex(color).multiplyScalar(isSelected ? 1 : 0.8));
          frames += 1;
        }
        if (isSelected && e.rally !== null && e.owner === player && flags < 32) {
          tmp.pos.set(e.rally.x, 0.55, e.rally.y);
          tmp.scale.set(1, 1, 1);
          tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
          poleMesh.setMatrixAt(flags, tmp.m);
          poleMesh.setColorAt(flags, tmp.color.setHex(COLORS.neutral));
          tmp.pos.set(e.rally.x + 0.22, 0.98, e.rally.y);
          tmp.m.compose(tmp.pos, tmp.qid, tmp.scale);
          flagMesh.setMatrixAt(flags, tmp.m);
          flagMesh.setColorAt(flags, tmp.color.setHex(COLORS.neutral));
          flags += 1;
        }
      }

      // Health bars: for what is selected, hovered, hurt lately, or going up.
      if (e.owner >= 0 && (allBars || isSelected || isHover || m.tick - e.hurtAt < 90 || e.progress < 1) && e.hp > 0) {
        const top = project(ix, iy, heightOf(e.type) + 0.35);
        const left = project(ix - halfSize(e).hw, iy, heightOf(e.type) + 0.35);
        const right = project(ix + halfSize(e).hw, iy, heightOf(e.type) + 0.35);
        if (top !== null && left !== null && right !== null) {
          const w = Math.min(70, Math.max(16, Math.abs(right.x - left.x) * 1.1));
          bars.push({ x: top.x, y: top.y, w, frac: Math.max(0, e.hp / e.maxHp), color: e.owner === player ? hpColor(e.hp / e.maxHp) : COLORS.enemy, progress: e.progress < 1 ? e.progress : -1 });
        }
      }

      // A damaged building smoulders.
      if (!unit && isBuilding(e) && e.progress >= 1 && e.hp / e.maxHp < 0.4 && Math.random() < dt * 5) {
        effects.deposit(ix + (Math.random() - 0.5) * halfSize(e).hw * 1.4, iy + (Math.random() - 0.5) * halfSize(e).hh * 1.4);
      }
    }

    if (frameNumber % 240 === 0) {
      for (const id of yaws.keys()) if (!m.byId.has(id)) yaws.delete(id);
    }

    for (const entry of allParts) {
      entry.mesh.count = entry.count;
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor !== null) entry.mesh.instanceColor.needsUpdate = true;
      entry.count = 0;
    }
    const finish = (mesh: THREE.InstancedMesh, count: number): void => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    };
    finish(shadowDisc, shadowDiscs);
    finish(shadowRect, shadowRects);
    finish(ringMesh, rings);
    finish(frameMesh, frames);
    finish(poleMesh, flags);
    finish(flagMesh, flags);

    // ---- the building being placed ---------------------------------------------------------------
    if (ghost !== null) {
      if (ghostType !== ghost.type) setGhostType(ghost.type);
      const snapped = snapCentre(ghost.type, ghost.x, ghost.y);
      ghostGroup.position.set(snapped.x, 0, snapped.y);
      ghostParts.visible = true;
      const color = ghost.valid ? COLORS.placeOk : COLORS.placeBad;
      ghostMaterial.color.setHex(color);
      ghostFrameMaterial.color.setHex(color);
      const stats = BUILDINGS[ghost.type];
      ghostFrame.scale.set(stats.w + 0.2, 1, stats.h + 0.2);
      ghostFrame.position.y = 0.08;
      ghostGroup.visible = true;
    } else {
      ghostGroup.visible = false;
    }

    effects.update(dt);
    renderer.render(scene, camera);
    return { bars };
  }

  // ---- picking --------------------------------------------------------------------------------
  function pick(m: Match, player: number, fog: boolean, sx: number, sy: number, slop = 0): Entity | null {
    let best: Entity | null = null;
    let bestScore = Infinity;
    updateCamera();
    for (const e of m.entities) {
      if (!visibleTo(m, player, fog, e)) continue;
      const model = MODELS[e.type];
      const top = heightOf(e.type);
      const lift = model.altitude ?? 0;
      const unit = isUnit(e);
      const hs = halfSize(e);
      const ix = unit ? e.px + (e.x - e.px) * 0.5 : e.x;
      const iy = unit ? e.py + (e.y - e.py) * 0.5 : e.y;
      const heights = unit ? [lift + top * 0.3, lift + top * 0.75] : [0.1, top * 0.5, top * 0.95];
      let nearest = Infinity;
      for (const h of heights) {
        const p = intersect(sx, sy, h);
        if (p === null) continue;
        if (unit) {
          const reach = hs.hw * 1.2 + 0.15 + slop;
          const d = Math.hypot(p.x - ix, p.y - iy);
          if (d <= reach) nearest = Math.min(nearest, d / reach);
        } else {
          const dx = Math.abs(p.x - ix) - hs.hw - slop * 0.6;
          const dy = Math.abs(p.y - iy) - hs.hh - slop * 0.6;
          if (dx <= 0 && dy <= 0) nearest = Math.min(nearest, 0.5 + Math.max(dx, dy) * 0.01);
        }
      }
      if (nearest === Infinity) continue;
      const kind = unit ? 0 : e.owner >= 0 ? 1 : 2;
      const score = kind * 10 + nearest;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  function boxSelect(m: Match, player: number, x0: number, y0: number, x1: number, y1: number): Entity[] {
    updateCamera();
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const units: Entity[] = [];
    const buildings: Entity[] = [];
    for (const e of m.entities) {
      if (!e.alive || e.owner !== player) continue;
      const unit = isUnit(e);
      if (!unit && !isBuilding(e)) continue;
      const p = project(e.x, e.y, (MODELS[e.type].altitude ?? 0) + heightOf(e.type) * 0.4);
      if (p === null) continue;
      const pad = unit ? 6 : 0;
      if (p.x >= left - pad && p.x <= right + pad && p.y >= top - pad && p.y <= bottom + pad) (unit ? units : buildings).push(e);
    }
    return units.length > 0 ? units : buildings;
  }

  function viewQuad(): Screen2D[] {
    updateCamera();
    const corners: [number, number][] = [
      [0, 0],
      [world.width, 0],
      [world.width, world.height],
      [0, world.height],
    ];
    const out: Screen2D[] = [];
    for (const [sx, sy] of corners) out.push(intersect(sx, sy, 0) ?? { x: cam.x, y: cam.y });
    return out;
  }

  return {
    canvas,
    effects,
    cam,

    load(map) {
      terrain?.dispose();
      if (terrain !== null) scene.remove(terrain.group);
      groundTexture?.dispose();
      mapSize = map.size;
      fogMap = createFogMap(mapSize);
      groundTexture = makeGroundTexture(map);
      const next = createMaterials(fogMap.texture, mapSize, groundTexture);
      // Materials are swapped in place so existing meshes keep working.
      materials = next;
      terrain = buildTerrain(map, next.ground, next.lit);
      scene.add(terrain.group);
      for (const part of allParts) part.mesh.material = part.part.glow === true ? next.glow : next.lit;
      for (const mesh of [shadowDisc, shadowRect]) mesh.material = next.shadow;
      for (const mesh of [ringMesh, frameMesh]) mesh.material = next.flat;
      for (const mesh of [poleMesh, flagMesh]) mesh.material = next.lit;
      fogShown = null;
      yaws.clear();
      loaded = true;
      cam.x = map.size / 2;
      cam.y = map.size / 2;
      clampCamera();
    },

    layout(fit) {
      const width = Math.max(2, Math.round(world.width * fit.scale));
      const height = Math.max(2, Math.round(world.height * fit.scale));
      const left = Math.round(fit.offsetX);
      const top = Math.round(fit.offsetY);
      const ratio = Math.min(window.devicePixelRatio || 1, maxRatio) * quality;
      if (width !== lastWidth || height !== lastHeight || fit.scale !== lastScale || ratio !== lastRatio) {
        renderer.setPixelRatio(ratio);
        lastRatio = ratio;
        renderer.setSize(width, height, false);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.setViewOffset(width, height, 0, Math.round(height * VIEW_SHIFT), width, height);
        camera.updateProjectionMatrix();
        lastWidth = width;
        lastHeight = height;
        lastScale = fit.scale;
      }
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
    },

    draw(input) {
      if (!loaded) return { bars: [] };
      return draw(input);
    },

    groundAt(sx, sy) {
      updateCamera();
      return intersect(sx, sy, 0);
    },

    project(x, y, h = 0) {
      updateCamera();
      return project(x, y, h);
    },

    projectEntity(e) {
      updateCamera();
      return project(e.x, e.y, (MODELS[e.type].altitude ?? 0) + MODELS[e.type].height * 0.5);
    },

    pick,
    boxSelect,
    viewQuad,
    clampCamera,
    fogBrightness: (x, y) => fogMap.valueAt(x, y),
    setQuality(scale) {
      quality = Math.min(1, Math.max(0.5, scale));
    },

    dispose() {
      terrain?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
