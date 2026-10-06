import { devices, expect, test } from '@playwright/test';
import { button, centreOf, colourCount, debug, duel, Fingers, litFraction, me, overlaps, phase, pressables, prop, shot, startMatch, waitForPhase, watchForErrors } from './helpers';

const desktopAgent = devices['Desktop Chrome'].userAgent;

/** Everything here runs in a phone held sideways (Playwright's "Pixel 7 landscape"), with real multi-touch, unless it says otherwise. */

test.describe('menu', () => {
  test('opens over a bots-only match, with the choices, the map and the links', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=5');
    await expect(page.getByRole('heading', { name: 'ARENA ZERO', level: 1 })).toBeVisible();
    for (const name of ['Teams', 'Free for all', 'Easy', 'Normal', 'Hard', '4', '6', '8', '10', 'Play', 'How to play', 'Settings', 'New map']) {
      await expect(button(page, name)).toBeVisible();
    }
    await expect(page.getByText('Map 5')).toBeVisible();
    await expect.poll(async () => await page.locator('canvas[data-layer="world3d"]').count()).toBe(1);
    expect(await phase(page)).toBe('menu');
    // The match behind the menu is really being played: bots move and the clock runs.
    await expect.poll(async () => (await page.evaluate(() => (window.__game!.debug as Record<string, any>)['demo'].tick)) as number).toBeGreaterThan(120);
    // And it is drawn: the 3D view fills the screen with something other than black.
    const view = page.viewportSize()!;
    expect(await litFraction(page, { x: view.width * 0.6, y: 0, width: view.width * 0.4, height: view.height })).toBeGreaterThan(0.5);
    expect(await colourCount(page, { x: view.width * 0.6, y: 0, width: view.width * 0.4, height: view.height })).toBeGreaterThan(40);
    await shot(page, '01-menu');
    expect(problems).toEqual([]);
  });

  test('how to play and settings open and close, and what is set is remembered', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=5');
    await button(page, 'How to play').tap();
    await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
    await expect(page.getByText('Drag anywhere on the left to move')).toBeVisible();
    await shot(page, '02-help');
    await button(page, 'Back').tap();
    await expect(page.getByRole('heading', { name: 'ARENA ZERO' })).toBeVisible();

    await button(page, 'Settings').tap();
    await expect(button(page, /^Sound/)).toContainText('On');
    await button(page, /^Sound/).tap();
    await expect(button(page, /^Sound/)).toContainText('Off');
    await button(page, /^Left handed/).tap();
    await button(page, 'Sharp').tap();
    await page.locator('input[data-key="sensitivity"]').evaluate((input: HTMLInputElement) => {
      input.value = '1.6';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByText('1.60x')).toBeVisible();
    await shot(page, '03-settings');
    await button(page, 'Back').tap();
    await page.reload();
    await button(page, 'Settings').tap();
    await expect(button(page, /^Sound/)).toContainText('Off');
    await expect(button(page, /^Left handed/)).toContainText('On');
    await expect(button(page, 'Sharp')).toHaveClass(/is-on/);
    await expect(page.getByText('1.60x')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the mode, the bots, the number of players and a new map are remembered', async ({ page }) => {
    await page.goto('/?seed=5');
    await button(page, 'Free for all').tap();
    await button(page, 'Hard').tap();
    await button(page, '8').tap();
    await expect(button(page, 'Free for all')).toHaveClass(/is-on/);
    await expect(button(page, 'Hard')).toHaveClass(/is-on/);
    await expect(button(page, '8')).toHaveClass(/is-on/);
    const before = await page.getByText(/^Map \d+$/).innerText();
    await button(page, 'New map').tap();
    await expect.poll(async () => await page.getByText(/^Map \d+$/).innerText()).not.toBe(before);
    // The URL's seed is only for the first visit: the player's own choice wins once made... but not here, as the URL fixes it.
    await page.goto('/');
    await expect(button(page, 'Free for all')).toHaveClass(/is-on/);
    await expect(button(page, 'Hard')).toHaveClass(/is-on/);
    await expect(button(page, '8')).toHaveClass(/is-on/);
  });
});

test.describe('a match', () => {
  test('counts down, then starts: full health, the pistol and the rifle, the right number of players, the HUD', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page, 'seed=3&level=easy&bots=5', true);
    // The countdown holds the match still.
    await expect(page.getByText('ELIMINATED')).toBeHidden();
    const first = await me(page);
    expect(first.tick).toBe(0);
    await shot(page, '04-countdown');
    await expect.poll(async () => (await me(page)).tick, { timeout: 20_000 }).toBeGreaterThan(30);
    const s = await me(page);
    expect(s.health).toBe(100);
    expect(s.armor).toBe(0);
    expect(s.owned).toEqual([true, true, false, false, false]);
    expect(s.current).toBe(1);
    const players = await page.evaluate(() => (window.__game!.debug as Record<string, any>)['match'].actors.length);
    expect(players).toBe(6);
    // The HUD: health, the score, the clock, the weapon and its ammunition, the bar of guns.
    await expect(page.locator('.bar-health .bar-text')).toHaveText('100');
    await expect(page.locator('.clock')).toHaveText(/^[45]:\d\d$/);
    await expect(page.locator('.ammo-name')).toHaveText('Arc Rifle');
    await expect(page.locator('.ammo-mag')).toHaveText('30');
    await expect(page.locator('.slot.is-current')).toHaveCount(1);
    expect(problems).toEqual([]);
  });

  test('the touch controls: the left thumb moves, the right thumb looks, fire shoots, jump leaves the floor, reload refills, aim zooms', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page);
    await duel(page, 14);
    // Walls and enemies out of the way: stand in the open.
    await page.evaluate(() => {
      const dbg = window.__game!.debug as Record<string, any>;
      dbg['look'](0, 0);
    });
    const fingers = await Fingers.on(page);
    const view = page.viewportSize()!;

    // Move: a thumb on the left, pushed forward.
    const start = await me(page);
    await fingers.down(1, view.width * 0.2, view.height * 0.75);
    await fingers.slide(1, view.width * 0.2, view.height * 0.75 - 50);
    await expect.poll(async () => (await me(page)).speed, { timeout: 5_000 }).toBeGreaterThan(2);
    await shot(page, '05-touch-move');
    await fingers.up(1);
    const moved = await me(page);
    expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(0.5);

    // Look: a thumb dragged across the right of the screen turns the view left (the simulation's positive yaw).
    const before = await me(page);
    await fingers.down(2, view.width * 0.7, view.height * 0.4);
    await fingers.slide(2, view.width * 0.5, view.height * 0.4);
    await fingers.up(2);
    await expect.poll(async () => (await me(page)).yaw).toBeGreaterThan(before.yaw + 0.2);
    await fingers.down(2, view.width * 0.6, view.height * 0.5);
    await fingers.slide(2, view.width * 0.6, view.height * 0.4);
    await fingers.up(2);
    await expect.poll(async () => (await me(page)).pitch).toBeGreaterThan(before.pitch + 0.1);

    // Fire: the big button, held.
    const fire = await centreOf(button(page, 'Fire'));
    const shots = (await me(page)).shots;
    await fingers.down(3, fire.x, fire.y);
    await expect.poll(async () => (await me(page)).shots, { timeout: 5_000 }).toBeGreaterThan(shots + 3);
    await shot(page, '06-touch-fire');
    // The thumb that is firing can also turn the view.
    const yaw = (await me(page)).yaw;
    await fingers.slide(3, fire.x - 70, fire.y);
    await expect.poll(async () => (await me(page)).yaw).toBeGreaterThan(yaw + 0.1);
    await fingers.up(3);
    const after = (await me(page)).shots;
    await page.waitForTimeout(300);
    expect((await me(page)).shots).toBe(after);

    // Reload: the magazine is refilled.
    const mag = (await me(page)).mag;
    expect(mag).toBeLessThan(30);
    const reload = await centreOf(button(page, 'Reload'));
    await fingers.down(4, reload.x, reload.y);
    await fingers.up(4);
    await expect.poll(async () => (await me(page)).reloading).toBeGreaterThan(0);
    await expect.poll(async () => (await me(page)).mag, { timeout: 8_000 }).toBe(30);

    // Jump: off the floor for a moment.
    const jump = await centreOf(button(page, 'Jump'));
    await fingers.down(5, jump.x, jump.y);
    let high = 0;
    for (let i = 0; i < 12; i++) {
      high = Math.max(high, (await me(page)).y);
      await page.waitForTimeout(40);
    }
    await fingers.up(5);
    expect(high).toBeGreaterThan(0.4);

    // Aim: toggles the sights, and the button shows it.
    const aim = await centreOf(button(page, 'Aim'));
    await fingers.down(6, aim.x, aim.y);
    await fingers.up(6);
    await expect.poll(async () => (await me(page)).aiming).toBe(true);
    await expect(button(page, 'Aim')).toHaveClass(/is-lit/);
    await fingers.down(6, aim.x, aim.y);
    await fingers.up(6);
    await expect.poll(async () => (await me(page)).aiming).toBe(false);

    await fingers.dispose();
    expect(problems).toEqual([]);
  });

  test('two thumbs at once: moving and looking and shooting do not cancel one another', async ({ page }) => {
    await startMatch(page);
    await duel(page, 14);
    const fingers = await Fingers.on(page);
    const view = page.viewportSize()!;
    const fire = await centreOf(button(page, 'Fire'));
    const start = await me(page);
    await fingers.down(1, view.width * 0.2, view.height * 0.75);
    await fingers.slide(1, view.width * 0.2, view.height * 0.75 - 50);
    await fingers.down(2, fire.x, fire.y);
    await fingers.slide(2, fire.x - 60, fire.y - 10);
    await page.waitForTimeout(500);
    const mid = await me(page);
    expect(mid.speed).toBeGreaterThan(1);
    expect(mid.shots).toBeGreaterThan(start.shots);
    expect(mid.yaw).toBeGreaterThan(start.yaw + 0.05);
    await fingers.dispose();
    await page.waitForTimeout(400);
    expect((await me(page)).speed).toBeLessThan(0.5);
  });

  test('the weapon bar chooses a gun and the swap button cycles through the ones you own', async ({ page }) => {
    await startMatch(page);
    await debug(page, 'give', 'shotgun');
    await expect(page.locator('.slot.is-owned')).toHaveCount(3);
    await page.locator('.slot[data-slot="2"]').tap();
    await expect.poll(async () => (await me(page)).current).toBe(2);
    await expect(page.locator('.ammo-name')).toHaveText('Scatter');
    await page.locator('.slot[data-slot="0"]').tap();
    await expect.poll(async () => (await me(page)).current).toBe(0);
    await button(page, 'Next weapon').tap();
    await expect.poll(async () => (await me(page)).current).toBe(1);
    await button(page, 'Next weapon').tap();
    await expect.poll(async () => (await me(page)).current).toBe(2);
    await button(page, 'Next weapon').tap();
    await expect.poll(async () => (await me(page)).current).toBe(0);
    // A gun that is not owned cannot be chosen.
    await expect(page.locator('.slot[data-slot="4"]')).toBeDisabled();
  });

  test('shooting a bot dead: it takes damage, a hit marker, the kill feed and a toast, and its body falls as a ragdoll', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page);
    await duel(page, 7);
    const fingers = await Fingers.on(page);
    const fire = await centreOf(button(page, 'Fire'));
    await fingers.down(1, fire.x, fire.y);
    // Keep the crosshair on the target as it flinches.
    await expect
      .poll(
        async () => {
          await debug(page, 'faceActor', 1);
          return await page.evaluate(() => (window.__game!.debug as Record<string, any>)['match'].actors[1].alive);
        },
        { timeout: 12_000, intervals: [60] },
      )
      .toBe(false);
    await fingers.up(1);
    const s = await me(page);
    expect(s.kills).toBe(1);
    expect(s.hits).toBeGreaterThan(2);
    await expect(page.locator('.feed-row.is-mine')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('Eliminated');
    await expect(page.locator('.score-left .score-value')).toHaveText('1');
    expect(await debug<boolean>(page, 'fallen', 1)).toBe(true);
    await shot(page, '07-kill');
    expect(problems).toEqual([]);
  });

  test('a body keeps falling after the shot: the ragdoll moves, then settles on the floor', async ({ page }) => {
    await startMatch(page);
    await duel(page, 7);
    // Whatever it is standing on (the floor, or a crate, or a platform), the body ends up lying on it.
    const ground = await page.evaluate(() => (window.__game!.debug as Record<string, any>)['match'].actors[1].y as number);
    await debug(page, 'kill', 1);
    await expect.poll(async () => await debug<boolean>(page, 'fallen', 1)).toBe(true);
    const head = (): Promise<{ x: number; y: number; z: number }> => page.evaluate(() => (window.__game!.debug as Record<string, any>)['fallenHead'](1));
    const first = await head();
    await page.waitForTimeout(250);
    const second = await head();
    expect(Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z)).toBeGreaterThan(0.05);
    await page.waitForTimeout(1500);
    const rest = await head();
    // Lying down: the head is close to the ground it fell on, not at standing height (1.66 above it).
    expect(rest.y - ground).toBeLessThan(0.7);
  });

  test('dying: the ragdoll view, the banner with the ad button, and a new life after the countdown, safe for a moment', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page);
    await duel(page, 8);
    await debug(page, 'kill', 0);
    await expect(page.locator('.banner-title')).toHaveText('ELIMINATED');
    await expect(page.locator('.banner-sub')).toContainText('back in');
    await expect(page.locator('.banner-boost')).toBeVisible();
    expect((await me(page)).alive).toBe(false);
    expect(await debug<boolean>(page, 'fallen', 0)).toBe(true);
    await shot(page, '08-dead');
    await expect.poll(async () => (await me(page)).alive, { timeout: 10_000 }).toBe(true);
    await expect(page.locator('.banner')).toBeHidden();
    const s = await me(page);
    expect(s.health).toBe(100);
    expect(s.deaths).toBe(1);
    expect(await debug<boolean>(page, 'fallen', 0)).toBe(false);
    expect(problems).toEqual([]);
  });

  test('the rewarded ad brings you back at once with armor and the heavy guns, once a match', async ({ page }) => {
    await startMatch(page, 'seed=3&level=easy&bots=3&ads=ok');
    await debug(page, 'kill', 0);
    await expect(page.locator('.banner-boost')).toBeVisible();
    await page.locator('.banner-boost').tap();
    await expect.poll(async () => (await me(page)).alive, { timeout: 20_000 }).toBe(true);
    const s = await me(page);
    expect(s.armor).toBe(100);
    expect(s.owned).toEqual([true, true, false, true, true]);
    await debug(page, 'kill', 0);
    await expect(page.locator('.banner-title')).toHaveText('ELIMINATED');
    await expect(page.locator('.banner-boost')).toBeHidden();
  });

  test('pausing stops the match and the pause screen resumes, restarts and quits', async ({ page }) => {
    await startMatch(page);
    await page.getByRole('button', { name: 'Pause' }).tap();
    await waitForPhase(page, 'paused');
    await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
    const frozen = (await me(page)).tick;
    await page.waitForTimeout(600);
    expect((await me(page)).tick).toBe(frozen);
    await shot(page, '09-pause');
    await button(page, 'Resume').tap();
    await waitForPhase(page, 'playing');
    await expect.poll(async () => (await me(page)).tick).toBeGreaterThan(frozen + 10);
    await page.getByRole('button', { name: 'Pause' }).tap();
    await button(page, 'Restart match').tap();
    await waitForPhase(page, 'playing');
    await expect.poll(async () => (await me(page)).tick).toBeLessThan(120);
    await page.getByRole('button', { name: 'Pause' }).tap();
    await button(page, 'Quit to menu').tap();
    await waitForPhase(page, 'menu');
    await expect(page.getByRole('heading', { name: 'ARENA ZERO' })).toBeVisible();
  });

  test('the scoreboard chip shows the table of everyone and hides it again', async ({ page }) => {
    await startMatch(page, 'seed=3&level=easy&bots=3&mode=ffa');
    await expect(page.locator('.board')).toBeHidden();
    await page.getByRole('button', { name: 'Scoreboard' }).tap();
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('.board .brow')).toHaveCount(5);
    await expect(page.locator('.board .brow.is-you')).toContainText('You');
    await shot(page, '10-board');
    await page.getByRole('button', { name: 'Scoreboard' }).tap();
    await expect(page.locator('.board')).toBeHidden();
  });

  test('the match ends: the result with a table and your numbers, then play again or the menu', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page, 'seed=3&level=easy&bots=3&mode=ffa');
    await page.evaluate(() => {
      const m = (window.__game!.debug as Record<string, any>)['match'];
      m.actors[0].kills = 12;
      m.scores[0] = 12;
      m.timeLeft = 5;
    });
    await waitForPhase(page, 'result', 20_000);
    await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible();
    await expect(page.locator('.panel-result .brow')).toHaveCount(5);
    await expect(page.locator('.panel-result .fact').first()).toContainText('Kills');
    await shot(page, '11-result');
    await button(page, 'Play again').tap();
    await waitForPhase(page, 'playing');
    expect((await me(page)).kills).toBe(0);
    // Played, won, and the career numbers kept.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arenazero.profile') ?? '{}'));
    expect(saved).toMatchObject({ played: 1, wins: 1, kills: 12, best: 12 });
    expect(problems).toEqual([]);
  });

  test('a lost match says so, and names the winner', async ({ page }) => {
    await startMatch(page, 'seed=3&level=easy&bots=3&mode=ffa');
    await page.evaluate(() => {
      const m = (window.__game!.debug as Record<string, any>)['match'];
      m.actors[2].kills = 20;
      m.scores[2] = 20;
    });
    await waitForPhase(page, 'result', 20_000);
    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    await expect(page.locator('.result-sub')).toContainText('won with 20 kills');
  });

  test('in a team match you and your teammates are on one side, the table is by team', async ({ page }) => {
    await startMatch(page, 'seed=3&level=easy&bots=5&mode=tdm');
    const teams = await page.evaluate(() => (window.__game!.debug as Record<string, any>)['match'].actors.map((a: any) => a.team));
    expect(teams).toEqual([0, 1, 0, 1, 0, 1]);
    await expect(page.locator('.score-left .score-label')).toHaveText('You');
    await expect(page.locator('.score-right .score-label')).toHaveText('Them');
    await expect(page.locator('.limit')).toHaveText('First to 40');
  });

  test('the 3D view really draws: the arena, the guns and the bodies', async ({ page }) => {
    await startMatch(page);
    await duel(page, 6);
    await page.waitForTimeout(600);
    const view = page.viewportSize()!;
    const clip = { x: view.width * 0.3, y: view.height * 0.15, width: view.width * 0.4, height: view.height * 0.6 };
    expect(await litFraction(page, clip)).toBeGreaterThan(0.6);
    expect(await colourCount(page, clip)).toBeGreaterThan(60);
  });
});

test.describe('on every phone', () => {
  const sizes = [
    { width: 667, height: 375 },
    { width: 740, height: 360 },
    { width: 800, height: 360 },
    { width: 844, height: 390 },
    { width: 915, height: 412 },
    { width: 932, height: 430 },
    { width: 1024, height: 768 },
  ];
  for (const size of sizes) {
    test(`${size.width} x ${size.height}: the menu fits, every control is a finger wide and nothing overlaps`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/?seed=5&quality=1');
      // The menu: inside the screen, with a Play button a thumb can hit.
      const play = await button(page, 'Play').boundingBox();
      expect(play!.height).toBeGreaterThanOrEqual(43.5);
      for (const name of ['Teams', 'Free for all', 'Easy', 'Normal', 'Hard', 'New map', 'How to play', 'Settings']) {
        const box = await button(page, name).boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(43.5);
        expect(box!.y + box!.height, name).toBeLessThanOrEqual(size.height + 0.5);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(size.width + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

      await button(page, 'Play').tap();
      await waitForPhase(page, 'playing');
      await page.waitForTimeout(400);
      const boxes = await pressables(page);
      expect(boxes.map((b) => b.name)).toEqual(expect.arrayContaining(['Fire', 'Jump', 'Aim', 'Reload', 'Next weapon', 'Pause', 'Scoreboard', 'slot 0', 'slot 1']));
      for (const b of boxes) {
        expect(b.width, b.name).toBeGreaterThanOrEqual(43.5);
        expect(b.height, b.name).toBeGreaterThanOrEqual(43.5);
        expect(b.x, b.name).toBeGreaterThanOrEqual(-0.5);
        expect(b.y, b.name).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width, b.name).toBeLessThanOrEqual(size.width + 0.5);
        expect(b.y + b.height, b.name).toBeLessThanOrEqual(size.height + 0.5);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.name} overlaps ${boxes[j]!.name}`).toBe(false);
      }
      await shot(page, `12-hud-${size.width}x${size.height}`);
    });
  }

  test('left-handed: the thumbs swap sides, the fire button on the left, the stick on the right', async ({ page }) => {
    await page.goto('/?seed=5&quality=1&countdown=0');
    await button(page, 'Settings').tap();
    await button(page, /^Left handed/).tap();
    await button(page, 'Back').tap();
    await button(page, 'Play').tap();
    await waitForPhase(page, 'playing');
    // In the open, facing clear ground, and nobody to hurt us.
    await duel(page, 14);
    await debug(page, 'look', 0, 0);
    const view = page.viewportSize()!;
    const fire = await centreOf(button(page, 'Fire'));
    expect(fire.x).toBeLessThan(view.width / 2);
    const fingers = await Fingers.on(page);
    const start = await me(page);
    // The stick is now under the right thumb.
    await fingers.down(1, view.width * 0.8, view.height * 0.75);
    await fingers.slide(1, view.width * 0.8, view.height * 0.75 - 50);
    await expect.poll(async () => (await me(page)).speed, { timeout: 5_000 }).toBeGreaterThan(2);
    await fingers.up(1);
    // And the look is under the left.
    const before = await me(page);
    await fingers.down(2, view.width * 0.4, view.height * 0.4);
    await fingers.slide(2, view.width * 0.2, view.height * 0.4);
    await fingers.up(2);
    await expect.poll(async () => (await me(page)).yaw).toBeGreaterThan(before.yaw + 0.2);
    expect(Math.hypot((await me(page)).x - start.x, (await me(page)).z - start.z)).toBeGreaterThan(0.3);
    await shot(page, '13-left-handed');
    await fingers.dispose();
  });

  test('the HUD never blocks a touch: it is see-through to the look area underneath', async ({ page }) => {
    await startMatch(page);
    const result = await page.evaluate(() => {
      const hud = document.querySelector('.hud') as HTMLElement;
      const style = getComputedStyle(hud);
      // Every element of the HUD that is not a button must let touches through.
      const blockers: string[] = [];
      for (const node of hud.querySelectorAll('*')) {
        const s = getComputedStyle(node);
        const interactive = node.closest('button') !== null || node.tagName === 'BUTTON' || node.classList.contains('slots') || node.closest('.slots') !== null;
        if (!interactive && s.pointerEvents !== 'none') blockers.push(node.className.toString());
      }
      return { hud: style.pointerEvents, blockers };
    });
    expect(result.hud).toBe('none');
    expect(result.blockers).toEqual([]);
  });
});

test.describe('a phone held upright', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('asks to be turned sideways', async ({ page }) => {
    await page.goto('/?seed=5&quality=1');
    await expect(page.getByText('Turn your phone sideways to play')).toBeVisible();
    await shot(page, '14-upright');
  });
});

test.describe('with a keyboard and a mouse', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1, userAgent: desktopAgent });

  test('W A S D walk, Space jumps, 1 and 2 choose a gun, Tab shows the table, Esc pauses', async ({ page }) => {
    const problems = watchForErrors(page);
    await startMatch(page);
    await duel(page, 14);
    expect(await prop<boolean>(page, 'touch')).toBe(false);
    // No touch controls on a desktop.
    await expect(button(page, 'Fire')).toBeHidden();
    const start = await me(page);
    await page.keyboard.down('w');
    await expect.poll(async () => (await me(page)).speed, { timeout: 5_000 }).toBeGreaterThan(3);
    await page.keyboard.up('w');
    expect(Math.hypot((await me(page)).x - start.x, (await me(page)).z - start.z)).toBeGreaterThan(0.5);

    await page.keyboard.down('Space');
    let high = 0;
    for (let i = 0; i < 12; i++) {
      high = Math.max(high, (await me(page)).y);
      await page.waitForTimeout(40);
    }
    await page.keyboard.up('Space');
    expect(high).toBeGreaterThan(0.4);

    await page.keyboard.press('1');
    await expect.poll(async () => (await me(page)).current).toBe(0);
    await page.keyboard.press('2');
    await expect.poll(async () => (await me(page)).current).toBe(1);
    await page.keyboard.press('r');
    await expect.poll(async () => (await me(page)).mag).toBe(30);

    await page.keyboard.down('Tab');
    await expect(page.locator('.board')).toBeVisible();
    await page.keyboard.up('Tab');
    await expect(page.locator('.board')).toBeHidden();
    await shot(page, '15-desktop');

    await page.keyboard.press('Escape');
    await waitForPhase(page, 'paused');
    await button(page, 'Resume').click();
    await waitForPhase(page, 'playing');
    expect(problems).toEqual([]);
  });

  test('the mouse fires, and where the browser will not capture it a right-drag looks', async ({ page }) => {
    await startMatch(page);
    await duel(page, 12);
    // A first click asks the browser to capture the mouse (it may refuse in a test browser; the game copes).
    await page.mouse.click(640, 360);
    await page.waitForTimeout(300);
    const locked = await prop<boolean>(page, 'locked');
    if (!locked) {
      const before = await me(page);
      await page.mouse.move(640, 360);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(540, 360, { steps: 6 });
      await page.mouse.up({ button: 'right' });
      expect((await me(page)).yaw).toBeGreaterThan(before.yaw + 0.1);
    }
    const shots = (await me(page)).shots;
    await page.mouse.down();
    await expect.poll(async () => (await me(page)).shots, { timeout: 5_000 }).toBeGreaterThan(shots + 2);
    await page.mouse.up();
  });
});
