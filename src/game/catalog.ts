import { BUNDLED_SKINS, mergeCatalogs, parseCatalog, type Skin } from './sim';

export interface CatalogOptions {
  /** Where the online catalog lives, if anywhere. Without it the game uses only what ships inside it. */
  url: string | undefined;
  /** The last good download, so the skins survive being offline. */
  readCache(): string | null;
  writeCache(json: string): void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The cached online skins merged over the bundled ones: instant, no network. */
export function offlineCatalog(readCache: () => string | null): Skin[] {
  return mergeCatalogs(BUNDLED_SKINS, parseCatalog(parseJson(readCache())).skins);
}

/**
 * The skin catalog: bundled skins, plus an optional online catalog downloaded in the background.
 * Never throws and never blocks the game: any failure (offline, slow, bad JSON, bad entries)
 * quietly leaves the cached or bundled skins in place. Skins are plain data, so even a hostile
 * catalog can only change how the knife looks.
 */
export async function loadCatalog({ url, readCache, writeCache, fetchImpl = globalThis.fetch, timeoutMs = 4000 }: CatalogOptions): Promise<Skin[]> {
  const fallback = offlineCatalog(readCache);
  if (!url) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) return fallback;
    const online = parseCatalog(await response.json());
    if (online.skins.length === 0) return fallback;
    writeCache(JSON.stringify({ skins: online.skins }));
    return mergeCatalogs(BUNDLED_SKINS, online.skins);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
