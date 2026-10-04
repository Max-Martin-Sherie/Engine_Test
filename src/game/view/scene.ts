/**
 * How Fruit Slice looks. The engine's view (gameView) calls `update` once per frame; the flow
 * (index.ts) tells the scene about drags and cuts. Read the run, never write it.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { createRng, nextRange } from '../../engine/core/rng';
import {
  BUNDLED_SKINS,
  CONFIG,
  bladeOutline,
  makeFruitShape,
  type CutPiece,
  type FruitKind,
  type FruitShape,
  type Run,
  type Skin,
  type Vec,
} from '../sim';
import { drawFruit } from './fruitArt';
import { loadFruitSheet, makeFruitBody } from './fruitSprites';
import { COLORS, FRUIT_COLORS } from './palette';

const { width: W, height: H } = CONFIG.world;

export interface Frame {
  /** The run on screen, or null on the menu (the scene then shows its attract-mode backdrop). */
  run: Run | null;
  /** Position between the previous and current simulation step, for smooth motion. */
  alpha: number;
  /** Visual clock in seconds. Runs while the game is open, even between fixed steps. */
  now: number;
}

export interface Scene {
  /** Resolves once the optional painted fruit sheet has loaded (or there is none). */
  ready: Promise<void>;
  update(frame: Frame): void;
  setSkin(skin: Skin): void;
  /** The drag in progress (world coordinates), or null. */
  setDrag(drag: { a: Vec; b: Vec } | null): void;
  /** A cut happened: animate the halves, juice and slash. `ok` false tints it red. */
  showCut(a: Vec, b: Vec, pieces: readonly CutPiece[], ok: boolean, now: number): void;
  showCancel(a: Vec, b: Vec, now: number): void;
  showBomb(x: number, y: number, now: number): void;
  /** A "+x" bubble was cut through: it bursts. */
  showBubble(x: number, y: number, now: number): void;
  clearEffects(): void;
  /** Dev tool: lay out every kind of fruit, whole or cut, to review the art. */
  showGallery(kinds: readonly FruitKind[]): void;
}

const hex = (color: string): number => Number.parseInt(color.slice(1), 16);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

interface FruitSprite {
  root: Container;
  born: number;
}

interface BombSprite {
  root: Container;
}

interface BubbleSprite {
  root: Container;
  born: number;
}

interface Half {
  root: Container;
  start: number;
  nx: number;
  ny: number;
  cx: number;
  cy: number;
  spin: number;
}

interface Slash {
  g: Graphics;
  start: number;
  duration: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: number;
}

const HALF_SECONDS = 0.95;
const GRAVITY = 460;

export function createScene(field: Container): Scene {
  const ready = loadFruitSheet();
  const visual = createRng(20240601); // looks only; the simulation has its own seeded RNG
  const random = (min: number, max: number): number => nextRange(visual, min, max);

  // Backdrop: the plum field with a soft spotlight where the fruit appears.
  const backdrop = new Graphics().rect(0, 0, W, H).fill(COLORS.field);
  for (let i = 0; i < 5; i++) {
    backdrop.circle(CONFIG.fruit.centerX, CONFIG.fruit.centerY, 250 - i * 38).fill({ color: COLORS.spot, alpha: 0.16 });
  }

  const attract = new Container();
  const fruitLayer = new Container();
  const bombLayer = new Container();
  const bubbleLayer = new Container();
  const effectLayer = new Container();
  const particleGraphics = new Graphics();
  const dragGraphics = new Graphics();
  const knifeLayer = new Container();
  const galleryLayer = new Container();
  field.addChild(backdrop, attract, bombLayer, fruitLayer, bubbleLayer, effectLayer, particleGraphics, dragGraphics, knifeLayer, galleryLayer);

  // Attract mode: three big, faint fruit drifting behind the menu.
  const attractRng = createRng(7);
  const attractItems = (
    [
      ['orange', 48, 96, 34],
      ['apple', 312, 598, 40],
      ['watermelon', 62, 590, 38],
    ] as const
  ).map(([kind, x, y, radius], index) => {
    const holder = new Container();
    const g = new Graphics();
    drawFruit(g, makeFruitShape(kind, attractRng, CONFIG.fruit.segments), { x: 0, y: 0, rotation: 0, radius });
    holder.addChild(g);
    holder.alpha = 0.33;
    attract.addChild(holder);
    return { holder, x, y, index };
  });

  let skin: Skin = BUNDLED_SKINS[0]!;
  let drag: { a: Vec; b: Vec } | null = null;
  let lastNow = 0;
  const fruitSprites = new Map<number, FruitSprite>();
  const bombSprites = new Map<number, BombSprite>();
  const bubbleSprites = new Map<number, BubbleSprite>();
  const halves: Half[] = [];
  const slashes: Slash[] = [];
  const particles: Particle[] = [];
  const rings: { x: number; y: number; start: number; g: Graphics; color?: number }[] = [];

  function makeFruitSprite(radius: number, shape: FruitShape): Container {
    const root = new Container();
    root.addChild(makeFruitBody(shape, { x: 0, y: 0, rotation: 0, radius }));
    return root;
  }

  /** A soap bubble with the margin it is worth, "+4". */
  function makeBubble(r: number, value: number): Container {
    const root = new Container();
    const g = new Graphics()
      .circle(0, 0, r * 1.5)
      .fill({ color: COLORS.lime, alpha: 0.1 })
      .circle(0, 0, r)
      .fill({ color: COLORS.lime, alpha: 0.26 })
      .stroke({ width: 2.5, color: COLORS.lime, alpha: 0.95 })
      .ellipse(-r * 0.38, -r * 0.42, r * 0.3, r * 0.17)
      .fill({ color: 0xffffff, alpha: 0.55 });
    const label = new Text({
      text: `+${value}`,
      style: { fontFamily: 'system-ui, sans-serif', fontWeight: '900', fontSize: Math.round(r * 1.05), fill: COLORS.cream, stroke: { color: COLORS.ink, width: 3 } },
    });
    label.anchor.set(0.5);
    label.position.set(0, r * 0.06);
    root.addChild(g, label);
    return root;
  }

  function makeBomb(r: number): Container {
    const root = new Container();
    const g = new Graphics()
      .circle(0, 0, r)
      .fill(COLORS.bomb)
      .stroke({ width: 3, color: COLORS.bombRim })
      .circle(-r * 0.3, -r * 0.35, r * 0.22)
      .fill({ color: 0xffffff, alpha: 0.18 })
      .moveTo(r * 0.2, -r * 0.9)
      .lineTo(r * 0.55, -r * 1.35)
      .stroke({ width: 3, color: 0xc9b38a, cap: 'round' })
      .circle(r * 0.58, -r * 1.4, r * 0.2)
      .fill(COLORS.citrus)
      .circle(0, 2, r * 0.38)
      .stroke({ width: 3, color: COLORS.tomato })
      .moveTo(-r * 0.18, -r * 0.12)
      .lineTo(r * 0.18, r * 0.2)
      .moveTo(r * 0.18, -r * 0.12)
      .lineTo(-r * 0.18, r * 0.2)
      .stroke({ width: 3, color: COLORS.tomato, cap: 'round' });
    root.addChild(g);
    return root;
  }

  // The knife. Its origin is the middle of its cutting edge, so when it is placed at the end of the
  // drag only that middle point sits on the line; the rest of the blade is tilted away from it.
  const KNIFE_SCALE = 0.55;
  const BASE_TILT = 0.85;
  const knife = new Container();
  const knifeBody = new Graphics();
  knife.addChild(knifeBody);
  knife.visible = false;
  knifeLayer.addChild(knife);
  const knifePos = { x: 0, y: 0 };
  let knifeActive = false;
  let knifeStart = 0;
  let knifeSpeed = 0;
  let lastDir: Vec = { x: 1, y: 0 };
  const ghosts: { root: Container; start: number; dir: Vec; from: Vec; angle: number }[] = [];

  /** Draws the knife of the current skin into `g`, edge-middle at (0, 0), tip pointing along +x. */
  function paintKnife(g: Graphics): void {
    g.clear();
    const at = (x: number, y: number): [number, number] => [(x - 50) * KNIFE_SCALE, (y - 24) * KNIFE_SCALE];
    const blade = bladeOutline(skin.blade.shape).flatMap(([x, y]) => at(x, y));
    g.poly(blade.map((v, i) => v + (i % 2 === 0 ? 2.5 : 3.5))).fill({ color: 0x000000, alpha: 0.28 }); // soft shadow
    g.poly([at(-38, 6), at(0, 6), at(0, 22), at(-38, 22)].flat()).fill(hex(skin.handle.color));
    g.poly([at(-10, 6), at(-3, 6), at(-3, 22), at(-10, 22)].flat()).fill(hex(skin.handle.accent));
    g.poly(blade).fill(hex(skin.blade.color)).stroke({ width: 1.2, color: hex(skin.blade.edge), join: 'round' });
    const [ex0, ey0] = at(4, 23);
    const [ex1, ey1] = at(90, 23);
    g.moveTo(ex0, ey0).lineTo(ex1, ey1).stroke({ width: 1.6, color: hex(skin.blade.edge), alpha: 0.95 });
  }
  paintKnife(knifeBody);

  /** The knife swishes on through where the cut was, spinning a little, and fades. */
  function releaseKnife(now: number): void {
    const root = new Container();
    const body = new Graphics();
    paintKnife(body);
    root.addChild(body);
    root.position.set(knife.x, knife.y);
    root.rotation = knife.rotation;
    root.scale.set(knife.scale.x);
    knifeLayer.addChild(root);
    ghosts.push({ root, start: now, dir: lastDir, from: { x: knife.x, y: knife.y }, angle: knife.rotation });
  }

  function drawSlashLine(g: Graphics, a: Vec, b: Vec, color: number, glow: number, width: number, alpha: number): void {
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 5, color: glow, alpha: 0.16 * alpha, cap: 'round' });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 2.4, color: glow, alpha: 0.34 * alpha, cap: 'round' });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color, alpha, cap: 'round' });
  }

  function addSlash(a: Vec, b: Vec, color: number, glow: number, width: number, now: number, duration: number): void {
    const g = new Graphics();
    drawSlashLine(g, a, b, color, glow, width, 1);
    effectLayer.addChild(g);
    slashes.push({ g, start: now, duration });
  }

  function spawnJuice(piece: CutPiece, a: Vec, b: Vec, now: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    const n = { x: -dir.y, y: dir.x };
    const colors = FRUIT_COLORS[piece.kind] ?? FRUIT_COLORS['orange']!;
    const palette = [colors.flesh, colors.fleshLight, colors.skin, hex(skin.sparks.color)];
    for (let i = 0; i < 18; i++) {
      const along = random(-0.75, 0.75) * piece.radius;
      const side = i % 2 === 0 ? 1 : -1;
      particles.push({
        x: piece.x + dir.x * along,
        y: piece.y + dir.y * along,
        vx: n.x * side * random(30, 170) + dir.x * random(-40, 40),
        vy: n.y * side * random(30, 170) + dir.y * random(-40, 40) - random(30, 150),
        born: now,
        life: random(0.45, 0.95),
        size: random(1.6, 4.2),
        color: palette[i % palette.length]!,
      });
    }
  }

  return {
    ready,
    setSkin(next) {
      skin = next;
      paintKnife(knifeBody);
    },

    setDrag(next) {
      drag = next;
    },

    showCut(a, b, pieces, ok, now) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / len, y: dy / len };
      const n = { x: -dir.y, y: dir.x };
      const reach = 700;
      for (const piece of pieces) {
        for (const side of [1, -1] as const) {
          const root = new Container();
          const g = makeFruitBody(piece.shape, piece);
          // A half-plane on one side of the cut line hides the other half.
          const mask = new Graphics()
            .poly([
              a.x - dir.x * reach, a.y - dir.y * reach,
              a.x + dir.x * reach, a.y + dir.y * reach,
              a.x + dir.x * reach + n.x * side * reach, a.y + dir.y * reach + n.y * side * reach,
              a.x - dir.x * reach + n.x * side * reach, a.y - dir.y * reach + n.y * side * reach,
            ])
            .fill(0xffffff);
          root.addChild(g, mask);
          root.mask = mask;
          root.pivot.set(piece.x, piece.y);
          root.position.set(piece.x, piece.y);
          if (!ok) root.tint = 0xffa3a3;
          effectLayer.addChild(root);
          halves.push({ root, start: now, nx: n.x * side, ny: n.y * side, cx: piece.x, cy: piece.y, spin: side * random(0.25, 0.6) });
        }
        spawnJuice(piece, a, b, now);
      }
      if (ok) addSlash(a, b, hex(skin.trail.color), hex(skin.trail.glow), skin.trail.width, now, 0.4);
      else addSlash(a, b, COLORS.tomato, COLORS.tomato, 3, now, 0.45);
    },

    showCancel(a, b, now) {
      addSlash(a, b, 0x9a8fb0, 0x6b5b8a, 2, now, 0.28);
    },

    showBomb(x, y, now) {
      const g = new Graphics();
      effectLayer.addChild(g);
      rings.push({ x, y, start: now, g });
      for (let i = 0; i < 16; i++) {
        const angle = random(0, Math.PI * 2);
        const speed = random(60, 230);
        particles.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, born: now, life: random(0.4, 0.8),
          size: random(2, 5), color: [COLORS.tomato, COLORS.citrus, 0x3b3052][i % 3]!,
        });
      }
    },

    showBubble(x, y, now) {
      const g = new Graphics();
      effectLayer.addChild(g);
      rings.push({ x, y, start: now, g, color: COLORS.lime });
      for (let i = 0; i < 14; i++) {
        const angle = random(0, Math.PI * 2);
        const speed = random(50, 180);
        particles.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, born: now, life: random(0.4, 0.8),
          size: random(2, 4.5), color: [COLORS.lime, COLORS.cream, 0xd6ffb0][i % 3]!,
        });
      }
    },

    clearEffects() {
      for (const h of halves.splice(0)) h.root.destroy({ children: true });
      for (const s of slashes.splice(0)) s.g.destroy();
      for (const r of rings.splice(0)) r.g.destroy();
      particles.length = 0;
      for (const gh of ghosts.splice(0)) gh.root.destroy({ children: true });
    },

    showGallery(kinds) {
      for (const child of galleryLayer.removeChildren()) child.destroy({ children: true });
      attract.visible = false;
      const rng = createRng(11);
      const cols = 4;
      const radius = 38;
      kinds.forEach((kind, i) => {
        const x = 48 + (i % cols) * 88;
        const y = 84 + Math.floor(i / cols) * 112;
        const g = makeFruitBody(makeFruitShape(kind, rng, CONFIG.fruit.segments), { x, y, rotation: 0, radius });
        galleryLayer.addChild(g);
      });
    },

    update({ run, alpha, now }) {
      const dt = Math.min(0.1, Math.max(0, now - lastNow));
      lastNow = now;

      // Menu backdrop.
      attract.visible = run === null && galleryLayer.children.length === 0;
      if (run === null) {
        for (const item of attractItems) {
          item.holder.position.set(item.x + Math.sin(now * 0.5 + item.index * 2) * 6, item.y + Math.cos(now * 0.4 + item.index) * 9);
          item.holder.rotation = Math.sin(now * 0.3 + item.index * 1.7) * 0.4;
        }
      }

      // Fruit on screen.
      const liveFruit = new Set<number>();
      for (const f of run?.fruits ?? []) {
        liveFruit.add(f.id);
        let sprite = fruitSprites.get(f.id);
        if (!sprite) {
          sprite = { root: makeFruitSprite(f.radius, f.shape), born: now };
          fruitLayer.addChild(sprite.root);
          fruitSprites.set(f.id, sprite);
        }
        const pop = easeOutBack(clamp01((now - sprite.born) / 0.3));
        sprite.root.position.set(lerp(f.prevX, f.x, alpha), lerp(f.prevY, f.y, alpha));
        sprite.root.rotation = lerp(f.prevRotation, f.rotation, alpha);
        sprite.root.scale.set(0.55 + 0.45 * pop);
        sprite.root.alpha = clamp01((now - sprite.born) / 0.12);
      }
      for (const [id, sprite] of fruitSprites) {
        if (liveFruit.has(id)) continue;
        sprite.root.destroy({ children: true });
        fruitSprites.delete(id);
      }

      // Bombs.
      const liveBombs = new Set<number>();
      for (const b of run?.bombs ?? []) {
        liveBombs.add(b.id);
        let sprite = bombSprites.get(b.id);
        if (!sprite) {
          sprite = { root: makeBomb(b.r) };
          bombLayer.addChild(sprite.root);
          bombSprites.set(b.id, sprite);
        }
        sprite.root.position.set(lerp(b.prevX, b.x, alpha), lerp(b.prevY, b.y, alpha));
        sprite.root.scale.set(1 + Math.sin(now * 6 + b.id) * 0.04);
      }
      for (const [id, sprite] of bombSprites) {
        if (liveBombs.has(id)) continue;
        sprite.root.destroy({ children: true });
        bombSprites.delete(id);
      }

      // "+x" bubbles over the fruit.
      const liveBubbles = new Set<number>();
      for (const b of run?.bubbles ?? []) {
        liveBubbles.add(b.id);
        let sprite = bubbleSprites.get(b.id);
        if (!sprite) {
          sprite = { root: makeBubble(b.r, b.value), born: now };
          bubbleLayer.addChild(sprite.root);
          bubbleSprites.set(b.id, sprite);
        }
        const pop = easeOutBack(clamp01((now - sprite.born) / 0.35));
        sprite.root.position.set(b.x, b.y + Math.sin(now * 3 + b.id) * 3);
        sprite.root.scale.set((0.4 + 0.6 * pop) * (1 + Math.sin(now * 4 + b.id) * 0.04));
      }
      for (const [id, sprite] of bubbleSprites) {
        if (liveBubbles.has(id)) continue;
        sprite.root.destroy({ children: true });
        bubbleSprites.delete(id);
      }

      // Cut halves drift apart, tumble, and fade.
      for (let i = halves.length - 1; i >= 0; i--) {
        const h = halves[i]!;
        const t = clamp01((now - h.start) / HALF_SECONDS);
        const push = 62 * easeOutCubic(t);
        const fall = 240 * t * t;
        h.root.position.set(h.cx + h.nx * push, h.cy + h.ny * push + fall);
        h.root.rotation = h.spin * t;
        h.root.alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        if (t >= 1) {
          h.root.destroy({ children: true });
          halves.splice(i, 1);
        }
      }

      for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i]!;
        const t = clamp01((now - s.start) / s.duration);
        s.g.alpha = 1 - t;
        if (t >= 1) {
          s.g.destroy();
          slashes.splice(i, 1);
        }
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!;
        const t = clamp01((now - r.start) / 0.5);
        r.g.clear().circle(r.x, r.y, 22 + 70 * easeOutCubic(t)).stroke({ width: 6 * (1 - t) + 1, color: r.color ?? COLORS.tomato, alpha: 1 - t });
        if (t >= 1) {
          r.g.destroy();
          rings.splice(i, 1);
        }
      }

      // Juice.
      particleGraphics.clear();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        const age = now - p.born;
        if (age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        particleGraphics.circle(p.x, p.y, p.size * (1 - age / p.life * 0.5)).fill({ color: p.color, alpha: 1 - age / p.life });
      }

      // The drag in progress: a glowing line, and the knife riding its end.
      dragGraphics.clear();
      const live = drag !== null && Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) > 6;
      if (drag) {
        drawSlashLine(dragGraphics, drag.a, drag.b, hex(skin.trail.color), hex(skin.trail.glow), skin.trail.width, 1);
        dragGraphics.circle(drag.a.x, drag.a.y, 4).fill({ color: hex(skin.trail.color), alpha: 0.9 });
      }
      if (live && drag) {
        if (!knifeActive) {
          knifeActive = true;
          knifeStart = now;
          knifeSpeed = 0;
          knifePos.x = drag.b.x;
          knifePos.y = drag.b.y;
        }
        // The knife trails the fingertip a little, which gives it weight.
        const follow = 1 - Math.exp(-dt * 26);
        const px = knifePos.x;
        const py = knifePos.y;
        knifePos.x += (drag.b.x - knifePos.x) * follow;
        knifePos.y += (drag.b.y - knifePos.y) * follow;
        const speed = dt > 0 ? Math.hypot(knifePos.x - px, knifePos.y - py) / dt : 0;
        knifeSpeed += (speed - knifeSpeed) * 0.25;
        const angle = Math.atan2(drag.b.y - drag.a.y, drag.b.x - drag.a.x);
        lastDir = { x: Math.cos(angle), y: Math.sin(angle) };
        // It sways as it goes, more the faster you move.
        const sway = Math.sin(now * 8) * (0.07 + 0.2 * Math.min(1, knifeSpeed / 500));
        knife.position.set(knifePos.x, knifePos.y);
        knife.rotation = angle + BASE_TILT + sway;
        knife.scale.set(easeOutBack(clamp01((now - knifeStart) / 0.22)));
        knife.visible = true;
      } else if (knifeActive) {
        knifeActive = false;
        knife.visible = false;
        releaseKnife(now);
      }
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const gh = ghosts[i]!;
        const t = clamp01((now - gh.start) / 0.3);
        const travel = 80 * easeOutCubic(t);
        gh.root.position.set(gh.from.x + gh.dir.x * travel, gh.from.y + gh.dir.y * travel);
        gh.root.rotation = gh.angle + 0.5 * t;
        gh.root.alpha = 1 - t;
        if (t >= 1) {
          gh.root.destroy({ children: true });
          ghosts.splice(i, 1);
        }
      }
    },
  };
}
