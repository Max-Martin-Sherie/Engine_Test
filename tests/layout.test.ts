import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/engine/core/config';
import { clientToWorld, clientToWorldX, fitWorld } from '../src/engine/core/layout';
import { computeStageLayout } from '../src/engine/ui/stage';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('fitWorld (letterboxing)', () => {
  it('is 9:16, so a phone-shaped window fits exactly', () => {
    expect(fitWorld(360, 640)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(fitWorld(720, 1280)).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it('adds bars top and bottom on a tall, narrow screen (Pixel 7: 412 x 839)', () => {
    const fit = fitWorld(412, 839);
    expect(fit.scale).toBeCloseTo(412 / 360, 9);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBeCloseTo((839 - 640 * fit.scale) / 2, 9);
    expect(fit.offsetY).toBeGreaterThan(0);
  });

  it('adds bars left and right on a wide window', () => {
    const fit = fitWorld(1100, 640);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(370);
    expect(fit.offsetY).toBe(0);
  });

  it('always keeps the whole world on screen and centred', () => {
    for (const [w, h] of [[320, 568], [390, 844], [768, 1024], [1920, 1080], [500, 500]] as const) {
      const fit = fitWorld(w, h);
      expect(WORLD.width * fit.scale + 2 * fit.offsetX).toBeCloseTo(w, 6);
      expect(WORLD.height * fit.scale + 2 * fit.offsetY).toBeCloseTo(h, 6);
      expect(fit.offsetX).toBeGreaterThanOrEqual(0);
      expect(fit.offsetY).toBeGreaterThanOrEqual(0);
    }
  });

  it('survives a zero-sized window', () => {
    expect(fitWorld(0, 0)).toEqual({ scale: 0, offsetX: 0, offsetY: 0 });
    expect(clientToWorldX(100, 0, fitWorld(0, 0))).toBe(0);
  });
});

describe('clientToWorldX', () => {
  it('maps the field edges and centre on a wide window', () => {
    const fit = fitWorld(1100, 640);
    expect(clientToWorldX(370, 0, fit)).toBe(0); // left edge of the field
    expect(clientToWorldX(550, 0, fit)).toBe(180); // centre
    expect(clientToWorldX(730, 0, fit)).toBe(360); // right edge
    expect(clientToWorldX(0, 0, fit)).toBe(-370); // in the bar: outside the world
  });

  it('accounts for the canvas not sitting at the window origin', () => {
    const fit = fitWorld(360, 640);
    expect(clientToWorldX(150, 100, fit)).toBe(50);
  });

  it('accounts for scale', () => {
    const fit = fitWorld(720, 1280);
    expect(clientToWorldX(360, 0, fit)).toBe(180);
  });
});

describe('clientToWorld (points)', () => {
  it('maps both axes and agrees with clientToWorldX', () => {
    const fit = fitWorld(412, 839);
    const p = clientToWorld(206, 419.5, 0, 0, fit);
    expect(p.x).toBeCloseTo(180, 6);
    expect(p.y).toBeCloseTo(320, 6); // the centre of the screen is the centre of the world
    expect(clientToWorld(100, 0, 0, 0, fit).x).toBeCloseTo(clientToWorldX(100, 0, fit), 9);
  });

  it('maps the field corners on a wide window, and bars to outside the world', () => {
    const fit = fitWorld(1100, 640);
    expect(clientToWorld(370, 0, 0, 0, fit)).toEqual({ x: 0, y: 0 });
    expect(clientToWorld(730, 640, 0, 0, fit)).toEqual({ x: 360, y: 640 });
    expect(clientToWorld(0, 0, 0, 0, fit).x).toBe(-370);
  });

  it('accounts for the canvas origin, and survives a zero-sized window', () => {
    const fit = fitWorld(360, 640);
    expect(clientToWorld(150, 250, 100, 200, fit)).toEqual({ x: 50, y: 50 });
    expect(clientToWorld(1, 1, 0, 0, fitWorld(0, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('computeStageLayout', () => {
  it('puts the stage exactly over the letterboxed field', () => {
    const layout = computeStageLayout(1100, 640, NO_INSETS);
    expect(layout).toMatchObject({ left: 370, top: 0, width: 360, height: 640, unit: 1 });
  });

  it('ignores safe-area insets that fall inside the letterbox bars', () => {
    // Tall phone: 50 px bars top and bottom swallow a 40 px notch and a 30 px home indicator.
    const width = 360;
    const height = 640 + 100;
    const layout = computeStageLayout(width, height, { top: 40, right: 0, bottom: 30, left: 0 });
    expect(layout.top).toBe(50);
    expect(layout.insets).toEqual(NO_INSETS);
  });

  it('keeps only the part of an inset that reaches into the stage', () => {
    const layout = computeStageLayout(360, 740, { top: 70, right: 10, bottom: 80, left: 5 });
    expect(layout.insets.top).toBe(20); // 70 - 50
    expect(layout.insets.bottom).toBe(30); // 80 - 50
    expect(layout.insets.left).toBe(5); // no side bars at all
    expect(layout.insets.right).toBe(10);
  });
});
