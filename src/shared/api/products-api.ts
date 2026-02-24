import { apiClient, ApiError } from './api-client';

/** Producto para la PWA (solo lectura desde API) */
export interface ProductForUI {
  id: string;
  sku: string;
  name: string;
  category: string;
  currentPrice: number;
  isActive: boolean;
}

function toProduct(raw: any): ProductForUI {
  return {
    id: String(raw?.id ?? raw?.Id ?? ''),
    sku: String(raw?.sku ?? raw?.Sku ?? ''),
    name: String(raw?.name ?? raw?.Name ?? ''),
    category: String(raw?.category ?? raw?.Category ?? raw?.categoryName ?? raw?.CategoryName ?? ''),
    currentPrice: Number(raw?.currentPrice ?? raw?.CurrentPrice ?? raw?.price ?? raw?.Price ?? 0),
    isActive: typeof raw?.isActive === 'boolean' ? raw.isActive : (raw?.IsActive ?? true),
  };
}

// Cache en memoria para productos individuales (por id)
const productCache = new Map<string, Promise<ProductForUI | null>>();

export const productsApi = {
  /** Lista todos los productos. GET /products/products */
  async fetchAll(): Promise<ProductForUI[]> {
    try {
      const res = await apiClient.get<any>('/products/products');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      const products = (list as any[]).map(toProduct);
      // Pre-cargar cache básica por id para evitar peticiones repetidas posteriores
      products.forEach((p) => {
        const key = String(p.id).trim();
        if (key && !productCache.has(key)) {
          productCache.set(key, Promise.resolve(p));
        }
      });
      return products;
    } catch (error) {
      const err = error as ApiError;
      console.error('[products-api] GET /products/products failed:', err.message || err);
      return [];
    }
  },

  /** Obtiene un producto por id. GET /products/products/{id} */
  async getById(id: string): Promise<ProductForUI | null> {
    const key = String(id ?? '').trim();
    if (!key) return null;

    let cached = productCache.get(key);
    if (!cached) {
      cached = (async () => {
        try {
          const res = await apiClient.get<any>(`/products/products/${encodeURIComponent(key)}`);
          const product = res ? toProduct(res) : null;
          return product;
        } catch {
          return null;
        }
      })();
      productCache.set(key, cached);
    }

    try {
      return await cached;
    } catch {
      productCache.delete(key);
      return null;
    }
  },
};
