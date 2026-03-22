import { apiClient, ApiError } from './api-client';

/** Distribución: posición (fila/col) de un producto en un planograma. PWA solo lectura. */
export interface DistributionForUI {
  id: string;
  planogramId: string;
  productId: string;
  xPosition: number; // fila (row) 0-9
  yPosition: number; // columna (col) 0-9
}

function getPositionFromRaw(raw: any): { x: number; y: number } {
  const pos = raw?.position ?? raw?.Position;
  const xFromPos = pos?.x ?? pos?.X ?? pos?.row ?? pos?.Row;
  const yFromPos = pos?.y ?? pos?.Y ?? pos?.column ?? pos?.Column ?? pos?.col ?? pos?.Col;
  const apiX = raw?.Xposition ?? raw?.xposition ?? raw?.xPosition ?? raw?.XPosition ?? raw?.row ?? raw?.Row ?? xFromPos ?? 0;
  const apiY = raw?.Yposition ?? raw?.yposition ?? raw?.yPosition ?? raw?.YPosition ?? raw?.column ?? raw?.Column ?? raw?.col ?? raw?.Col ?? yFromPos ?? 0;
  const x = Math.max(0, Math.min(9, Math.floor(isNaN(Number(apiX)) ? 0 : Number(apiX))));
  const y = Math.max(0, Math.min(9, Math.floor(isNaN(Number(apiY)) ? 0 : Number(apiY))));
  return { x, y };
}

function toDistribution(raw: any): DistributionForUI {
  const item = raw?.distribution ?? raw?.Distribution ?? raw;
  const { x: xPosition, y: yPosition } = getPositionFromRaw(item ?? raw);
  return {
    id: String(item?.id ?? item?.Id ?? raw?.id ?? raw?.Id ?? ''),
    planogramId: String(item?.planogramId ?? item?.PlanogramId ?? raw?.planogramId ?? raw?.PlanogramId ?? ''),
    productId: String(item?.productId ?? item?.ProductId ?? raw?.productId ?? raw?.ProductId ?? ''),
    xPosition,
    yPosition,
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

export const distributionsApi = {
  /** Lista distribuciones de un planograma. GET /distributions/distributions/planogram/{id} */
  async getByPlanogram(planogramId: string): Promise<DistributionForUI[]> {
    try {
      const res = await apiClient.get<any>(`/distributions/distributions/planogram/${encodeURIComponent(planogramId)}`);
      const items = normalizeDistributionList(res);
      return items.map((item: any) => toDistribution(item));
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
          return allItems.filter(
            (d) => String(d.planogramId).trim() === String(planogramId).trim()
          );
        } catch (fallbackError) {
          const fbErr = fallbackError as ApiError;
          console.error(
            '[distributions-api] Fallback list/filter failed:',
            fbErr.message || fbErr
          );
        }
      }
      console.error('[distributions-api] GET by planogram failed:', message);
      throw err;
    }
  },
};
