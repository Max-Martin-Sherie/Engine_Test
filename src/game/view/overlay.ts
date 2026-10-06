/** The 2D layer over the 3D world (drawn with Pixi): health bars and the selection rectangle. */
import { Container, Graphics } from 'pixi.js';
import { COLORS } from './palette';
import type { Bar } from './world3d';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Overlay {
  draw(bars: readonly Bar[], box: Box | null): void;
  clear(): void;
}

export function createOverlay(field: Container): Overlay {
  const layer = new Container();
  const g = new Graphics();
  layer.addChild(g);
  field.addChild(layer);

  return {
    draw(bars, box) {
      g.clear();
      for (const bar of bars) {
        const h = 3.5;
        const x = bar.x - bar.w / 2;
        const y = bar.y - h - 1;
        g.rect(x - 1, y - 1, bar.w + 2, h + 2).fill({ color: COLORS.barBack, alpha: 0.78 });
        g.rect(x, y, bar.w * bar.frac, h).fill({ color: bar.color });
        if (bar.progress >= 0) {
          g.rect(x - 1, y + h + 1, bar.w + 2, 3).fill({ color: COLORS.barBack, alpha: 0.78 });
          g.rect(x, y + h + 1.5, bar.w * bar.progress, 2).fill({ color: COLORS.neutral });
        }
      }
      if (box !== null) {
        const x = Math.min(box.x0, box.x1);
        const y = Math.min(box.y0, box.y1);
        const w = Math.abs(box.x1 - box.x0);
        const h = Math.abs(box.y1 - box.y0);
        g.rect(x, y, w, h).fill({ color: COLORS.boxFill, alpha: 0.1 }).stroke({ width: 1.6, color: COLORS.boxFill, alpha: 1 });
      }
    },

    clear() {
      g.clear();
    },
  };
}
