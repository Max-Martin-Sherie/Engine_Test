import { expect, test, type Page } from '@playwright/test';
import { createRun } from '../src/game/sim';
import {
  SHOTS,
  button,
  cutFruit,
  dragWorld,
  fruitHidden,
  phase,
  profileDump,
  runDump,
  seedProfile,
  shot,
  snapshot,
  waitForFruit,
  watchForErrors,
} from './helpers';

/** A screenshot right now, without waiting for animations (to catch the moment of a cut). */
const shotNow = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

const waitForPhase = (page: Page, expected: string, timeout = 8000) =>
  expect.poll(() => phase(page), { timeout, intervals: [100] }).toBe(expected);

async function startClassic(page: Page, url = '/?seed=1'): Promise<void> {
  await page.goto(url);
  await button(page, /^Classic/).click();
  await waitForFruit(page);
}

/** Fails the current fruit on purpose and waits for the try-again screen. */
async function failOnPurpose(page: Page): Promise<void> {
  await cutFruit(page, 35);
  await waitForPhase(page, 'tryAgain');
}

test.describe('main menu', () => {
  test('shows the modes, the shop and the settings, and logs no errors', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=1');
    await expect(button(page, /^Classic/)).toBeVisible();
    await expect(button(page, /^Arcade/)).toBeVisible();
    await expect(button(page, /^Survival/)).toBeVisible();
    await expect(button(page, 'Skins')).toBeVisible();
    await expect(button(page, 'Settings')).toBeVisible();
    expect(await phase(page)).toBe('menu');
    expect((await profileDump(page)).coins).toBe(0);
    await shot(page, '01-menu');
    expect(problems).toEqual([]);
  });
});

test.describe('classic', () => {
  test('a stray drag is a cancel, a perfect cut scores, and the next fruit is harder', async ({ page }) => {
    const problems = watchForErrors(page);
    await startClassic(page);
    const first = (await runDump(page))!;
    expect(first.mode).toBe('classic');
    expect(first.fruits).toHaveLength(1);
    await shot(page, '02-classic-start');

    // A drag that misses the fruit does nothing but tell you so.
    await dragWorld(page, { x: 20, y: 580 }, { x: 340, y: 580 });
    await expect(page.getByText('Cut all the way across')).toBeVisible();
    // Neither does one that starts or stops on the fruit.
    const f = first.fruits[0]!;
    await dragWorld(page, { x: f.x, y: f.y }, { x: f.x + f.radius * 1.5, y: f.y });
    const unchanged = (await runDump(page))!;
    expect(unchanged.score).toBe(0);
    expect(unchanged.round).toBe(0);
    expect(unchanged.fruits[0]!.id).toBe(f.id);
    expect(unchanged.phase).toBe('playing');

    // A perfect cut.
    await cutFruit(page, 0);
    await expect(page.getByText('Perfect!')).toBeVisible();
    await shotNow(page, '03-classic-perfect');
    await expect.poll(async () => (await runDump(page))?.score).toBe(110);
    expect((await runDump(page))!.round).toBe(1);

    // The next fruit is smaller and the allowed error is tighter.
    await waitForFruit(page);
    const next = (await runDump(page))!;
    expect(next.fruits[0]!.id).not.toBe(f.id);
    expect(next.fruits[0]!.radius).toBeLessThan(f.radius);
    expect(next.tolerance).toBeLessThan(first.tolerance);
    await shot(page, '04-classic-next');
    expect(problems).toEqual([]);
  });

  test('an imperfect but acceptable cut still counts', async ({ page }) => {
    await startClassic(page);
    await cutFruit(page, 6);
    await expect(page.getByText('Nice')).toBeVisible();
    await expect.poll(async () => (await runDump(page))?.round).toBe(1);
  });

  test('a cut that is too uneven ends the run at the try-again screen', async ({ page }) => {
    await startClassic(page);
    await cutFruit(page, 35);
    await expect(page.getByText('Uneven')).toBeVisible();
    await shotNow(page, '05-classic-uneven');
    await waitForPhase(page, 'tryAgain');
    await expect(page.getByText('Not even enough')).toBeVisible();
    expect((await runDump(page))!.phase).toBe('failed');
    await shot(page, '06-try-again');
  });
});

test.describe('trying again', () => {
  test('with an ad: the same fruit comes back, free, and the run carries on', async ({ page }) => {
    await startClassic(page);
    await cutFruit(page, 0);
    await waitForFruit(page);
    const before = (await runDump(page))!;
    await failOnPurpose(page);
    // The halves flew off, so the whole fruit must not be drawn as well (it is still in the run for the retry).
    expect(await fruitHidden(page)).toBe(true);

    // No coins yet, so the coin option is off; the ad works for any try.
    await expect(button(page, /^Try again/)).toBeDisabled();
    await button(page, 'Watch ad to try again').click();
    await expect(page.getByText('Test ad', { exact: true })).toBeVisible();
    await waitForPhase(page, 'playing');
    const after = (await runDump(page))!;
    expect(after.restarts).toBe(1);
    expect(after.fruits[0]!.id).toBe(before.fruits[0]!.id);
    expect(after.score).toBe(before.score);
    expect((await profileDump(page)).coins).toBe(0);
    await expect.poll(() => fruitHidden(page)).toBe(false); // and it is back

    // And it can be won now.
    await cutFruit(page, 0);
    await expect.poll(async () => (await runDump(page))?.round).toBe(2);
  });

  test('with coins: each try costs double the last', async ({ page }) => {
    await seedProfile(page, { coins: 500 });
    await startClassic(page);
    await failOnPurpose(page);
    await expect(button(page, /^Try again/)).toContainText('20');
    await button(page, /^Try again/).click();
    await waitForPhase(page, 'playing');
    expect((await profileDump(page)).coins).toBe(480);
    expect((await runDump(page))!.restarts).toBe(1);

    await failOnPurpose(page);
    await expect(button(page, /^Try again/)).toContainText('40');
    await button(page, /^Try again/).click();
    await waitForPhase(page, 'playing');
    expect((await profileDump(page)).coins).toBe(440);

    await failOnPurpose(page);
    await expect(button(page, /^Try again/)).toContainText('80');
    // The ad is still on offer, even for the dearest try.
    await expect(button(page, 'Watch ad to try again')).toBeVisible();
    await shot(page, '07-try-again-coins');
  });

  test('not enough coins: the coin button is off and the ad is the way', async ({ page }) => {
    await seedProfile(page, { coins: 15 });
    await startClassic(page);
    await failOnPurpose(page);
    await expect(button(page, /^Try again/)).toBeDisabled();
    await expect(page.getByText(/Watch an ad to try again for free/)).toBeVisible();
  });
});

test.describe('the end of a run', () => {
  test('coins are paid out, an ad doubles them once, and no short ad follows a rewarded one', async ({ page }) => {
    await startClassic(page);
    for (let i = 0; i < 3; i++) {
      await cutFruit(page, 0);
      await waitForFruit(page);
    }
    await failOnPurpose(page);
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await expect(page.getByRole('heading', { name: 'Run over' })).toBeVisible();

    const result = (await snapshot(page))!.debug['result'] as { coinsEarned: number; fruits: number; score: number };
    expect(result.fruits).toBe(3);
    expect(result.coinsEarned).toBeGreaterThan(0);
    expect((await profileDump(page)).coins).toBe(result.coinsEarned);
    expect((await profileDump(page)).best.classic).toBe(result.score);
    await shot(page, '08-result');

    await button(page, /^Watch ad to double/).click();
    await expect(page.getByText('Test ad', { exact: true })).toBeVisible();
    await expect.poll(async () => (await profileDump(page)).coins, { timeout: 8000 }).toBe(result.coinsEarned * 2);
    await expect(button(page, /^Watch ad to double/)).toBeHidden(); // once only
    await shot(page, '09-result-doubled');

    // A rewarded ad was watched this run, so no short ad on the way back.
    await button(page, 'Main menu').click();
    await waitForPhase(page, 'menu', 3000);
    await expect(page.getByText('Short test ad')).toHaveCount(0);
    await expect(page.locator('[data-screen="menu"] .coins-pill')).toContainText(String(result.coinsEarned * 2));
  });

  test('returning to the menu shows a short ad, but not twice in a row', async ({ page }) => {
    await startClassic(page);
    await failOnPurpose(page);
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await button(page, 'Main menu').click();
    await expect(page.getByText('Short test ad')).toBeVisible();
    await waitForPhase(page, 'menu', 6000);
    expect(((await snapshot(page))!.debug['lastInterstitialAt'])).not.toBeNull();

    // Straight into another run and back: the last ad was moments ago, so none this time.
    await button(page, /^Classic/).click();
    await waitForFruit(page);
    await failOnPurpose(page);
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await button(page, 'Main menu').click();
    await waitForPhase(page, 'menu', 3000);
    await expect(page.getByText('Short test ad')).toHaveCount(0);
  });

  test('Play again starts another run without any ad', async ({ page }) => {
    await startClassic(page);
    await failOnPurpose(page);
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await button(page, 'Play again').click();
    await waitForPhase(page, 'playing', 3000);
    await expect(page.getByText('Short test ad')).toHaveCount(0);
  });

  test('with no ads available: no ad buttons, no short ad, nothing blocks the game', async ({ page }) => {
    const problems = watchForErrors(page);
    await startClassic(page, '/?seed=1&ads=no-fill');
    await cutFruit(page, 0);
    await waitForFruit(page);
    await failOnPurpose(page);
    await expect(button(page, 'Watch ad to try again')).toBeHidden();
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await expect(button(page, /^Watch ad to double/)).toBeHidden();
    await button(page, 'Main menu').click();
    await waitForPhase(page, 'menu', 3000);
    await expect(page.getByText('Short test ad')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

test.describe('the skin shop', () => {
  test('buy with coins, wear it, and it stays after a reload', async ({ page }) => {
    const problems = watchForErrors(page);
    await seedProfile(page, { coins: 500 });
    await page.goto('/?seed=1');
    await button(page, 'Skins').click();
    await expect(page.locator('.skin-card')).toHaveCount(10);
    await shot(page, '10-shop');

    const ember = page.locator('.skin-card', { hasText: 'Ember' });
    await ember.getByRole('button').click();
    await expect(page.getByText('Ember equipped')).toBeVisible();
    expect(await profileDump(page)).toMatchObject({ coins: 200, equipped: 'ember' });
    await expect(ember.getByRole('button')).toHaveText('Equipped');

    // Something dearer than the wallet does nothing but say so.
    await page.locator('.skin-card', { hasText: 'Golden Edge' }).getByRole('button').click();
    await expect(page.getByText('Not enough coins')).toBeVisible();
    expect((await profileDump(page)).coins).toBe(200);
    expect((await profileDump(page)).owned).toEqual(['steel', 'ember']);

    // Wear the free one again, then reload: everything was saved.
    await page.locator('.skin-card', { hasText: 'Steel' }).getByRole('button', { name: 'Equip' }).click();
    expect((await profileDump(page)).equipped).toBe('steel');
    await page.reload();
    expect(await profileDump(page)).toMatchObject({ coins: 200, equipped: 'steel', owned: ['steel', 'ember'] });
    await button(page, 'Skins').click();
    await expect(page.locator('.skin-card', { hasText: 'Ember' }).getByRole('button')).toHaveText('Equip');
    await button(page, 'Back').click();
    await expect(page.locator('[data-screen="menu"] .coins-pill')).toContainText('200');
    expect(problems).toEqual([]);
  });

  test('the equipped skin is used for the knife (a drag in progress draws it)', async ({ page }) => {
    await seedProfile(page, { coins: 0, owned: ['steel', 'ember'], equipped: 'ember' });
    await startClassic(page);
    const f = (await runDump(page))!.fruits[0]!;
    await page.evaluate(() => void 0);
    // Hold a drag across the fruit and look at it before letting go.
    const view = await page.evaluate(() => ({ fit: window.__engine!.fit, rect: document.querySelector('canvas')!.getBoundingClientRect() }));
    const at = (x: number, y: number) => ({ x: view.rect.left + view.fit.offsetX + x * view.fit.scale, y: view.rect.top + view.fit.offsetY + y * view.fit.scale });
    const from = at(f.x - f.radius - 30, f.y + 10);
    const to = at(f.x + f.radius * 0.3, f.y - 10);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await shotNow(page, '11-knife-ember');
    await page.mouse.up();
  });
});

test.describe('settings', () => {
  test('sound and vibration toggles are saved', async ({ page }) => {
    await page.goto('/?seed=1');
    await button(page, 'Settings').click();
    await shot(page, '12-settings');
    await expect(page.getByRole('switch', { name: /Sound: On/ })).toBeVisible();
    await page.getByRole('switch', { name: /Sound/ }).click();
    await expect(page.getByRole('switch', { name: /Sound: Off/ })).toBeVisible();
    await page.getByRole('switch', { name: /Vibration/ }).click();
    expect((await profileDump(page)).settings).toEqual({ sound: false, haptics: false });
    await page.reload();
    expect((await profileDump(page)).settings).toEqual({ sound: false, haptics: false });
  });
});

test.describe('arcade', () => {
  test('a clock runs, good cuts add time, and running out of time ends the run', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=2&time=6');
    await button(page, /^Arcade/).click();
    await waitForFruit(page);
    await expect(page.getByText(/^0:0[3-6]$/)).toBeVisible();
    await shot(page, '13-arcade-start');

    const before = (await runDump(page))!.timeLeft;
    await cutFruit(page, 0);
    await expect.poll(async () => (await runDump(page))!.timeLeft, { timeout: 3000 }).toBeGreaterThan(before);

    // Do nothing: the clock runs out.
    await waitForPhase(page, 'tryAgain', 15_000);
    await expect(page.getByText("Time's up")).toBeVisible();
    await shot(page, '14-arcade-time-up');
    await button(page, 'Give up').click();
    await waitForPhase(page, 'result');
    await expect(page.locator('[data-screen="result"] .meta', { hasText: 'Arcade' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('three mistakes are three strikes', async ({ page }) => {
    await page.goto('/?seed=3&time=60');
    await button(page, /^Arcade/).click();
    for (let strikes = 1; strikes <= 3; strikes++) {
      await waitForFruit(page);
      await cutFruit(page, 40);
      await expect.poll(async () => (await runDump(page))!.strikes).toBe(strikes);
    }
    await waitForPhase(page, 'tryAgain');
    await expect(page.getByText('Three strikes')).toBeVisible();
  });
});

test.describe('survival', () => {
  test('every cut costs margin, a bubble gives it back, and running out ends the run', async ({ page }) => {
    const problems = watchForErrors(page);
    await seedProfile(page, { coins: 500 });
    // A seed whose first fruit has a "+x" bubble over it.
    let seed = 1;
    while (createRun('survival', seed).bubbles.length === 0) seed++;
    await page.goto(`/?seed=${seed}`);
    await button(page, /^Survival/).click();
    await waitForFruit(page);
    const first = (await runDump(page))!;
    expect(first.mode).toBe('survival');
    expect(first.fruits).toHaveLength(1);
    expect(first.bubbles).toHaveLength(1);
    expect(first.margin).toBe(25);
    await expect(page.getByText(/^Margin 25\.0/)).toBeVisible();
    await shot(page, '15-survival-start');

    // Aim a good cut through the bubble: its value comes back to the margin.
    const fruit = first.fruits[0]!;
    const bubble = first.bubbles[0]!;
    await cutFruit(page, 3, Math.atan2(bubble.y - fruit.y, bubble.x - fruit.x));
    await expect(page.getByText(/^\+\d+ −\d/)).toBeVisible();
    await shotNow(page, '16-survival-bubble');
    const afterBubble = (await runDump(page))!;
    expect(afterBubble.margin).toBeGreaterThan(25 + bubble.value - 4);
    expect(afterBubble.margin).toBeLessThanOrEqual(35);
    expect(afterBubble.round).toBe(1);
    expect(afterBubble.phase).toBe('playing');

    // An ordinary cut off by 6 takes 6 off the margin and the run goes on.
    await waitForFruit(page);
    const before = (await runDump(page))!;
    await expect(page.getByText(/^Margin /)).toBeVisible();
    await shot(page, '17-survival-next');
    await cutFruit(page, 6, 0.3 + Math.PI / 2);
    await expect.poll(async () => (await runDump(page))?.round).toBe(2);
    await waitForFruit(page);
    const after = (await runDump(page))!;
    expect(after.margin).toBeLessThan(before.margin - 5);
    expect(after.margin).toBeGreaterThan(before.margin - 7);
    expect(after.tolerance).toBeCloseTo(after.margin - 0.6, 1);

    // A cut worse than what is left ends the run, on the same fruit.
    const fruitId = after.fruits[0]!.id;
    await cutFruit(page, 45);
    await waitForPhase(page, 'tryAgain');
    await expect(page.getByText('Out of margin')).toBeVisible();
    await shot(page, '18-survival-out');

    // A try with coins brings the fruit back with the margin it had.
    await button(page, /^Try again/).click();
    await waitForPhase(page, 'playing');
    const back = (await runDump(page))!;
    expect(back.fruits[0]!.id).toBe(fruitId);
    expect(back.margin).toBeCloseTo(after.margin, 5);
    expect(back.restarts).toBe(1);
    expect(problems).toEqual([]);
  });
});

test.describe('pausing', () => {
  test('the pause button freezes the run; Resume continues it', async ({ page }) => {
    await page.goto('/?seed=2&time=60');
    await button(page, /^Arcade/).click();
    await waitForFruit(page);
    await button(page, 'Pause').click();
    await waitForPhase(page, 'paused');
    await shot(page, '15-paused');
    const frozen = (await runDump(page))!.timeLeft;
    await page.waitForTimeout(1200);
    expect((await runDump(page))!.timeLeft).toBe(frozen);
    await button(page, 'Resume').click();
    await waitForPhase(page, 'playing');
    await expect.poll(async () => (await runDump(page))!.timeLeft).toBeLessThan(frozen);
  });

  test('hiding the page (app backgrounded) pauses too', async ({ page }) => {
    await startClassic(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitForPhase(page, 'paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await button(page, 'Resume').click();
    await waitForPhase(page, 'playing');
  });
});

test.describe('online skins', () => {
  const catalog = {
    version: 1,
    skins: [
      { id: 'testy', name: 'Testy', rarity: 'rare', price: 10, blade: { color: '#123456', edge: '#ffffff', shape: 'cleaver' }, handle: { color: '#000000', accent: '#ff00ff' }, trail: { color: '#00ff00', glow: '#0000ff', width: 4 }, sparks: { color: '#ffffff' } },
      { id: 'broken', name: 'Broken', rarity: 'mythic', price: -5 },
    ],
  };

  test('are downloaded in the background, validated, cached for offline, and bad entries are dropped', async ({ page }) => {
    await page.route('**/skins-test-ok.json', (route) => route.fulfill({ json: catalog }));
    await page.goto('/?catalog=/skins-test-ok.json&seed=1');
    await expect.poll(async () => ((await snapshot(page))?.debug['catalog'] as string[]).includes('testy'), { timeout: 6000 }).toBe(true);
    const ids = (await snapshot(page))!.debug['catalog'] as string[];
    expect(ids).not.toContain('broken');
    expect(ids).toHaveLength(11);
    await button(page, 'Skins').click();
    await expect(page.locator('.skin-card', { hasText: 'Testy' })).toBeVisible();

    // Offline next time: the cached download is still there.
    await page.unroute('**/skins-test-ok.json');
    await page.route('**/skins-test-ok.json', (route) => route.abort());
    await page.reload();
    await expect.poll(async () => ((await snapshot(page))?.debug['catalog'] as string[]).includes('testy')).toBe(true);
  });

  test('a failing server changes nothing and breaks nothing', async ({ page }) => {
    await page.route('**/skins-test-bad.json', (route) => route.fulfill({ status: 500, body: 'nope' }));
    await page.goto('/?catalog=/skins-test-bad.json&seed=1');
    await expect(button(page, /^Classic/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(((await snapshot(page))!.debug['catalog'] as string[]).length).toBe(10);
    await button(page, 'Skins').click();
    await expect(page.locator('.skin-card')).toHaveCount(10);
  });

  test('garbage from the server is ignored', async ({ page }) => {
    await page.route('**/skins-test-junk.json', (route) => route.fulfill({ body: '<html>not json</html>', contentType: 'application/json' }));
    await page.goto('/?catalog=/skins-test-junk.json&seed=1');
    await page.waitForTimeout(500);
    expect(((await snapshot(page))!.debug['catalog'] as string[]).length).toBe(10);
  });
});

test.describe('wide desktop window', () => {
  test.use({ viewport: { width: 1100, height: 640 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('letterboxes the field; cutting still lines up with the mouse', async ({ page }) => {
    await startClassic(page);
    await cutFruit(page, 0);
    await expect.poll(async () => (await runDump(page))?.round).toBe(1);
    await waitForFruit(page);
    await shot(page, '16-wide-playing');
  });
});

test.describe('the fruit', () => {
  test('every fruit draws without errors', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?gallery=1');
    await expect.poll(async () => (await page.evaluate(() => window.__engine?.viewReady)) === true).toBe(true);
    await page.waitForTimeout(400); // a frame or two with everything on screen
    await shot(page, '17-gallery');
    expect(problems).toEqual([]);
  });
});
