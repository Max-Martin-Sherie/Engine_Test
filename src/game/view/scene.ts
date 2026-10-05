/**
 * How Echo Loop looks. The flow calls `update` once per frame with the run and tells the scene about events
 * (an orb taken, a death, a rewind) so it can add effects. The scene reads the run and never writes it.
 */
import { Container, Graphics } from 'pixi.js';
import { CONFIG, arenaBottom, arenaLeft, arenaRight, arenaTop, drifterX, drifterY, pulsarActive, pulsarWarning, type Arena, type Run } from '../sim';
import { COLORS, GATE_COLORS, ghostColor } from './palette';

const { width: W, height: H } = CONFIG.world;
const TRAIL_LENGTH = 22;
const MAX_PARTICLES = 420;

export interface Frame {
  /** The run on screen, or null on the menu (the scene then shows the empty arena backdrop). */
  run: Run | null;
  /** How far into the next fixed tick we are, for smooth motion. */
  alpha: number;
  /** Visual clock in seconds (keeps running while paused, so pulses stay alive). */
  now: number;
}

export interface Scene {
  update(frame: Frame): void;
  /** A new arena or a new loop: forget trails and effects. */
  reset(): void;
  orb(x: number, y: number, by: number, now: number): void;
  died(x: number, y: number, now: number): void;
  ghostDied(x: number, y: number, ghost: number, now: number): void;
  gate(gate: number, open: boolean, now: number): void;
  rewind(now: number): void;
  won(now: number): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: number;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  from: number;
  to: number;
  color: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export function createScene(field: Container): Scene {
  // Everything lives under `shaker` so a death can shake the whole picture.
  const shaker = new Container();
  const backdrop = new Graphics();
  const zones = new Graphics();
  const barriers = new Graphics();
  const plates = new Graphics();
  const orbs = new Graphics();
  const hazards = new Graphics();
  const trails = new Graphics();
  const movers = new Graphics();
  const fx = new Graphics();
  const overlay = new Graphics();
  shaker.addChild(backdrop, zones, barriers, plates, orbs, hazards, trails, movers, fx, overlay);
  field.addChild(shaker);

  // ---- the static backdrop: a dark field, a faint grid over the arena, and its frame -----------------
  backdrop.rect(0, 0, W, H).fill(COLORS.field);
  for (let i = 0; i < 6; i++) backdrop.circle(W / 2, (arenaTop + arenaBottom) / 2, 380 - i * 58).fill({ color: COLORS.fieldGlow, alpha: 0.18 });
  for (let x = arenaLeft; x <= arenaRight; x += CONFIG.grid.cell * 2) backdrop.moveTo(x, arenaTop).lineTo(x, arenaBottom);
  for (let y = arenaTop; y <= arenaBottom; y += CONFIG.grid.cell * 2) backdrop.moveTo(arenaLeft, y).lineTo(arenaRight, y);
  backdrop.stroke({ width: 1, color: COLORS.grid, alpha: 0.55 });
  backdrop.rect(arenaLeft, arenaTop, arenaRight - arenaLeft, arenaBottom - arenaTop).stroke({ width: 2, color: COLORS.frame, alpha: 0.9 });

  let arena: Arena | null = null;
  const particles: Particle[] = [];
  const rings: Ring[] = [];
  const trailPoints = new Map<string, { x: number; y: number }[]>();
  let lastTick = -1;
  let lastLoop = -1;
  let shakeStart = -10;
  let rewindStart = -10;

  function glow(g: Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
    g.circle(x, y, r * 2.4).fill({ color, alpha: alpha * 0.07 });
    g.circle(x, y, r * 1.7).fill({ color, alpha: alpha * 0.14 });
    g.circle(x, y, r * 1.25).fill({ color, alpha: alpha * 0.25 });
  }

  function burst(x: number, y: number, color: number, count: number, now: number, speed = 90): void {
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.7;
      const v = speed * (0.35 + ((i * 37) % 10) / 10);
      particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, born: now, life: 0.45 + ((i * 13) % 10) / 20, size: 1.4 + ((i * 7) % 4) * 0.5, color });
    }
  }

  function trailOf(key: string, x: number, y: number): { x: number; y: number }[] {
    let points = trailPoints.get(key);
    if (!points) {
      points = [];
      trailPoints.set(key, points);
    }
    const last = points[points.length - 1];
    if (!last || last.x !== x || last.y !== y) points.push({ x, y });
    if (points.length > TRAIL_LENGTH) points.shift();
    return points;
  }

  function drawTrail(key: string, x: number, y: number, color: number, alpha: number): void {
    const points = trailOf(key, x, y);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      trails.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1 + (i / points.length) * 3, color, alpha: alpha * (i / points.length) * 0.55, cap: 'round' });
    }
  }

  function drawArena(a: Arena, run: Run, now: number, vt: number): void {
    const { gates } = a;

    // Pulsar zones: faint when off, flickering just before they switch on, solid while on.
    for (const p of a.pulsars) {
      if (pulsarActive(p, vt)) {
        zones.circle(p.x, p.y, p.r).fill({ color: COLORS.danger, alpha: 0.3 });
        zones.circle(p.x, p.y, p.r).stroke({ width: 2, color: COLORS.danger, alpha: 0.95 });
      } else if (pulsarWarning(p, vt)) {
        const flicker = 0.35 + 0.35 * Math.sin(now * 40) * Math.sin(now * 40);
        zones.circle(p.x, p.y, p.r).stroke({ width: 2, color: COLORS.danger, alpha: flicker });
      } else {
        zones.circle(p.x, p.y, p.r).stroke({ width: 1, color: COLORS.danger, alpha: 0.16 });
      }
    }

    // Barriers: red walls with a coloured door that is a beam when shut and posts when open.
    gates.forEach((gate, i) => {
      const color = GATE_COLORS[i % GATE_COLORS.length] ?? COLORS.cyan;
      const open = run.open[i] === true;
      barriers.moveTo(arenaLeft, gate.y).lineTo(gate.doorX0, gate.y).moveTo(gate.doorX1, gate.y).lineTo(arenaRight, gate.y);
      barriers.stroke({ width: 7, color: COLORS.danger, alpha: 0.14 });
      barriers.moveTo(arenaLeft, gate.y).lineTo(gate.doorX0, gate.y).moveTo(gate.doorX1, gate.y).lineTo(arenaRight, gate.y);
      barriers.stroke({ width: 2.5, color: COLORS.danger, alpha: 0.95 });
      if (open) {
        barriers.moveTo(gate.doorX0, gate.y).lineTo(gate.doorX1, gate.y).stroke({ width: 1, color, alpha: 0.28 });
      } else {
        const pulse = 0.78 + 0.22 * Math.sin(now * 9 + i);
        barriers.moveTo(gate.doorX0, gate.y).lineTo(gate.doorX1, gate.y).stroke({ width: 9, color, alpha: 0.16 * pulse });
        barriers.moveTo(gate.doorX0, gate.y).lineTo(gate.doorX1, gate.y).stroke({ width: 3, color, alpha: pulse });
      }
      barriers.circle(gate.doorX0, gate.y, 3.5).fill(color);
      barriers.circle(gate.doorX1, gate.y, 3.5).fill(color);

      // Plate, linked to its door by a faint dotted line.
      const doorX = (gate.doorX0 + gate.doorX1) / 2;
      const dx = doorX - gate.plate.x;
      const dy = gate.y - gate.plate.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      for (let d = 18; d < length - 8; d += 9) {
        plates.circle(gate.plate.x + (dx / length) * d, gate.plate.y + (dy / length) * d, 0.9).fill({ color, alpha: 0.28 });
      }
      plates.circle(gate.plate.x, gate.plate.y, 13).stroke({ width: 2, color, alpha: open ? 1 : 0.7 });
      plates.circle(gate.plate.x, gate.plate.y, 8.5).fill({ color, alpha: open ? 0.55 : 0.12 });
      if (open) glow(plates, gate.plate.x, gate.plate.y, 10, color, 1);
    });

    // The start.
    orbs.circle(a.start.x, a.start.y, 11).stroke({ width: 1, color: COLORS.white, alpha: 0.22 });

    // Orbs.
    a.orbs.forEach((orb, i) => {
      if (run.collected[i] === true) return;
      const pulse = 1 + 0.14 * Math.sin(now * 4 + i * 1.7);
      glow(orbs, orb.x, orb.y, 6 * pulse, COLORS.orb, 1);
      orbs.circle(orb.x, orb.y, 5 * pulse).fill(COLORS.orb);
      orbs.circle(orb.x - 1.5, orb.y - 1.5, 1.6).fill({ color: COLORS.white, alpha: 0.9 });
    });

    // Drifters: red balls with spikes.
    for (const d of a.drifters) {
      const x = drifterX(d, vt);
      const y = drifterY(d, vt);
      glow(hazards, x, y, d.r, COLORS.danger, 0.9);
      hazards.circle(x, y, d.r).fill(COLORS.danger);
      hazards.circle(x, y, d.r * 0.5).fill({ color: 0x2a0713, alpha: 0.85 });
      for (let s = 0; s < 6; s++) {
        const angle = now * 2.2 + (s / 6) * Math.PI * 2;
        const tipX = x + Math.cos(angle) * (d.r + 4);
        const tipY = y + Math.sin(angle) * (d.r + 4);
        hazards.moveTo(x + Math.cos(angle) * d.r, y + Math.sin(angle) * d.r).lineTo(tipX, tipY).stroke({ width: 2, color: COLORS.danger, alpha: 0.95, cap: 'round' });
      }
    }
  }

  function drawMover(key: string, x: number, y: number, color: number, alpha: number, player: boolean, now: number): void {
    drawTrail(key, x, y, color, alpha);
    glow(movers, x, y, player ? 7 : 6, color, alpha);
    if (player) {
      movers.circle(x, y, CONFIG.player.radius).fill(COLORS.white);
      movers.circle(x, y, CONFIG.player.radius + 2.5 + Math.sin(now * 6) * 0.6).stroke({ width: 1.5, color, alpha: 0.9 });
    } else {
      movers.circle(x, y, CONFIG.player.radius).fill({ color, alpha: 0.78 * alpha });
      movers.circle(x, y, CONFIG.player.radius).stroke({ width: 1.5, color, alpha });
    }
  }

  return {
    reset() {
      particles.length = 0;
      rings.length = 0;
      trailPoints.clear();
      lastTick = -1;
      lastLoop = -1;
      rewindStart = -10;
      shakeStart = -10;
    },

    orb(x, y, by, now) {
      const color = by === 0 ? COLORS.white : ghostColor(by - 1);
      burst(x, y, color, 14, now);
      rings.push({ x, y, born: now, life: 0.5, from: 6, to: 30, color: COLORS.orb });
    },

    died(x, y, now) {
      burst(x, y, COLORS.white, 26, now, 150);
      burst(x, y, COLORS.danger, 20, now, 120);
      rings.push({ x, y, born: now, life: 0.6, from: 8, to: 60, color: COLORS.danger });
      shakeStart = now;
    },

    ghostDied(x, y, ghost, now) {
      burst(x, y, ghostColor(ghost), 12, now, 80);
    },

    gate(gate, open, now) {
      const g = arena?.gates[gate];
      if (!g) return;
      const color = GATE_COLORS[gate % GATE_COLORS.length] ?? COLORS.cyan;
      rings.push({ x: g.plate.x, y: g.plate.y, born: now, life: 0.55, from: open ? 6 : 26, to: open ? 30 : 8, color });
      rings.push({ x: (g.doorX0 + g.doorX1) / 2, y: g.y, born: now, life: 0.45, from: 4, to: 26, color });
    },

    rewind(now) {
      rewindStart = now;
    },

    won(now) {
      const palette = [COLORS.cyan, COLORS.magenta, COLORS.amber, COLORS.lime, COLORS.violet];
      for (let i = 0; i < 9; i++) burst(40 + ((i * 97) % 280), 200 + ((i * 61) % 300), palette[i % palette.length]!, 16, now + i * 0.05, 160);
    },

    update({ run, alpha, now }) {
      for (const g of [zones, barriers, plates, orbs, hazards, trails, movers, fx, overlay]) g.clear();

      // Shake after a death.
      const shake = clamp01(1 - (now - shakeStart) / 0.35);
      shaker.position.set(Math.sin(now * 90) * 4 * shake, Math.cos(now * 77) * 4 * shake);

      if (run === null) {
        arena = null;
        return;
      }
      arena = run.arena;
      if (run.tick < lastTick || run.loop !== lastLoop) trailPoints.clear();
      lastTick = run.tick;
      lastLoop = run.loop;

      const vt = Math.max(0, run.tick - 1 + alpha);
      drawArena(run.arena, run, now, vt);

      run.ghosts.forEach((g, i) => {
        if (!g.alive) return;
        drawMover(`g${i}`, lerp(g.prevX, g.x, alpha), lerp(g.prevY, g.y, alpha), ghostColor(i), 0.9, false, now);
      });
      if (run.hasPlayer && run.player.alive) {
        drawMover('p', lerp(run.player.prevX, run.player.x, alpha), lerp(run.player.prevY, run.player.y, alpha), COLORS.cyan, 1, true, now);
      }

      // Particles and rings.
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!;
        const t = (now - r.born) / r.life;
        if (t >= 1) {
          rings.splice(i, 1);
          continue;
        }
        fx.circle(r.x, r.y, lerp(r.from, r.to, 1 - (1 - t) * (1 - t))).stroke({ width: 2.5 * (1 - t) + 0.5, color: r.color, alpha: 1 - t });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        const age = now - p.born;
        if (age < 0) continue;
        if (age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        const drag = 1 - age * 1.4;
        fx.circle(p.x + p.vx * age * Math.max(0.2, drag), p.y + p.vy * age * Math.max(0.2, drag), p.size * (1 - age / p.life * 0.6)).fill({ color: p.color, alpha: 1 - age / p.life });
      }

      // Rewind: scan lines sweeping upward over the arena.
      const t = (now - rewindStart) / 0.9;
      if (t >= 0 && t < 1) {
        overlay.rect(arenaLeft, arenaTop, arenaRight - arenaLeft, arenaBottom - arenaTop).fill({ color: COLORS.cyan, alpha: 0.07 * (1 - t) });
        for (let i = 0; i < 14; i++) {
          const y = arenaBottom - ((t * 1.7 + i / 14) % 1) * (arenaBottom - arenaTop);
          overlay.rect(arenaLeft, y, arenaRight - arenaLeft, 2).fill({ color: COLORS.cyan, alpha: 0.32 * (1 - t) });
        }
      }
    },
  };
}
