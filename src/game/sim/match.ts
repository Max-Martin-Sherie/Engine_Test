/** A match: setting one up, and advancing it one tick (1/60 s) at a time. */
import { createRng, nextFloat } from '../../engine/core/rng';
import { ACTOR, BOT_NAMES, DT, LOADOUT, MODES, PICKUP, START_RESERVE, WEAPONS, WEAPON_IDS, sec, type Difficulty, type Mode } from './config';
import { NavGrid, generateArena, heightAt } from './arena';
import { createBrain, thinkBot } from './bots';
import { lineOfSight, moveActor } from './physics';
import { giveWeapon, updateProjectiles, updateWeapons } from './weapons';
import { noInput, type Actor, type Input, type Match } from './types';

export interface MatchOptions {
  seed: number;
  mode?: Mode;
  difficulty?: Difficulty;
  /** How many computer players. */
  bots?: number;
  /** Is there a person playing (actor 0)? Without one it is bots only. */
  human?: boolean;
}

function newActor(id: number, name: string, team: number, human: boolean, difficulty: Difficulty): Actor {
  return {
    id,
    name,
    team,
    human,
    alive: false,
    x: 0,
    y: 0,
    z: 0,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    health: ACTOR.health,
    armor: 0,
    weapons: WEAPON_IDS.map(() => ({ owned: false, mag: 0, reserve: 0 })),
    current: 1,
    cooldown: 0,
    reloading: 0,
    equipping: 0,
    bloom: 0,
    trigger: false,
    aiming: false,
    protect: 0,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
    streak: 0,
    damageDealt: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    lastHurtBy: -1,
    lastHurtTick: -1000,
    stride: 0,
    input: noInput(),
    brain: human ? null : createBrain(difficulty),
  };
}

export function createMatch(options: MatchOptions): Match {
  const mode = options.mode ?? 'ffa';
  const difficulty = options.difficulty ?? 'normal';
  const human = options.human ?? true;
  const botCount = Math.max(1, Math.min(BOT_NAMES.length, options.bots ?? 5));
  const arena = generateArena(options.seed);
  const total = botCount + (human ? 1 : 0);
  const actors: Actor[] = [];
  for (let i = 0; i < total; i++) {
    const isHuman = human && i === 0;
    // Teams alternate (you are on team 0), so both sides are as even as they can be.
    const team = mode === 'tdm' ? i % 2 : i;
    actors.push(newActor(i, isHuman ? 'You' : (BOT_NAMES[(i - (human ? 1 : 0) + options.seed) % BOT_NAMES.length] ?? `Bot ${i}`), team, isHuman, difficulty));
  }
  // Names must be different.
  const used = new Set<string>();
  for (const a of actors) {
    let name = a.name;
    for (let k = 0; used.has(name); k++) name = `${a.name}${k + 2}`;
    a.name = name;
    used.add(name);
  }
  const m: Match = {
    seed: options.seed,
    tick: 0,
    rng: createRng(options.seed ^ 0xa5ce0),
    arena,
    nav: new NavGrid(arena),
    mode,
    difficulty,
    actors,
    pickups: arena.pickups.map((p) => ({ kind: p.kind, x: p.x, z: p.z, y: heightAt(arena, p.x, p.z), active: true, backAt: 0 })),
    projectiles: [],
    nextProjectile: 1,
    events: [],
    sounds: [],
    scores: mode === 'tdm' ? [0, 0] : actors.map(() => 0),
    scoreLimit: MODES[mode].scoreLimit,
    timeLeft: sec(MODES[mode].time),
    winner: -1,
    human: human ? 0 : -1,
  };
  for (const a of actors) spawnActor(m, a);
  m.events.length = 0;
  return m;
}

/** The start for an actor: far from the enemy and out of their sight, on their own side in a team match. */
export function pickSpawn(m: Match, a: Actor): { x: number; z: number; yaw: number } {
  let candidates = m.arena.spawns.filter((s) => m.mode !== 'tdm' || s.team === a.team);
  if (candidates.length === 0) candidates = m.arena.spawns;
  if (candidates.length === 0) return { x: m.arena.size / 2, z: m.arena.size / 2, yaw: 0 };
  let scored = candidates.map((s) => {
    let nearest = Infinity;
    let seen = 0;
    for (const o of m.actors) {
      if (o === a || !o.alive || o.team === a.team) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      nearest = Math.min(nearest, d);
      if (d < 40 && lineOfSight(m.arena, s.x, 1.6, s.z, o.x, o.y + 1.4, o.z)) seen += 1;
    }
    // Nobody may be standing in it.
    const crowded = m.actors.some((o) => o !== a && o.alive && Math.hypot(o.x - s.x, o.z - s.z) < 1.4);
    return { s, score: (crowded ? -1000 : 0) + Math.min(nearest, 60) - seen * 18 };
  });
  scored = scored.sort((p, q) => q.score - p.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  const pick = top[Math.floor(nextFloat(m.rng) * top.length)] ?? scored[0]!;
  return { x: pick.s.x, z: pick.s.z, yaw: pick.s.yaw };
}

export function spawnActor(m: Match, a: Actor): void {
  const s = pickSpawn(m, a);
  a.x = s.x;
  a.z = s.z;
  a.y = heightAt(m.arena, s.x, s.z);
  a.px = a.x;
  a.py = a.y;
  a.pz = a.z;
  a.vx = 0;
  a.vy = 0;
  a.vz = 0;
  a.yaw = s.yaw;
  a.pitch = 0;
  a.onGround = true;
  a.health = ACTOR.health;
  a.armor = 0;
  for (const w of a.weapons) {
    w.owned = false;
    w.mag = 0;
    w.reserve = 0;
  }
  for (const id of LOADOUT) giveWeapon(a, id, START_RESERVE);
  a.current = WEAPON_IDS.indexOf('rifle');
  a.cooldown = 0;
  a.reloading = 0;
  a.equipping = sec(WEAPONS.rifle.equip);
  a.bloom = 0;
  a.trigger = false;
  a.aiming = false;
  a.protect = sec(ACTOR.protect);
  a.alive = true;
  a.lastHurtBy = -1;
  if (a.brain !== null) {
    a.brain.target = -1;
    a.brain.hasGoal = false;
    a.brain.path = [];
    a.brain.aimYaw = a.yaw;
    a.brain.aimPitch = 0;
  }
  m.events.push({ type: 'spawn', actor: a.id, x: a.x, y: a.y, z: a.z });
}

/** Bodies do not walk through each other. */
function separate(m: Match): void {
  const list = m.actors;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      if (!b.alive || Math.abs(a.y - b.y) > 1.6) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const min = ACTOR.radius * 2;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = (min - d) / 2;
      const ux = d > 0.001 ? dx / d : 1;
      const uz = d > 0.001 ? dz / d : 0;
      for (const [o, sign] of [[a, -1], [b, 1]] as const) {
        const nx = o.x + ux * push * sign;
        const nz = o.z + uz * push * sign;
        if (heightAt(m.arena, nx, nz) <= o.y + ACTOR.step) {
          o.x = nx;
          o.z = nz;
        }
      }
    }
  }
}

function updatePickups(m: Match): void {
  for (const p of m.pickups) {
    if (!p.active) {
      if (m.tick >= p.backAt) p.active = true;
      continue;
    }
    for (const a of m.actors) {
      if (!a.alive || Math.abs(a.y - p.y) > 1.5 || Math.hypot(a.x - p.x, a.z - p.z) > PICKUP.radius) continue;
      let taken = false;
      if (p.kind === 'health') {
        if (a.health < ACTOR.health) {
          a.health = Math.min(ACTOR.health, a.health + PICKUP.health);
          taken = true;
        }
      } else if (p.kind === 'armor') {
        if (a.armor < ACTOR.armorMax) {
          a.armor = Math.min(ACTOR.armorMax, a.armor + PICKUP.armor);
          taken = true;
        }
      } else if (p.kind === 'ammo') {
        for (const id of WEAPON_IDS) {
          const def = WEAPONS[id];
          const slot = a.weapons[WEAPON_IDS.indexOf(id)]!;
          if (slot.owned && Number.isFinite(def.reserve) && slot.reserve < def.reserve) {
            giveWeapon(a, id, PICKUP.ammo);
            taken = true;
          }
        }
      } else {
        const slot = a.weapons[WEAPON_IDS.indexOf(p.kind)]!;
        const def = WEAPONS[p.kind];
        if (!slot.owned || (Number.isFinite(def.reserve) && slot.reserve < def.reserve)) {
          giveWeapon(a, p.kind, 0.5);
          taken = true;
        }
      }
      if (taken) {
        p.active = false;
        p.backAt = m.tick + sec(PICKUP.respawn[p.kind] ?? 20);
        m.events.push({ type: 'pickup', actor: a.id, kind: p.kind, x: p.x, z: p.z });
        break;
      }
    }
  }
}

function checkEnd(m: Match): void {
  const lead = Math.max(...m.scores);
  const limitHit = lead >= m.scoreLimit;
  if (!limitHit && m.timeLeft > 0) return;
  const leaders = m.scores.map((s, i) => (s === lead ? i : -1)).filter((i) => i >= 0);
  // Time up with the top score shared is a draw; reaching the limit first (even by the same tick) wins.
  m.winner = leaders.length === 1 || limitHit ? (leaders[0] ?? -2) : -2;
  m.events.push({ type: 'end', winner: m.winner });
}

/**
 * Advances the match one tick. `humanInput` is what the person is doing (ignored when it is bots only). Nothing
 * happens once the match is over.
 */
export function stepMatch(m: Match, humanInput?: Input): void {
  if (m.winner !== -1) return;
  m.tick += 1;
  m.timeLeft = Math.max(0, m.timeLeft - 1);
  while (m.sounds.length > 0 && m.tick - m.sounds[0]!.tick > 90) m.sounds.shift();

  // Whoever acts first in a tick has the edge in a duel, so the order alternates.
  const odd = (m.tick & 1) === 1;
  const count = m.actors.length;
  for (let n = 0; n < count; n++) {
    const a = m.actors[odd ? count - 1 - n : n]!;
    if (!a.alive) {
      if (m.tick >= a.respawnAt) spawnActor(m, a);
      continue;
    }
    if (a.protect > 0) a.protect -= 1;
    const input = a.human ? sanitize(humanInput ?? noInput()) : thinkBot(m, a);
    a.input = input;
    moveActor(m.arena, a, input, DT, m.events);
    updateWeapons(m, a, input);
  }
  separate(m);
  updateProjectiles(m, DT);
  updatePickups(m);
  checkEnd(m);
}

/** Keeps a person's input inside what the rules allow. */
function sanitize(i: Input): Input {
  const cl = (v: number): number => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  return { ...i, moveX: cl(i.moveX), moveZ: cl(i.moveZ), yaw: Number.isFinite(i.yaw) ? i.yaw : 0, pitch: Number.isFinite(i.pitch) ? i.pitch : 0 };
}

export const drainEvents = (m: Match): Match['events'] => {
  const out = m.events.slice();
  m.events.length = 0;
  return out;
};

/** A short text that changes if anything about the match changes (for checking two runs were the same). */
export function fingerprint(m: Match): string {
  const parts = [m.tick, m.winner, m.scores.join(',')];
  for (const a of m.actors) parts.push(`${a.id}:${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}:${Math.round(a.health)}:${a.kills}/${a.deaths}`);
  return parts.join('|');
}
