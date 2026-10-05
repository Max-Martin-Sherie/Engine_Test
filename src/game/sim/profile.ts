/** What is saved between sessions: settings and the best result for each seed played. Pure; the flow stores the text. */

export interface Settings {
  sound: boolean;
  haptics: boolean;
}

export interface Result {
  loops: number;
  stars: number;
}

export interface Profile {
  version: 1;
  settings: Settings;
  /** Best result per seed (as text). Oldest are dropped past MAX_RESULTS. */
  results: Record<string, Result>;
  /** Arenas cleared, ever. */
  cleared: number;
}

export const MAX_RESULTS = 300;

export function defaultProfile(): Profile {
  return { version: 1, settings: { sound: true, haptics: true }, results: {}, cleared: 0 };
}

const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);

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
  const results: Record<string, Result> = {};
  const saved = record['results'];
  if (typeof saved === 'object' && saved !== null) {
    for (const [seed, value] of Object.entries(saved as Record<string, unknown>)) {
      if (!/^\d{1,10}$/.test(seed) || typeof value !== 'object' || value === null) continue;
      const r = value as Record<string, unknown>;
      const loops = count(r['loops'], 99);
      const stars = count(r['stars'], 3);
      if (loops >= 1 && stars >= 1) results[seed] = { loops, stars };
    }
  }
  return {
    version: 1,
    settings: { sound: settings['sound'] !== false, haptics: settings['haptics'] !== false },
    results,
    cleared: count(record['cleared'], 1_000_000),
  };
}

export const serializeProfile = (profile: Profile): string => JSON.stringify(profile);

export function setSetting(profile: Profile, key: keyof Settings, value: boolean): Profile {
  return { ...profile, settings: { ...profile.settings, [key]: value } };
}

/** Records a cleared arena; keeps only the better of the old and new result for that seed. */
export function recordResult(profile: Profile, seed: number, loops: number, stars: number): { profile: Profile; isBest: boolean } {
  const key = String(seed);
  const old = profile.results[key];
  const isBest = old === undefined || loops < old.loops;
  const results = { ...profile.results };
  if (isBest) {
    delete results[key]; // re-insert so it counts as the newest
    results[key] = { loops, stars };
  }
  const keys = Object.keys(results);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_RESULTS))) delete results[k];
  return { profile: { ...profile, results, cleared: profile.cleared + 1 }, isBest };
}

export const bestFor = (profile: Profile, seed: number): Result | null => profile.results[String(seed)] ?? null;

export const totalStars = (profile: Profile): number => Object.values(profile.results).reduce((sum, r) => sum + r.stars, 0);
