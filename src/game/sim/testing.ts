/**
 * Helpers that only tests use: an empty arena to build a scene in, and placing people exactly. Nothing in the game
 * imports this file.
 */
import { ARENA } from './config';
import { NavGrid, type Arena } from './arena';
import { heightAt } from './arena';
import type { Actor, Match } from './types';

/** A flat floor inside a tall wall, nothing else. Set `heights` to build a scene. */
export function emptyArena(): Arena {
  const size = ARENA.size;
  const heights = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    heights[i] = ARENA.wall;
    heights[(size - 1) * size + i] = ARENA.wall;
    heights[i * size] = ARENA.wall;
    heights[i * size + size - 1] = ARENA.wall;
  }
  return { seed: 0, size, heights, rects: [], spawns: [{ x: 6.5, z: 6.5, yaw: 0, team: 0 }, { x: 6.5, z: 41.5, yaw: 0, team: 0 }, { x: 41.5, z: 6.5, yaw: 0, team: 1 }, { x: 41.5, z: 41.5, yaw: 0, team: 1 }], pickups: [], waypoints: [{ x: 12.5, z: 12.5 }, { x: 35.5, z: 35.5 }, { x: 12.5, z: 35.5 }, { x: 35.5, z: 12.5 }], attempt: 0 };
}

/** A solid block of cells. */
export function setBox(arena: Arena, x0: number, z0: number, w: number, d: number, h: number): void {
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) arena.heights[z * arena.size + x] = h;
}

/** Swaps a match's arena for a plain one (so a test can set the scene), keeping everything else. */
export function useArena(m: Match, arena: Arena): void {
  m.arena = arena;
  m.nav = new NavGrid(arena);
  for (const p of m.pickups) p.active = false;
}

/** Puts someone exactly somewhere, standing, safe from being shot at spawn. */
export function place(m: Match, a: Actor, x: number, z: number, yaw = 0, pitch = 0): void {
  a.x = x;
  a.z = z;
  a.y = heightAt(m.arena, x, z);
  a.px = a.x;
  a.py = a.y;
  a.pz = a.z;
  a.vx = 0;
  a.vy = 0;
  a.vz = 0;
  a.yaw = yaw;
  a.pitch = pitch;
  a.onGround = true;
  a.protect = 0;
  a.equipping = 0;
  a.cooldown = 0;
  a.alive = true;
  if (a.brain !== null) {
    a.brain.aimYaw = yaw;
    a.brain.aimPitch = pitch;
    a.brain.hasGoal = false;
    a.brain.path = [];
    a.brain.target = -1;
  }
}

export * from './index';
