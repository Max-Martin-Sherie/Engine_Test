/** Arena Zero (first look: bots fighting, watched from a chase camera). */
import type { GameFactory } from '../engine';
import { showEvent } from './feedback';
import { cellHeight, createMatch, drainEvents, lineOfSight, stepMatch, type Match } from './sim';
import { damageActor } from './sim/weapons';
import type { WeaponId } from './sim/config';
import { createWorld3d } from './view';

export const createGame: GameFactory = ({ view, world, params }) => {
  const seed = Number(params.get('seed')) || 3;
  const world3d = createWorld3d(view.host, world);
  let match: Match = createMatch({ seed, mode: params.get('mode') === 'ffa' ? 'ffa' : 'tdm', difficulty: 'normal', bots: 7, human: false });
  world3d.load(match);
  let time = 0;
  let follow = 0;
  let frames = 0;
  let frozen = false;
  let camera: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

  function update(): void {
    if (frozen) return;
    stepMatch(match);
    for (const ev of drainEvents(match)) showEvent(world3d, match, ev, -1);
    if (match.winner !== -1) {
      match = createMatch({ seed: seed + 1, mode: 'tdm', difficulty: 'normal', bots: 7, human: false });
      world3d.load(match);
    }
  }

  function render(alpha: number): void {
    time += 1 / 60;
    frames += 1;
    world3d.layout(view.fit());
    if (Math.floor(time / 9) % match.actors.length !== follow) follow = Math.floor(time / 9) % match.actors.length;
    const a = match.actors[follow]!;
    const x = a.px + (a.x - a.px) * alpha;
    const z = a.pz + (a.z - a.pz) * alpha;
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    world3d.draw({
      match,
      viewer: -1,
      pose: camera !== null ? { ...camera, roll: 0, fov: 60 } : { x: x - fx * 3.4, y: a.y + 2.3, z: z - fz * 3.4, yaw: a.yaw, pitch: -0.28, roll: 0, fov: 70 },
      alpha,
      dt: 1 / 60,
      time,
      gun: null,
    });
  }

  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__game', {
      configurable: true,
      value: {
        phase: 'demo',
        score: 0,
        alive: true,
        debug: {
          get frames() {
            return frames;
          },
          get match() {
            return match;
          },
          freeze(on: boolean) {
            frozen = on;
          },
          damage(victim: number, attacker: number, weapon: WeaponId, head: boolean, amount = 500) {
            const v = match.actors[victim]!;
            const k = match.actors[attacker]!;
            damageActor(match, v, amount, k, weapon, head, k.x, k.z);
            for (const ev of drainEvents(match)) showEvent(world3d, match, ev, -1);
          },
          /** Looks at an actor from `dist` metres away at `angle` (radians around it) and `height`. */
          lookAt(id: number, dist: number, angle: number, height: number) {
            const t = match.actors[id]!;
            const tx = t.x;
            const tz = t.z;
            let cx = tx;
            let cz = tz;
            const cy = t.y + height;
            for (let i = 0; i < 24; i++) {
              const ang = angle + (i * Math.PI * 2) / 24;
              cx = tx + Math.sin(ang) * dist;
              cz = tz + Math.cos(ang) * dist;
              if (cellHeight(match.arena, Math.floor(cx), Math.floor(cz)) < 0.3 && lineOfSight(match.arena, cx, cy, cz, tx, t.y + 1, tz)) break;
            }
            const yaw = Math.atan2(-(tx - cx), -(tz - cz));
            const pitch = Math.atan2(t.y + 1 - cy, Math.hypot(tx - cx, tz - cz));
            camera = { x: cx, y: cy, z: cz, yaw, pitch };
          },
          free() {
            camera = null;
          },
        },
      },
    });
  }

  return { step: 1 / 60, update, render };
};
