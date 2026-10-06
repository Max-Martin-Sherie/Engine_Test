/** What is saved between sessions: settings, the last choices and some career numbers. Pure; the flow stores the text. */
import type { Difficulty, Mode } from './sim/config';

export type Quality = 'auto' | 'low' | 'high';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  /** Phones: go fullscreen (and lock to landscape) when a match starts, where the browser allows it. */
  fullscreen: boolean;
  /** How fast the view turns: 1 is the default, 0.3 .. 2.5. */
  sensitivity: number;
  /** Vertical field of view in degrees, 60 .. 100. */
  fov: number;
  /** The view slows down and drifts toward an enemy near the crosshair. */
  aimAssist: boolean;
  /** Shoots by itself while the crosshair is on an enemy. */
  autoFire: boolean;
  /** Phones: the move stick on the right and the look and fire controls on the left. */
  leftHanded: boolean;
  invertY: boolean;
  quality: Quality;
}

export interface Profile {
  version: 1;
  settings: Settings;
  mode: Mode;
  level: Difficulty;
  /** How many computer players are in a match. */
  bots: number;
  /** The map last played. */
  seed: number;
  played: number;
  wins: number;
  kills: number;
  deaths: number;
  /** The most kills in one match. */
  best: number;
  /** The how-to-play hint was shown. */
  helped: boolean;
}

export const BOT_COUNTS: readonly number[] = [3, 5, 7, 9];

export const SENSITIVITY = { min: 0.3, max: 2.5 };
export const FOV = { min: 60, max: 100 };

export const defaultProfile = (): Profile => ({
  version: 1,
  settings: { sound: true, haptics: true, fullscreen: true, sensitivity: 1, fov: 78, aimAssist: true, autoFire: false, leftHanded: false, invertY: false, quality: 'auto' },
  mode: 'tdm',
  level: 'normal',
  bots: 5,
  seed: 1,
  played: 0,
  wins: 0,
  kills: 0,
  deaths: 0,
  best: 0,
  helped: false,
});

const count = (v: unknown, max: number, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback);
const ranged = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

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
  const s = (typeof record['settings'] === 'object' && record['settings'] !== null ? record['settings'] : {}) as Record<string, unknown>;
  const level = record['level'];
  const quality = s['quality'];
  const bots = count(record['bots'], 9, base.bots);
  return {
    version: 1,
    settings: {
      sound: s['sound'] !== false,
      haptics: s['haptics'] !== false,
      fullscreen: s['fullscreen'] !== false,
      sensitivity: ranged(s['sensitivity'], SENSITIVITY.min, SENSITIVITY.max, base.settings.sensitivity),
      fov: ranged(s['fov'], FOV.min, FOV.max, base.settings.fov),
      aimAssist: s['aimAssist'] !== false,
      autoFire: s['autoFire'] === true,
      leftHanded: s['leftHanded'] === true,
      invertY: s['invertY'] === true,
      quality: quality === 'low' || quality === 'high' ? quality : 'auto',
    },
    mode: record['mode'] === 'ffa' ? 'ffa' : 'tdm',
    level: level === 'easy' || level === 'hard' ? level : 'normal',
    bots: BOT_COUNTS.includes(bots) ? bots : base.bots,
    seed: Math.max(1, count(record['seed'], 99999, 1)),
    played: count(record['played'], 1_000_000),
    wins: count(record['wins'], 1_000_000),
    kills: count(record['kills'], 10_000_000),
    deaths: count(record['deaths'], 10_000_000),
    best: count(record['best'], 1000),
    helped: record['helped'] === true,
  };
}

export const serializeProfile = (profile: Profile): string => JSON.stringify(profile);
