/** What each side can see. Fog is a grid per player: 0 never seen, 1 seen before, 2 in sight right now. */
import { BUILDINGS, UNITS, VISION, type BuildingType, type UnitType } from './config';
import { isBuilding, isResource, isUnit, type Match } from './state';
import type { Entity } from './types';

const OFFSETS = new Map<number, number[]>();

/** The cell offsets inside a circle of the given radius (cached). */
function discOffsets(radius: number): number[] {
  const r = Math.ceil(radius);
  let list = OFFSETS.get(r);
  if (list === undefined) {
    list = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= radius * radius) list.push(dx, dy);
    OFFSETS.set(r, list);
  }
  return list;
}

export function visionRadius(e: Entity): number {
  if (isUnit(e)) return UNITS[e.type as UnitType].vision;
  if (isBuilding(e)) return e.progress >= 1 ? BUILDINGS[e.type as BuildingType].vision : 4;
  return 0;
}

/** Recomputes what both players can see. */
export function updateVision(m: Match): void {
  m.visionTick = m.tick;
  const s = m.map.size;
  for (let p = 0; p < m.vision.length; p++) {
    const grid = m.vision[p]!;
    for (let i = 0; i < grid.length; i++) if (grid[i] === 2) grid[i] = 1;
    for (const e of m.entities) {
      if (!e.alive || e.owner !== p) continue;
      const radius = visionRadius(e);
      if (radius <= 0) continue;
      const cx = Math.floor(e.x);
      const cy = Math.floor(e.y);
      const offsets = discOffsets(radius);
      for (let i = 0; i < offsets.length; i += 2) {
        const x = cx + (offsets[i] ?? 0);
        const y = cy + (offsets[i + 1] ?? 0);
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        grid[y * s + x] = 2;
      }
    }
  }
}

/** How well a player can see a cell: 0, 1 or 2. */
export function fogAt(m: Match, player: number, x: number, y: number): number {
  const s = m.map.size;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= s || cy >= s) return 0;
  return m.vision[player]?.[cy * s + cx] ?? 0;
}

/**
 * Can this player see the entity? Their own things, always. Resources and buildings once the ground has been seen.
 * Units only while in sight right now.
 */
export function canSee(m: Match, player: number, e: Entity): boolean {
  if (e.owner === player) return true;
  const fog = fogAt(m, player, e.x, e.y);
  if (isResource(e) || isBuilding(e)) return fog >= 1;
  return fog === 2;
}

export const VISION_EVERY = VISION.every;
