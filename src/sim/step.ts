import { createRng, nextRange } from '../core/rng';
import { CONFIG } from './config';
import { fallSpeed, spawnInterval } from './difficulty';
import type { GameEvent, GameState, Input } from './types';

const { width: W, height: H } = CONFIG.world;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function createState(seed: number): GameState {
  return {
    seed: seed >>> 0,
    tick: 0,
    alive: true,
    player: { x: W / 2, y: CONFIG.player.y, prevX: W / 2, r: CONFIG.player.radius },
    rocks: [],
    spawnTimer: CONFIG.spawn.firstDelay,
    nextRockId: 1,
    invuln: 0,
    reviveUsed: false,
    rng: createRng(seed),
    events: [],
  };
}

/** Seconds survived (continuous). */
export function timeOf(state: GameState): number {
  return state.tick * CONFIG.dt;
}

/** The score: whole seconds survived. */
export function scoreOf(state: GameState): number {
  return Math.floor(state.tick / CONFIG.ticksPerSecond);
}

/** Returns the pending events and clears them. */
export function drainEvents(state: GameState): GameEvent[] {
  return state.events.splice(0, state.events.length);
}

/** Makes "previous" equal "current", so a render at any alpha shows exactly the current state. */
function syncPrev(state: GameState): void {
  state.player.prevX = state.player.x;
  for (const rock of state.rocks) {
    rock.prevX = rock.x;
    rock.prevY = rock.y;
  }
}

function spawnRock(state: GameState, time: number): void {
  const { rng } = state;
  const { minRadius, maxRadius, maxDrift, speedJitter } = CONFIG.rocks;
  const r = nextRange(rng, minRadius, maxRadius);
  const x = nextRange(rng, r, W - r);
  const vx = nextRange(rng, -maxDrift, maxDrift);
  const vy = fallSpeed(time) * nextRange(rng, 1 - speedJitter, 1 + speedJitter);
  state.rocks.push({ id: state.nextRockId++, x, y: -r, prevX: x, prevY: -r, vx, vy, r });
}

/** Advances the game by one fixed step. Does nothing while dead. */
export function step(state: GameState, input: Input): void {
  if (!state.alive) return;

  const dt = CONFIG.dt;
  state.tick += 1;
  const time = timeOf(state);

  // Player steers toward the target at a capped speed and stays inside the field.
  const player = state.player;
  player.prevX = player.x;
  const target = input.targetX;
  if (target !== null && Number.isFinite(target)) {
    const maxMove = CONFIG.player.maxSpeed * dt;
    player.x += clamp(target - player.x, -maxMove, maxMove);
  }
  player.x = clamp(player.x, player.r, W - player.r);

  // Spawn.
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnRock(state, time);
    state.spawnTimer += spawnInterval(time);
  }

  // Move rocks (bouncing off the side walls) and drop the ones that left the bottom.
  const rocks = state.rocks;
  let kept = 0;
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock === undefined) continue;
    rock.prevX = rock.x;
    rock.prevY = rock.y;
    rock.x += rock.vx * dt;
    rock.y += rock.vy * dt;
    if (rock.x < rock.r) {
      rock.x = rock.r;
      rock.vx = -rock.vx;
    } else if (rock.x > W - rock.r) {
      rock.x = W - rock.r;
      rock.vx = -rock.vx;
    }
    if (rock.y - rock.r <= H) rocks[kept++] = rock;
  }
  rocks.length = kept;

  // Revive grace.
  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);

  // Collisions, with a forgiving hitbox.
  if (state.invuln <= 0) {
    for (const rock of rocks) {
      const dx = rock.x - player.x;
      const dy = rock.y - player.y;
      const reach = (rock.r + player.r) * CONFIG.hitboxScale;
      if (dx * dx + dy * dy < reach * reach) {
        state.alive = false;
        state.events.push({ type: 'died', score: scoreOf(state) });
        syncPrev(state);
        return;
      }
    }
  }
}

/**
 * Brings a dead player back: clears every rock and grants a short invulnerability.
 * Works once per run. Returns whether the revive happened.
 */
export function revive(state: GameState): boolean {
  if (state.alive || state.reviveUsed) return false;
  state.alive = true;
  state.reviveUsed = true;
  state.rocks.length = 0;
  state.invuln = CONFIG.reviveGrace;
  state.spawnTimer = CONFIG.spawn.firstDelay;
  syncPrev(state);
  state.events.push({ type: 'revived' });
  return true;
}
