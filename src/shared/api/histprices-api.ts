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
    console.error(`[histprices-api] GET ${endpoint} failed:`, err.message || err);
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

export const histpricesApi = {
  /**
   * Obtiene el último precio del historial de un producto.
   * GET /histprices/histprices/latest/{productId}
   * Si la API devuelve lista, se usa el último registro (el más reciente).
   */
  async getLatest(productId: string): Promise<number> {
    const res = await safeGet<any>(
      `/histprices/histprices/latest/${encodeURIComponent(productId)}`
    );
    const last = takeLatestFromResponse(res);
    return last != null ? parsePrice(last) : 0;
  },
};
