/** What is saved between sessions: settings, the last choices and a win count. Pure; the flow stores the text. */
import type { Level } from './ui';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  /** The camera scrolls when the mouse touches the edge of the window. */
  edgeScroll: boolean;
  /** Health bars on every unit, not only the hurt and selected ones. */
  bars: boolean;
}

export interface Profile {
  version: 1;
  settings: Settings;
  level: Level;
  /** The map last shown. */
  seed: number;
  wins: number;
  played: number;
  /** The how-to-play hint was shown. */
  helped: boolean;
}

export const defaultProfile = (): Profile => ({
  version: 1,
  settings: { sound: true, haptics: true, edgeScroll: false, bars: false },
  level: 'normal',
  seed: 1,
  wins: 0,
  played: 0,
  helped: false,
});

const count = (v: unknown, max: number, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback);

/** Reads saved text; anything unusable gives the defaults (never throws). */
export function parseProfile(raw: string | null): Profile {
  const base = defaultProfile();
  if (raw === null) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof data !== 'object' || data === null) return base;
  const record = data as Record<string, unknown>;
  const settings = (typeof record['settings'] === 'object' && record['settings'] !== null ? record['settings'] : {}) as Record<string, unknown>;
  const level = record['level'];
  return {
    version: 1,
    settings: {
      sound: settings['sound'] !== false,
      haptics: settings['haptics'] !== false,
      edgeScroll: settings['edgeScroll'] === true,
      bars: settings['bars'] === true,
    },
    level: level === 'easy' || level === 'hard' ? level : 'normal',
    seed: Math.max(1, count(record['seed'], 99999, 1)),
    wins: count(record['wins'], 1_000_000),
    played: count(record['played'], 1_000_000),
    helped: record['helped'] === true,
  };
}

export const serializeProfile = (profile: Profile): string => JSON.stringify(profile);
