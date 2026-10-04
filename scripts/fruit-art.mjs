// @ts-nocheck - a standalone helper script, run by hand with node
/**
 * Tools for replacing the drawn fruit with painted sprites (for example made with ChatGPT).
 *
 *   node scripts/fruit-art.mjs guide
 *       Writes art/fruit-guide.png: the layout sheet to give to the image generator. Every cell shows
 *       the exact outline the game uses for that fruit (grey) on a magenta background, with its name.
 *
 *   node scripts/fruit-art.mjs prepare <generated-sheet.png>
 *       Takes the generated picture, removes the magenta background, finds each fruit as a separate
 *       shape (so uneven rows are fine), scales and centres it onto the game's outline, and writes src/game/art/fruits.png. When that
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
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const full = document.createElement('canvas');
        full.width = W;
        full.height = H;
        const fg = full.getContext('2d', { willReadFrequently: true });
        fg.drawImage(img, 0, 0);
        const data = fg.getImageData(0, 0, W, H);
        const px = data.data;

        // 1. Make the magenta background transparent (soft edge), and pull pink fringes back to the fruit's colour.
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
        fg.putImageData(data, 0, 0);

        // 2. Find the separate shapes (connected pixels). Anything small next to a bigger shape belongs to it
        //    (a detached leaf, a seed), so close shapes are merged.
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
        let groups = blobs
          .filter((bl) => bl.area > biggest * 0.002)
          .map((bl) => ({ ids: [bl.id], area: bl.area, x0: bl.x0, y0: bl.y0, x1: bl.x1, y1: bl.y1 }));
        const gap = Math.max(6, Math.round(Math.min(W, H) * 0.008));
        let merged = true;
        while (merged) {
          merged = false;
          outer: for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
              const p = groups[i], q = groups[j];
              const near = p.x0 - gap <= q.x1 && q.x0 - gap <= p.x1 && p.y0 - gap <= q.y1 && q.y0 - gap <= p.y1;
              // Only merge a small shape into a much bigger one that it sits on, never two fruit together.
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
        const report = [];
        if (groups.length !== outlines.length) {
          report.push(`WARNING: found ${groups.length} separate fruit, expected ${outlines.length}. Keeping the ${outlines.length} biggest.`);
        }
        groups.sort((p, q) => q.area - p.area);
        groups = groups.slice(0, outlines.length);

        // 3. Reading order: top to bottom in rows of COLS (the last row has the rest), left to right in each row.
        groups.sort((p, q) => (p.y0 + p.y1) - (q.y0 + q.y1));
        const ordered = [];
        for (let r = 0; r < ROWS; r++) {
          const row = groups.slice(r * COLS, r * COLS + COLS);
          row.sort((p, q) => (p.x0 + p.x1) - (q.x0 + q.x1));
          ordered.push(...row);
        }

        // 4. Scale each fruit to fit the game's outline and put it in its cell.
        const out = document.createElement('canvas');
        out.width = COLS * CELL;
        out.height = ROWS * CELL;
        const og = out.getContext('2d');
        og.imageSmoothingQuality = 'high';
        outlines.forEach((o, i) => {
          const group = ordered[i];
          if (!group) {
            report.push(`${i + 1}. ${o.kind}: NOTHING FOUND`);
            return;
          }
          const ids = new Set(group.ids);
          const bw = group.x1 - group.x0 + 1;
          const bh = group.y1 - group.y0 + 1;
          // Copy only this fruit's own pixels (a neighbour's leaf may overlap its box).
          const tmp = document.createElement('canvas');
          tmp.width = bw;
          tmp.height = bh;
          const tg = tmp.getContext('2d');
          const crop = tg.createImageData(bw, bh);
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const from = (group.y0 + y) * W + (group.x0 + x);
              const k = (y * bw + x) * 4;
              const f = from * 4;
              const own = ids.has(label[from]) || (label[from] === -1 && px[f + 3] > 0);
              if (!own) continue;
              crop.data[k] = px[f];
              crop.data[k + 1] = px[f + 1];
              crop.data[k + 2] = px[f + 2];
              crop.data[k + 3] = px[f + 3];
            }
          }
          tg.putImageData(crop, 0, 0);
          const xs = o.points.map((p) => p[0]);
          const ys = o.points.map((p) => p[1]);
          const tx0 = Math.min(...xs), tx1 = Math.max(...xs), ty0 = Math.min(...ys), ty1 = Math.max(...ys);
          const scale = Math.min((tx1 - tx0) / bw, (ty1 - ty0) / bh);
          const dw = bw * scale;
          const dh = bh * scale;
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const cx = col * CELL + CELL / 2 + (tx0 + tx1) / 2;
          const cy = row * CELL + CELL / 2 + (ty0 + ty1) / 2;
          og.drawImage(tmp, 0, 0, bw, bh, cx - dw / 2, cy - dh / 2, dw, dh);
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
