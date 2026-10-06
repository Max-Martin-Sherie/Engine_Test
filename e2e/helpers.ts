import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

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

export interface Me {
  alive: boolean;
  health: number;
  armor: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
  current: number;
  owned: boolean[];
  mag: number;
  reserve: number;
  reloading: number;
  aiming: boolean;
  tick: number;
  winner: number;
  yaw: number;
  pitch: number;
}

/** A small, serialisable look at the player (the live match is far too big to send across). */
export const me = (page: Page): Promise<Me> =>
  page.evaluate(() => {
    const game = window.__game!;
    const d = game.debug as Record<string, any>;
    const m = d['match'];
    const a = m.actors[0];
    const slot = a.weapons[a.current];
    return {
      alive: a.alive,
      health: a.health,
      armor: a.armor,
      x: a.x,
      y: a.y,
      z: a.z,
      speed: Math.hypot(a.vx, a.vz),
      kills: a.kills,
      deaths: a.deaths,
      shots: a.shots,
      hits: a.hits,
      current: a.current,
      owned: a.weapons.map((w: any) => w.owned),
      mag: slot.mag,
      reserve: slot.reserve,
      reloading: a.reloading,
      aiming: a.aiming,
      tick: m.tick,
      winner: m.winner,
      yaw: d['yaw'],
      pitch: d['pitch'],
    };
  });

export const phase = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__game?.phase);

export async function waitForPhase(page: Page, wanted: string, timeout = 15_000): Promise<void> {
  await expect.poll(() => phase(page), { timeout }).toBe(wanted);
}

/** A button by its exact name ("Play" is not "How to play"), or by a pattern. */
export const button = (page: Page, name: string | RegExp): Locator => page.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Runs a function on the game's debug handle. */
export const debug = <T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([fn, rest]) => (window.__game!.debug as Record<string, any>)[fn as string](...(rest as unknown[])), [name, args] as const) as Promise<T>;

/** A value on the game's debug handle (as opposed to a function on it). */
export const prop = <T = unknown>(page: Page, name: string): Promise<T> => page.evaluate((key) => (window.__game!.debug as Record<string, any>)[key], name) as Promise<T>;

/** Starts a match from the menu. `quality=1` pins the resolution: the game otherwise lowers it when a (software-rendered) test machine is slow. */
export async function startMatch(page: Page, query = 'seed=3&level=easy&bots=3', countdown = false): Promise<void> {
  await page.goto(`/?${query}&quality=1${countdown ? '' : '&countdown=0'}`);
  // A finger on a phone, a mouse on a desktop: the game treats them differently.
  const play = button(page, 'Play');
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await play.tap();
  else await play.click();
  await waitForPhase(page, 'playing');
  // These tests are about the controls, not about surviving the bots.
  await debug(page, 'peace', true);
}

/** Puts the player at a spot in the open, the bots well out of the way, and one bot (id 1) in front. */
export async function duel(page: Page, distance = 6): Promise<void> {
  await page.evaluate((d) => {
    const dbg = window.__game!.debug as Record<string, any>;
    dbg['peace'](true);
    dbg['teleport'](24.5, 32.5);
    for (const a of dbg['match'].actors) if (a.id > 1) dbg['put'](a.id, 6.5 + a.id, 6.5);
    dbg['put'](1, 24.5, 32.5 - d);
    dbg['match'].actors[1].protect = 0;
    dbg['faceActor'](1);
  }, distance);
}

/** Real fingers: Chrome's own touch events, any number at once (Playwright's `tap` can only do one quick press). */
export class Fingers {
  private readonly points = new Map<number, { x: number; y: number }>();
  private constructor(
    private readonly page: Page,
    private readonly client: CDPSession,
  ) {}

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(page, await page.context().newCDPSession(page));
  }

  private all() {
    return [...this.points.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { x, y });
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.all() });
  }

  async move(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { x, y });
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.all() });
  }

  /** A finger travels from where it is to a new place in steps. */
  async slide(id: number, x: number, y: number, steps = 8): Promise<void> {
    const from = this.points.get(id)!;
    for (let i = 1; i <= steps; i++) {
      await this.move(id, from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
      await this.page.waitForTimeout(16);
    }
  }

  async up(id: number): Promise<void> {
    const p = this.points.get(id);
    if (p === undefined) return;
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
    this.points.delete(id);
  }

  async upAll(): Promise<void> {
    for (const id of [...this.points.keys()]) await this.up(id);
  }

  async dispose(): Promise<void> {
    await this.upAll();
    await this.client.detach().catch(() => undefined);
  }
}

/** The middle of an element, in client pixels. */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  expect(box, 'the element has a box').not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** What fraction of a screen region is brighter than near-black (so a drawn 3D view reads as drawn). */
export async function litFraction(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
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
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 90) lit += 1;
    return lit / (data.length / 4);
  }, png.toString('base64'));
}

/** How many distinct colours (quantised) a region has: a flat or empty picture has very few. */
export async function colourCount(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
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
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add(((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4));
    return seen.size;
  }, png.toString('base64'));
}

export interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The boxes of the touch controls and the other things a finger can press, as the player sees them. */
export const pressables = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const out: Box[] = [];
    const add = (name: string, node: Element | null): void => {
      if (node === null) return;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      out.push({ name, x: r.x, y: r.y, width: r.width, height: r.height });
    };
    for (const node of document.querySelectorAll('.tb')) add(node.getAttribute('aria-label') ?? 'touch button', node);
    for (const node of document.querySelectorAll('.chip')) add(node.getAttribute('aria-label') ?? 'chip', node);
    for (const node of document.querySelectorAll('.slot')) add(`slot ${node.getAttribute('data-slot')}`, node);
    return out;
  });

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
