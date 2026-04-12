import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

/** Distribución: posición (fila/col) de un producto en un planograma. PWA solo lectura. */
export interface DistributionForUI {
  id: string;
  planogramId: string;
  productId: string;
  xPosition: number; // fila (row) 0-9
  yPosition: number; // columna (col) 0-9
  /** Si el backend marca false, no debe pintarse en la grilla (igual que en Admin). */
  isActive?: boolean;
}

function getPositionFromRaw(raw: any): { x: number; y: number } {
  const pos = raw?.position ?? raw?.Position;
  const xFromPos = pos?.x ?? pos?.X ?? pos?.row ?? pos?.Row;
  const yFromPos = pos?.y ?? pos?.Y ?? pos?.column ?? pos?.Column ?? pos?.col ?? pos?.Col;
  // Mismas claves que Admin: algunos backends envían solo x/y o snake_case.
  const apiX =
    raw?.Xposition ??
    raw?.xposition ??
    raw?.xPosition ??
    raw?.XPosition ??
    raw?.x_position ??
    raw?.X_POSITION ??
    raw?.x ??
    raw?.row ??
    raw?.Row ??
    xFromPos ??
    0;
  const apiY =
    raw?.Yposition ??
    raw?.yposition ??
    raw?.yPosition ??
    raw?.YPosition ??
    raw?.y_position ??
    raw?.Y_POSITION ??
    raw?.y ??
    raw?.column ??
    raw?.Column ??
    raw?.col ??
    raw?.Col ??
    yFromPos ??
    0;
  const x = Math.max(0, Math.min(9, Math.floor(isNaN(Number(apiX)) ? 0 : Number(apiX))));
  const y = Math.max(0, Math.min(9, Math.floor(isNaN(Number(apiY)) ? 0 : Number(apiY))));
  return { x, y };
}

function resolveProductIdFromRaw(item: any, raw: any): string {
  const nested = item?.product ?? item?.Product ?? raw?.product ?? raw?.Product;
  const fromNested =
    nested != null
      ? String(
          nested.id ??
            nested.Id ??
            nested.productId ??
            nested.ProductId ??
            nested.product_id ??
            ''
        ).trim()
      : '';
  const flat = String(
    item?.productId ??
      item?.ProductId ??
      item?.product_id ??
      item?.PRODUCT_ID ??
      raw?.productId ??
      raw?.ProductId ??
      raw?.product_id ??
      raw?.PRODUCT_ID ??
      ''
  ).trim();
  return flat || fromNested;
}

function toDistribution(raw: any): DistributionForUI {
  const item = raw?.distribution ?? raw?.Distribution ?? raw;
  const base = item ?? raw;
  const { x: xPosition, y: yPosition } = getPositionFromRaw(base);
  const isActiveRaw = base?.isActive ?? base?.IsActive ?? base?.active ?? base?.Active;
  const isActive = typeof isActiveRaw === 'boolean' ? isActiveRaw : true;
  return {
    id: String(item?.id ?? item?.Id ?? raw?.id ?? raw?.Id ?? ''),
    planogramId: String(
      item?.planogramId ??
        item?.PlanogramId ??
        item?.planogram_id ??
        raw?.planogramId ??
        raw?.PlanogramId ??
        ''
    ),
    productId: resolveProductIdFromRaw(item, raw),
    xPosition,
    yPosition,
    isActive,
  };
}

function normalizeDistributionList(res: any): any[] {
  const list = Array.isArray(res)
    ? res
    : res?.data ??
      res?.Data ??
      res?.items ??
      res?.Items ??
      res?.value ??
      res?.Value ??
      res?.distributions ??
      res?.Distributions ??
      [];
  return Array.isArray(list) ? list : [];
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

export const distributionsApi = {
  /** Lista distribuciones de un planograma. GET /distributions/distributions/planogram/{id} */
  async getByPlanogram(planogramId: string): Promise<DistributionForUI[]> {
    const key = `distributions.planogram.${String(planogramId).trim()}`;
    try {
      const res = await apiClient.get<any>(`/distributions/distributions/planogram/${encodeURIComponent(planogramId)}`);
      const items = normalizeDistributionList(res);
      const mapped = items
        .map((item: any) => toDistribution(item))
        .filter((d) => d.isActive !== false && String(d.productId).trim());
      await cacheSet(key, mapped);
      return mapped;
    } catch (error) {
      const err = error as ApiError;
      const message = String(err?.message || err || '');
      // Fallback real para backend con error EF ("ProductId1"):
      // listamos todas las distribuciones y filtramos por planograma en frontend.
      if (message.includes('ProductId1') || message.includes('42703')) {
        try {
          const allRes = await apiClient.get<any>('/distributions/distributions');
          const allItems = normalizeDistributionList(allRes).map((item: any) =>
            toDistribution(item)
          );
          const filtered = allItems.filter(
            (d) =>
              String(d.planogramId).trim() === String(planogramId).trim() &&
              d.isActive !== false &&
              String(d.productId).trim()
          );
          await cacheSet(key, filtered);
          return filtered;
        } catch (fallbackError) {
          const fbErr = fallbackError as ApiError;
          if (!isExpectedOfflineError(fallbackError)) {
            console.warn(
              '[distributions-api] Fallback list/filter failed:',
              fbErr.message || fbErr
            );
          }
        }
      }
      if (!isExpectedOfflineError(error)) {
        console.warn('[distributions-api] GET by planogram failed:', message);
      }
      const cached = await cacheGet<DistributionForUI[]>(key);
      return cached ?? [];
    }
  },
};
