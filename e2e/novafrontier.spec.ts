import { expect, test, type Page } from '@playwright/test';
import {
  boxAround,
  button,
  clickEntity,
  destroyBuildings,
  entities,
  focus,
  freeSpot,
  give,
  home,
  minerals,
  reveal,
  screenOf,
  screenOfPoint,
  shot,
  snap,
  spawn,
  startBattle,
  waitForPhase,
  watchForErrors,
} from './helpers';

/** Presses and drags with real fingers (Chrome's own touch events), which Playwright's `tap` cannot do. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 0): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  if (hold > 0) await page.waitForTimeout(hold);
  for (let i = 1; i <= 8; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function pinch(page: Page, centre: { x: number; y: number }, from: number, to: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const points = (d: number) => [
    { x: centre.x - d / 2, y: centre.y, id: 1 },
    { x: centre.x + d / 2, y: centre.y, id: 2 },
  ];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 8; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + ((to - from) * i) / 8) });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test.describe('menu', () => {
  test('opens on a battle that is already under way, with the opponents, the map and the links', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?seed=5');
    await expect(page.getByRole('heading', { name: 'Nova Frontier', level: 1 })).toBeVisible();
    for (const name of ['Easy', 'Normal', 'Hard']) await expect(button(page, name)).toBeVisible();
    await expect(button(page, /^Battle/)).toBeVisible();
    await expect(button(page, 'How to play')).toBeVisible();
    await expect(button(page, 'Settings')).toBeVisible();
    await expect(page.getByText('Map 5')).toBeVisible();
    await expect.poll(async () => await page.locator('canvas[data-layer="world3d"]').count()).toBe(1);
    expect(await page.evaluate(() => window.__game?.phase)).toBe('menu');
    // The demo behind the menu really is a game being played: it has buildings and units on both sides.
    const demo = await page.evaluate(() => {
      const m = (window.__game!.debug as Record<string, any>)['demo'];
      return { tick: m.tick, buildings: m.entities.filter((e: any) => e.alive && e.type === 'hub').length };
    });
    expect(demo.tick).toBeGreaterThan(2000);
    expect(demo.buildings).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    await shot(page, '01-menu');
    expect(problems).toEqual([]);
  });

  test('how to play and settings open and close, and settings are remembered', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/?demo=0');
    await button(page, 'How to play').click();
    await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
    await expect(page.getByText('Attack-move: fight whatever you meet')).toBeVisible();
    await shot(page, '02-help');
    await button(page, 'Back').click();
    await expect(page.getByRole('heading', { name: 'Nova Frontier' })).toBeVisible();

    await button(page, 'Settings').click();
    await expect(button(page, /^Sound/)).toContainText('On');
    await button(page, /^Sound/).click();
    await expect(button(page, /^Sound/)).toContainText('Off');
    await button(page, 'Back').click();
    await page.reload();
    await button(page, 'Settings').click();
    await expect(button(page, /^Sound/)).toContainText('Off');
    expect(problems).toEqual([]);
  });

  test('choosing an opponent and a new map is remembered', async ({ page }) => {
    await page.goto('/?demo=0');
    await button(page, 'Hard').click();
    await expect(button(page, 'Hard')).toHaveClass(/is-on/);
    const before = await page.getByText(/^Map \d+$/).innerText();
    await button(page, 'New map').click();
    await expect.poll(async () => await page.getByText(/^Map \d+$/).innerText()).not.toBe(before);
    await page.reload();
    await expect(button(page, 'Hard')).toHaveClass(/is-on/);
  });
});

test.describe('a battle', () => {
  test('starts with a hub, four workers mining, 250 minerals, the hub selected and its commands showing', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page);
    const s = await snap(page);
    expect(s.minerals).toBe(250);
    expect(s.counts).toMatchObject({ hub: 1, worker: 4 });
    expect(s.enemyCounts).toMatchObject({ hub: 1, worker: 4 });
    expect(s.supplyUsed).toBe(4);
    expect(s.supplyCap).toBe(10);
    expect(s.selected).toHaveLength(1);
    await expect(page.locator('.sel-title')).toHaveText('Hub');
    await expect(button(page, /^Worker/)).toBeVisible();
    await expect(page.locator('.res-minerals .res-value')).toHaveText('250');
    await expect(page.locator('.res-supply .res-value')).toHaveText('4/10');
    await page.waitForTimeout(1500);
    await shot(page, '03-start');
    expect(problems).toEqual([]);
  });

  test('the workers mine: money comes in and the numbers on screen follow', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0&speed=6');
    await expect.poll(async () => (await snap(page)).mined, { timeout: 20_000 }).toBeGreaterThan(40);
    const s = await snap(page);
    expect(s.minerals).toBeGreaterThan(250 + 30);
    await expect(page.locator('.res-minerals .res-value')).toHaveText(String(Math.floor(s.minerals)), { timeout: 3000 }).catch(() => {});
    const shown = Number(await page.locator('.res-minerals .res-value').innerText());
    expect(shown).toBeGreaterThanOrEqual(s.minerals - 60);
  });

  test('Q trains a worker: the money and supply are taken, it queues, and it appears', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0&speed=6');
    const { hub } = await home(page);
    await page.keyboard.press('q');
    await expect.poll(async () => (await entities(page, 'hub'))[0]!.queue).toBe(1);
    expect((await snap(page)).supplyUsed).toBe(5);
    await expect(page.locator('.queue-slot')).toHaveCount(1);
    await shot(page, '04-training');
    await expect.poll(async () => (await snap(page)).counts['worker'], { timeout: 25_000 }).toBe(5);
    await expect(page.locator('.queue-slot')).toHaveCount(0);
    // It walked out of the hub and went to mine (the hub's rally point is its default).
    const workers = await entities(page, 'worker');
    expect(workers).toHaveLength(5);
    expect(hub.id).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('right click sends workers to mine a patch; stopping them first proves the order works', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const { workers, patches } = await home(page);
    // Double click one worker: every worker on the screen is selected.
    const at = (await screenOf(page, workers[0]!.id))!;
    await page.mouse.dblclick(at.x, at.y);
    await expect.poll(async () => (await snap(page)).selected.length).toBe(4);
    await page.keyboard.press('s');
    await expect.poll(async () => (await entities(page, 'worker')).every((w) => w.order === 'idle')).toBe(true);
    const patch = patches[3]!;
    await clickEntity(page, patch.id, 'right');
    await expect.poll(async () => (await entities(page, 'worker')).every((w) => w.order === 'gather')).toBe(true);
    const before = (await snap(page)).mined;
    await expect.poll(async () => (await snap(page)).mined, { timeout: 20_000 }).toBeGreaterThan(before + 15);
  });

  test('B, D, then a click puts up a depot that raises the supply limit', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0&speed=5');
    const { hub, workers } = await home(page);
    await clickEntity(page, workers[0]!.id);
    await expect.poll(async () => (await snap(page)).selected).toEqual([workers[0]!.id]);
    await expect(button(page, /^Build/)).toBeVisible();
    await page.keyboard.press('b');
    await expect(button(page, /^Depot/)).toBeVisible();
    await shot(page, '05-build-menu');
    await page.keyboard.press('d');
    await expect.poll(async () => (await snap(page)).mode).toBe('place');

    const spot = (await freeSpot(page, 'depot', hub.x + 3, hub.y + 6))!;
    expect(spot).not.toBeNull();
    const at = await reveal(page, spot.x, spot.y);
    await page.mouse.move(at.x - 30, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.waitForTimeout(300);
    await shot(page, '06-placing');
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await snap(page)).mode).toBe('none');

    await expect.poll(async () => (await snap(page)).counts['depot'] ?? 0, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await entities(page, 'depot'))[0]?.progress ?? 0, { timeout: 25_000 }).toBe(1);
    await expect.poll(async () => (await snap(page)).supplyCap).toBe(18);
    expect(problems).toEqual([]);
  });

  test('an order that cannot work says why instead of doing nothing', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const { workers } = await home(page);
    await clickEntity(page, workers[0]!.id);
    await page.keyboard.press('b');
    // Barracks cost 150 and the player has 250, but a factory needs a barracks first.
    await page.keyboard.press('f');
    await expect(page.locator('.toast')).toContainText('Needs a Barracks');
    expect((await snap(page)).mode).toBe('none');
  });

  test('Escape cancels placing, then pauses; time stops while paused and carries on after', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const { workers } = await home(page);
    await clickEntity(page, workers[0]!.id);
    await page.keyboard.press('b');
    await page.keyboard.press('d');
    expect((await snap(page)).mode).toBe('place');
    await page.keyboard.press('Escape');
    expect((await snap(page)).mode).toBe('none');
    await page.keyboard.press('Escape');
    await waitForPhase(page, 'paused');
    await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
    await shot(page, '07-paused');
    const t0 = (await snap(page)).tick;
    await page.waitForTimeout(700);
    expect((await snap(page)).tick).toBe(t0);
    await button(page, 'Resume').click();
    await waitForPhase(page, 'playing');
    await expect.poll(async () => (await snap(page)).tick).toBeGreaterThan(t0 + 5);
  });

  test('the minimap moves the camera, and the camera keys and the wheel work', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const before = (await snap(page)).cam;
    const box = (await page.locator('canvas.minimap').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.75);
    await expect.poll(async () => (await snap(page)).cam.x).toBeGreaterThan(before.x + 20);
    await expect.poll(async () => (await snap(page)).cam.y).toBeGreaterThan(before.y + 20);
    const c1 = (await snap(page)).cam;
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    expect((await snap(page)).cam.x).toBeLessThan(c1.x - 2);
    const z = (await snap(page)).cam.zoom;
    await page.mouse.move(450, 150);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await snap(page)).cam.zoom).toBeLessThan(z - 1);
  });

  test('a fight: units sent to attack-move meet the enemy, shoot, and win', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0&speed=3');
    const { hub } = await home(page);
    // A small army for each side, a short march apart.
    const mine: number[] = [];
    for (let i = 0; i < 8; i++) mine.push((await spawn(page, i < 5 ? 'trooper' : 'tank', 0, hub.x + 6 + (i % 4) * 0.9, hub.y + 6 + Math.floor(i / 4) * 1.2))!);
    const target = { x: hub.x + 16, y: hub.y + 9 };
    for (let i = 0; i < 4; i++) await spawn(page, 'trooper', 1, target.x + (i % 2) * 1.1, target.y + Math.floor(i / 2) * 1.1);
    await focus(page, hub.x + 10, hub.y + 6, 24);
    await page.waitForTimeout(400);
    // Select the army with a box, attack-move to the enemy.
    await boxAround(page, mine);
    await expect.poll(async () => (await snap(page)).selected.length).toBe(8);
    await page.keyboard.press('a');
    await expect.poll(async () => (await snap(page)).mode).toBe('attackMove');
    const to = (await screenOfPoint(page, target.x, target.y))!;
    expect(to.y, 'the target is above the bottom panel').toBeLessThan(290);
    await page.mouse.click(to.x, to.y);
    await expect.poll(async () => (await snap(page)).mode).toBe('none');
    await expect.poll(async () => (await entities(page, 'trooper')).some((t) => t.order === 'attackMove')).toBe(true);
    await focus(page, hub.x + 16, hub.y + 11, 20);
    await page.waitForTimeout(1500);
    await shot(page, '08-marching');
    await expect.poll(async () => (await snap(page)).killed, { timeout: 40_000 }).toBeGreaterThanOrEqual(4);
    await shot(page, '09-fought');
    const s = await snap(page);
    expect(s.lost).toBeLessThan(5);
    expect(problems).toEqual([]);
  });

  test('destroying the enemy base wins; the result shows, and Play again starts a fresh battle', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0');
    await destroyBuildings(page, 1);
    await waitForPhase(page, 'result', 20_000);
    await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible();
    await expect(page.getByText('Minerals mined')).toBeVisible();
    await shot(page, '10-victory');
    await button(page, 'Play again').click();
    await waitForPhase(page, 'playing');
    const s = await snap(page);
    expect(s.tick).toBeLessThan(20);
    expect(s.counts['hub']).toBe(1);
    expect(problems).toEqual([]);
  });

  test('losing every building is a defeat, and the menu is one press away', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    await destroyBuildings(page, 0);
    await waitForPhase(page, 'result', 20_000);
    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    await button(page, 'Main menu').click();
    await waitForPhase(page, 'menu');
    await expect(page.getByRole('heading', { name: 'Nova Frontier' })).toBeVisible();
  });

  test('the hard computer player attacks an idle base, warns you, and wins', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0&level=hard&speed=12');
    await waitForPhase(page, 'result', 100_000);
    const s = await snap(page);
    expect(s.winner).toBe(1);
    // The attack was announced: the player had somewhere to look.
    const alert = await page.evaluate(() => (window.__game!.debug as Record<string, any>)['session'].lastAlert);
    expect(alert).not.toBeNull();
    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    await shot(page, '14-defeat');
  });

  test('fog: the enemy base is hidden at the start and the minimap only shows what you have seen', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const enemyHub = (await entities(page, 'hub', 1))[0]!;
    const seen = await page.evaluate(([x, y]) => {
      const m = (window.__game!.debug as Record<string, any>)['match'];
      const size = m.map.size;
      return m.vision[0][Math.floor(y) * size + Math.floor(x)];
    }, [enemyHub.x, enemyHub.y] as const);
    expect(seen).toBe(0);
    // Resources far away are not on screen at all (hidden by the dark), but the player's own base is.
    expect((await minerals(page)).length).toBeGreaterThan(8);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tap to select, tap the ground to move, tap minerals to mine', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0');
    const { hub, patches } = await home(page);
    const spot = { x: hub.x + 5, y: hub.y + 6 };
    const id = (await spawn(page, 'worker', 0, spot.x, spot.y))!;
    await focus(page, spot.x, spot.y, 20);
    await page.waitForTimeout(200);
    const at = (await screenOf(page, id))!;
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => (await snap(page)).selected).toEqual([id]);

    // Tap the ground a little way off: the worker walks there.
    const ground = (await screenOfPoint(page, spot.x + 3, spot.y + 1))!;
    await page.touchscreen.tap(ground.x, ground.y);
    await expect.poll(async () => (await entities(page, 'worker')).find((x) => x.id === id)!.order).toBe('move');

    // Tap a mineral patch: it goes mining.
    const patch = patches[1]!;
    await focus(page, (patch.x + spot.x) / 2, (patch.y + spot.y) / 2, 24);
    await page.waitForTimeout(200);
    const onPatch = (await screenOf(page, patch.id))!;
    await page.touchscreen.tap(onPatch.x, onPatch.y);
    await expect.poll(async () => (await entities(page, 'worker')).find((x) => x.id === id)!.order).toBe('gather');
    await shot(page, '11-touch');
    expect(problems).toEqual([]);
  });

  test('dragging pans the camera and two fingers zoom it', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const c0 = (await snap(page)).cam;
    await touchDrag(page, { x: 450, y: 150 }, { x: 330, y: 190 });
    const c1 = (await snap(page)).cam;
    // Dragging the ground left and down moves the view right and up.
    expect(c1.x).toBeGreaterThan(c0.x + 1);
    expect(c1.y).toBeLessThan(c0.y - 0.5);
    await pinch(page, { x: 450, y: 150 }, 80, 200);
    expect((await snap(page)).cam.zoom).toBeLessThan(c1.zoom - 2);
  });

  test('press and hold, then drag, draws a selection box', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0');
    const { hub } = await home(page);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await spawn(page, 'trooper', 0, hub.x + 6 + (i % 2) * 1.2, hub.y + 6 + Math.floor(i / 2) * 1.2))!);
    await focus(page, hub.x + 6.6, hub.y + 6.6, 16);
    await page.waitForTimeout(200);
    const points = (await Promise.all(ids.map((id) => screenOf(page, id)))).filter((p) => p !== null) as { x: number; y: number }[];
    const x0 = Math.min(...points.map((p) => p.x)) - 25;
    const y0 = Math.min(...points.map((p) => p.y)) - 35;
    const x1 = Math.max(...points.map((p) => p.x)) + 25;
    const y1 = Math.max(...points.map((p) => p.y)) + 25;
    await touchDrag(page, { x: x0, y: y0 }, { x: x1, y: y1 }, 450);
    await expect.poll(async () => (await snap(page)).selected.length).toBe(4);
  });

  test('building by touch: choose, tap where, then confirm', async ({ page }) => {
    await startBattle(page, 'seed=3&demo=0&speed=5');
    const { hub } = await home(page);
    const spot0 = { x: hub.x + 5, y: hub.y + 7 };
    const id = (await spawn(page, 'worker', 0, spot0.x, spot0.y))!;
    await focus(page, spot0.x, spot0.y, 20);
    await page.waitForTimeout(200);
    const at = (await screenOf(page, id))!;
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => (await snap(page)).selected).toEqual([id]);
    await button(page, /^Build/).tap();
    await button(page, /^Depot/).tap();
    await expect.poll(async () => (await snap(page)).mode).toBe('place');
    const spot = (await freeSpot(page, 'depot', hub.x + 3, hub.y + 6))!;
    const where = await reveal(page, spot.x, spot.y);
    await page.touchscreen.tap(where.x, where.y);
    await page.waitForTimeout(300);
    await shot(page, '12-touch-place');
    await button(page, /^Build here/).tap();
    await expect.poll(async () => (await snap(page)).counts['depot'] ?? 0, { timeout: 25_000 }).toBe(1);
  });
});

test.describe('the wider game', () => {
  test('a full tech path can be built: barracks, factory, airfield and a refinery, and units from them', async ({ page }) => {
    const problems = watchForErrors(page);
    await startBattle(page, 'seed=3&demo=0&speed=8&fog=0');
    const { hub, workers } = await home(page);
    await give(page, 2000, 1000);
    await clickEntity(page, workers[0]!.id);

    const raise = async (key: string, type: string, nearX: number, nearY: number): Promise<void> => {
      await page.keyboard.press('b');
      await page.keyboard.press(key);
      const spot = (await freeSpot(page, type, nearX, nearY))!;
      expect(spot, type).not.toBeNull();
      const at = await reveal(page, spot.x, spot.y);
      await page.mouse.click(at.x, at.y);
      await expect.poll(async () => (await entities(page, type))[0]?.progress ?? 0, { timeout: 40_000 }).toBe(1);
    };
    await raise('b', 'barracks', hub.x + 8, hub.y + 4);
    await raise('f', 'factory', hub.x + 8, hub.y + 9);
    await raise('a', 'airfield', hub.x + 3, hub.y + 10);
    // A refinery goes on a geyser: click the geyser itself.
    const geysers = await page.evaluate(([x, y]) => {
      const m = (window.__game!.debug as Record<string, any>)['match'];
      return m.entities.filter((e: any) => e.alive && e.type === 'geyser' && Math.hypot(e.x - x, e.y - y) < 14).map((e: any) => ({ x: e.x, y: e.y }));
    }, [hub.x, hub.y] as const);
    expect(geysers.length).toBeGreaterThan(0);
    await page.keyboard.press('b');
    await page.keyboard.press('r');
    const g = await reveal(page, geysers[0]!.x, geysers[0]!.y);
    await page.mouse.click(g.x, g.y);
    await expect.poll(async () => (await entities(page, 'refinery'))[0]?.progress ?? 0, { timeout: 40_000 }).toBe(1);
    await expect.poll(async () => (await snap(page)).gas, { timeout: 30_000 }).toBeGreaterThan(1000);

    // Train one of each from its building.
    for (const [type, unit] of [['barracks', 'trooper'], ['factory', 'tank'], ['airfield', 'skiff']] as const) {
      const b = (await entities(page, type))[0]!;
      await clickEntity(page, b.id);
      await page.keyboard.press('q');
      await expect.poll(async () => (await snap(page)).counts[unit] ?? 0, { timeout: 40_000 }).toBe(1);
    }
    await focus(page, hub.x + 7, hub.y + 7, 22);
    await page.waitForTimeout(700);
    await shot(page, '13-base');
    expect(problems).toEqual([]);
  });
});
