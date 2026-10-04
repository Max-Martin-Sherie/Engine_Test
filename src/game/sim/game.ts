/**
 * GAME: Rockfall's rules. The engine (step.ts) owns the lifecycle; this file holds the player,
 * the falling rocks and the collisions. Stay pure: randomness comes from `state.rng` only.
 */
import { nextRange } from '../../engine/core/rng';
import { CONFIG } from './config';
import { fallSpeed, spawnInterval } from './difficulty';
import type { GameState, Input } from './types';

export interface Rock {
  id: number;
  x: number;
  y: number;
  /** Position at the start of the latest step, for render interpolation. */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Player {
  x: number;
  y: number;
  prevX: number;
  r: number;
}

export interface GameData {
  player: Player;
  rocks: Rock[];
  /** Seconds until the next rock spawns. */
  spawnTimer: number;
  nextRockId: number;
}

const { width: W, height: H } = CONFIG.world;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function createGameData(): GameData {
  return {
    player: { x: W / 2, y: CONFIG.player.y, prevX: W / 2, r: CONFIG.player.radius },
    rocks: [],
    spawnTimer: CONFIG.spawn.firstDelay,
    nextRockId: 1,
  };
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

/** One fixed step of Rockfall. Returns true if a rock hit the player. */
export function updateGame(state: GameState, input: Input): boolean {
  const dt = CONFIG.dt;
  const time = state.tick * dt;

  // Player steers toward the pointer at a capped speed and stays inside the field.
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

  // Collisions, with a forgiving hitbox. Revive grace (state.invuln) protects the player.
  if (state.invuln > 0) return false;
  for (const rock of rocks) {
    const dx = rock.x - player.x;
    const dy = rock.y - player.y;
    const reach = (rock.r + player.r) * CONFIG.hitboxScale;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}

/** A revived player starts with a clean field and a short breather before the next rock. */
export function onRevive(state: GameState): void {
  state.rocks.length = 0;
  state.spawnTimer = CONFIG.spawn.firstDelay;
}

export function syncGamePrev(state: GameState): void {
  state.player.prevX = state.player.x;
  for (const rock of state.rocks) {
    rock.prevX = rock.x;
    rock.prevY = rock.y;
  }
}

export function debugSnapshot(state: GameState): Record<string, unknown> {
  return {
    playerX: state.player.x,
    rocks: state.rocks.map(({ id, x, y, r }) => ({ id, x, y, r })),
  };
}
