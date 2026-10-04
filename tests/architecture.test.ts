import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the layering from CLAUDE.md:  main -> ui / view2d / services -> sim -> core
 * Layers may import only from layers to their right; ui, view2d and services never import each other.
 */

const SRC = join(__dirname, '..', 'src');

type Layer = 'core' | 'sim' | 'ui' | 'view2d' | 'services' | 'main';

const ALLOWED: Record<Layer, readonly Layer[]> = {
  core: [],
  sim: ['core'],
  ui: ['sim', 'core'],
  view2d: ['sim', 'core'],
  services: ['sim', 'core'],
  main: ['ui', 'view2d', 'services', 'sim', 'core'],
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
  const first = path.split('/')[0] ?? '';
  return first === 'core' || first === 'sim' || first === 'ui' || first === 'view2d' || first === 'services'
    ? first
    : 'main';
}

const files: SourceFile[] = walk(SRC)
  .filter((f) => /\.(ts|css)$/.test(f) && !f.endsWith('.d.ts'))
  .map((full) => {
    const path = relative(SRC, full).split(sep).join('/');
    const raw = readFileSync(full, 'utf8');
    return { path, layer: layerOf(path), raw, code: stripComments(raw) };
  });

const tsFiles = files.filter((f) => f.path.endsWith('.ts'));

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
    for (const layer of ['core', 'sim', 'ui', 'view2d', 'services', 'main'] as const) {
      expect(tsFiles.some((f) => f.layer === layer)).toBe(true);
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

  it('only view2d imports pixi.js, and only services import Capacitor / AdMob', () => {
    const violations: string[] = [];
    for (const file of tsFiles) {
      for (const spec of importsOf(file)) {
        if (spec === 'pixi.js' && file.layer !== 'view2d') violations.push(`${file.path} imports ${spec}`);
        if (spec.startsWith('@capacitor') && file.layer !== 'services') violations.push(`${file.path} imports ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('sim and its rng are pure: no DOM, timers, clocks or Math.random', () => {
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
    const violations: string[] = [];
    for (const file of tsFiles.filter((f) => f.layer === 'sim' || f.path === 'core/rng.ts')) {
      for (const [re, name] of forbidden) if (re.test(file.code)) violations.push(`${file.path} uses ${name}`);
    }
    expect(violations).toEqual([]);
  });

  it('all tuning numbers live in sim/config.ts (no magic numbers in the engine step)', () => {
    for (const name of ['sim/step.ts']) {
      const file = tsFiles.find((f) => f.path === name);
      expect(file, name).toBeDefined();
      // Allow 0, 1, 2 (arithmetic) and array indices; anything else should come from CONFIG.
      const numbers = [...(file?.code ?? '').matchAll(/(?<![\w.$])(\d+\.?\d*)(?![\w.]*\s*:)/g)].map((m) => m[1]);
      expect(numbers.filter((n) => !['0', '1', '2'].includes(n ?? ''))).toEqual([]);
    }
  });

  it('ui never touches GameState, and view2d never writes to it', () => {
    for (const file of tsFiles.filter((f) => f.layer === 'ui')) {
      expect(file.code, file.path).not.toMatch(/\bGameState\b/);
    }
    for (const file of tsFiles.filter((f) => f.layer === 'view2d')) {
      expect(file.code, file.path).not.toMatch(/\bstate\.[\w.[\]]+\s*(?:[-+*/]?=)(?!=)/);
    }
  });

  it('never focuses buttons programmatically (focus rings on touch devices)', () => {
    for (const file of tsFiles) expect(file.code, file.path).not.toMatch(/\.focus\s*\(/);
  });

  it('the HUD ignores pointer events', () => {
    const css = files.find((f) => f.path === 'ui/styles.css');
    expect(css).toBeDefined();
    expect(css?.raw).toMatch(/\.hud\s*\{[^}]*pointer-events:\s*none/);
  });
});
