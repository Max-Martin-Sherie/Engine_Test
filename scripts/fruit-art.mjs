// @ts-nocheck - a standalone helper script, run by hand with node
/**
 * Tools for replacing the drawn fruit with painted sprites (for example made with ChatGPT).
 *
 *   node scripts/fruit-art.mjs guide
 *       Writes art/fruit-guide.png: ONE sheet with all 19 fruit (5 x 4). Quick, but each fruit ends up
 *       with only ~230 px, which looks soft in the game.
 *   node scripts/fruit-art.mjs guide batches
 *       Writes art/batch-1.png ... batch-5.png: four fruit per image (2 x 2, 1024 x 1024). Give these to the
 *       image generator one at a time: each fruit gets ~450 px, which is sharp enough.
 *   node scripts/fruit-art.mjs reference
 *       Writes art/fruit-reference.png: the game's drawn fruit, to show the generator the idea.
 *   node scripts/fruit-art.mjs prepare [--cell 512] <picture.png> [more pictures...]
 *       Takes the generated picture(s), removes the magenta background, finds every fruit as a separate shape
 *       (rows may be uneven), puts them in reading order (picture after picture), scales each onto the game's
 *       outline and writes src/game/art/fruits.png. When that file exists the game draws it instead of the
 *       built-in drawings. --cell is the pixel size of one fruit's cell in that file (default 512).
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
/** In a cell of BASE_CELL px a fruit's outline reaches at most BASE_RADIUS px from the middle. */
const BASE_CELL = 256;
const BASE_RADIUS = 112;

/** The game's real fruit outlines, in px for a cell of `cell` px. */
async function loadOutlines(cell = BASE_CELL) {
  const radius = (BASE_RADIUS * cell) / BASE_CELL;
  const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const sim = await server.ssrLoadModule('/src/game/sim/index.ts');
    const rng = await server.ssrLoadModule('/src/engine/core/rng.ts');
    const random = rng.createRng(11); // the same seed as the ?gallery page
    return sim.FRUIT_KINDS.map((kind) => {
      const shape = sim.makeFruitShape(kind, random, sim.CONFIG.fruit.segments);
      return { kind, points: shape.outline.map((p) => [p.x * radius, p.y * radius]) };
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

/** Draws grey silhouettes with labels on magenta: `cols` x `rows` cells of `cell` px; items fill cells in order. */
const drawGuide = ({ items, cols, rows, cell }) => {
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ff00ff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  items.forEach((o, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    g.beginPath();
    o.points.forEach(([x, y], k) => (k === 0 ? g.moveTo(cx + x, cy + y) : g.lineTo(cx + x, cy + y)));
    g.closePath();
    g.fillStyle = '#9a9a9a';
    g.fill();
    g.lineWidth = Math.max(3, cell / 80);
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#000000';
    g.font = `bold ${Math.round(cell / 16)}px sans-serif`;
    g.textAlign = 'left';
    g.fillText(`${o.number}. ${o.kind.toUpperCase()}`, (i % cols) * cell + 8, Math.floor(i / cols) * cell + cell / 14);
  });
  return canvas.toDataURL('image/png');
};

async function guide() {
  const outlines = (await loadOutlines(BASE_CELL)).map((o, i) => ({ ...o, number: i + 1 }));
  const dataUrl = await withPage((page) =>
    page.evaluate(`(${drawGuide})(${JSON.stringify({ items: outlines, cols: COLS, rows: ROWS, cell: BASE_CELL })})`),
  );
  await savePng(resolve(root, 'art/fruit-guide.png'), dataUrl);
}

async function guideBatches() {
  const cell = 512;
  const outlines = (await loadOutlines(cell)).map((o, i) => ({ ...o, number: i + 1 }));
  const batches = [];
  for (let i = 0; i < outlines.length; i += 4) batches.push(outlines.slice(i, i + 4));
  await withPage(async (page) => {
    for (let b = 0; b < batches.length; b++) {
      const dataUrl = await page.evaluate(`(${drawGuide})(${JSON.stringify({ items: batches[b], cols: 2, rows: 2, cell })})`);
      await savePng(resolve(root, `art/batch-${b + 1}.png`), dataUrl);
      console.log(`  batch ${b + 1}: ${batches[b].map((o) => `${o.number}. ${o.kind}`).join(', ')}`);
    }
  });
}

async function prepare(inputs, cell) {
  if (inputs.length === 0) throw new Error('usage: node scripts/fruit-art.mjs prepare [--cell 512] <picture.png> [more...]');
  const outlines = await loadOutlines(cell);
  const sources = [];
  for (const file of inputs) {
    const bytes = await readFile(resolve(file));
    sources.push(`data:image/png;base64,${bytes.toString('base64')}`);
  }
  const result = await withPage((page) =>
    page.evaluate(
      async ({ outlines, sources, COLS, ROWS, cell }) => {
        /** Cuts every fruit out of one picture: magenta -> transparent, one canvas per separate shape, in reading order. */
        async function fruitsIn(source) {
          const img = new Image();
          img.src = source;
          await img.decode();
          const W = img.naturalWidth;
          const H = img.naturalHeight;
          const full = document.createElement('canvas');
          full.width = W;
          full.height = H;
          const fg = full.getContext('2d', { willReadFrequently: true });
          fg.drawImage(img, 0, 0);
          const data = fg.getImageData(0, 0, W, H);
          const px = data.data;

          // 1. Magenta -> transparent (soft edge); pull pink fringes back towards the fruit's own colour.
          const solid = new Uint8Array(W * H);
          for (let i = 0; i < W * H; i++) {
            const k = i * 4;
            const r = px[k], g = px[k + 1], b = px[k + 2];
            const magenta = Math.min(r, b) - g;
            let alpha = 255;
            if (magenta > 150) alpha = 0;
            else if (magenta > 60) alpha = Math.round(255 * (1 - (magenta - 60) / 90));
            if (alpha > 0 && alpha < 255) {
              const spill = Math.max(0, Math.min(r, b) - g);
              px[k] = Math.max(0, r - spill * 0.6);
              px[k + 2] = Math.max(0, b - spill * 0.6);
            }
            px[k + 3] = alpha;
            solid[i] = alpha > 128 ? 1 : 0;
          }

          // 2. Separate shapes = connected solid pixels.
          const label = new Int32Array(W * H).fill(-1);
          const blobs = [];
          const stack = [];
          for (let start = 0; start < W * H; start++) {
            if (!solid[start] || label[start] !== -1) continue;
            const id = blobs.length;
            const blob = { id, area: 0, x0: W, y0: H, x1: -1, y1: -1 };
            label[start] = id;
            stack.push(start);
            while (stack.length) {
              const p = stack.pop();
              const x = p % W;
              const y = (p - x) / W;
              blob.area++;
              if (x < blob.x0) blob.x0 = x;
              if (x > blob.x1) blob.x1 = x;
              if (y < blob.y0) blob.y0 = y;
              if (y > blob.y1) blob.y1 = y;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx, ny = y + dy;
                  if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                  const q = ny * W + nx;
                  if (solid[q] && label[q] === -1) {
                    label[q] = id;
                    stack.push(q);
                  }
                }
              }
            }
            blobs.push(blob);
          }
          const biggest = Math.max(...blobs.map((bl) => bl.area), 1);
          const groups = blobs
            .filter((bl) => bl.area > biggest * 0.02)
            .map((bl) => ({ ids: [bl.id], area: bl.area, x0: bl.x0, y0: bl.y0, x1: bl.x1, y1: bl.y1 }));
          // A small shape sitting next to a much bigger one (a detached leaf, a seed) belongs to it.
          const gap = Math.max(6, Math.round(Math.min(W, H) * 0.008));
          let merged = true;
          while (merged) {
            merged = false;
            outer: for (let i = 0; i < groups.length; i++) {
              for (let j = i + 1; j < groups.length; j++) {
                const p = groups[i], q = groups[j];
                const near = p.x0 - gap <= q.x1 && q.x0 - gap <= p.x1 && p.y0 - gap <= q.y1 && q.y0 - gap <= p.y1;
                if (near && Math.min(p.area, q.area) < Math.max(p.area, q.area) * 0.08) {
                  p.ids.push(...q.ids);
                  p.area += q.area;
                  p.x0 = Math.min(p.x0, q.x0); p.y0 = Math.min(p.y0, q.y0);
                  p.x1 = Math.max(p.x1, q.x1); p.y1 = Math.max(p.y1, q.y1);
                  groups.splice(j, 1);
                  merged = true;
                  break outer;
                }
              }
            }
          }

          // 3. Reading order: rows found by vertical gaps, then left to right.
          groups.sort((p, q) => (p.y0 + p.y1) - (q.y0 + q.y1));
          const heights = groups.map((p) => p.y1 - p.y0).sort((a, b) => a - b);
          const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1;
          const rows = [];
          for (const group of groups) {
            const centre = (group.y0 + group.y1) / 2;
            const row = rows[rows.length - 1];
            if (row && Math.abs(centre - row.centre) < medianHeight * 0.6) {
              row.items.push(group);
              row.centre = row.items.reduce((s, p) => s + (p.y0 + p.y1) / 2, 0) / row.items.length;
            } else rows.push({ centre, items: [group] });
          }
          const ordered = rows.flatMap((row) => row.items.sort((p, q) => (p.x0 + p.x1) - (q.x0 + q.x1)));

          // 4. One canvas per fruit with only its own pixels (a neighbour's leaf may overlap its box).
          return ordered.map((group) => {
            const ids = new Set(group.ids);
            const bw = group.x1 - group.x0 + 1;
            const bh = group.y1 - group.y0 + 1;
            const canvas = document.createElement('canvas');
            canvas.width = bw;
            canvas.height = bh;
            const cg = canvas.getContext('2d');
            const crop = cg.createImageData(bw, bh);
            for (let y = 0; y < bh; y++) {
              for (let x = 0; x < bw; x++) {
                const from = (group.y0 + y) * W + (group.x0 + x);
                const f = from * 4;
                if (!(ids.has(label[from]) || (label[from] === -1 && px[f + 3] > 0))) continue;
                const k = (y * bw + x) * 4;
                crop.data[k] = px[f];
                crop.data[k + 1] = px[f + 1];
                crop.data[k + 2] = px[f + 2];
                crop.data[k + 3] = px[f + 3];
              }
            }
            cg.putImageData(crop, 0, 0);
            return { canvas, w: bw, h: bh };
          });
        }

        const report = [];
        const fruits = [];
        for (let s = 0; s < sources.length; s++) {
          const found = await fruitsIn(sources[s]);
          report.push(`picture ${s + 1}: ${found.length} fruit`);
          fruits.push(...found);
        }
        if (fruits.length !== outlines.length) {
          report.push(`WARNING: found ${fruits.length} fruit, expected ${outlines.length}.`);
        }

        const out = document.createElement('canvas');
        out.width = COLS * cell;
        out.height = ROWS * cell;
        const og = out.getContext('2d');
        og.imageSmoothingQuality = 'high';
        outlines.forEach((o, i) => {
          const fruit = fruits[i];
          if (!fruit) {
            report.push(`${i + 1}. ${o.kind}: NOTHING FOUND`);
            return;
          }
          const xs = o.points.map((p) => p[0]);
          const ys = o.points.map((p) => p[1]);
          const tx0 = Math.min(...xs), tx1 = Math.max(...xs), ty0 = Math.min(...ys), ty1 = Math.max(...ys);
          const scale = Math.min((tx1 - tx0) / fruit.w, (ty1 - ty0) / fruit.h);
          const dw = fruit.w * scale;
          const dh = fruit.h * scale;
          const cx = (i % COLS) * cell + cell / 2 + (tx0 + tx1) / 2;
          const cy = Math.floor(i / COLS) * cell + cell / 2 + (ty0 + ty1) / 2;
          og.drawImage(fruit.canvas, 0, 0, fruit.w, fruit.h, cx - dw / 2, cy - dh / 2, dw, dh);
          const soft = scale > 1.15 ? `  (enlarged x${scale.toFixed(2)}: soft)` : '';
          report.push(`${i + 1}. ${o.kind}: found ${fruit.w}x${fruit.h}px -> ${Math.round(dw)}x${Math.round(dh)}px${soft}`);
        });
        return { dataUrl: out.toDataURL('image/png'), report };
      },
      { outlines, sources, COLS, ROWS, cell },
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

const [command, ...rest] = process.argv.slice(2);
if (command === 'guide') await (rest[0] === 'batches' ? guideBatches() : guide());
else if (command === 'reference') await reference();
else if (command === 'prepare') {
  const cellIndex = rest.indexOf('--cell');
  const cell = cellIndex >= 0 ? Number(rest[cellIndex + 1]) : 512;
  const files = rest.filter((_, i) => cellIndex < 0 || (i !== cellIndex && i !== cellIndex + 1));
  await prepare(files, cell);
} else console.log('usage: node scripts/fruit-art.mjs guide [batches] | reference | prepare [--cell 512] <picture.png> [more...]');
