import { expect, type Page } from '@playwright/test';

export const SHOTS = 'e2e/screenshots';

export interface Vec {
  x: number;
  y: number;
}

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

export interface RunDump {
  phase: string;
  loop: number;
  maxLoops: number;
  tick: number;
  deaths: number;
  orbs: number;
  collected: number;
  player: { x: number; y: number; alive: boolean };
  ghosts: { x: number; y: number; alive: boolean }[];
  open: boolean[];
  par: number;
  seed: number;
}

export interface ArenaDump {
  seed: number;
  start: Vec;
  orbs: Vec[];
  gates: { y: number; doorX0: number; doorX1: number; plate: Vec }[];
  par: number;
}

export interface ResultDump {
  seed: number;
  loops: number;
  par: number;
  stars: number;
  isBest: boolean;
  deaths: number;
  daily: boolean;
}

export const snapshot = (page: Page) => page.evaluate(() => window.__game);
export const phase = async (page: Page): Promise<string | undefined> => (await snapshot(page))?.phase;
export const runDump = async (page: Page): Promise<RunDump | null> => ((await snapshot(page))?.debug['run'] as RunDump | null) ?? null;
export const arenaDump = async (page: Page): Promise<ArenaDump | null> => ((await snapshot(page))?.debug['arena'] as ArenaDump | null) ?? null;
export const resultDump = async (page: Page): Promise<ResultDump | null> => ((await snapshot(page))?.debug['result'] as ResultDump | null) ?? null;
export const debugValue = async <T>(page: Page, key: string): Promise<T | null> => ((await snapshot(page))?.debug[key] as T | undefined) ?? null;

/** World coordinates -> where to put the mouse on the page. */
export async function toClient(page: Page, p: Vec): Promise<Vec> {
  const view = await page.evaluate(() => ({ fit: window.__engine!.fit, rect: document.querySelector('canvas')!.getBoundingClientRect() }));
  return { x: view.rect.left + view.fit.offsetX + p.x * view.fit.scale, y: view.rect.top + view.fit.offsetY + p.y * view.fit.scale };
}

/** Puts a finger down at a world point and keeps it there (the player steers toward it). */
export async function pressAt(page: Page, p: Vec): Promise<void> {
  const at = await toClient(page, p);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
}

export async function moveTo(page: Page, p: Vec): Promise<void> {
  const at = await toClient(page, p);
  await page.mouse.move(at.x, at.y, { steps: 3 });
}

export async function release(page: Page): Promise<void> {
  await page.mouse.up();
}

export const waitForPhase = (page: Page, expected: string, timeout = 15_000) =>
  expect.poll(() => phase(page), { timeout, intervals: [100] }).toBe(expected);

/** Waits for the click-through animations (screen fade-ins), so screenshots show the settled screen. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
}

export async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** A screenshot right now, without waiting for animations (to catch a moment). */
export const shotNow = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
