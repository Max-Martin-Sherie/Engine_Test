/**
 * Painted fruit. If `src/game/art/fruits.png` exists (made with `scripts/fruit-art.mjs prepare`), the
 * game draws fruit from it; otherwise it falls back to the built-in vector drawings in fruitArt.ts.
 *
 * The sheet is 5 columns x 4 rows of square cells, in the order of FRUIT_KINDS. Each fruit sits in the
 * middle of its cell and its outline reaches 7/16 of the cell size from the middle (112 px of a 256 px
 * cell), so any cell size works: a fruit of world radius r is drawn at scale r / (cell * 7/16).
 */
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { FRUIT_KINDS, type FruitKind, type FruitShape } from '../sim';
import { drawFruit, type FruitPose } from './fruitArt';

const COLS = 5;
const OUTLINE_REACH = 7 / 16;

// With no file, the glob matches nothing: no request is made and nothing can 404.
const found = import.meta.glob('../art/fruits.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const sheetUrl = Object.values(found)[0];

const textures = new Map<FruitKind, Texture>();
/** Pixels from a fruit's middle to the edge of its outline in the loaded sheet. */
let sheetRadius = 112;

/** Loads the sheet in the background. Fruit made before it arrives use the vector drawings. */
export async function loadFruitSheet(): Promise<void> {
  if (!sheetUrl) return;
  try {
    const sheet = await Assets.load<Texture>(sheetUrl);
    const cell = Math.floor(sheet.width / COLS);
    sheetRadius = cell * OUTLINE_REACH;
    // Big painted art is shown smaller than it is: mipmaps keep the shrunken picture smooth.
    sheet.source.autoGenerateMipmaps = true;
    sheet.source.style.scaleMode = 'linear';
    sheet.source.style.mipmapFilter = 'linear';
    FRUIT_KINDS.forEach((kind, i) => {
      const frame = new Rectangle((i % COLS) * cell, Math.floor(i / COLS) * cell, cell, cell);
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
    sprite.scale.set(pose.radius / sheetRadius);
    return sprite;
  }
  const g = new Graphics();
  drawFruit(g, shape, pose);
  return g;
}
