/** Turns what happened in the simulation into what you see (and, through the hooks, hear and feel). */
import type { Match, MatchEvent } from './sim';
import { actorColor, muzzlePoint, type World3d } from './view';

/** What the flow wants to know about, beyond the pictures. */
export interface Hooks {
  event(ev: MatchEvent): void;
}

export function showEvent(world: World3d, match: Match, ev: MatchEvent, viewer: number, hooks?: Hooks): void {
  const fx = world.effects;
  const teamMode = match.mode === 'tdm';
  switch (ev.type) {
    case 'fire': {
      const a = match.actors[ev.actor];
      if (a === undefined) break;
      if (ev.actor === viewer) world.kick(ev.weapon);
      else {
        const p = muzzlePoint(a);
        fx.muzzle(p.x, p.y, p.z, ev.weapon, 0.55);
      }
      break;
    }
    case 'bullet': {
      // Your own tracers are hidden for the first fraction of their length, so they do not cross your face.
      fx.tracer(ev.weapon, ev.fx, ev.fy, ev.fz, ev.tx, ev.ty, ev.tz);
      if (ev.hit !== 'none') fx.impact(ev.hit, ev.tx, ev.ty, ev.tz, ev.nx, ev.ny, ev.nz, ev.victim);
      break;
    }
    case 'explosion':
      fx.explosion(ev.x, ev.y, ev.z);
      world.characters.blast(ev.x, ev.y, ev.z);
      break;
    case 'hit':
      if (ev.killed) world.characters.noteHit(ev.victim, { weapon: ev.weapon, fromYaw: ev.fromYaw, damage: ev.damage, head: ev.head });
      break;
    case 'death': {
      const a = match.actors[ev.actor];
      if (a !== undefined) fx.death(ev.x, ev.y, ev.z, actorColor(a.id, a.team, teamMode));
      world.characters.kill(match, ev.actor);
      break;
    }
    case 'spawn': {
      const a = match.actors[ev.actor];
      if (a !== undefined) fx.spawn(ev.x, ev.y, ev.z, actorColor(a.id, a.team, teamMode));
      break;
    }
    case 'pickup':
      fx.pickup(ev.x, 0, ev.z, 0xffffff);
      break;
    default:
  }
  hooks?.event(ev);
}
