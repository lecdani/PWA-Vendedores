import { apiClient, ApiError, getBackendAssetUrl } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

/** Producto para la PWA (solo lectura desde API) */
export interface ProductForUI {
  id: string;
  /** Código del producto (prioridad para mostrar en UI). */
  code: string;
  sku: string;
  name: string;
  shortName?: string;
  category: string;
  familyId?: string;
  categoryId?: string;
  /** FK presentación (resumen planograma por presentación). */
  presentationId?: string;
  /** family_code de la familia embebida en la presentación. */
  familyCode?: string;
  /** Código genérico de la presentación (genericCode en API). */
  presentationGenericCode?: string;
  /** SKU comercial del producto (campo sku en API, sin rellenar con code). */
  commerceSku?: string;
  /** Código interno del producto (code en API). */
  internalCode?: string;
  /** Nombre de la presentación (API). */
  presentationName?: string;
  presentationVolume?: number;
  presentationUnit?: string;
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
  const pres = raw?.presentation ?? raw?.Presentation;
  const famRaw = pres?.family ?? pres?.Family;
  const presentationIdRaw =
    pres?.id ??
    pres?.Id ??
    raw?.presentationId ??
    raw?.PresentationId ??
    undefined;
  const presentationId =
    presentationIdRaw != null && String(presentationIdRaw).trim() !== ''
      ? String(presentationIdRaw).trim()
      : undefined;
  const volRaw = pres?.volume ?? pres?.Volume;
  const volN = volRaw != null && volRaw !== '' ? Number(volRaw) : NaN;
  const presentationVolume = Number.isFinite(volN) ? volN : undefined;
  const presentationUnit =
    String(pres?.unit ?? pres?.Unit ?? '').trim() || undefined;
  const presentationName =
    pres != null
      ? String(
          pres.name ??
            pres.Name ??
            pres.genericLabel ??
            pres.GenericLabel ??
            ''
        ).trim() || undefined
      : undefined;
  const familyCodeFromPres =
    famRaw != null
      ? String(
          famRaw.familyCode ??
            famRaw.FamilyCode ??
            famRaw.code ??
            famRaw.Code ??
            ''
        ).trim() || undefined
      : undefined;
  const familyIdFromPresentation =
    famRaw != null
      ? String(famRaw.id ?? famRaw.Id ?? famRaw.familyId ?? famRaw.FamilyId ?? '').trim() || undefined
      : undefined;
  const familyOrCategoryRaw =
    raw?.familyId ??
    raw?.FamilyId ??
    raw?.categoryId ??
    raw?.CategoryId ??
    familyIdFromPresentation ??
    undefined;
  const familyOrCategoryId =
    familyOrCategoryRaw != null && String(familyOrCategoryRaw).trim() !== ''
      ? String(familyOrCategoryRaw).trim()
      : undefined;
  const familyNameFromPres =
    famRaw != null ? String(famRaw.name ?? famRaw.Name ?? '').trim() : '';
  const presentationGenericCode =
    pres != null
      ? String(
          pres.genericCode ??
            pres.GenericCode ??
            pres.code ??
            pres.Code ??
            ''
        ).trim() || undefined
      : undefined;
  const presentationSku =
    pres != null ? String(pres.sku ?? pres.Sku ?? '').trim() : '';
  /** SKU comercial: producto primero; si no, el de la presentación (no mezclar con `code` interno). */
  const commerceSkuVal = skuVal || presentationSku || undefined;
  return {
    id: String(raw?.id ?? raw?.Id ?? ''),
    code: codeVal || skuVal,
    sku: skuVal || codeVal,
    commerceSku: commerceSkuVal,
    internalCode: codeVal || undefined,
    name: String(raw?.name ?? raw?.Name ?? ''),
    shortName: String(raw?.shortName ?? raw?.ShortName ?? raw?.short_name ?? '').trim() || undefined,
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
        familyNameFromPres ??
        ''
    ).trim(),
    familyId: familyOrCategoryId,
    categoryId: familyOrCategoryId,
    presentationId,
    familyCode: familyCodeFromPres,
    presentationName,
    presentationGenericCode,
    presentationVolume,
    presentationUnit,
    currentPrice: Number(raw?.currentPrice ?? raw?.CurrentPrice ?? raw?.price ?? raw?.Price ?? 0),
    isActive: typeof raw?.isActive === 'boolean' ? raw.isActive : (raw?.IsActive ?? true),
    image: imageVal != null && imageVal !== '' ? String(imageVal) : undefined,
    imageFileName: imageFileNameVal != null && imageFileNameVal !== '' ? String(imageFileNameVal) : undefined,
  };
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

// Cache en memoria para productos individuales (por id)
const productCache = new Map<string, Promise<ProductForUI | null>>();

/** URL para mostrar la imagen del producto (S3 vía backend). */
/** Nombre corto para grillas y listados (prioridad shortName). */
export function getProductShortDisplayName(p: ProductForUI | null | undefined): string {
  if (!p) return '';
  const short = String(p.shortName ?? '').trim();
  if (short) return short;
  return String(p.name ?? '').trim() || '—';
}

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
      await cacheSet('products.all', products);
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
      if (!isExpectedOfflineError(error)) {
        console.warn('[products-api] GET /products/products failed:', err.message || err);
      }
      const cached = await cacheGet<ProductForUI[]>('products.all');
      const products = cached ?? [];
      products.forEach((p) => {
        const key = String(p.id).trim();
        if (key && !productCache.has(key)) {
          productCache.set(key, Promise.resolve(p));
        }
      });
      return products;
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
