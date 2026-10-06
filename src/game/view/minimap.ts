/** The minimap: the whole map in a small 2D canvas, with fog, what you can see of everyone, and where the camera is. */
import { canSee, halfSize, isBuilding, isUnit, type GameMap, type Match } from '../sim';
import { COLORS, css } from './palette';
import type { Screen2D } from './world3d';

export interface Alert {
  x: number;
  y: number;
  /** performance.now() seconds when it began. */
  at: number;
}

export interface MinimapDraw {
  match: Match;
  player: number;
  fog: boolean;
  /** The four map points at the screen's corners. */
  quad: readonly Screen2D[];
  alerts: readonly Alert[];
  now: number;
}

export interface Minimap {
  draw(input: MinimapDraw): void;
  /** The map point under a client position. */
  toMap(clientX: number, clientY: number): { x: number; y: number };
}

const MIN_GAP = 1 / 30;

export function createMinimap(canvas: HTMLCanvasElement, map: GameMap): Minimap {
  const size = map.size;
  const scale = 2;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('No 2D canvas for the minimap');

  // The ground, once.
  const ground = document.createElement('canvas');
  ground.width = size;
  ground.height = size;
  const gctx = ground.getContext('2d');
  if (gctx === null) throw new Error('No 2D canvas for the minimap ground');
  const image = gctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const rock = map.rock[i] === 1;
    const edge = i % size < 2 || i % size >= size - 2 || Math.floor(i / size) < 2 || Math.floor(i / size) >= size - 2;
    const n = ((i * 2654435761) >>> 0) % 7;
    image.data[i * 4] = rock ? (edge ? 62 : 112 + n) : 50 + n;
    image.data[i * 4 + 1] = rock ? (edge ? 58 : 104 + n) : 62 + n;
    image.data[i * 4 + 2] = rock ? (edge ? 80 : 138 + n) : 86 + n;
    image.data[i * 4 + 3] = 255;
  }
  gctx.putImageData(image, 0, 0);

  // The fog, redrawn when the player's vision changes.
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = size;
  fogCanvas.height = size;
  const fctx = fogCanvas.getContext('2d');
  if (fctx === null) throw new Error('No 2D canvas for the minimap fog');
  const fogImage = fctx.createImageData(size, size);
  let fogTick = -1;
  let lastDraw = -1;

  function updateFog(vision: Uint8Array): void {
    for (let i = 0; i < size * size; i++) {
      const v = vision[i] ?? 0;
      fogImage.data[i * 4] = 2;
      fogImage.data[i * 4 + 1] = 4;
      fogImage.data[i * 4 + 2] = 9;
      fogImage.data[i * 4 + 3] = v === 2 ? 0 : v === 1 ? 120 : 255;
    }
    fctx?.putImageData(fogImage, 0, 0);
  }

  return {
    draw({ match, player, fog, quad, alerts, now }) {
      if (now - lastDraw < MIN_GAP) return;
      lastDraw = now;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ground, 0, 0, canvas.width, canvas.height);

      const dot = (x: number, y: number, w: number, h: number, color: string): void => {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round((x - w / 2) * scale), Math.round((y - h / 2) * scale), Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
      };

      // Resources and buildings sit under the fog (what was seen stays on the map).
      for (const e of match.entities) {
        if (!e.alive || isUnit(e)) continue;
        if (e.owner !== player && fog && !canSee(match, player, e)) continue;
        const h = halfSize(e);
        if (e.type === 'minerals') dot(e.x, e.y, 1, 1, css(COLORS.mineral));
        else if (e.type === 'geyser') dot(e.x, e.y, 2.4, 2.4, css(COLORS.gas));
        else if (isBuilding(e)) dot(e.x, e.y, h.hw * 2, h.hh * 2, css(COLORS.team[e.owner === 1 ? 1 : 0]));
      }

      if (fog) {
        const vision = match.vision[player];
        if (vision !== undefined && match.tick !== fogTick) {
          updateFog(vision);
          fogTick = match.tick;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fogCanvas, 0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
      }

      for (const e of match.entities) {
        if (!e.alive || !isUnit(e)) continue;
        if (e.owner !== player && fog && !canSee(match, player, e)) continue;
        const r = e.type === 'tank' ? 1.5 : 1.1;
        dot(e.x, e.y, r, r, css(COLORS.team[e.owner === 1 ? 1 : 0]));
      }

      // Where the camera is looking.
      if (quad.length === 4) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        quad.forEach((p, i) => {
          const px = Math.min(size, Math.max(0, p.x)) * scale;
          const py = Math.min(size, Math.max(0, p.y)) * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // Attack warnings pulse.
      for (const a of alerts) {
        const age = now - a.at;
        if (age > 4) continue;
        const r = (3 + ((age * 6) % 1) * 6) * scale;
        ctx.strokeStyle = `rgba(255,70,70,${1 - age / 4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x * scale, a.y * scale, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    },

    toMap(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.min(size, Math.max(0, ((clientX - rect.left) / rect.width) * size)),
        y: Math.min(size, Math.max(0, ((clientY - rect.top) / rect.height) * size)),
      };
    },
  };
}
