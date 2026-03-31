import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

/** Precio vigente de un producto (solo lectura en PWA) */
export interface LatestPriceResult {
  price: number;
}

const HISTPRICE_CACHE_KEY_PREFIX = 'histprices.latest.';
const OFFLINE_HINT_KEY = 'app_offline_hint';

function getCachedLatestPriceKey(familyId: string): string {
  return `${HISTPRICE_CACHE_KEY_PREFIX}${familyId}`;
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
  // Si hubo fallos de red muy recientes, evitamos más requests para no congelar UI.
  return hintAge != null && hintAge >= 0 && hintAge < 10_000;
}

async function safeGet<T>(endpoint: string): Promise<T | null> {
  try {
    return await apiClient.get<T>(endpoint);
  } catch (error) {
    const err = error as ApiError;
    const msg = String(err?.message || '');
    const isNotFound = err?.status === 404 || /not found|no encontrado/i.test(msg);
    const isOffline =
      Number((err as any)?.status ?? 0) === 0 ||
      /error de conexión|network/i.test(msg);
    // Cuando no existe histórico de precio devolvemos 0 sin ruido en consola.
    if (!isNotFound && !isOffline) {
      console.error(`[histprices-api] GET ${endpoint} failed:`, err.message || err);
    }
    return null;
  }
}

function parsePrice(raw: any): number {
  if (raw == null) return 0;
  const n = Number(
    raw?.price ?? raw?.Price ??
    raw?.currentPrice ?? raw?.CurrentPrice ??
    raw?.value ?? raw?.Value ?? 0
  );
  return Number.isFinite(n) ? n : 0;
}

/**
 * Si la API devuelve un array del historial, toma el último registro (el más reciente).
 */
function takeLatestFromResponse(res: any): any {
  if (res == null) return null;
  if (Array.isArray(res)) {
    const arr = res as any[];
    return arr.length > 0 ? arr[arr.length - 1] : null;
  }
  if (Array.isArray(res?.data)) {
    const arr = res.data as any[];
    return arr.length > 0 ? arr[arr.length - 1] : null;
  }
  if (Array.isArray(res?.items)) {
    const arr = res.items as any[];
    return arr.length > 0 ? arr[arr.length - 1] : null;
  }
  return res;
}

// Cache en memoria para evitar múltiples peticiones por el mismo producto
const latestPriceCache = new Map<string, Promise<number>>();

export const histpricesApi = {
  /**
 * Obtiene el último precio del historial de una familia.
 * GET /histprices/histprices/latest/{familyId}
   * Si la API devuelve lista, se usa el último registro (el más reciente).
 * Las peticiones se cachean por familyId en memoria para acelerar vistas como historial, pendientes, etc.
   */
  async getLatest(familyId: string): Promise<number> {
    const key = String(familyId ?? '').trim();
    if (!key) return 0;
    const cacheKey = getCachedLatestPriceKey(key);

    if (shouldSkipNetworkForHistprices()) {
      const cachedPrice = await cacheGet<number>(cacheKey);
      return Number.isFinite(Number(cachedPrice)) ? Number(cachedPrice) : 0;
    }

    let cached = latestPriceCache.get(key);
    if (!cached) {
      cached = (async () => {
        const res = await safeGet<any>(
          `/histprices/histprices/latest/${encodeURIComponent(key)}`
        );
        const last = takeLatestFromResponse(res);
        const price = last != null ? parsePrice(last) : 0;
        if (price > 0) {
          await cacheSet<number>(cacheKey, price);
        } else {
          const fallback = await cacheGet<number>(cacheKey);
          if (Number.isFinite(Number(fallback))) return Number(fallback);
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
