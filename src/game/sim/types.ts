import type { BuildingType, EntityType, ResourceType, UnitType } from './config';

export interface Vec {
  x: number;
  y: number;
}

/** What an entity is trying to do. Orders are plain data so the AI, the player and the tests all use them. */
export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  /** `auto` attacks start by themselves (an idle unit seeing an enemy) and are given up when the enemy gets away. */
  | { type: 'attack'; target: number; auto: boolean }
  | { type: 'hold' }
  | { type: 'gather'; target: number; phase: 'toResource' | 'harvest' | 'toDepot'; timer: number }
  /** Walk to a spot and put a building down. `site` is the building's id once it has started. */
  | { type: 'build'; building: BuildingType; x: number; y: number }
  /** Keep building an existing, unfinished building. */
  | { type: 'construct'; site: number };

export interface QueueItem {
  type: UnitType;
  /** Ticks left (only the first item counts down). */
  left: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  /** 0 or 1; -1 for neutral resources. */
  owner: number;
  x: number;
  y: number;
  /** Where it was at the start of the latest tick (for smooth drawing). */
  px: number;
  py: number;
  /** Facing as a unit vector (no angles in the sim). */
  fx: number;
  fy: number;
  hp: number;
  maxHp: number;
  alive: boolean;

  // ---- units
  order: Order;
  /** Waypoints still to walk: x0, y0, x1, y1, ... */
  path: number[];
  pathVersion: number;
  /** Where the current path was made for (to notice a moving target). */
  goalX: number;
  goalY: number;
  /** After an automatic fight, go back to an attack-move that was interrupted. */
  resume: Vec | null;
  /** How many times the way has been re-found while stuck. */
  retries: number;
  /** Ticks until the next shot. */
  cooldown: number;
  /** Minerals a worker is carrying. */
  carry: number;
  /** Ticks without making progress along a path. */
  stuck: number;
  lastX: number;
  lastY: number;
  /** The tick it was last hurt (the view flashes it). */
  hurtAt: number;

  // ---- buildings
  /** 0..1; a unit is always 1. */
  progress: number;
  /** The worker building it (-1 for none). */
  builder: number;
  queue: QueueItem[];
  rally: Vec | null;

  // ---- resources
  amount: number;
}

export interface Player {
  id: number;
  minerals: number;
  gas: number;
  /** Gas a refinery has made that is not yet a whole point. */
  gasFraction: number;
  supplyUsed: number;
  supplyCap: number;
  /** Is the computer playing this side? */
  ai: boolean;
  stats: { unitsKilled: number; unitsLost: number; buildingsKilled: number; buildingsLost: number; mined: number; built: number; trained: number };
  defeated: boolean;
}

export type MatchEvent =
  | { type: 'shot'; from: number; to: number; fx: number; fy: number; tx: number; ty: number; weapon: string; owner: number; air: boolean }
  | { type: 'death'; id: number; entity: EntityType; owner: number; x: number; y: number; killer: number }
  | { type: 'spawn'; id: number; entity: EntityType; owner: number; x: number; y: number }
  | { type: 'built'; id: number; entity: BuildingType; owner: number; x: number; y: number }
  | { type: 'started'; id: number; entity: BuildingType; owner: number; x: number; y: number }
  | { type: 'trained'; id: number; entity: UnitType; owner: number; x: number; y: number }
  | { type: 'deposit'; owner: number; x: number; y: number; amount: number }
  | { type: 'alert'; owner: number; kind: 'attack' | 'supply' | 'minerals' | 'gas' | 'requirement' | 'blocked' | 'queue'; x: number; y: number }
  | { type: 'depleted'; id: number; x: number; y: number }
  | { type: 'victory'; winner: number };

export type { BuildingType, EntityType, ResourceType, UnitType };
