import { apiClient, ApiError, getBackendAssetUrl } from './api-client';

/** Producto para la PWA (solo lectura desde API) */
export interface ProductForUI {
  id: string;
  /** Código del producto (prioridad para mostrar en UI). */
  code: string;
  sku: string;
  name: string;
  category: string;
  familyId?: string;
  categoryId?: string;
  currentPrice: number;
  isActive: boolean;
  image?: string;
  imageFileName?: string;
}

function toProduct(raw: any): ProductForUI {
  const imageVal = raw?.image ?? raw?.Image ?? raw?.imageUrl ?? raw?.ImageUrl ?? raw?.imagePath ?? raw?.ImagePath;
  const imageFileNameVal = raw?.imageFileName ?? raw?.ImageFileName;
  const codeVal = String(raw?.code ?? raw?.Code ?? '').trim();
  const skuVal = String(raw?.sku ?? raw?.Sku ?? '').trim();
  return {
    id: String(raw?.id ?? raw?.Id ?? ''),
    code: codeVal || skuVal,
    sku: skuVal || codeVal,
    name: String(raw?.name ?? raw?.Name ?? ''),
    // Nombre de categoría o familia (el backend puede enviar nombre y/o id)
    category: String(
      raw?.category ??
        raw?.Category ??
        raw?.categoryName ??
        raw?.CategoryName ??
        raw?.family ??
        raw?.Family ??
        raw?.familyName ??
        raw?.FamilyName ??
        ''
    ).trim(),
    familyId: raw?.familyId ?? raw?.FamilyId ?? raw?.categoryId ?? raw?.CategoryId ?? undefined,
    categoryId: raw?.categoryId ?? raw?.CategoryId ?? raw?.familyId ?? raw?.FamilyId ?? undefined,
    currentPrice: Number(raw?.currentPrice ?? raw?.CurrentPrice ?? raw?.price ?? raw?.Price ?? 0),
    isActive: typeof raw?.isActive === 'boolean' ? raw.isActive : (raw?.IsActive ?? true),
    image: imageVal != null && imageVal !== '' ? String(imageVal) : undefined,
    imageFileName: imageFileNameVal != null && imageFileNameVal !== '' ? String(imageFileNameVal) : undefined,
  };
}

// Cache en memoria para productos individuales (por id)
const productCache = new Map<string, Promise<ProductForUI | null>>();

/** URL para mostrar la imagen del producto (S3 vía backend). */
export function getProductImageUrl(p: { image?: string; imageFileName?: string } | null): string {
  if (!p) return '';
  const img = p.image?.trim();
  if (img) {
    // Si ya es ruta (contiene /) o URL, usarla; si es solo nombre de archivo, prefijar images/url/
    const path = img.includes('/') || img.startsWith('http') ? img : 'images/url/' + img;
    return getBackendAssetUrl(path);
  }
  if (p.imageFileName) return getBackendAssetUrl('images/url/' + p.imageFileName);
  return '';
}

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
