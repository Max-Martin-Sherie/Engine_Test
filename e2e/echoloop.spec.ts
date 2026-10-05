import { expect, test } from '@playwright/test';
import {
  arenaDump,
  button,
  debugValue,
  moveTo,
  phase,
  pressAt,
  release,
  resultDump,
  runDump,
  shot,
  shotNow,
  snapshot,
  waitForPhase,
  watchForErrors,
} from './helpers';

test.describe('main menu', () => {
  test('shows the three ways to play and settings, and logs no errors', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/');
    await expect(button(page, /^Daily arena/)).toBeVisible();
    await expect(button(page, /^Random arena/)).toBeVisible();
    await expect(button(page, /^Watch it play itself/)).toBeVisible();
    await expect(button(page, 'Settings')).toBeVisible();
    expect(await phase(page)).toBe('menu');
    await shot(page, '01-menu');
    expect(problems).toEqual([]);
  });
});

test.describe('playing', () => {
  test('a random arena starts at loop 1 with the arena on screen; dragging moves you', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=3');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'playing');
    await expect(page.getByText('Loop 1 of 8')).toBeVisible();
    const arena = (await arenaDump(page))!;
    expect(arena.seed).toBe(3);
    expect(arena.orbs.length).toBeGreaterThanOrEqual(3);
    await shot(page, '02-start');

    const before = (await runDump(page))!;
    await pressAt(page, { x: arena.start.x + 70, y: arena.start.y - 40 });
    await expect.poll(async () => (await runDump(page))!.player.x, { timeout: 4000 }).toBeGreaterThan(before.player.x + 30);
    await shotNow(page, '03-moving');
    await release(page);
    // Lifting the finger stops you.
    const stopped = (await runDump(page))!.player;
    await page.waitForTimeout(400);
    const later = (await runDump(page))!.player;
    expect(Math.abs(later.x - stopped.x) + Math.abs(later.y - stopped.y)).toBeLessThan(12);
    expect(problems).toEqual([]);
  });

  test('running into a closed door kills you, the loop restarts, and nothing is lost', async ({ page }) => {
    await page.goto('/?seed=3');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'playing');
    const arena = (await arenaDump(page))!;
    const gate = arena.gates[0]!;
    await pressAt(page, { x: (gate.doorX0 + gate.doorX1) / 2, y: gate.y });
    await waitForPhase(page, 'dead');
    await expect(page.getByText('Rewinding')).toBeVisible();
    await shotNow(page, '04-died');
    await release(page);
    await waitForPhase(page, 'playing');
    const after = (await runDump(page))!;
    expect(after.deaths).toBe(1);
    expect(after.tick).toBeLessThan(120);
    expect(after.ghosts).toHaveLength(0);
    expect(after.loop).toBe(0);
  });

  test('when the time is up the loop rewinds and you become a ghost', async ({ page }) => {
    await page.goto('/?seed=3&speed=240');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'rewind');
    await shotNow(page, '05-rewind');
    await waitForPhase(page, 'playing');
    const run = (await runDump(page))!;
    expect(run.loop).toBe(1);
    expect(run.ghosts).toHaveLength(1);
    await expect(page.getByText('Loop 2 of 8')).toBeVisible();
    await expect(page.getByText('1 ghost with you')).toBeVisible();
  });

  test('the pause button freezes the loop, and Resume carries on', async ({ page }) => {
    await page.goto('/?seed=3');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'playing');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Pause' }).click();
    await waitForPhase(page, 'paused');
    const frozen = (await runDump(page))!.tick;
    await page.waitForTimeout(500);
    expect((await runDump(page))!.tick).toBe(frozen);
    await shot(page, '06-paused');
    await button(page, 'Resume').click();
    await waitForPhase(page, 'playing');
    await expect.poll(async () => (await runDump(page))!.tick).toBeGreaterThan(frozen);
  });
});

test.describe('ghosts', () => {
  test('"Rewind now" appears after a moment and ends the loop early; the ghost stays where it stopped', async ({ page }) => {
    await page.goto('/?seed=3');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'playing');
    await expect(button(page, 'Rewind now')).toBeHidden(); // not in the first half second
    const arena = (await arenaDump(page))!;
    await pressAt(page, { x: arena.start.x + 40, y: arena.start.y - 20 });
    await expect(button(page, 'Rewind now')).toBeVisible();
    await release(page);
    await button(page, 'Rewind now').click();
    await waitForPhase(page, 'rewind');
    await waitForPhase(page, 'playing');
    const run = (await runDump(page))!;
    expect(run.loop).toBe(1);
    expect(run.ghosts).toHaveLength(1);
    // It walks to where the player stopped, then stays there for the rest of the loop.
    await page.waitForTimeout(2200);
    const first = (await runDump(page))!.ghosts[0]!;
    await page.waitForTimeout(1500);
    const second = (await runDump(page))!.ghosts[0]!;
    expect(Math.abs(second.x - first.x) + Math.abs(second.y - first.y)).toBeLessThan(0.5);
    expect(Math.abs(second.x - arena.start.x)).toBeGreaterThan(20); // and it did go somewhere
    await expect(page.getByText('1 ghost with you')).toBeVisible();
  });

  test('several ghosts replay beside you', async ({ page }) => {
    await page.goto('/?seed=3&speed=8&autoplay=1');
    await button(page, /^Random arena/).click();
    await expect.poll(async () => ((await runDump(page))?.loop ?? 0) === 2 && ((await runDump(page))?.tick ?? 0) > 500, { timeout: 40_000, intervals: [50] }).toBe(true);
    await shotNow(page, '15-ghosts');
    const run = (await runDump(page))!;
    expect(run.ghosts).toHaveLength(2);
    expect(run.ghosts.every((g) => g.alive)).toBe(true);
  });
});

test.describe('the end of an arena', () => {
  test('the bot-driven run clears the arena at par for three stars; share and watch-back work', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => ((window as unknown as { __copied: string }).__copied = text) }, configurable: true });
    });
    await page.goto('/?seed=3&speed=30&autoplay=1');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'result', 40_000);
    await expect(page.getByRole('heading', { name: 'Cleared' })).toBeVisible();
    const result = (await resultDump(page))!;
    expect(result.loops).toBe(result.par);
    expect(result.stars).toBe(3);
    expect(result.isBest).toBe(true);
    await shot(page, '07-result');

    // Share puts a link on the clipboard that reproduces the run.
    await button(page, /^Share this run/).click();
    await expect(page.getByText(/Link copied/)).toBeVisible();
    const link = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(link).toContain('?replay=');

    // Watching it back plays the same run again and ends on "Can you beat it?".
    await button(page, /^Watch it back/).click();
    await waitForPhase(page, 'viewer');
    await shot(page, '08-viewer');
    await expect(page.getByText('Can you beat it?')).toBeVisible({ timeout: 60_000 });
    expect(problems).toEqual([]);

    // The profile remembers the best result.
    const profile = (await debugValue<{ results: Record<string, { loops: number; stars: number }>; cleared: number }>(page, 'profile'))!;
    expect(profile.results['3']).toEqual({ loops: result.par, stars: 3 });
    expect(profile.cleared).toBe(1);

    // And that link opens straight into the same run on a fresh page.
    const other = await page.context().newPage();
    await other.goto(link);
    await waitForPhase(other, 'viewer');
    await expect(other.getByText(/A friend cleared arena 3/)).toBeVisible();
    await shot(other, '09-shared');
    await other.getByRole('button', { name: 'Play this arena' }).click();
    await waitForPhase(other, 'playing');
    expect((await runDump(other))!.seed).toBe(3);
  });

  test('a broken link says so and lands on the menu', async ({ page }) => {
    await page.goto('/?replay=thisisnotarun');
    await expect(page.getByText('That link is not a valid run')).toBeVisible();
    expect(await phase(page)).toBe('menu');
    await page.goto('/?replay=');
    expect(await phase(page)).toBe('menu');
  });

  test('running out of loops ends the run, and a rewarded ad gives more', async ({ page }) => {
    await page.goto('/?seed=3&speed=240');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'lost', 60_000);
    await expect(page.getByRole('heading', { name: 'Out of loops' })).toBeVisible();
    await shot(page, '10-lost');
    await button(page, /^Watch ad for more loops/).click();
    await expect(page.getByText('Test ad', { exact: true })).toBeVisible();
    await waitForPhase(page, 'playing', 30_000);
    const run = (await runDump(page))!;
    expect(run.maxLoops).toBe(10);
    expect(run.loop).toBe(8);
  });
});

test.describe('the bot demo', () => {
  test('plays arena after arena by itself, fast, and Stop returns to the menu', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=10');
    await button(page, /^Watch it play itself/).click();
    await waitForPhase(page, 'demo');
    await shot(page, '11-demo');
    await expect.poll(async () => (await debugValue<{ cleared: number }>(page, 'playback'))?.cleared ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    const playback = (await debugValue<{ cleared: number; totalLoops: number; seed: number }>(page, 'playback'))!;
    expect(playback.totalLoops).toBeGreaterThanOrEqual(4);
    expect(playback.seed).toBeGreaterThan(10);
    await shotNow(page, '12-demo-later');
    await button(page, 'Stop').click();
    await waitForPhase(page, 'menu');
    expect(problems).toEqual([]);
  });
});

test.describe('settings', () => {
  test('sound and vibration toggles are saved', async ({ page }) => {
    await page.goto('/');
    await button(page, 'Settings').click();
    await shot(page, '13-settings');
    await expect(page.getByRole('switch', { name: /Sound: On/ })).toBeVisible();
    await page.getByRole('switch', { name: /Sound/ }).click();
    await expect(page.getByRole('switch', { name: /Sound: Off/ })).toBeVisible();
    await page.getByRole('switch', { name: /Vibration/ }).click();
    const profile = (await debugValue<{ settings: { sound: boolean; haptics: boolean } }>(page, 'profile'))!;
    expect(profile.settings).toEqual({ sound: false, haptics: false });
    await page.reload();
    const again = (await debugValue<{ settings: { sound: boolean; haptics: boolean } }>(page, 'profile'))!;
    expect(again.settings).toEqual({ sound: false, haptics: false });
  });
});

test.describe('wide desktop window', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('letterboxes the arena; dragging still lines up with the mouse', async ({ page }) => {
    await page.goto('/?seed=3');
    await button(page, /^Random arena/).click();
    await waitForPhase(page, 'playing');
    const arena = (await arenaDump(page))!;
    const target = { x: arena.start.x + 60, y: arena.start.y - 30 };
    await pressAt(page, target);
    await expect.poll(async () => Math.abs((await runDump(page))!.player.x - target.x), { timeout: 5000 }).toBeLessThan(2);
    await shotNow(page, '14-wide');
    await release(page);
    expect((await snapshot(page))?.alive).toBe(true);
    await moveTo(page, target);
  });
});
