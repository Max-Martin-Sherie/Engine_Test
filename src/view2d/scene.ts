/**
 * GAME: how Rockfall looks. gameView.ts (engine) creates the Pixi app, letterboxes the 360x640
 * world and calls `update` once per frame. Read `state`, never write it.
 */
import { Container, Graphics } from 'pixi.js';
import { CONFIG, type GameState } from '../sim';
import { COLORS } from './palette';
import { drawRock, type RockLook } from './rockArt';

const { width: W, height: H } = CONFIG.world;

/** Where the ground strip starts; rocks sink into it below the player. */
const GROUND_Y = 596;
const STREAK_COUNT = 16;

export interface Scene {
  /** Updates the display objects for `state`; the engine renders right after. */
  update(state: GameState, alpha: number): void;
}

interface RockSprite {
  g: Graphics;
  look: RockLook;
}

interface Streak {
  g: Graphics;
  x: number;
  length: number;
  speed: number;
  phase: number;
}

/** Fixed, hand-picked pseudo-random numbers so the backdrop looks the same every run. */
function streakSpec(i: number): Omit<Streak, 'g'> {
  const a = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const b = Math.sin((i + 1) * 78.233) * 12345.6789;
  const c = Math.sin((i + 1) * 39.346) * 98765.4321;
  const frac = (v: number): number => v - Math.floor(v);
  return {
    x: 14 + frac(a) * (W - 28),
    length: 28 + frac(b) * 70,
    speed: 18 + frac(c) * 46,
    phase: frac(a * b) * (H + 100),
  };
}

export function createScene(field: Container): Scene {
  const streakLayer = new Container();
  const rockLayer = new Container();
  const ground = new Graphics()
    .rect(0, GROUND_Y, W, H - GROUND_Y)
    .fill(COLORS.ground)
    .rect(0, GROUND_Y, W, 2)
    .fill(COLORS.groundEdge);
  const playerLayer = new Container();
  field.addChild(streakLayer, rockLayer, ground, playerLayer);

  const streaks: Streak[] = [];
  for (let i = 0; i < STREAK_COUNT; i++) {
    const spec = streakSpec(i);
    const g = new Graphics().roundRect(-1, 0, 2, spec.length, 1).fill(COLORS.streak);
    g.alpha = 0.14 + (i % 3) * 0.05;
    streakLayer.addChild(g);
    streaks.push({ g, ...spec });
  }

  // Player: sand pebble with a rim, a highlight and two eyes that glance the way it moves.
  const r = CONFIG.player.radius;
  const shield = new Graphics().circle(0, 0, r + 7).stroke({ width: 2, color: COLORS.sand, alpha: 0.7 });
  const body = new Graphics()
    .circle(0, 0, r)
    .fill(COLORS.sand)
    .circle(0, 0, r - 1)
    .stroke({ width: 2, color: COLORS.sandDark })
    .circle(-r * 0.32, -r * 0.4, r * 0.3)
    .fill({ color: COLORS.sandLight, alpha: 0.75 });
  const eyes = new Graphics()
    .circle(-r * 0.3, 0, r * 0.15)
    .fill(COLORS.ink)
    .circle(r * 0.3, 0, r * 0.15)
    .fill(COLORS.ink);
  const player = new Container();
  player.addChild(shield, body, eyes);
  playerLayer.addChild(player);

  // Rocks: pooled Graphics keyed by sim id.
  const active = new Map<number, RockSprite>();
  const free: RockSprite[] = [];
  const seen = new Set<number>();

  function acquireRock(id: number, radius: number): RockSprite {
    const sprite = free.pop() ?? { g: new Graphics(), look: { angle0: 0, spin: 0 } };
    sprite.look = drawRock(sprite.g, id, radius);
    sprite.g.visible = true;
    rockLayer.addChild(sprite.g);
    return sprite;
  }

  return {
    update(state, alpha) {
      const time = (state.tick + alpha) * CONFIG.dt;

      // Backdrop streaks drift down with the run's clock, so they freeze when the player dies.
      for (const s of streaks) {
        const span = H + 100 + s.length;
        s.g.position.set(s.x, ((s.phase + time * s.speed) % span) - s.length);
      }

      seen.clear();
      for (const rock of state.rocks) {
        seen.add(rock.id);
        let sprite = active.get(rock.id);
        if (sprite === undefined) {
          sprite = acquireRock(rock.id, rock.r);
          active.set(rock.id, sprite);
        }
        sprite.g.position.set(
          rock.prevX + (rock.x - rock.prevX) * alpha,
          rock.prevY + (rock.y - rock.prevY) * alpha,
        );
        sprite.g.rotation = sprite.look.angle0 + sprite.look.spin * time;
      }
      for (const [id, sprite] of active) {
        if (seen.has(id)) continue;
        sprite.g.visible = false;
        rockLayer.removeChild(sprite.g);
        free.push(sprite);
        active.delete(id);
      }

      const p = state.player;
      player.position.set(p.prevX + (p.x - p.prevX) * alpha, p.y);
      eyes.position.set(Math.max(-3, Math.min(3, (p.x - p.prevX) * 1.2)), 0);
      body.tint = state.alive ? 0xffffff : 0xff9a86;
      const invulnerable = state.invuln > 0;
      shield.visible = invulnerable;
      // Blink while invulnerable (derived from state, so it is deterministic).
      player.alpha = invulnerable && Math.floor(state.invuln * 10) % 2 === 0 ? 0.3 : 1;
    },
  };
}
