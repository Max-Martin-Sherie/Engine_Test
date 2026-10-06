import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests of the engine: it loads the libraries and services, runs the loop and
 * letterboxes a canvas. These hold for every game, so game branches keep this file unchanged.
 * The one test that needs a blank screen only runs while src/game is the empty game.
 * Game-specific flows belong in a game's own spec files.
 *
 * A game may be landscape (boot's `orientation` in src/main.ts) and may draw its own canvas under the engine's
 * (marked `data-layer`); the expectations below follow both.
 */

const EMPTY_GAME = readFileSync('src/game/index.ts', 'utf8').includes('IS_EMPTY_GAME = true');

const LANDSCAPE = /orientation:s*['"]landscape['"]/.test(readFileSync('src/main.ts', 'utf8'));
/** The play field in world units. */
const WORLD = LANDSCAPE ? { width: 640, height: 360 } : { width: 360, height: 640 };

/** Where the world should sit in a screen of this size: scaled to fit, centred. */
function expectedFit(width: number, height: number): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  return { scale, offsetX: (width - WORLD.width * scale) / 2, offsetY: (height - WORLD.height * scale) / 2 };
}

/** The engine's own canvas (a game's canvas, if it has one, carries `data-layer`). */
const ENGINE_CANVAS = '#game canvas:not([data-layer])';

const SHOTS = 'e2e/screenshots';

/** Collects anything that would show up as a red line in the console (including 404s). */
function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

const engine = (page: Page) => page.evaluate(() => window.__engine);

async function waitForRenderer(page: Page): Promise<void> {
  await expect.poll(async () => (await engine(page))?.viewReady, { timeout: 15_000 }).toBe(true);
}

test('boots with a real renderer, a letterboxed canvas and no stray DOM', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await waitForRenderer(page);

  // PixiJS picked a real renderer (WebGPU, or WebGL as the fallback).
  expect(['webgpu', 'webgl']).toContain((await engine(page))?.renderer);

  // One engine canvas at the capped resolution: a 2.625 DPR phone renders at 2x, not 2.625x.
  const view = page.viewportSize();
  expect(view).not.toBeNull();
  const { width: vw, height: vh } = view!;
  const canvas = await page.evaluate((selector) => {
    const c = document.querySelector<HTMLCanvasElement>(selector);
    return c ? { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight } : null;
  }, ENGINE_CANVAS);
  expect(canvas).toEqual({ width: vw * 2, height: vh * 2, cssWidth: vw, cssHeight: vh });
  expect(await page.locator(ENGINE_CANVAS).count()).toBe(1);

  // Pixi's phone-only accessibility hook button is removed.
  expect(await page.locator('button[title*="enable accessibility"]').count()).toBe(0);

  // Letterboxed: the world is scaled to fit and centred, with bars on the longer side.
  const fit = (await engine(page))?.fit;
  const want = expectedFit(vw, vh);
  expect(fit?.scale).toBeCloseTo(want.scale, 6);
  expect(fit?.offsetX).toBeCloseTo(want.offsetX, 6);
  expect(fit?.offsetY).toBeCloseTo(want.offsetY, 6);

  expect(problems).toEqual([]);
});

test('the empty engine shows a blank screen', async ({ page }) => {
  test.skip(!EMPTY_GAME, 'a game is installed in src/game');
  const problems = watchForErrors(page);
  await page.goto('/');
  await waitForRenderer(page);

  // Blank: the engine adds no screens, buttons or text of its own.
  expect(await page.locator('#ui').evaluate((el) => el.children.length)).toBe(0);
  expect(await page.locator('button').count()).toBe(0);
  expect((await page.locator('body').innerText()).trim()).toBe('');

  await page.screenshot({ path: `${SHOTS}/engine-blank.png` });
  expect(problems).toEqual([]);
});

test('the ad service starts in the background and reports a loaded ad', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await engine(page))?.adsReady, { timeout: 10_000 }).toBe(true);
});

test('?ads=no-fill: no ad ever loads', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?ads=no-fill');
  await waitForRenderer(page);
  await page.waitForTimeout(1000);
  expect((await engine(page))?.adsReady).toBe(false);
  expect(problems).toEqual([]);
});

test.describe('wide desktop window', () => {
  test.use({ viewport: { width: 1100, height: 640 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('letterboxes to the window, and re-fits when the window is resized', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/');
    await waitForRenderer(page);
    expect((await engine(page))?.fit).toEqual(expectedFit(1100, 640));

    await page.setViewportSize({ width: 720, height: 1280 });
    await expect.poll(async () => (await engine(page))?.fit, { timeout: 5000 }).toEqual(expectedFit(720, 1280));
    expect(problems).toEqual([]);
  });
});
