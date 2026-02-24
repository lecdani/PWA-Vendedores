import { apiClient, ApiError } from './api-client';

export interface StoreForUI {
  id: string;
  name: string;
  address: string;
  city: string;
  lastVisit?: string;
  status: 'active' | 'inactive';
}

function toStore(raw: any): StoreForUI {
  const id = String(raw?.id ?? raw?.Id ?? '');
  const name = String(raw?.name ?? raw?.Name ?? '');
  const address = String(raw?.address ?? raw?.Address ?? '');
  const city = String(raw?.city ?? raw?.City ?? raw?.cityId ?? raw?.CityId ?? '');
  const isActive = raw?.isActive ?? raw?.IsActive ?? true;
  return {
    id,
    name,
    address,
    city,
    status: isActive ? 'active' : 'inactive',
    lastVisit: raw?.lastVisit ?? raw?.LastVisit,
  };
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
      console.error('[stores-api] GET /stores/stores failed:', err.message || err);
      return [];
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
          return res ? toStore(res) : null;
        } catch {
          return null;
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
