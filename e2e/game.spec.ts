import { expect, test, type Page } from '@playwright/test';

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

const phase = (page: Page) => page.evaluate(() => window.__game?.phase);
const rockCount = (page: Page) => page.evaluate(() => window.__game?.rocks.length ?? -1);
const score = (page: Page) => page.evaluate(() => window.__game?.score ?? -1);

/** Waits for the UI's one-shot fade/rise animations, so screenshots show the settled screen. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const playButton = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });
const playAgainButton = (page: Page) => page.getByRole('button', { name: 'Play again' });
const reviveButton = (page: Page) => page.getByRole('button', { name: 'Watch ad to continue' });

/** Waits (in real time) for the player to die with nobody steering. */
async function waitForGameOver(page: Page): Promise<void> {
  await expect.poll(() => phase(page), { timeout: 60_000, intervals: [250] }).toBe('over');
}

test('boots, plays with pointer sweeps, and logs no errors', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?seed=1');

  await expect(playButton(page)).toBeVisible();
  expect(await phase(page)).toBe('title');
  await shot(page, '01-title');

  await playButton(page).click();
  await expect.poll(() => phase(page)).toBe('playing');

  // Sweep the pointer back and forth across the field while rocks come down.
  const { width, height } = page.viewportSize() ?? { width: 412, height: 839 };
  const y = height * 0.8;
  let mostRocks = 0;
  for (let pass = 0; pass < 6 && (await phase(page)) === 'playing'; pass++) {
    const [from, to] = pass % 2 === 0 ? [0.12, 0.88] : [0.88, 0.12];
    await page.mouse.move(width * from, y);
    await page.mouse.move(width * to, y, { steps: 25 });
    await page.waitForTimeout(250);
    mostRocks = Math.max(mostRocks, await rockCount(page));
    if (pass === 3 && (await phase(page)) === 'playing') {
      await shot(page, '02-playing');
    }
  }

  expect(mostRocks).toBeGreaterThan(0); // the sim is running and rocks reach the page
  expect(await score(page)).toBeGreaterThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('standing still dies; the revive button appears and returns to playing', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?seed=3');
  await playButton(page).click();
  await waitForGameOver(page);

  await expect(playAgainButton(page)).toBeVisible();
  await expect(reviveButton(page)).toBeVisible();
  await shot(page, '03-game-over');

  await reviveButton(page).click();
  await expect.poll(() => phase(page)).toBe('ad');
  await expect(page.getByText('Test ad', { exact: true })).toBeVisible();
  await shot(page, '04-test-ad');

  // The fake ad lasts 2 s, then the run continues with a clean field.
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe('playing');
  expect(await rockCount(page)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(500);
  await shot(page, '05-revived');

  // Only one revive per run: the next death offers "Play again" alone.
  await waitForGameOver(page);
  await expect(playAgainButton(page)).toBeVisible();
  await expect(reviveButton(page)).toHaveCount(0);

  await playAgainButton(page).click();
  await expect.poll(() => phase(page)).toBe('playing');
  expect(problems).toEqual([]);
});

test('?ads=no-fill hides the revive button', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?seed=3&ads=no-fill');
  await playButton(page).click();
  await waitForGameOver(page);

  await expect(playAgainButton(page)).toBeVisible();
  await expect(reviveButton(page)).toHaveCount(0);
  await shot(page, '06-game-over-no-ad');
  expect(problems).toEqual([]);
});

test('?ads=skip: closing the ad early gives no revive', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?seed=3&ads=skip');
  await playButton(page).click();
  await waitForGameOver(page);

  await reviveButton(page).click();
  await expect.poll(() => phase(page)).toBe('ad');
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe('over');
  await expect(playAgainButton(page)).toBeVisible();
  await expect(reviveButton(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('pauses when the page is hidden and resumes with the button', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/?seed=1');
  await playButton(page).click();
  await expect.poll(() => phase(page)).toBe('playing');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => phase(page)).toBe('paused');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await shot(page, '07-paused');

  // The sim is frozen while paused.
  const frozenAt = await score(page);
  await page.waitForTimeout(1500);
  expect(await score(page)).toBe(frozenAt);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  expect(problems).toEqual([]);
});

test.describe('wide desktop window', () => {
  test.use({ viewport: { width: 1100, height: 640 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('letterboxes the 9:16 field and keeps the UI on it', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=1');
    await shot(page, '08-wide-title');
    await playButton(page).click();
    await expect.poll(() => rockCount(page)).toBeGreaterThan(1);
    await shot(page, '09-wide-playing');
    expect(problems).toEqual([]);
  });
});
