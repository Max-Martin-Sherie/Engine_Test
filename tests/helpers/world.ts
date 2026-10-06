import {
  addEntityForTests,
  recomputeSupply,
  updateVision,
  createMatch,
  drainEvents,
  stepMatch,
  type BuildingType,
  type Entity,
  type EntityType,
  type Match,
  type MatchEvent,
  type UnitType,
} from '../../src/game/sim/testing';

/** A match with nobody controlling either side, so a test decides everything. */
export function quiet(seed = 1, open = false): Match {
  const m = createMatch({ seed, ai: [false, false] });
  // Take everything off the map except the hubs and minerals: tests put in what they need.
  for (const e of m.entities) if (e.type === 'worker') e.alive = false;
  m.entities = m.entities.filter((e) => e.alive);
  m.byId.clear();
  for (const e of m.entities) m.byId.set(e.id, e);
  if (open) {
    // No rock inside the border: a flat arena for a fight or a march.
    const s = m.map.size;
    for (let y = 2; y < s - 2; y++) {
      for (let x = 2; x < s - 2; x++) {
        if (m.map.rock[y * s + x] === 1) {
          m.map.rock[y * s + x] = 0;
          m.blocked[y * s + x] = 0;
        }
      }
    }
  }
  recomputeSupply(m);
  updateVision(m);
  return m;
}

/** Runs the match for some seconds and returns every event that happened. */
export function run(m: Match, seconds: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  const ticks = Math.round(seconds * 20);
  for (let i = 0; i < ticks; i++) {
    stepMatch(m);
    events.push(...drainEvents(m));
  }
  return events;
}

export function unit(m: Match, type: UnitType, owner: number, x: number, y: number): Entity {
  const e = addEntityForTests(m, type, owner, x, y, true);
  recomputeSupply(m);
  updateVision(m);
  return e;
}

/** A building, finished or not, at a position. */
export function building(m: Match, type: BuildingType, owner: number, x: number, y: number, finished = true): Entity {
  const e = addEntityForTests(m, type, owner, x, y, finished);
  recomputeSupply(m);
  updateVision(m);
  return e;
}

export const find = (m: Match, type: EntityType, owner: number): Entity | undefined => m.entities.find((e) => e.alive && e.type === type && e.owner === owner);
export const all = (m: Match, type: EntityType, owner: number): Entity[] => m.entities.filter((e) => e.alive && e.type === type && e.owner === owner);

/** The middle of the open ground just south-east of a player's hub: a safe place to stage a test. */
export function openGround(m: Match, owner: number): { x: number; y: number } {
  const hub = find(m, 'hub', owner)!;
  const toward = hub.x < m.map.size / 2 ? 1 : -1;
  return { x: hub.x + toward * 9, y: hub.y + (hub.y < m.map.size / 2 ? 9 : -9) };
}

/** Give a side plenty of everything. */
export function rich(m: Match, owner: number): void {
  const p = m.players[owner]!;
  p.minerals = 5000;
  p.gas = 5000;
}

/** Light up the whole map for a player, so fog does not get in the way. */
export function reveal(m: Match, owner: number): void {
  m.vision[owner]!.fill(2);
}

/** The middle of the map: with `quiet(seed, true)` it is open ground all around. */
export const ARENA = { x: 48, y: 48 };
