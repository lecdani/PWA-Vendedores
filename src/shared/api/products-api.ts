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

export const productsApi = {
  /** Lista todos los productos. GET /products/products */
  async fetchAll(): Promise<ProductForUI[]> {
    try {
      const res = await apiClient.get<any>('/products/products');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      return (list as any[]).map(toProduct);
    } catch (error) {
      const err = error as ApiError;
      console.error('[products-api] GET /products/products failed:', err.message || err);
      return [];
    }
  },

  /** Obtiene un producto por id. GET /products/products/{id} */
  async getById(id: string): Promise<ProductForUI | null> {
    try {
      const res = await apiClient.get<any>(`/products/products/${encodeURIComponent(id)}`);
      return res ? toProduct(res) : null;
    } catch {
      return null;
    }
  },
};
