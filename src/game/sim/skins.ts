import { CONFIG } from './config';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type BladeShape = 'straight' | 'cleaver' | 'curved' | 'serrated';

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const BLADE_SHAPES: readonly BladeShape[] = ['straight', 'cleaver', 'curved', 'serrated'];

/**
 * A knife skin: pure data (colours and a blade shape), never code or images, so a catalog can
 * come from anywhere without being able to do anything but change how the knife looks.
 * Skins are cosmetic only; they never affect gameplay.
 */
export interface Skin {
  id: string;
  name: string;
  rarity: Rarity;
  /** Coins to buy it. 0 = free. */
  price: number;
  blade: { color: string; edge: string; shape: BladeShape };
  handle: { color: string; accent: string };
  trail: { color: string; glow: string; width: number };
  sparks: { color: string };
}

const skin = (
  id: string,
  name: string,
  rarity: Rarity,
  price: number,
  shape: BladeShape,
  blade: string,
  edge: string,
  handle: string,
  accent: string,
  trail: string,
  glow: string,
  sparks: string,
  width = 3,
): Skin => ({
  id,
  name,
  rarity,
  price,
  blade: { color: blade, edge, shape },
  handle: { color: handle, accent },
  trail: { color: trail, glow, width },
  sparks: { color: sparks },
});

/** The skins that ship inside the app. An online catalog can add to or replace these. */
export const BUNDLED_SKINS: readonly Skin[] = [
  skin('steel', 'Steel', 'common', 0, 'straight', '#cfd8dc', '#ffffff', '#5d4037', '#8d6e63', '#e3f2fd', '#90caf9', '#ffffff'),
  skin('cleaver', "Chef's Cleaver", 'common', 120, 'cleaver', '#b0bec5', '#eceff1', '#263238', '#ff7043', '#cfd8dc', '#78909c', '#ffe0b2'),
  skin('ember', 'Ember', 'rare', 300, 'straight', '#ff7043', '#ffe0b2', '#3e2723', '#ff3d00', '#ff7043', '#ffab91', '#ffcc80'),
  skin('jade', 'Jade', 'rare', 300, 'curved', '#43a047', '#c8e6c9', '#1b5e20', '#a5d6a7', '#69f0ae', '#2e7d32', '#b9f6ca'),
  skin('frost', 'Frostbite', 'rare', 350, 'serrated', '#81d4fa', '#e1f5fe', '#01579b', '#b3e5fc', '#80d8ff', '#0288d1', '#e1f5fe'),
  skin('sunset', 'Sunset', 'epic', 700, 'curved', '#ff8a65', '#ffd54f', '#4a148c', '#f06292', '#ffb74d', '#f06292', '#ffe082', 4),
  skin('neon', 'Neon Drift', 'epic', 800, 'straight', '#1de9b6', '#ffffff', '#212121', '#00e5ff', '#00e5ff', '#18ffff', '#84ffff', 4),
  skin('shadow', 'Shadow Fang', 'epic', 900, 'serrated', '#37474f', '#b39ddb', '#120b1f', '#7c4dff', '#b388ff', '#7c4dff', '#d1c4e9', 4),
  skin('gold', 'Golden Edge', 'legendary', 1800, 'cleaver', '#ffd54f', '#fff8e1', '#4e342e', '#ffb300', '#ffca28', '#fff176', '#fff9c4', 5),
  skin('aurora', 'Aurora', 'legendary', 2500, 'curved', '#b388ff', '#e1bee7', '#1a237e', '#64ffda', '#64ffda', '#b388ff', '#a7ffeb', 5),
];

// ---- validation of catalogs (bundled, cached, or downloaded) -------------------------------

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hex(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value)) return null;
  const v = value.toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates one catalog entry; returns the skin, or why it was rejected. */
export function parseSkin(raw: unknown): { skin: Skin } | { error: string } {
  if (!isRecord(raw)) return { error: 'not an object' };
  const { id, name, rarity, price, blade, handle, trail, sparks } = raw;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { error: 'bad id' };
  const label = `skin "${id}"`;
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 32) return { error: `${label}: bad name` };
  if (!RARITIES.includes(rarity as Rarity)) return { error: `${label}: bad rarity` };
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 100_000) {
    return { error: `${label}: bad price` };
  }
  if (!isRecord(blade) || !isRecord(handle) || !isRecord(trail) || !isRecord(sparks)) {
    return { error: `${label}: missing blade, handle, trail or sparks` };
  }
  if (!BLADE_SHAPES.includes(blade['shape'] as BladeShape)) return { error: `${label}: bad blade shape` };
  const colors = [hex(blade['color']), hex(blade['edge']), hex(handle['color']), hex(handle['accent']), hex(trail['color']), hex(trail['glow']), hex(sparks['color'])];
  if (colors.some((c) => c === null)) return { error: `${label}: bad colour` };
  const [bc, be, hc, ha, tc, tg, sc] = colors as string[];
  const width = typeof trail['width'] === 'number' && Number.isFinite(trail['width']) ? Math.min(8, Math.max(1, trail['width'])) : 3;
  return {
    skin: {
      id,
      name: name.trim(),
      rarity: rarity as Rarity,
      price,
      blade: { color: bc!, edge: be!, shape: blade['shape'] as BladeShape },
      handle: { color: hc!, accent: ha! },
      trail: { color: tc!, glow: tg!, width },
      sparks: { color: sc! },
    },
  };
}

export interface ParsedCatalog {
  skins: Skin[];
  /** Entries that were dropped, and why. */
  errors: string[];
}

/** Validates a whole catalog: `{ skins: [...] }` or just `[...]`. Bad entries are dropped, never fatal. */
export function parseCatalog(raw: unknown): ParsedCatalog {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw['skins']) ? raw['skins'] : null;
  if (list === null) return { skins: [], errors: ['catalog has no skins list'] };
  const skins: Skin[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const parsed = parseSkin(entry);
    if ('error' in parsed) {
      errors.push(parsed.error);
    } else if (seen.has(parsed.skin.id)) {
      errors.push(`skin "${parsed.skin.id}": duplicate id`);
    } else {
      seen.add(parsed.skin.id);
      skins.push(parsed.skin);
    }
  }
  return { skins, errors };
}

/**
 * Bundled skins plus an online catalog: online entries replace bundled ones with the same id and
 * add new ones. The default skin always exists and is always free.
 */
export function mergeCatalogs(bundled: readonly Skin[], online: readonly Skin[]): Skin[] {
  const byId = new Map<string, Skin>();
  for (const s of bundled) byId.set(s.id, s);
  for (const s of online) byId.set(s.id, s);
  const fallback = bundled.find((s) => s.id === CONFIG.defaultSkin) ?? BUNDLED_SKINS[0]!;
  const base = byId.get(CONFIG.defaultSkin) ?? fallback;
  byId.set(CONFIG.defaultSkin, { ...base, price: 0 });
  return [...byId.values()];
}

// ---- how a blade is drawn, shared by the game view and the shop preview -------------------

/**
 * Outline of a blade pointing along +x, in a box 100 wide and 28 tall (the tip at x = 100,
 * the spine at the top y = 0 and the edge at the bottom). Pure data so Pixi and SVG draw the same knife.
 */
export function bladeOutline(shape: BladeShape): readonly (readonly [number, number])[] {
  switch (shape) {
    case 'cleaver':
      return [[0, 0], [92, 0], [100, 4], [100, 28], [0, 28]];
    case 'curved':
      return [[0, 4], [40, 0], [78, 6], [100, 22], [70, 28], [34, 24], [0, 20]];
    case 'serrated':
      return [[0, 4], [90, 4], [100, 14], [92, 14], [88, 20], [80, 14], [74, 20], [66, 14], [60, 20], [52, 14], [46, 20], [38, 14], [32, 20], [24, 14], [16, 20], [8, 14], [0, 18]];
    default:
      return [[0, 4], [88, 4], [100, 18], [88, 24], [0, 24]];
  }
}
