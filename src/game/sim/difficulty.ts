import { CONFIG } from './config';

/** Seconds between rock spawns after `time` seconds survived. Shrinks, then holds at the floor. */
export function spawnInterval(time: number): number {
  const { startInterval, minInterval, shrinkPerSecond } = CONFIG.spawn;
  return Math.max(minInterval, startInterval - shrinkPerSecond * time);
}

/** Base fall speed (units/s) after `time` seconds survived. Rises, then holds at the cap. */
export function fallSpeed(time: number): number {
  const { startSpeed, maxSpeed, gainPerSecond } = CONFIG.fall;
  return Math.min(maxSpeed, startSpeed + gainPerSecond * time);
}
