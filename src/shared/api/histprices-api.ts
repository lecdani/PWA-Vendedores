import { apiClient, ApiError } from './api-client';

/** Precio vigente de un producto (solo lectura en PWA) */
export interface LatestPriceResult {
  price: number;
}

async function safeGet<T>(endpoint: string): Promise<T | null> {
  try {
    return await apiClient.get<T>(endpoint);
  } catch (error) {
    const err = error as ApiError;
    const msg = String(err?.message || '');
    const isNotFound = err?.status === 404 || /not found|no encontrado/i.test(msg);
    // Cuando no existe histórico de precio devolvemos 0 sin ruido en consola.
    if (!isNotFound) {
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

    let cached = latestPriceCache.get(key);
    if (!cached) {
      cached = (async () => {
        const res = await safeGet<any>(
          `/histprices/histprices/latest/${encodeURIComponent(key)}`
        );
        const last = takeLatestFromResponse(res);
        return last != null ? parsePrice(last) : 0;
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
