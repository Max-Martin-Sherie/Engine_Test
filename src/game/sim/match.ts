/** A match: setting one up, and advancing it by one tick. */
import { createRng } from '../../engine/core/rng';
import { stepAi } from './ai';
import { updateTurret } from './combat';
import { recomputeSupply, updateProduction, updateRefineries } from './construction';
import { leastBusyPatch, startGather } from './economy';
import { addEntity, newEntity, spawnUnit } from './entities';
import { generateMap } from './map';
import { updateUnit } from './orders';
import { Pathfinder } from './path';
import { ECONOMY, VISION, type Difficulty } from './config';
import { isBuilding, isUnit, type AiState, type Match } from './state';
import { bucketUnits, separate } from './units';
import { updateVision } from './vision';
import type { Player } from './types';

export interface MatchOptions {
  seed: number;
  /** Which sides the computer plays. Default: side 1 only. */
  ai?: [boolean, boolean];
  difficulty?: [Difficulty, Difficulty];
}

const newPlayer = (id: number, ai: boolean): Player => ({
  id,
  minerals: ECONOMY.startMinerals,
  gas: 0,
  gasFraction: 0,
  supplyUsed: 0,
  supplyCap: 0,
  ai,
  stats: { unitsKilled: 0, unitsLost: 0, buildingsKilled: 0, buildingsLost: 0, mined: 0, built: 0, trained: 0 },
  defeated: false,
});

const newAi = (): AiState => ({ last: 0, wave: 0, attacking: false, sentAt: 0, cooldown: 0 });

export function createMatch(options: MatchOptions): Match {
  const map = generateMap(options.seed);
  const ai = options.ai ?? [false, true];
  const m: Match = {
    map,
    seed: options.seed,
    tick: 0,
    rng: createRng(options.seed ^ 0x5eed),
    entities: [],
    byId: new Map(),
    nextId: 1,
    players: [newPlayer(0, ai[0]), newPlayer(1, ai[1])],
    blocked: map.rock.slice(),
    pathVersion: 0,
    vision: [new Uint8Array(map.size * map.size), new Uint8Array(map.size * map.size)],
    visionTick: -1,
    events: [],
    winner: -1,
    pathfinder: new Pathfinder(map.size),
    difficulty: options.difficulty ?? ['normal', 'normal'],
    ai: [newAi(), newAi()],
    attackAlertAt: [-1000, -1000],
    buckets: new Map(),
  };

  for (const r of map.resources) addEntity(m, newEntity(m, r.type, -1, r.x + 0.5, r.y + 0.5));

  for (const player of [0, 1]) {
    const base = map.bases[player]!;
    const hub = newEntity(m, 'hub', player, base.x, base.y);
    addEntity(m, hub);
    // The workers start just below the hub, on the side away from the minerals.
    for (let i = 0; i < ECONOMY.startWorkers; i++) {
      // Side 1 starts exactly where side 0 would be if the map were turned half way round.
      const sign = player === 0 ? 1 : -1;
      const w = spawnUnit(m, 'worker', player, base.x - sign * (1.6 - i * 1.1), base.y + sign * 2.8);
      const patch = leastBusyPatch(m, player, base.x, base.y, 12);
      if (patch !== undefined) startGather(m, w, patch);
    }
  }
  updateVision(m);
  recomputeSupply(m);
  m.events.length = 0;
  return m;
}

/** Has a side lost everything it builds? */
function checkVictory(m: Match): void {
  for (const p of m.players) {
    if (!p.defeated && !m.entities.some((e) => e.alive && e.owner === p.id && isBuilding(e))) p.defeated = true;
  }
  const [a, b] = m.players;
  if (a === undefined || b === undefined) return;
  if (a.defeated && b.defeated) m.winner = 2;
  else if (a.defeated) m.winner = 1;
  else if (b.defeated) m.winner = 0;
  if (m.winner >= 0) m.events.push({ type: 'victory', winner: m.winner });
}

/** Advances the match by one tick (1/20 s). Does nothing once someone has won. */
export function stepMatch(m: Match): void {
  if (m.winner >= 0) return;
  m.tick += 1;
  for (const e of m.entities) {
    e.px = e.x;
    e.py = e.y;
  }
  bucketUnits(m);

  // Whoever acts first in a tick has the edge in a fight (a kill stops the victim shooting back), so the order
  // alternates every tick: neither side is the favourite just for being listed first.
  const odd = (m.tick & 1) === 1;
  for (const p of odd ? [m.players[1]!, m.players[0]!] : m.players) if (p.ai) stepAi(m, p.id);

  const count = m.entities.length;
  for (let n = 0; n < count; n++) {
    const e = m.entities[odd ? count - 1 - n : n]!;
    if (!e.alive) continue;
    if (isUnit(e)) updateUnit(m, e);
    else if (isBuilding(e) && e.progress >= 1) updateTurret(m, e);
  }
  updateProduction(m);
  updateRefineries(m);
  separate(m);
  recomputeSupply(m);

  if (m.tick % VISION.every === 0) updateVision(m);
  if (m.tick % 20 === 0) checkVictory(m);
  if (m.tick % 200 === 0) {
    m.entities = m.entities.filter((e) => {
      if (e.alive) return true;
      m.byId.delete(e.id);
      return false;
    });
  }
}

/** Removes and returns the events since the last call. */
export function drainEvents(m: Match): Match['events'] {
  return m.events.splice(0, m.events.length);
}

/** A short fingerprint of the state, for tests that compare two runs. */
export function fingerprint(m: Match): string {
  let h = 2166136261;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0;
  };
  mix(m.tick);
  for (const e of m.entities) {
    if (!e.alive) continue;
    mix(e.id);
    mix(e.x);
    mix(e.y);
    mix(e.hp);
  }
  for (const p of m.players) {
    mix(p.minerals);
    mix(p.gas);
    mix(p.supplyUsed);
  }
  return `${h.toString(16)}:${m.entities.filter((e) => e.alive).length}`;
}
