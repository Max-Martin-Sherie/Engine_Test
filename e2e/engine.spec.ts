import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests of the engine on its own: it loads the libraries and services, runs the loop
 * and shows a blank letterboxed canvas. Game-specific flows belong in a game's own spec files.
 */

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

test('boots to a blank letterboxed canvas with the services running', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await waitForRenderer(page);

  // PixiJS picked a real renderer (WebGPU, or WebGL as the fallback).
  expect(['webgpu', 'webgl']).toContain((await engine(page))?.renderer);

  // One canvas at the capped resolution: a 2.625 DPR phone renders at 2x, not 2.625x.
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight } : null;
  });
  expect(canvas).toEqual({ width: 824, height: 1678, cssWidth: 412, cssHeight: 839 });
  expect(await page.locator('canvas').count()).toBe(1);

  // Blank: the engine adds no screens, buttons or text of its own.
  expect(await page.locator('#ui').evaluate((el) => el.children.length)).toBe(0);
  expect(await page.locator('button').count()).toBe(0);
  expect((await page.locator('body').innerText()).trim()).toBe('');

  // Letterboxed: 9:16 world on a taller phone screen leaves bars top and bottom.
  const fit = (await engine(page))?.fit;
  expect(fit?.scale).toBeCloseTo(412 / 360, 6);
  expect(fit?.offsetX).toBeCloseTo(0, 6);
  expect(fit?.offsetY).toBeCloseTo((839 - 640 * (412 / 360)) / 2, 6);

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

  test('letterboxes with bars left and right, and re-fits when the window is resized', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/');
    await waitForRenderer(page);
    expect((await engine(page))?.fit).toEqual({ scale: 1, offsetX: 370, offsetY: 0 });
    await page.screenshot({ path: `${SHOTS}/engine-blank-wide.png` });

    await page.setViewportSize({ width: 720, height: 1280 });
    await expect
      .poll(async () => (await engine(page))?.fit, { timeout: 5000 })
      .toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
    expect(problems).toEqual([]);
  });
});
