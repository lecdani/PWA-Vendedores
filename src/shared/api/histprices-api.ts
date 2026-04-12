import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

const HISTPRICE_CACHE_KEY_PREFIX = 'histprices.latest.';
const OFFLINE_HINT_KEY = 'app_offline_hint';

function getCachedLatestPriceKey(presentationId: string): string {
  return `${HISTPRICE_CACHE_KEY_PREFIX}${presentationId}`;
}

function getOfflineHintAgeMs(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(OFFLINE_HINT_KEY);
  if (!raw) return null;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Date.now() - ts;
}

function shouldSkipNetworkForHistprices(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const hintAge = getOfflineHintAgeMs();
  return hintAge != null && hintAge >= 0 && hintAge < 10_000;
}

function parseHistPriceListResponse(res: any): Array<{ price: number; startDate: Date }> {
  const list = Array.isArray(res)
    ? res
    : res?.data ??
      res?.items ??
      res?.Data ??
      res?.Items ??
      res?.results ??
      res?.Results ??
      [];
  if (!Array.isArray(list)) return [];
  return (list as any[]).map((raw: any) => ({
    price: Number(raw?.price ?? raw?.Price ?? 0),
    startDate: raw?.startDate
      ? new Date(raw.startDate)
      : raw?.StartDate
        ? new Date(raw.StartDate)
        : new Date(0),
  }));
}

/**
 * Mismo criterio que Admin (`histprices-api.fetchLatestPrice`): el registro con startDate más reciente.
 */
function pickLatestPriceFromList(items: Array<{ price: number; startDate: Date }>): number {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  const p = Number(sorted[0]?.price ?? 0);
  return Number.isFinite(p) ? p : 0;
}

async function fetchHistPricesByPresentation(presentationId: string): Promise<Array<{ price: number; startDate: Date }>> {
  const id = String(presentationId ?? '').trim();
  if (!id) return [];
  try {
    const res = await apiClient.get<any>(
      `/histprices/histprices/presentation/${encodeURIComponent(id)}`
    );
    return parseHistPriceListResponse(res);
  } catch (error) {
    const err = error as ApiError;
    const msg = String(err?.message || '');
    const isNotFound = err?.status === 404 || /not found|no encontrado/i.test(msg);
    const isOffline =
      Number((err as any)?.status ?? 0) === 0 || /error de conexión|network/i.test(msg);
    if (!isNotFound && !isOffline) {
      console.error(`[histprices-api] GET presentation/${id} failed:`, err.message || err);
    }
    return [];
  }
}

// Evita múltiples peticiones por la misma presentación en una misma sesión
const latestPriceCache = new Map<string, Promise<number>>();

export const histpricesApi = {
  /**
   * Precio vigente por id de presentación (histórico en BD está ligado a la presentación, no a la familia).
   * GET /histprices/histprices/presentation/{presentationId} y se toma el registro con startDate más reciente.
   */
  async getLatest(presentationId: string): Promise<number> {
    const key = String(presentationId ?? '').trim();
    if (!key) return 0;
    const storageKey = getCachedLatestPriceKey(key);

    if (shouldSkipNetworkForHistprices()) {
      const cachedPrice = await cacheGet<number>(storageKey);
      return Number.isFinite(Number(cachedPrice)) ? Number(cachedPrice) : 0;
    }

    let cached = latestPriceCache.get(key);
    if (!cached) {
      cached = (async () => {
        const list = await fetchHistPricesByPresentation(key);
        const price = pickLatestPriceFromList(list);
        if (price > 0) {
          await cacheSet<number>(storageKey, price);
        } else {
          const fallback = await cacheGet<number>(storageKey);
          if (Number.isFinite(Number(fallback)) && Number(fallback) > 0) return Number(fallback);
        }
        return price;
      })();
      latestPriceCache.set(key, cached);
    }

    try {
      return await cached;
    } catch {
      latestPriceCache.delete(key);
      return 0;
    }
  },
};
