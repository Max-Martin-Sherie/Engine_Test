/**
 * The computer player. It plays by the same rules and uses the same commands as a person: it mines, builds,
 * trains and sends its army out in waves, but it never gets a free unit. (The harder levels do get more out
 * of each mining trip, and the easiest gets less.)
 */
import { AI, BUILDINGS, UNITS, type BuildingType, type UnitType } from './config';
import { cmdBuild, cmdMove, cmdTrain, ownUnits } from './commands';
import { checkPlacement, geyserAt, hasBuilt } from './construction';
import { leastBusyPatch, startGather } from './economy';
import { footprint, snapCentre } from './entities';
import { isBuilding, isUnit, unitStats, type Match } from './state';
import { fogAt } from './vision';
import type { Entity } from './types';

interface Census {
  mine: Entity[];
  workers: Entity[];
  hubs: Entity[];
  army: Entity[];
  armySupply: number;
}

const count = (list: Entity[], type: string, finishedOnly = false): number => list.filter((e) => e.type === type && (!finishedOnly || e.progress >= 1)).length;

function census(m: Match, player: number): Census {
  const mine = m.entities.filter((e) => e.alive && e.owner === player);
  const workers = mine.filter((e) => e.type === 'worker');
  const hubs = mine.filter((e) => e.type === 'hub' && e.progress >= 1);
  const army = mine.filter((e) => isUnit(e) && e.type !== 'worker');
  const armySupply = army.reduce((sum, u) => sum + unitStats(u).supply, 0);
  return { mine, workers, hubs, army, armySupply };
}

/** Money already promised to buildings workers are walking toward (their cost is only taken on arrival). */
function reserved(c: Census): { minerals: number; gas: number } {
  let minerals = 0;
  let gas = 0;
  for (const w of c.workers) {
    if (w.order.type !== 'build') continue;
    minerals += BUILDINGS[w.order.building].cost.minerals;
    gas += BUILDINGS[w.order.building].cost.gas;
  }
  return { minerals, gas };
}

/** Buildings of a type that are under way: being walked to, or going up. */
function pending(c: Census, type: BuildingType): number {
  const walking = c.workers.filter((w) => w.order.type === 'build' && w.order.building === type).length;
  const building = c.mine.filter((e) => e.type === type && e.progress < 1).length;
  return walking + building;
}

/** A spot for a building near a point: free, with a gap around it for walking, and not in the mining line. */
function findSpot(m: Match, player: number, type: BuildingType, near: { x: number; y: number }): { x: number; y: number } | null {
  const s = m.map.size;
  if (type === 'refinery') {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const g of m.entities) {
      if (!g.alive || g.type !== 'geyser') continue;
      const d = (g.x - near.x) * (g.x - near.x) + (g.y - near.y) * (g.y - near.y);
      if (d > 18 * 18 || d >= bestD) continue;
      if (!checkPlacement(m, player, 'refinery', g.x, g.y).ok) continue;
      bestD = d;
      best = g;
    }
    return best === null ? null : { x: best.x, y: best.y };
  }
  const patches = m.entities.filter((e) => e.alive && e.type === 'minerals');
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let r = 4; r <= 20; r += 1) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const spot = snapCentre(type, near.x + dx, near.y + dy);
        if (!checkPlacement(m, player, type, spot.x, spot.y).ok) continue;
        // Keep a free cell all around, so units can walk past.
        const f = footprint(type, spot.x, spot.y);
        let roomy = true;
        for (let y = f.y0 - 1; y <= f.y1 + 1 && roomy; y++) {
          for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
            if (x < 0 || y < 0 || x >= s || y >= s || m.blocked[y * s + x] === 1) {
              roomy = false;
              break;
            }
          }
        }
        if (!roomy) continue;
        if (type !== 'hub' && patches.some((p) => (p.x - spot.x) * (p.x - spot.x) + (p.y - spot.y) * (p.y - spot.y) < 5.5 * 5.5)) continue;
        const score = dx * dx + dy * dy;
        if (score < bestScore) {
          bestScore = score;
          best = spot;
        }
      }
    }
    if (best !== null && r >= 6) break;
  }
  return best;
}

/** Sends a worker (a miner by preference, the nearest to the spot) to build. */
function tryBuild(m: Match, player: number, c: Census, type: BuildingType, near: { x: number; y: number }): boolean {
  const spot = findSpot(m, player, type, near);
  if (spot === null) return false;
  let worker: Entity | null = null;
  let bestD = Infinity;
  for (const w of c.workers) {
    if (w.order.type === 'build' || w.order.type === 'construct') continue;
    const d = (w.x - spot.x) * (w.x - spot.x) + (w.y - spot.y) * (w.y - spot.y) + (w.carry > 0 ? 40 : 0);
    if (d < bestD) {
      bestD = d;
      worker = w;
    }
  }
  if (worker === null) return false;
  return cmdBuild(m, player, worker.id, type, spot.x, spot.y).ok;
}

/** Where the army waits: a little out from the main base toward the middle of the map. */
function staging(m: Match, c: Census): { x: number; y: number } {
  const home = c.hubs[0] ?? c.mine[0];
  const cx = m.map.size / 2;
  if (home === undefined) return { x: cx, y: cx };
  const dx = cx - home.x;
  const dy = cx - home.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: home.x + (dx / d) * 11, y: home.y + (dy / d) * 11 };
}

/** The nearest enemy building the player knows of, else an unexplored base, else the enemy's start. */
function attackTarget(m: Match, player: number, from: { x: number; y: number }): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const e of m.entities) {
    if (!e.alive || e.owner === player || e.owner < 0 || !isBuilding(e)) continue;
    if (fogAt(m, player, e.x, e.y) < 1) continue;
    const d = (e.x - from.x) * (e.x - from.x) + (e.y - from.y) * (e.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = { x: e.x, y: e.y };
    }
  }
  if (best !== null) return best;
  // No known buildings: go to where the enemy must have started; once that has been seen, look at the bases nobody has scouted.
  const enemyStart = m.map.bases[1 - player]!;
  if (fogAt(m, player, enemyStart.x, enemyStart.y) === 0) return { x: enemyStart.x, y: enemyStart.y };
  let unseen: { x: number; y: number } | null = null;
  let unseenD = Infinity;
  for (const b of m.map.bases) {
    if (b.start === player || fogAt(m, player, b.x, b.y) !== 0) continue;
    const d = (b.x - from.x) * (b.x - from.x) + (b.y - from.y) * (b.y - from.y);
    if (d < unseenD) {
      unseenD = d;
      unseen = { x: b.x, y: b.y };
    }
  }
  return unseen ?? { x: enemyStart.x, y: enemyStart.y };
}

/** An enemy unit near any of our buildings. */
function threat(m: Match, player: number, c: Census): { x: number; y: number } | null {
  for (const e of m.entities) {
    if (!e.alive || e.owner === player || e.owner < 0 || !isUnit(e) || fogAt(m, player, e.x, e.y) < 2) continue;
    for (const b of c.mine) {
      if (!isBuilding(b)) continue;
      if ((b.x - e.x) * (b.x - e.x) + (b.y - e.y) * (b.y - e.y) < 17 * 17) return { x: e.x, y: e.y };
    }
  }
  return null;
}

/** One decision round for one computer player. */
export function stepAi(m: Match, player: number): void {
  const level = AI[m.difficulty[player as 0 | 1]];
  const state = m.ai[player];
  const p = m.players[player];
  if (state === undefined || p === undefined || p.defeated) return;
  if (m.tick - state.last < level.think) return;
  state.last = m.tick;

  const c = census(m, player);
  const home = c.hubs[0];
  if (home === undefined) return;
  const spare = reserved(c);
  let minerals = p.minerals - spare.minerals;
  let gas = p.gas - spare.gas;

  // Idle workers go mining.
  for (const w of c.workers) {
    if (w.order.type !== 'idle') continue;
    const hub = c.hubs.reduce((best, h) => ((h.x - w.x) ** 2 + (h.y - w.y) ** 2 < (best.x - w.x) ** 2 + (best.y - w.y) ** 2 ? h : best), home);
    const patch = leastBusyPatch(m, player, hub.x, hub.y, 12);
    if (patch !== undefined) startGather(m, w, patch);
  }

  const queuedWorkers = c.hubs.reduce((sum, h) => sum + h.queue.filter((q) => q.type === 'worker').length, 0);
  const producers = c.mine.filter((e) => isBuilding(e) && BUILDINGS[e.type as BuildingType].produces.length > 0 && e.progress >= 1).length;
  const free = p.supplyCap - p.supplyUsed;

  // 1. Supply first: running out stops everything.
  if (free <= 3 + producers * 2 && p.supplyCap < 120 && pending(c, 'depot') === 0 && minerals >= BUILDINGS.depot.cost.minerals) {
    if (tryBuild(m, player, c, 'depot', home)) minerals -= BUILDINGS.depot.cost.minerals;
  }

  // 2. Workers.
  const workerGoal = Math.min(level.workers, c.hubs.length * 16 + 4);
  if (c.workers.length + queuedWorkers < workerGoal) {
    for (const h of c.hubs) {
      if (h.queue.length >= 2 || minerals < UNITS.worker.cost.minerals) continue;
      if (cmdTrain(m, player, h.id, 'worker').ok) minerals -= UNITS.worker.cost.minerals;
    }
  }

  // 3. Buildings, in the order a game usually needs them. `total` counts finished, going up, and being walked to.
  const total = (type: BuildingType): number => count(c.mine, type) + c.workers.filter((w) => w.order.type === 'build' && w.order.building === type).length;
  const wantRefineries = level.factories + level.airfields > 2 ? 2 : level.factories + level.airfields > 0 ? 1 : 0;
  const hasBarracks = hasBuilt(m, player, 'barracks');
  const want: { type: BuildingType; test: boolean }[] = [
    { type: 'barracks', test: total('barracks') < 1 },
    { type: 'refinery', test: hasBarracks && total('refinery') < wantRefineries && gas < 300 },
    { type: 'factory', test: hasBarracks && total('factory') < level.factories },
    { type: 'airfield', test: hasBuilt(m, player, 'factory') && total('airfield') < level.airfields },
    { type: 'barracks', test: c.workers.length >= 10 && total('barracks') < level.barracks && minerals > 220 },
    { type: 'turret', test: level.airfields > 1 && hasBarracks && total('turret') < c.hubs.length * 2 && c.armySupply > 14 },
    {
      type: 'hub',
      test: c.workers.length >= level.expandAt && total('hub') < 3 && minerals >= BUILDINGS.hub.cost.minerals + 50 && m.tick > 20 * 150,
    },
  ];
  for (const w of want) {
    if (!w.test) continue;
    const cost = BUILDINGS[w.type].cost;
    if (minerals < cost.minerals || gas < cost.gas) continue;
    if (w.type === 'hub') {
      // The nearest free base to home (so the two sides do not both go for the same one).
      const site = m.map.bases
        .filter((b) => b.start < 0 && !m.entities.some((e) => e.alive && e.type === 'hub' && Math.abs(e.x - b.x) < 3 && Math.abs(e.y - b.y) < 3) && checkPlacement(m, player, 'hub', b.x, b.y).ok)
        .sort((a, b) => (a.x - home.x) ** 2 + (a.y - home.y) ** 2 - ((b.x - home.x) ** 2 + (b.y - home.y) ** 2))[0];
      if (site !== undefined) {
        const here = c.workers[0];
        if (here !== undefined && cmdBuild(m, player, here.id, 'hub', site.x, site.y).ok) minerals -= cost.minerals;
      }
      continue;
    }
    if (tryBuild(m, player, c, w.type, w.type === 'turret' ? (c.hubs[c.hubs.length - 1] ?? home) : home)) {
      minerals -= cost.minerals;
      gas -= cost.gas;
    }
  }

  // 4. Army units from every producer that is not busy: the expensive ones first, and no spending at all while saving for a new hub.
  const saving = c.workers.length >= level.expandAt && total('hub') < 3 && m.tick > 20 * 150 && minerals < BUILDINGS.hub.cost.minerals + 50 && c.armySupply >= 12;
  const producersByCost = c.mine.slice().sort((a, b) => {
    const cost = (e: Entity): number => (BUILDINGS[e.type as BuildingType]?.produces[0] !== undefined ? UNITS[BUILDINGS[e.type as BuildingType].produces[0] as UnitType].cost.gas : -1);
    return cost(b) - cost(a);
  });
  for (const b of saving ? [] : producersByCost) {
    if (!isBuilding(b) || b.progress < 1 || b.queue.length >= 2) continue;
    const options = BUILDINGS[b.type as BuildingType].produces.filter((u) => u !== 'worker') as UnitType[];
    const pick = options[0];
    if (pick === undefined) continue;
    const cost = UNITS[pick].cost;
    if (minerals < cost.minerals || gas < cost.gas) {
      // Something expensive we have the gas for: save up for it instead of spending on cheap units.
      if (cost.gas > 0 && gas >= cost.gas) break;
      continue;
    }
    if (cmdTrain(m, player, b.id, pick).ok) {
      minerals -= cost.minerals;
      gas -= cost.gas;
    }
  }

  // 5. The army: defend, wait, and go in waves.
  const camp = staging(m, c);
  const danger = threat(m, player, c);
  if (danger !== null) {
    cmdMove(m, player, c.army.map((u) => u.id), danger.x, danger.y, true);
    return;
  }
  if (!state.attacking) {
    const idle = c.army.filter((u) => u.order.type === 'idle' && (u.x - camp.x) ** 2 + (u.y - camp.y) ** 2 > 10 * 10);
    if (idle.length > 0) cmdMove(m, player, idle.map((u) => u.id), camp.x, camp.y, true);
    if (state.wave === 0) state.wave = level.wave;
    if (c.armySupply >= state.wave) {
      state.attacking = true;
      state.sentAt = m.tick;
      const target = attackTarget(m, player, camp);
      cmdMove(m, player, c.army.map((u) => u.id), target.x, target.y, true);
    }
    return;
  }
  // Attacking: reinforce, retarget when the target is gone, or fall back when it is going badly.
  const target = attackTarget(m, player, camp);
  const lazy = c.army.filter((u) => u.order.type === 'idle');
  if (lazy.length > 0) cmdMove(m, player, lazy.map((u) => u.id), target.x, target.y, true);
  if (c.armySupply < Math.max(5, state.wave * 0.3) && m.tick - state.sentAt > 20 * 20) {
    state.attacking = false;
    state.wave += level.waveGrowth;
    cmdMove(m, player, c.army.map((u) => u.id), camp.x, camp.y, false);
  }
}

export { geyserAt, ownUnits };
