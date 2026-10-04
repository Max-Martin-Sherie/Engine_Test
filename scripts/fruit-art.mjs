// @ts-nocheck - a standalone helper script, run by hand with node
/**
 * Tools for replacing the drawn fruit with painted sprites (for example made with ChatGPT).
 *
 *   node scripts/fruit-art.mjs guide
 *       Writes art/fruit-guide.png: the layout sheet to give to the image generator. Every cell shows
 *       the exact outline the game uses for that fruit (grey) on a magenta background, with its name.
 *
 *   node scripts/fruit-art.mjs prepare <generated-sheet.png>
 *       Takes the generated picture, removes the magenta background, finds each fruit inside its cell,
 *       scales and centres it onto the game's outline, and writes src/game/art/fruits.png. When that
 *       file exists the game draws it instead of the built-in drawings.
 *
 * Needs Chrome: set CHROMIUM_PATH to chrome.exe if Playwright has not downloaded its own browser.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COLS = 5;
const ROWS = 4;
const CELL = 256;
/** Pixels per unit of the fruit's radius. A fruit's outline reaches at most this far from the cell's middle. */
const RADIUS = 112;

async function loadOutlines() {
  const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const sim = await server.ssrLoadModule('/src/game/sim/index.ts');
    const rng = await server.ssrLoadModule('/src/engine/core/rng.ts');
    const random = rng.createRng(11); // the same seed as the ?gallery page
    return sim.FRUIT_KINDS.map((kind) => {
      const shape = sim.makeFruitShape(kind, random, sim.CONFIG.fruit.segments);
      return { kind, points: shape.outline.map((p) => [p.x * RADIUS, p.y * RADIUS]) };
    });
  } finally {
    await server.close();
  }
}

async function withPage(run) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    return await run(page);
  } finally {
    await browser.close();
  }
}

const savePng = async (file, dataUrl) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
};

async function guide() {
  const outlines = await loadOutlines();
  const dataUrl = await withPage((page) =>
    page.evaluate(
      ({ outlines, COLS, ROWS, CELL }) => {
        const canvas = document.createElement('canvas');
        canvas.width = COLS * CELL;
        canvas.height = ROWS * CELL;
        const g = canvas.getContext('2d');
        g.fillStyle = '#ff00ff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        outlines.forEach((o, i) => {
          const cx = (i % COLS) * CELL + CELL / 2;
          const cy = Math.floor(i / COLS) * CELL + CELL / 2;
          g.beginPath();
          o.points.forEach(([x, y], k) => (k === 0 ? g.moveTo(cx + x, cy + y) : g.lineTo(cx + x, cy + y)));
          g.closePath();
          g.fillStyle = '#9a9a9a';
          g.fill();
          g.lineWidth = 3;
          g.strokeStyle = '#ffffff';
          g.stroke();
          g.fillStyle = '#000000';
          g.font = 'bold 16px sans-serif';
          g.textAlign = 'left';
          g.fillText(`${i + 1}. ${o.kind.toUpperCase()}`, (i % COLS) * CELL + 8, Math.floor(i / COLS) * CELL + 20);
        });
        return canvas.toDataURL('image/png');
      },
      { outlines, COLS, ROWS, CELL },
    ),
  );
  await savePng(resolve(root, 'art/fruit-guide.png'), dataUrl);
  console.log(outlines.map((o, i) => `${i + 1}. ${o.kind}`).join('\n'));
}

async function prepare(input) {
  if (!input) throw new Error('usage: node scripts/fruit-art.mjs prepare <generated-sheet.png>');
  const outlines = await loadOutlines();
  const bytes = await readFile(resolve(input));
  const source = `data:image/png;base64,${bytes.toString('base64')}`;
  const result = await withPage((page) =>
    page.evaluate(
      async ({ outlines, source, COLS, ROWS, CELL }) => {
        const img = new Image();
        img.src = source;
        await img.decode();
        const cellW = img.naturalWidth / COLS;
        const cellH = img.naturalHeight / ROWS;
        const out = document.createElement('canvas');
        out.width = COLS * CELL;
        out.height = ROWS * CELL;
        const og = out.getContext('2d');
        const report = [];

        outlines.forEach((o, i) => {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          // 1. Cut the cell out and make the magenta background transparent.
          const w = Math.round(cellW);
          const h = Math.round(cellH);
          const tmp = document.createElement('canvas');
          tmp.width = w;
          tmp.height = h;
          const tg = tmp.getContext('2d', { willReadFrequently: true });
          tg.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, w, h);
          const data = tg.getImageData(0, 0, w, h);
          const px = data.data;
          let minX = w, minY = h, maxX = -1, maxY = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const k = (y * w + x) * 4;
              const r = px[k], gr = px[k + 1], b = px[k + 2];
              // How magenta it is: red and blue high, green low.
              const magenta = Math.min(r, b) - gr;
              let alpha = 255;
              if (magenta > 150) alpha = 0;
              else if (magenta > 60) alpha = Math.round(255 * (1 - (magenta - 60) / 90));
              if (alpha > 0 && alpha < 255) {
                // Pull the pink fringe back towards the fruit's own colour.
                const spill = Math.max(0, Math.min(r, b) - gr);
                px[k] = Math.max(0, r - spill * 0.6);
                px[k + 2] = Math.max(0, b - spill * 0.6);
              }
              px[k + 3] = alpha;
              if (alpha > 128) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          tg.putImageData(data, 0, 0);
          if (maxX < 0) {
            report.push(`${i + 1}. ${o.kind}: NOTHING FOUND in its cell`);
            return;
          }

          // 2. Scale the fruit to fit the game's outline, centred on it.
          const xs = o.points.map((p) => p[0]);
          const ys = o.points.map((p) => p[1]);
          const tx0 = Math.min(...xs), tx1 = Math.max(...xs), ty0 = Math.min(...ys), ty1 = Math.max(...ys);
          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          const scale = Math.min((tx1 - tx0) / bw, (ty1 - ty0) / bh);
          const dw = bw * scale;
          const dh = bh * scale;
          const cx = col * CELL + CELL / 2 + (tx0 + tx1) / 2;
          const cy = row * CELL + CELL / 2 + (ty0 + ty1) / 2;
          og.imageSmoothingQuality = 'high';
          og.drawImage(tmp, minX, minY, bw, bh, cx - dw / 2, cy - dh / 2, dw, dh);
          report.push(`${i + 1}. ${o.kind}: found ${bw}x${bh}px, scaled x${scale.toFixed(2)}`);
        });
        return { dataUrl: out.toDataURL('image/png'), report };
      },
      { outlines, source, COLS, ROWS, CELL },
    ),
  );
  console.log(result.report.join('\n'));
  await savePng(resolve(root, 'src/game/art/fruits.png'), result.dataUrl);
}

/** Writes art/fruit-reference.png: the game's current drawn fruit, to show an image generator the idea. */
async function reference() {
  const server = await createServer({ root, server: { port: 5198, strictPort: true }, logLevel: 'error' });
  await server.listen();
  try {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    await page.goto('http://localhost:5198/?gallery=1');
    await page.waitForFunction(() => window.__engine && window.__engine.viewReady === true);
    await page.waitForTimeout(600);
    const file = resolve(root, 'art/fruit-reference.png');
    await mkdir(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    console.log(`wrote ${file}`);
    await browser.close();
  } finally {
    await server.close();
  }
}

const [command, argument] = process.argv.slice(2);
if (command === 'guide') await guide();
else if (command === 'prepare') await prepare(argument);
else if (command === 'reference') await reference();
else console.log('usage: node scripts/fruit-art.mjs guide | reference | prepare <generated-sheet.png>');
