/**
 * What everything looks like: each unit, building and resource is a handful of simple solids (boxes, cylinders, cones,
 * domes) in one team colour or a fixed colour. There are no model files and no textures; the shapes are described here
 * and the 3D world turns them into instanced meshes (one draw call per part).
 *
 * Sizes are in cells (the map's grid). A unit faces +x before it is turned; a part's (x, y, z) is its centre measured
 * from the middle of the entity on the ground (y is up, z is the map's y).
 */
import type { Entity, EntityType } from '../sim';

export type Shape = 'box' | 'cyl' | 'cone' | 'sphere' | 'oct' | 'dome';
export type PartColor = number | 'team' | 'teamDark';

export interface Part {
  shape: Shape;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: PartColor;
  /** Drawn without shading (lights, crystals, glass). */
  glow?: boolean;
  rotY?: number;
  rotZ?: number;
  /** Turns with the entity's facing. Units turn whole; a building turns only the parts marked so (a turret's head). */
  spin?: boolean;
  show?: (e: Entity) => boolean;
}

export interface Model {
  parts: readonly Part[];
  /** How tall it stands, for health bars and picking. */
  height: number;
  /** Floats this far above the ground. */
  altitude?: number;
  /** Size multiplier (a mined-down mineral patch is smaller). */
  scale?: (e: Entity) => number;
}

/** Units are drawn a little larger than the cell they take up, so they read at a distance. */
const UNIT_SCALE = 1.3;

const METAL = 0x2a2f3c;
const STEEL = 0x5b657c;
const PLATE = 0x7b86a0;
const LIGHT = 0xcfd6e6;
const GLASS = 0x6fe3ff;

type Extra = Partial<Pick<Part, 'glow' | 'rotY' | 'rotZ' | 'spin' | 'show'>>;

/** A part sitting on a level: (x, z) is its middle, `y` its bottom edge. */
function on(shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number, color: PartColor, extra: Extra = {}): Part {
  return { shape, x, y: y + h / 2, z, w, h, d, color, ...extra };
}

/** A part placed by its centre. */
function at(shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number, color: PartColor, extra: Extra = {}): Part {
  return { shape, x, y, z, w, h, d, color, ...extra };
}

const worker: Model = {
  scale: () => UNIT_SCALE,
  height: 0.7,
  parts: [
    on('box', 0, 0, 0, 0.52, 0.12, 0.42, METAL),
    on('box', 0, 0.12, 0, 0.44, 0.26, 0.36, LIGHT),
    on('box', 0, 0.3, 0, 0.46, 0.07, 0.38, 'team'),
    on('dome', 0.1, 0.38, 0, 0.3, 0.2, 0.3, PLATE),
    on('box', 0.3, 0.26, 0.15, 0.3, 0.06, 0.07, STEEL, { rotZ: -0.5 }),
    on('box', -0.19, 0.38, 0, 0.18, 0.15, 0.2, 0x45e6ff, { glow: true, show: (e) => e.carry > 0 }),
  ],
};

const trooper: Model = {
  scale: () => UNIT_SCALE,
  height: 0.78,
  parts: [
    on('box', 0.02, 0, 0, 0.24, 0.14, 0.3, METAL),
    on('box', 0, 0.14, 0, 0.28, 0.3, 0.36, 'team'),
    on('sphere', 0.02, 0.44, 0, 0.3, 0.3, 0.3, 0x39425a),
    on('box', 0.14, 0.5, 0, 0.08, 0.07, 0.2, GLASS, { glow: true }),
    on('box', 0.26, 0.28, 0.18, 0.5, 0.07, 0.07, 0x161a24),
    on('box', -0.17, 0.18, 0, 0.1, 0.22, 0.2, 'teamDark'),
  ],
};

const tank: Model = {
  scale: () => UNIT_SCALE,
  height: 0.8,
  parts: [
    on('box', 0, 0, -0.42, 1.08, 0.24, 0.24, 0x1b1e27),
    on('box', 0, 0, 0.42, 1.08, 0.24, 0.24, 0x1b1e27),
    on('box', 0, 0.1, 0, 0.98, 0.24, 0.64, STEEL),
    on('box', -0.05, 0.34, 0, 0.55, 0.05, 0.5, 'team'),
    on('box', 0.04, 0.38, 0, 0.52, 0.22, 0.48, PLATE, { spin: true }),
    on('cyl', 0.62, 0.55, 0, 0.1, 0.78, 0.1, 0x1b1e27, { rotZ: Math.PI / 2, spin: true }),
    on('box', -0.2, 0.6, 0.12, 0.12, 0.1, 0.12, 'teamDark', { spin: true }),
  ],
};

const skiff: Model = {
  scale: () => UNIT_SCALE,
  height: 0.5,
  altitude: 2.1,
  parts: [
    at('cone', 0.05, 0.15, 0, 0.4, 1.1, 0.4, LIGHT, { rotZ: -Math.PI / 2 }),
    at('box', -0.18, 0.12, 0, 0.5, 0.04, 1.2, 0x8f9ab4),
    at('box', -0.22, 0.14, 0.58, 0.34, 0.06, 0.12, 'team'),
    at('box', -0.22, 0.14, -0.58, 0.34, 0.06, 0.12, 'team'),
    at('sphere', 0.12, 0.27, 0, 0.26, 0.2, 0.22, GLASS, { glow: true }),
    at('box', -0.55, 0.15, 0, 0.14, 0.14, 0.26, 0xff9a4d, { glow: true }),
    at('box', -0.3, 0.3, 0, 0.3, 0.14, 0.06, 'teamDark'),
  ],
};

const hub: Model = {
  height: 2.4,
  parts: [
    on('box', 0, 0, 0, 3.9, 0.22, 3.9, METAL),
    on('box', 0, 0.22, 0, 3.0, 0.9, 3.0, STEEL),
    on('box', 0, 0.8, 0, 3.12, 0.16, 3.12, 'team'),
    on('dome', 0, 1.12, 0, 2.0, 0.9, 2.0, 0x98a5c0),
    on('cyl', 0.6, 1.9, 0.6, 0.1, 0.7, 0.1, STEEL),
    on('sphere', 0.6, 2.55, 0.6, 0.22, 0.22, 0.22, 'team', { glow: true }),
    on('cyl', 1.6, 0.22, 1.6, 0.34, 0.85, 0.34, 0x3a4256),
    on('cyl', -1.6, 0.22, 1.6, 0.34, 0.85, 0.34, 0x3a4256),
    on('cyl', 1.6, 0.22, -1.6, 0.34, 0.85, 0.34, 0x3a4256),
    on('cyl', -1.6, 0.22, -1.6, 0.34, 0.85, 0.34, 0x3a4256),
    on('sphere', 1.6, 1.0, 1.6, 0.26, 0.26, 0.26, 'team', { glow: true }),
    on('sphere', -1.6, 1.0, 1.6, 0.26, 0.26, 0.26, 'team', { glow: true }),
    on('sphere', 1.6, 1.0, -1.6, 0.26, 0.26, 0.26, 'team', { glow: true }),
    on('sphere', -1.6, 1.0, -1.6, 0.26, 0.26, 0.26, 'team', { glow: true }),
    on('box', 1.5, 0.22, 0, 0.1, 0.55, 0.9, 0x161a24),
  ],
};

const depot: Model = {
  height: 1.0,
  parts: [
    on('box', 0, 0, 0, 1.9, 0.14, 1.9, METAL),
    on('box', 0, 0.14, 0, 1.5, 0.7, 1.5, PLATE),
    on('box', 0, 0.5, 0, 1.56, 0.12, 1.56, 'team'),
    on('box', 0, 0.84, 0, 0.9, 0.1, 0.9, METAL),
    on('cyl', 0.4, 0.94, 0.4, 0.2, 0.18, 0.2, STEEL),
    on('sphere', -0.4, 0.84, -0.4, 0.2, 0.2, 0.2, 'team', { glow: true }),
  ],
};

const barracks: Model = {
  height: 1.5,
  parts: [
    on('box', 0, 0, 0, 2.9, 0.16, 2.9, METAL),
    on('box', -0.12, 0.16, 0, 2.3, 0.9, 2.1, PLATE),
    on('box', -0.12, 0.98, 0, 2.44, 0.14, 2.24, 0x3a4256),
    on('box', 1.06, 0.16, 0, 0.12, 0.62, 0.9, 0x161a24),
    on('box', 1.0, 0.8, 0, 0.14, 0.2, 1.2, 'team'),
    on('box', -0.12, 0.62, 1.08, 2.0, 0.12, 0.08, 'team'),
    on('cyl', -0.8, 1.1, -0.6, 0.3, 0.55, 0.3, STEEL),
    on('box', 0.4, 1.1, 0.4, 0.8, 0.18, 0.6, 0x2a2f3c),
  ],
};

const refinery: Model = {
  height: 1.6,
  parts: [
    on('cyl', 0, 0, 0, 2.8, 0.18, 2.8, METAL),
    on('cyl', -0.45, 0.18, -0.3, 1.2, 1.0, 1.2, 0x8a96ad),
    on('dome', -0.45, 1.18, -0.3, 1.2, 0.35, 1.2, 0x9aa6bd),
    on('cyl', 0.65, 0.18, 0.55, 0.8, 0.7, 0.8, 0x7a86a0),
    on('box', 0.1, 0.5, 0.2, 1.3, 0.12, 0.14, STEEL, { rotY: 0.5 }),
    on('box', 0, 0.18, 1.2, 1.6, 0.2, 0.2, 'team'),
    on('cyl', 0, 0.18, 0, 0.55, 0.14, 0.55, 0x7dff6a, { glow: true }),
    on('sphere', 0.65, 0.9, 0.55, 0.22, 0.22, 0.22, 0x7dff6a, { glow: true }),
  ],
};

const factory: Model = {
  height: 1.9,
  parts: [
    on('box', 0, 0, 0, 2.9, 0.16, 2.9, METAL),
    on('box', -0.1, 0.16, 0.1, 2.6, 1.0, 2.3, PLATE),
    on('box', -0.1, 1.16, -0.5, 2.6, 0.3, 0.6, 0x3a4256),
    on('box', -0.1, 1.16, 0.2, 2.6, 0.2, 0.6, 0x3a4256),
    on('box', -0.1, 0.9, 1.26, 2.2, 0.14, 0.1, 'team'),
    on('cyl', 0.9, 1.2, -0.8, 0.4, 0.75, 0.4, STEEL),
    on('cyl', 0.9, 1.9, -0.8, 0.5, 0.08, 0.5, 'team'),
    on('box', 1.3, 0.16, 0.4, 0.14, 0.8, 1.2, 0x161a24),
    on('box', -1.1, 0.16, -1.2, 0.3, 1.5, 0.3, 'teamDark'),
  ],
};

const airfield: Model = {
  height: 2.0,
  parts: [
    on('box', 0, 0, 0, 2.95, 0.12, 2.95, METAL),
    on('cyl', -0.1, 0.12, 0.15, 2.0, 0.05, 2.0, 'teamDark'),
    on('cyl', -0.1, 0.17, 0.15, 1.3, 0.04, 1.3, METAL),
    on('box', 1.0, 0.12, -1.0, 0.45, 1.5, 0.45, STEEL),
    on('box', 1.0, 1.6, -1.0, 0.9, 0.3, 0.9, 'team'),
    at('box', 1.0, 1.78, -1.0, 0.95, 0.06, 0.95, GLASS, { glow: true }),
    on('box', -1.05, 0.12, -0.9, 0.9, 0.6, 1.0, PLATE),
    on('dome', -1.05, 0.72, -0.9, 0.9, 0.3, 1.0, 0x8f9ab4),
  ],
};

const turret: Model = {
  height: 1.3,
  parts: [
    on('cyl', 0, 0, 0, 1.7, 0.22, 1.7, METAL),
    on('cyl', 0, 0.22, 0, 0.7, 0.4, 0.7, STEEL),
    on('box', 0, 0.62, 0, 0.8, 0.34, 0.6, 'team', { spin: true }),
    on('cyl', 0.62, 0.72, 0.16, 0.1, 0.7, 0.1, 0x161a24, { rotZ: Math.PI / 2, spin: true }),
    on('cyl', 0.62, 0.72, -0.16, 0.1, 0.7, 0.1, 0x161a24, { rotZ: Math.PI / 2, spin: true }),
    on('sphere', -0.2, 0.96, 0, 0.2, 0.2, 0.2, GLASS, { glow: true, spin: true }),
  ],
};

const mineralsModel: Model = {
  height: 0.9,
  scale: (e) => 0.55 + 0.45 * Math.min(1, Math.max(0, e.amount / 1500)),
  parts: [
    on('oct', 0, 0, 0, 0.62, 0.95, 0.62, 0x37bfe0),
    on('oct', 0.24, 0, 0.2, 0.4, 0.62, 0.4, 0x7ae8ff),
    on('oct', -0.22, 0, 0.18, 0.36, 0.5, 0.36, 0x2aa6c9),
    on('oct', 0.02, 0, -0.26, 0.34, 0.48, 0.34, 0x5ad8f5),
    on('cyl', 0, 0, 0, 0.95, 0.08, 0.95, 0x2b3347),
  ],
};

const geyser: Model = {
  height: 0.5,
  parts: [
    on('cyl', 0, 0, 0, 2.6, 0.12, 2.6, 0x1c212c),
    on('cyl', 0, 0.12, 0, 1.5, 0.1, 1.5, 0x10141c),
    on('cyl', 0, 0.2, 0, 0.95, 0.12, 0.95, 0x7dff6a, { glow: true }),
    on('cone', 0, 0.3, 0, 0.5, 0.7, 0.5, 0x9dffa0, { glow: true }),
  ],
};

export const MODELS: Record<EntityType, Model> = {
  worker,
  trooper,
  tank,
  skiff,
  hub,
  depot,
  barracks,
  refinery,
  factory,
  airfield,
  turret,
  minerals: mineralsModel,
  geyser,
};

/** How tall an entity stands (for placing its health bar). */
export const heightOf = (type: EntityType): number => (MODELS[type].altitude ?? 0) + MODELS[type].height;
