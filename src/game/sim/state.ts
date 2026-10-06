/** The shape of a match in progress, and the small questions every system asks about it. */
import type { RngState } from '../../engine/core/rng';
import { BUILDINGS, UNITS, type BuildingStats, type BuildingType, type Difficulty, type EntityType, type UnitStats, type UnitType } from './config';
import type { GameMap } from './map';
import type { Pathfinder } from './path';
import type { Entity, MatchEvent, Player } from './types';

export interface AiState {
  /** Tick of the last decision. */
  last: number;
  /** Supply the next attack wave waits for. */
  wave: number;
  /** Are we mid-attack (the army is out there)? */
  attacking: boolean;
  /** Last tick a wave set off. */
  sentAt: number;
  /** Ticks to wait before trying to build the same thing again after a failure. */
  cooldown: number;
}

export interface Match {
  map: GameMap;
  seed: number;
  tick: number;
  rng: RngState;
  entities: Entity[];
  byId: Map<number, Entity>;
  nextId: number;
  players: Player[];
  /** 1 where nothing can walk: rock, buildings and resources. */
  blocked: Uint8Array;
  /** Bumped when a building goes down or comes up, so units know to check their routes. */
  pathVersion: number;
  /** Per player: 0 never seen, 1 seen before, 2 in sight now. */
  vision: Uint8Array[];
  events: MatchEvent[];
  /** -1 while playing; 0 or 1 when that player has won. */
  winner: number;
  pathfinder: Pathfinder;
  difficulty: [Difficulty, Difficulty];
  ai: AiState[];
  /** The tick each player was last told "you are under attack" (to space out the warnings). */
  attackAlertAt: number[];
  /** Units bucketed by cell, rebuilt each tick: finding neighbours without comparing everyone. */
  buckets: Map<number, number[]>;
}

export const isUnit = (e: Entity): boolean => e.type in UNITS;
export const isBuilding = (e: Entity): boolean => e.type in BUILDINGS;
export const isResource = (e: Entity): boolean => e.type === 'minerals' || e.type === 'geyser';

export const unitStats = (e: Entity): UnitStats => UNITS[e.type as UnitType];
export const buildingStats = (e: Entity): BuildingStats => BUILDINGS[e.type as BuildingType];

/** Is this unit in the air? */
export const isAir = (e: Entity): boolean => isUnit(e) && unitStats(e).air;

/** Half the footprint's size, for buildings and resources; the body radius for units. */
export function halfSize(e: Entity): { hw: number; hh: number } {
  if (isUnit(e)) {
    const r = unitStats(e).radius;
    return { hw: r, hh: r };
  }
  if (isBuilding(e)) {
    const s = buildingStats(e);
    return { hw: s.w / 2, hh: s.h / 2 };
  }
  return e.type === 'geyser' ? { hw: 1.5, hh: 1.5 } : { hw: 0.5, hh: 0.5 };
}

/** Distance between the edges of two entities (0 when they touch), treating buildings as boxes and units as discs. */
export function gap(a: Entity, b: Entity): number {
  const ha = halfSize(a);
  const hb = halfSize(b);
  const aBox = !isUnit(a);
  const bBox = !isUnit(b);
  // Distance from each one's centre to the other's surface, handled per shape.
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const ex = Math.max(0, dx - (aBox ? ha.hw : 0) - (bBox ? hb.hw : 0));
  const ey = Math.max(0, dy - (aBox ? ha.hh : 0) - (bBox ? hb.hh : 0));
  const centreGap = Math.sqrt(ex * ex + ey * ey);
  const discs = (aBox ? 0 : ha.hw) + (bBox ? 0 : hb.hw);
  return Math.max(0, centreGap - discs);
}

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export const get = (m: Match, id: number): Entity | undefined => {
  const e = m.byId.get(id);
  return e !== undefined && e.alive ? e : undefined;
};

export const typeName = (type: EntityType): string => (type in UNITS ? UNITS[type as UnitType].name : type in BUILDINGS ? BUILDINGS[type as BuildingType].name : type === 'minerals' ? 'Minerals' : 'Geyser');
