import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

export interface StoreForUI {
  id: string;
  name: string;
  address: string;
  city: string;
  lastVisit?: string;
  status: 'active' | 'inactive';
  /** Si la tienda usa planograma para pedidos. Si false, el pedido se hace por catálogo. */
  hasPlanogram?: boolean;
}

function toStore(raw: any): StoreForUI {
  const id = String(raw?.id ?? raw?.Id ?? '');
  const name = String(raw?.name ?? raw?.Name ?? '');
  const address = String(raw?.address ?? raw?.Address ?? '');
  const city = String(raw?.city ?? raw?.City ?? raw?.cityId ?? raw?.CityId ?? '');
  const isActive = raw?.isActive ?? raw?.IsActive ?? true;
  const hasPlanogram = raw?.hasPlanogram ?? raw?.HasPlanogram ?? true;
  return {
    id,
    name,
    address,
    city,
    status: isActive ? 'active' : 'inactive',
    lastVisit: raw?.lastVisit ?? raw?.LastVisit,
    hasPlanogram: !!hasPlanogram,
  };
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

// Cache simple en memoria por id de tienda
const storeCache = new Map<string, Promise<StoreForUI | null>>();

export const storesApi = {
  async fetchStores(): Promise<StoreForUI[]> {
    try {
      const res = await apiClient.get<any>('/stores/stores');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      const all = (list as any[]).map(toStore);
      const active = all.filter((s) => s.status === 'active');
      await cacheSet('stores.active', active);
      // Pre-cargar cache por id para evitar peticiones repetidas en vistas que resuelven nombres
      active.forEach((s) => {
        const key = String(s.id).trim();
        if (key && !storeCache.has(key)) {
          storeCache.set(key, Promise.resolve(s));
        }
      });
      return active;
    } catch (error) {
      const err = error as ApiError;
      if (!isExpectedOfflineError(error)) {
        console.warn('[stores-api] GET /stores/stores failed:', err.message || err);
      }
      const cached = await cacheGet<StoreForUI[]>('stores.active');
      return cached ?? [];
    }
  },

  async fetchStoreById(id: string): Promise<StoreForUI | null> {
    const key = String(id ?? '').trim();
    if (!key) return null;

    let cached = storeCache.get(key);
    if (!cached) {
      cached = (async () => {
        try {
          const res = await apiClient.get<any>(`/stores/stores/${encodeURIComponent(key)}`);
          const mapped = res ? toStore(res) : null;
          if (mapped) {
            const activeCached = (await cacheGet<StoreForUI[]>('stores.active')) ?? [];
            const exists = activeCached.some((s) => String(s.id) === String(mapped.id));
            if (!exists) {
              await cacheSet('stores.active', [...activeCached, mapped]);
            }
          }
          return mapped;
        } catch {
          const cachedStores = (await cacheGet<StoreForUI[]>('stores.active')) ?? [];
          return cachedStores.find((s) => String(s.id).trim() === key) ?? null;
        }
      })();
      storeCache.set(key, cached);
    }

    try {
      return await cached;
    } catch {
      storeCache.delete(key);
      return null;
    }
  },
};
