/**
 * localStorage can be missing or throw (private mode, blocked site data, quota, WebView quirks).
 * These helpers never throw; callers get a fallback / `false` instead.
 */

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Reads a non-negative finite number, or `fallback` when missing / corrupt. */
export function safeGetNumber(key: string, fallback = 0): number {
  const raw = safeGetItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function safeSetNumber(key: string, value: number): boolean {
  return safeSetItem(key, String(value));
}
