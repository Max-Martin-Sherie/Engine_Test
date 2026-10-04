import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the layering from CLAUDE.md.
 *
 *   main -> game -> engine           (the engine never imports a game)
 *
 *   engine:  boot (root) -> services / view / ui -> core
 *   game:    flow (root) -> ui / view -> sim -> engine/core
 *
 * Layers may import only from the layers listed for them. The game layers are optional: on `main`
 * there is an empty game, and a game branch adds sim / view / ui.
 */

const SRC = join(__dirname, '..', 'src');

type Layer =
  | 'engine/core'
  | 'engine/services'
  | 'engine/view'
  | 'engine/ui'
  | 'engine'
  | 'game/sim'
  | 'game/view'
  | 'game/ui'
  | 'game'
  | 'main';

const ALLOWED: Record<Layer, readonly Layer[]> = {
  'engine/core': [],
  'engine/services': ['engine/core'],
  'engine/view': ['engine/core'],
  'engine/ui': ['engine/core'],
  engine: ['engine/core', 'engine/services', 'engine/view', 'engine/ui'],
  'game/sim': ['engine/core'],
  'game/view': ['game/sim', 'engine/core'],
  'game/ui': ['engine/ui', 'engine/core'],
  game: ['game/sim', 'game/view', 'game/ui', 'engine', 'engine/core', 'engine/services', 'engine/view', 'engine/ui'],
  main: ['engine', 'game'],
};

interface SourceFile {
  path: string; // relative to src, forward slashes
  layer: Layer;
  code: string; // comments stripped
  raw: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function layerOf(path: string): Layer {
  const [top, second] = path.split('/');
  if (top === 'engine' || top === 'game') {
    const sub = `${top}/${second ?? ''}`;
    const subLayers: Layer[] =
      top === 'engine'
        ? ['engine/core', 'engine/services', 'engine/view', 'engine/ui']
        : ['game/sim', 'game/view', 'game/ui'];
    return subLayers.find((l) => l === sub) ?? top;
  }
  return 'main';
}

const files: SourceFile[] = walk(SRC)
  .filter((f) => /\.(ts|css)$/.test(f) && !f.endsWith('.d.ts'))
  .map((full) => {
    const path = relative(SRC, full).split(sep).join('/');
    const raw = readFileSync(full, 'utf8');
    return { path, layer: layerOf(path), raw, code: stripComments(raw) };
  });

const tsFiles = files.filter((f) => f.path.endsWith('.ts'));
const inLayer = (...layers: Layer[]): SourceFile[] => tsFiles.filter((f) => layers.includes(f.layer));

function importsOf(file: SourceFile): string[] {
  const specs: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (const m of file.code.matchAll(re)) if (m[1] !== undefined) specs.push(m[1]);
  return specs;
}

/** The layer a relative import lands in, or null for packages. */
function targetLayer(from: SourceFile, spec: string): Layer | null {
  if (!spec.startsWith('.')) return null;
  const parts = [...from.path.split('/').slice(0, -1)];
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return layerOf(parts.join('/'));
}

describe('architecture', () => {
  it('finds the source files it is meant to check', () => {
    expect(tsFiles.length).toBeGreaterThan(10);
    for (const layer of ['engine/core', 'engine/services', 'engine/view', 'engine/ui', 'engine', 'game', 'main'] as const) {
      expect(tsFiles.some((f) => f.layer === layer), layer).toBe(true);
    }
  });

  it('imports only point down the layer stack', () => {
    const violations: string[] = [];
    for (const file of tsFiles) {
      for (const spec of importsOf(file)) {
        const target = targetLayer(file, spec);
        if (target === null || target === file.layer) continue;
        if (!ALLOWED[file.layer].includes(target)) {
          violations.push(`${file.path} (${file.layer}) must not import ${spec} (${target})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the engine never imports a game', () => {
    const violations: string[] = [];
    for (const file of tsFiles.filter((f) => f.path.startsWith('engine/'))) {
      for (const spec of importsOf(file)) {
        const target = targetLayer(file, spec);
        if (target !== null && (target.startsWith('game') || target === 'main')) {
          violations.push(`${file.path} imports ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('only the view layers import pixi.js, and only engine/services imports Capacitor / AdMob', () => {
    const violations: string[] = [];
    for (const file of tsFiles) {
      for (const spec of importsOf(file)) {
        if (spec === 'pixi.js' && file.layer !== 'engine/view' && file.layer !== 'game/view') {
          violations.push(`${file.path} imports ${spec}`);
        }
        if (spec.startsWith('@capacitor') && file.layer !== 'engine/services') {
          violations.push(`${file.path} imports ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('game sim and the pure engine core are pure: no DOM, timers, clocks or Math.random', () => {
    const forbidden: [RegExp, string][] = [
      [/\bMath\.random\b/, 'Math.random'],
      [/\bDate\b/, 'Date'],
      [/\bperformance\b/, 'performance'],
      [/\bwindow\b/, 'window'],
      [/\bdocument\b/, 'document'],
      [/\bnavigator\b/, 'navigator'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b|\bqueueMicrotask\b/, 'timers'],
      [/\bconsole\b/, 'console'],
      [/\bHTML\w*Element\b/, 'DOM types'],
    ];
    const pure = ['engine/core/rng.ts', 'engine/core/layout.ts', 'engine/core/config.ts'];
    const violations: string[] = [];
    for (const file of tsFiles.filter((f) => f.layer === 'game/sim' || pure.includes(f.path))) {
      for (const [re, name] of forbidden) if (re.test(file.code)) violations.push(`${file.path} uses ${name}`);
    }
    expect(violations).toEqual([]);
  });

  it('the engine itself draws nothing: no colours or sprites in engine/', () => {
    // The engine may create a mask and containers; a visible look belongs to the game.
    const violations: string[] = [];
    for (const file of tsFiles.filter((f) => f.path.startsWith('engine/') && f.layer !== 'engine/services')) {
      if (/\b(?:Sprite|Text|BitmapText|Texture)\b/.test(file.code)) violations.push(`${file.path} uses a visible Pixi class`);
      if (/\.stroke\s*\(/.test(file.code)) violations.push(`${file.path} strokes a shape`);
    }
    for (const file of files.filter((f) => f.path.startsWith('engine/') && f.path.endsWith('.css'))) {
      if (/\bfont-family|(?<![\w-])color\s*:\s*(?!var)/.test(file.code.replace(/background:[^;]*;/g, ''))) {
        violations.push(`${file.path} styles a look (fonts or colours)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('all tuning numbers live in the game config (no magic numbers in the sim step)', () => {
    const file = tsFiles.find((f) => f.path === 'game/sim/step.ts');
    if (file === undefined) return; // no game sim on this branch
    // Allow 0, 1, 2 (arithmetic) and array indices; anything else should come from CONFIG.
    const numbers = [...file.code.matchAll(/(?<![\w.$])(\d+\.?\d*)(?![\w.]*\s*:)/g)].map((m) => m[1]);
    expect(numbers.filter((n) => !['0', '1', '2'].includes(n ?? ''))).toEqual([]);
  });

  it('game ui never touches GameState, and game view never writes to it', () => {
    for (const file of inLayer('game/ui')) {
      expect(file.code, file.path).not.toMatch(/\bGameState\b/);
    }
    for (const file of inLayer('game/view')) {
      expect(file.code, file.path).not.toMatch(/\bstate\.[\w.[\]]+\s*(?:[-+*/]?=)(?!=)/);
    }
  });

  it('never focuses buttons programmatically (focus rings on touch devices)', () => {
    for (const file of tsFiles) expect(file.code, file.path).not.toMatch(/\.focus\s*\(/);
  });

  it('a HUD, if the game has one, ignores pointer events', () => {
    for (const file of files.filter((f) => f.path.startsWith('game/') && f.path.endsWith('.css'))) {
      const hud = /\.hud\s*\{[^}]*\}/.exec(file.raw);
      if (hud) expect(hud[0], file.path).toMatch(/pointer-events:\s*none/);
    }
  });

  it('keeps the source tree where CLAUDE.md says it is', () => {
    expect(existsSync(join(SRC, 'engine', 'boot.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'game', 'index.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'main.ts'))).toBe(true);
  });
});
