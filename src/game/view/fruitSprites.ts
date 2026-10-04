/**
 * Painted fruit, from `src/game/art/fruits.png` (made with `scripts/fruit-art.mjs prepare`, see art/CHATGPT-PROMPT.md).
 *
 * The sheet is 5 columns x 4 rows of square cells, in the order of FRUIT_KINDS. Each fruit sits in the
 * middle of its cell and its outline reaches 7/16 of the cell size from the middle (112 px of a 256 px
 * cell), so any cell size works: a fruit of world radius r is drawn at scale r / (cell * 7/16).
 */
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { FRUIT_KINDS, type FruitKind, type FruitShape } from '../sim';
import { FRUIT_COLORS } from './palette';

/** Where and how large to draw a fruit. Unit-space shapes are multiplied by `radius`. */
export interface FruitPose {
  x: number;
  y: number;
  rotation: number;
  radius: number;
}

const COLS = 5;
const OUTLINE_REACH = 7 / 16;

// With no file, the glob matches nothing: no request is made and nothing can 404.
const found = import.meta.glob('../art/fruits.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const sheetUrl = Object.values(found)[0];

const textures = new Map<FruitKind, Texture>();
/** Pixels from a fruit's middle to the edge of its outline in the loaded sheet. */
let sheetRadius = 112;

/** Loads the sheet in the background; resolves when the fruit can be drawn. Never rejects. */
export async function loadFruitSheet(): Promise<void> {
  if (!sheetUrl) {
    console.warn('src/game/art/fruits.png is missing: fruit are drawn as plain shapes');
    return;
  }
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
  } catch (error) {
    console.warn('The fruit sheet could not be loaded: fruit are drawn as plain shapes', error);
    textures.clear();
  }
}

/** A fruit as a display object, placed by `pose`. Without the sheet it is a plain silhouette, so play never breaks. */
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
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  const points = shape.outline.flatMap((p) => [pose.x + (p.x * cos - p.y * sin) * pose.radius, pose.y + (p.x * sin + p.y * cos) * pose.radius]);
  return new Graphics().poly(points).fill((FRUIT_COLORS[shape.kind] ?? FRUIT_COLORS['orange']!).skin);
}
