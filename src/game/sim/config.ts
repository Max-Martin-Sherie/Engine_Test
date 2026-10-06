/**
 * Every number that defines how Nova Frontier plays. Units: cells (the map is a grid, one cell = one unit),
 * seconds converted to ticks (`sec`), and per-tick speeds.
 */

export const TPS = 20;
export const DT = 1 / TPS;
/** Whole ticks in a number of seconds. */
export const sec = (seconds: number): number => Math.max(1, Math.round(seconds * TPS));

export type UnitType = 'worker' | 'trooper' | 'tank' | 'skiff';
export type BuildingType = 'hub' | 'depot' | 'barracks' | 'refinery' | 'factory' | 'airfield' | 'turret';
export type ResourceType = 'minerals' | 'geyser';
export type EntityType = UnitType | BuildingType | ResourceType;

export const UNIT_TYPES: readonly UnitType[] = ['worker', 'trooper', 'tank', 'skiff'];
export const BUILDING_TYPES: readonly BuildingType[] = ['hub', 'depot', 'barracks', 'refinery', 'factory', 'airfield', 'turret'];

export interface Cost {
  minerals: number;
  gas: number;
}

export interface Weapon {
  damage: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Cells, edge to edge. */
  range: number;
  air: boolean;
  ground: boolean;
  /** Cells around the target that also take half damage (ground units only). */
  splash?: number;
}

export interface UnitStats {
  name: string;
  cost: Cost;
  supply: number;
  /** Ticks to train. */
  time: number;
  hp: number;
  /** Cells per tick. */
  speed: number;
  radius: number;
  armor: number;
  vision: number;
  air: boolean;
  weapon: Weapon | null;
  producedBy: BuildingType;
  blurb: string;
}

export interface BuildingStats {
  name: string;
  cost: Cost;
  /** Ticks to build. */
  time: number;
  hp: number;
  /** Footprint in cells. */
  w: number;
  h: number;
  /** Supply provided once finished. */
  supply: number;
  armor: number;
  vision: number;
  /** A finished building of this type the owner must have. */
  requires: BuildingType | null;
  produces: readonly UnitType[];
  weapon: Weapon | null;
  blurb: string;
}

export const UNITS: Record<UnitType, UnitStats> = {
  worker: {
    name: 'Worker',
    cost: { minerals: 50, gas: 0 },
    supply: 1,
    time: sec(12),
    hp: 40,
    speed: 3.0 / TPS,
    radius: 0.35,
    armor: 0,
    vision: 8,
    air: false,
    weapon: { damage: 5, cooldown: sec(1), range: 0.9, air: false, ground: true },
    producedBy: 'hub',
    blurb: 'Mines minerals and builds. Weak in a fight.',
  },
  trooper: {
    name: 'Trooper',
    cost: { minerals: 50, gas: 0 },
    supply: 1,
    time: sec(10),
    hp: 55,
    speed: 3.2 / TPS,
    radius: 0.38,
    armor: 0,
    vision: 9,
    air: false,
    weapon: { damage: 7, cooldown: sec(0.6), range: 5.5, air: true, ground: true },
    producedBy: 'barracks',
    blurb: 'Cheap rifleman. Hits ground and air.',
  },
  tank: {
    name: 'Tank',
    cost: { minerals: 150, gas: 100 },
    supply: 3,
    time: sec(22),
    hp: 170,
    speed: 2.4 / TPS,
    radius: 0.65,
    armor: 1,
    vision: 10,
    air: false,
    weapon: { damage: 30, cooldown: sec(1.6), range: 8, air: false, ground: true, splash: 1.3 },
    producedBy: 'factory',
    blurb: 'Heavy cannon with splash. Ground targets only.',
  },
  skiff: {
    name: 'Skiff',
    cost: { minerals: 125, gas: 100 },
    supply: 2,
    time: sec(20),
    hp: 95,
    speed: 4.6 / TPS,
    radius: 0.5,
    armor: 0,
    vision: 11,
    air: true,
    weapon: { damage: 9, cooldown: sec(0.9), range: 5.5, air: true, ground: true },
    producedBy: 'airfield',
    blurb: 'Fast flyer. Ignores terrain. Hits ground and air.',
  },
};

export const BUILDINGS: Record<BuildingType, BuildingStats> = {
  hub: {
    name: 'Hub',
    cost: { minerals: 400, gas: 0 },
    time: sec(50),
    hp: 1400,
    w: 4,
    h: 4,
    supply: 10,
    armor: 1,
    vision: 11,
    requires: null,
    produces: ['worker'],
    weapon: null,
    blurb: 'Trains workers, receives minerals, gives 10 supply.',
  },
  depot: {
    name: 'Depot',
    cost: { minerals: 100, gas: 0 },
    time: sec(14),
    hp: 400,
    w: 2,
    h: 2,
    supply: 8,
    armor: 1,
    vision: 6,
    requires: null,
    produces: [],
    weapon: null,
    blurb: 'Gives 8 supply.',
  },
  barracks: {
    name: 'Barracks',
    cost: { minerals: 150, gas: 0 },
    time: sec(28),
    hp: 800,
    w: 3,
    h: 3,
    supply: 0,
    armor: 1,
    vision: 8,
    requires: 'hub',
    produces: ['trooper'],
    weapon: null,
    blurb: 'Trains troopers. Unlocks factory and turret.',
  },
  refinery: {
    name: 'Refinery',
    cost: { minerals: 75, gas: 0 },
    time: sec(18),
    hp: 500,
    w: 3,
    h: 3,
    supply: 0,
    armor: 1,
    vision: 6,
    requires: 'hub',
    produces: [],
    weapon: null,
    blurb: 'Built on a geyser. Produces gas.',
  },
  factory: {
    name: 'Factory',
    cost: { minerals: 150, gas: 100 },
    time: sec(32),
    hp: 900,
    w: 3,
    h: 3,
    supply: 0,
    armor: 1,
    vision: 8,
    requires: 'barracks',
    produces: ['tank'],
    weapon: null,
    blurb: 'Builds tanks. Unlocks airfield.',
  },
  airfield: {
    name: 'Airfield',
    cost: { minerals: 150, gas: 100 },
    time: sec(32),
    hp: 800,
    w: 3,
    h: 3,
    supply: 0,
    armor: 1,
    vision: 8,
    requires: 'factory',
    produces: ['skiff'],
    weapon: null,
    blurb: 'Builds skiffs.',
  },
  turret: {
    name: 'Turret',
    cost: { minerals: 100, gas: 0 },
    time: sec(18),
    hp: 350,
    w: 2,
    h: 2,
    supply: 0,
    armor: 2,
    vision: 11,
    requires: 'barracks',
    produces: [],
    weapon: { damage: 12, cooldown: sec(0.8), range: 7.5, air: true, ground: true },
    blurb: 'Static defence. Hits ground and air.',
  },
};

export const ECONOMY = {
  startMinerals: 250,
  startWorkers: 4,
  /** Supply is capped here however many depots there are. */
  maxSupply: 120,
  patchMinerals: 1500,
  geyserRichness: 1,
  /** Minerals a worker carries per trip, and the ticks a trip's mining takes. */
  carry: 5,
  harvestTicks: sec(2.2),
  /** Gas a refinery makes per tick once built. */
  refineryRate: 1.6 / TPS,
  /** How many units can wait in a building's queue. */
  queueLimit: 5,
};

export const MAP = {
  size: 96,
  border: 2,
  /** Cells around a base hub kept free of rock. */
  clearRadius: 13,
  attempts: 12,
};

export const COMBAT = {
  /** Idle units notice enemies this far (cells) beyond their weapon range. */
  acquireExtra: 3.5,
  /** A ground unit is repathed when its target has moved this far. */
  chaseRepath: 2.5,
  /** Ticks without moving before a unit repaths. */
  stuckTicks: 24,
  separation: 0.35,
};

export const VISION = {
  /** Ticks between fog updates. */
  every: 4,
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiLevel {
  name: string;
  /** Ticks between decisions. */
  think: number;
  workers: number;
  /** First attack wave size in supply, and how much each next one grows. */
  wave: number;
  waveGrowth: number;
  /** Multiplier on what its workers deposit. */
  income: number;
  /** Barracks / factories / airfields it aims for. */
  barracks: number;
  factories: number;
  airfields: number;
  expandAt: number;
}

export const AI: Record<Difficulty, AiLevel> = {
  easy: { name: 'Easy', think: sec(2.5), workers: 12, wave: 14, waveGrowth: 6, income: 0.8, barracks: 2, factories: 1, airfields: 0, expandAt: 99 },
  normal: { name: 'Normal', think: sec(1.5), workers: 18, wave: 20, waveGrowth: 8, income: 1, barracks: 3, factories: 1, airfields: 1, expandAt: 16 },
  hard: { name: 'Hard', think: sec(1), workers: 24, wave: 24, waveGrowth: 10, income: 1.25, barracks: 4, factories: 2, airfields: 2, expandAt: 12 },
};
