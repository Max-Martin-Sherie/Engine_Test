import { expect, type Page } from '@playwright/test';
import { bisectingLine, splitAreas, type Vec } from '../src/game/sim/geometry';

export const SHOTS = 'e2e/screenshots';

/** Collects anything that would show up as a red line in the console (including 404s). */
export function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/skins-test-')) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

export interface FruitDump {
  id: number;
  kind: string;
  x: number;
  y: number;
  radius: number;
  polygon: Vec[];
}

export interface RunDump {
  mode: string;
  phase: string;
  failReason: string | null;
  round: number;
  fruitsCut: number;
  score: number;
  combo: number;
  tolerance: number;
  timeLeft: number;
  strikes: number;
  penalty: number;
  restarts: number;
  fruits: FruitDump[];
  bombs: { id: number; x: number; y: number; r: number }[];
}

export interface ProfileDump {
  coins: number;
  owned: string[];
  equipped: string;
  best: { classic: number; arcade: number; survival: number };
  settings: { sound: boolean; haptics: boolean };
}

export const snapshot = (page: Page) => page.evaluate(() => window.__game);
export const phase = async (page: Page): Promise<string | undefined> => (await snapshot(page))?.phase;
export const runDump = async (page: Page): Promise<RunDump | null> => ((await snapshot(page))?.debug['run'] as RunDump | null) ?? null;
export const profileDump = async (page: Page): Promise<ProfileDump> => (await snapshot(page))!.debug['profile'] as ProfileDump;

/** Gives a returning player some coins before the page loads (once, so a reload keeps what was saved). */
export async function seedProfile(page: Page, profile: Partial<ProfileDump>): Promise<void> {
  await page.addInitScript((p) => {
    if (localStorage.getItem('fruitslice.profile') === null) {
      localStorage.setItem('fruitslice.profile', JSON.stringify({ version: 1, coins: 0, owned: ['steel'], equipped: 'steel', best: { classic: 0, arcade: 0, survival: 0 }, settings: { sound: true, haptics: true }, ...p }));
    }
  }, profile);
}

/** World coordinates -> where to put the mouse on the page. */
async function toClient(page: Page, p: Vec): Promise<Vec> {
  const view = await page.evaluate(() => ({ fit: window.__engine!.fit, rect: document.querySelector('canvas')!.getBoundingClientRect() }));
  return { x: view.rect.left + view.fit.offsetX + p.x * view.fit.scale, y: view.rect.top + view.fit.offsetY + p.y * view.fit.scale };
}

/** One finger drag from world point a to world point b. */
export async function dragWorld(page: Page, a: Vec, b: Vec): Promise<void> {
  const from = await toClient(page, a);
  const to = await toClient(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/**
 * A drag across a fruit on screen that splits it with the given deviation from 50/50
 * (percentage points; 0 = a perfect cut), computed with the game's own geometry. The angle and the
 * side the line is shifted to are searched until both ends of the drag are on screen, and it returns
 * once the game has judged the cut.
 */
export async function cutFruit(page: Page, deviation = 0, angle = 0.3, fruitIndex = 0): Promise<void> {
  const run = await runDump(page);
  const fruit = run?.fruits[fruitIndex];
  if (!fruit) throw new Error('no fruit on screen to cut');

  const onScreen = (p: Vec): boolean => p.x >= 6 && p.x <= 354 && p.y >= 6 && p.y <= 634;
  const attempt = (theta: number, side: 1 | -1): { a: Vec; b: Vec } => {
    const base = bisectingLine(fruit.polygon, theta, 28, 1);
    if (deviation <= 0) return base;
    const nx = -Math.sin(theta) * side;
    const ny = Math.cos(theta) * side;
    const shifted = (t: number) => ({ a: { x: base.a.x + nx * t, y: base.a.y + ny * t }, b: { x: base.b.x + nx * t, y: base.b.y + ny * t } });
    const dev = (t: number): number => {
      const l = shifted(t);
      const areas = splitAreas(fruit.polygon, l.a, l.b);
      return Math.abs(areas.left / (areas.left + areas.right) - 0.5) * 100;
    };
    let lo = 0;
    let hi = fruit.radius * 0.95;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (dev(mid) < deviation) lo = mid;
      else hi = mid;
    }
    return shifted((lo + hi) / 2);
  };

  let line = attempt(angle, 1);
  search: for (let i = 0; i < 24; i++) {
    for (const side of [1, -1] as const) {
      const candidate = attempt(angle + i * 0.27, side);
      if (onScreen(candidate.a) && onScreen(candidate.b)) {
        line = candidate;
        break search;
      }
    }
  }
  const { a, b } = line;
  await dragWorld(page, a, b);

  // The game judges a drag on its next step: wait until it has (the fruit is gone or the run moved on).
  await expect
    .poll(async () => {
      const now = await runDump(page);
      return now === null || now.phase !== 'playing' || now.fruits.length === 0 || now.fruits[fruitIndex]?.id !== fruit.id;
    }, { timeout: 4000, intervals: [30] })
    .toBe(true);
}

/** Waits until a fruit is on screen and the run is in progress. */
export async function waitForFruit(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const run = await runDump(page);
      return (await phase(page)) === 'playing' && (run?.fruits.length ?? 0) > 0;
    }, { timeout: 10_000, intervals: [100] })
    .toBe(true);
}

/** Waits for the UI's one-shot fade/rise animations, so screenshots show the settled screen. */
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

export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
