/**
 * Painted fruit. If `src/game/art/fruits.png` exists (made with `scripts/fruit-art.mjs prepare`), the
 * game draws fruit from it; otherwise it falls back to the built-in vector drawings in fruitArt.ts.
 *
 * The sheet is 5 columns x 4 rows of 256 px cells, in the order of FRUIT_KINDS. Each fruit sits in the
 * middle of its cell and its outline reaches SHEET_RADIUS px from the middle, so a fruit of world
 * radius r is drawn at scale r / SHEET_RADIUS.
 */
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { FRUIT_KINDS, type FruitKind, type FruitShape } from '../sim';
import { drawFruit, type FruitPose } from './fruitArt';

const COLS = 5;
const CELL = 256;
const SHEET_RADIUS = 112;

// With no file, the glob matches nothing: no request is made and nothing can 404.
const found = import.meta.glob('../art/fruits.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const sheetUrl = Object.values(found)[0];

const textures = new Map<FruitKind, Texture>();

/** Loads the sheet in the background. Fruit made before it arrives use the vector drawings. */
export async function loadFruitSheet(): Promise<void> {
  if (!sheetUrl) return;
  try {
    const sheet = await Assets.load<Texture>(sheetUrl);
    FRUIT_KINDS.forEach((kind, i) => {
      const frame = new Rectangle((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
      textures.set(kind, new Texture({ source: sheet.source, frame }));
    });
  } catch {
    textures.clear(); // a broken file must never break the game: keep the vector drawings
  }
}

/** A fruit as a display object, placed by `pose`: a painted sprite if there is one, else the vector drawing. */
export function makeFruitBody(shape: FruitShape, pose: FruitPose): Container {
  const texture = textures.get(shape.kind);
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(pose.x, pose.y);
    sprite.rotation = pose.rotation;
    sprite.scale.set(pose.radius / SHEET_RADIUS);
    return sprite;
  }
  const g = new Graphics();
  drawFruit(g, shape, pose);
  return g;
}
