/**
 * Helpers that only tests use: they drop an entity straight into a match, bypassing the rules (cost, placement,
 * construction time), so a test can set the scene it wants. Nothing in the game imports this file.
 */
import { addEntity, newEntity } from './entities';
import type { EntityType } from './config';
import type { Match } from './state';
import type { Entity } from './types';

export function addEntityForTests(m: Match, type: EntityType, owner: number, x: number, y: number, finished = true): Entity {
  const e = newEntity(m, type, owner, x, y);
  if (!finished) {
    e.progress = 0;
    e.hp = Math.max(1, e.maxHp * 0.1);
  }
  return addEntity(m, e);
}

export { recomputeSupply } from './construction';
export { canTarget, weaponOf } from './combat';
export { damage, killEntity } from './entities';
export { updateVision } from './vision';
export * from './index';
