import { CONFIG, type Mode } from './config';
import type { Skin } from './skins';

export interface Settings {
  sound: boolean;
  haptics: boolean;
}

/** Everything saved between sessions. Immutable: every function returns a new profile. */
export interface Profile {
  version: 1;
  coins: number;
  /** Ids of the skins the player owns. Always includes the default. */
  owned: string[];
  equipped: string;
  best: Record<Mode, number>;
  settings: Settings;
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    coins: CONFIG.startCoins,
    owned: [CONFIG.defaultSkin],
    equipped: CONFIG.defaultSkin,
    best: { classic: 0, arcade: 0, survival: 0 },
    settings: { sound: true, haptics: true },
  };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a saved profile. Never throws: missing, corrupt or tampered data falls back to defaults
 * field by field, so one bad value cannot lose the rest.
 */
export function parseProfile(raw: string | null): Profile {
  const base = defaultProfile();
  if (raw === null) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isRecord(data)) return base;

  const owned = Array.isArray(data['owned'])
    ? data['owned'].filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 32)
    : [];
  const ownedUnique = [...new Set([CONFIG.defaultSkin, ...owned])];
  const equipped = typeof data['equipped'] === 'string' && ownedUnique.includes(data['equipped']) ? data['equipped'] : CONFIG.defaultSkin;
  const best = isRecord(data['best']) ? data['best'] : {};
  const settings = isRecord(data['settings']) ? data['settings'] : {};

  return {
    version: 1,
    coins: count(data['coins']),
    owned: ownedUnique,
    equipped,
    best: { classic: count(best['classic']), arcade: count(best['arcade']), survival: count(best['survival']) },
    settings: {
      sound: typeof settings['sound'] === 'boolean' ? settings['sound'] : base.settings.sound,
      haptics: typeof settings['haptics'] === 'boolean' ? settings['haptics'] : base.settings.haptics,
    },
  };
}

export function serializeProfile(profile: Profile): string {
  return JSON.stringify(profile);
}

export function earn(profile: Profile, coins: number): Profile {
  return { ...profile, coins: profile.coins + count(coins) };
}

/** Takes coins, or returns null if the player cannot afford it. */
export function spend(profile: Profile, coins: number): Profile | null {
  const cost = count(coins);
  return cost > profile.coins ? null : { ...profile, coins: profile.coins - cost };
}

export type BuyResult = { ok: true; profile: Profile } | { ok: false; reason: 'owned' | 'poor' };

export function buySkin(profile: Profile, skin: Skin): BuyResult {
  if (profile.owned.includes(skin.id)) return { ok: false, reason: 'owned' };
  const paid = spend(profile, skin.price);
  if (paid === null) return { ok: false, reason: 'poor' };
  return { ok: true, profile: { ...paid, owned: [...paid.owned, skin.id] } };
}

/** Equips an owned skin; null if it is not owned. */
export function equipSkin(profile: Profile, id: string): Profile | null {
  return profile.owned.includes(id) ? { ...profile, equipped: id } : null;
}

export function recordBest(profile: Profile, mode: Mode, score: number): { profile: Profile; isNewBest: boolean } {
  const isNewBest = score > profile.best[mode];
  return isNewBest ? { profile: { ...profile, best: { ...profile.best, [mode]: score } }, isNewBest } : { profile, isNewBest };
}

export function setSetting(profile: Profile, key: keyof Settings, value: boolean): Profile {
  return { ...profile, settings: { ...profile.settings, [key]: value } };
}
