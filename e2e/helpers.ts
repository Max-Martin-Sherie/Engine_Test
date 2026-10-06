import { expect, type Locator, type Page } from '@playwright/test';

export const SHOTS = 'e2e/screenshots';

/** Collects anything that would show up as a red line in the console (including 404s). */
export function watchForErrors(page: Page): string[] {
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

export interface Lite {
  id: number;
  type: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  progress: number;
  order: string;
  queue: number;
  carry: number;
  rally: boolean;
}

export interface Snap {
  phase: string;
  tick: number;
  winner: number;
  minerals: number;
  gas: number;
  supplyUsed: number;
  supplyCap: number;
  counts: Record<string, number>;
  enemyCounts: Record<string, number>;
  selected: number[];
  mode: string | null;
  cam: { x: number; y: number; zoom: number };
  killed: number;
  lost: number;
  mined: number;
}

/** A small, serialisable look at the game (the live match is far too big to send across). */
export const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const game = window.__game!;
    const d = game.debug as Record<string, any>;
    const m = d['match'];
    const count = (owner: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const e of m?.entities ?? []) if (e.alive && e.owner === owner) out[e.type] = (out[e.type] ?? 0) + 1;
      return out;
    };
    const p = m?.players[0];
    return {
      phase: game.phase,
      tick: m?.tick ?? 0,
      winner: m?.winner ?? -1,
      minerals: p?.minerals ?? 0,
      gas: p?.gas ?? 0,
      supplyUsed: p?.supplyUsed ?? 0,
      supplyCap: p?.supplyCap ?? 0,
      counts: count(0),
      enemyCounts: count(1),
      selected: d['selected'] as number[],
      mode: d['mode'] as string | null,
      cam: d['cam'] as { x: number; y: number; zoom: number },
      killed: p?.stats.unitsKilled ?? 0,
      lost: p?.stats.unitsLost ?? 0,
      mined: p?.stats.mined ?? 0,
    };
  });

export const entities = (page: Page, type?: string, owner = 0): Promise<Lite[]> =>
  page.evaluate(
    ([wanted, side]) => {
      const m = (window.__game!.debug as Record<string, any>)['match'];
      return (m?.entities ?? [])
        .filter((e: any) => e.alive && e.owner === side && (wanted === null || e.type === wanted))
        .map((e: any) => ({ id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, progress: e.progress, order: e.order.type, queue: e.queue.length, carry: e.carry, rally: e.rally !== null }));
    },
    [type ?? null, owner] as const,
  );

export const minerals = async (page: Page): Promise<Lite[]> => entities(page, 'minerals', -1);

/** Client pixels of an entity on the screen. */
export const screenOf = (page: Page, id: number): Promise<{ x: number; y: number } | null> =>
  page.evaluate((target) => (window.__game!.debug as Record<string, any>)['screenOf'](target), id);

export const screenOfPoint = (page: Page, x: number, y: number): Promise<{ x: number; y: number } | null> =>
  page.evaluate(([px, py]) => (window.__game!.debug as Record<string, any>)['screenOfPoint'](px, py), [x, y] as const);

export const focus = (page: Page, x: number, y: number, zoom?: number): Promise<void> =>
  page.evaluate(([px, py, z]) => (window.__game!.debug as Record<string, any>)['focus'](px, py, z), [x, y, zoom] as const);

export const spawn = (page: Page, type: string, owner: number, x: number, y: number, finished = true): Promise<number | null> =>
  page.evaluate(([t, o, px, py, f]) => (window.__game!.debug as Record<string, any>)['spawn'](t, o, px, py, f), [type, owner, x, y, finished] as const);

export const freeSpot = (page: Page, type: string, x: number, y: number): Promise<{ x: number; y: number } | null> =>
  page.evaluate(([t, px, py]) => (window.__game!.debug as Record<string, any>)['freeSpot'](t, px, py), [type, x, y] as const);

export const give = (page: Page, minerals: number, gas: number): Promise<void> =>
  page.evaluate(([m, g]) => (window.__game!.debug as Record<string, any>)['give'](m, g), [minerals, gas] as const);

export const destroyBuildings = (page: Page, owner: number): Promise<void> =>
  page.evaluate((side) => (window.__game!.debug as Record<string, any>)['destroyBuildings'](side), owner);

export const phase = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__game?.phase);

export async function waitForPhase(page: Page, wanted: string, timeout = 15_000): Promise<void> {
  await expect.poll(() => phase(page), { timeout }).toBe(wanted);
}

export const button = (page: Page, name: string | RegExp): Locator => page.getByRole('button', { name });

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Starts a battle from the menu. */
export async function startBattle(page: Page, query = 'seed=3&demo=0'): Promise<void> {
  // quality=1 pins the resolution: the game otherwise lowers it when a (software-rendered) test machine is slow.
  await page.goto(`/?${query}&quality=1`);
  await button(page, /^Battle/).click();
  await waitForPhase(page, 'playing');
  await expect.poll(async () => (await snap(page)).counts['hub'] ?? 0).toBe(1);
}

/** The player's start: the hub and where the minerals are. */
export async function home(page: Page): Promise<{ hub: Lite; workers: Lite[]; patches: Lite[] }> {
  const hub = (await entities(page, 'hub'))[0]!;
  const workers = await entities(page, 'worker');
  const patches = (await minerals(page)).filter((p) => Math.hypot(p.x - hub.x, p.y - hub.y) < 11);
  return { hub, workers, patches };
}

/** Clicks an entity with the mouse (after bringing it into view). */
export async function clickEntity(page: Page, id: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const at = await screenOf(page, id);
  expect(at, `entity ${id} on screen`).not.toBeNull();
  await page.mouse.click(at!.x, at!.y, { button });
}

/** Selects all of the player's workers with a drag box around them. */
export async function boxAround(page: Page, ids: number[]): Promise<void> {
  const points = (await Promise.all(ids.map((id) => screenOf(page, id)))).filter((p): p is { x: number; y: number } => p !== null);
  const x0 = Math.min(...points.map((p) => p.x)) - 30;
  const y0 = Math.min(...points.map((p) => p.y)) - 40;
  const x1 = Math.max(...points.map((p) => p.x)) + 30;
  const y1 = Math.max(...points.map((p) => p.y)) + 30;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
}

/** Brings a map point to the middle of the clear part of the screen (above the bottom panel); returns where it is, in client pixels. */
export async function reveal(page: Page, x: number, y: number, zoom = 22): Promise<{ x: number; y: number }> {
  await focus(page, x, y, zoom);
  await page.waitForTimeout(120);
  const at = await screenOfPoint(page, x, y);
  expect(at, 'the point is on screen').not.toBeNull();
  expect(at!.y, 'the point is above the bottom panel').toBeLessThan(290);
  return at!;
}

/**
 * How green the greenest pixel in a screen region is (green minus the larger of red and blue, 0..255): a selection
 * outline is bright green, the terrain is blue-grey. Reads the real screenshot, so it sees what the player sees.
 */
export async function greenness(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let best = -255;
    for (let i = 0; i < data.length; i += 4) best = Math.max(best, data[i + 1]! - Math.max(data[i]!, data[i + 2]!));
    return best;
  }, png.toString('base64'));
}

/** How bright the fog leaves a map cell, 0 (black) to 1 (clear). */
export const fogBrightness = (page: Page, x: number, y: number): Promise<number> =>
  page.evaluate(([px, py]) => (window.__game!.debug as Record<string, any>)['fogBrightness'](px, py), [x, y] as const);
