import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

export interface AssignmentForUI {
  id: string;
  /** Legacy: asignación directa al vendedor. */
  salespersonId?: string;
  /** Modelo ER: asignación ruta + tienda. */
  salesRouteId?: string;
  storeId: string;
}

function normalizeList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res?.data && Array.isArray(res.data)) return res.data;
  if (res?.items && Array.isArray(res.items)) return res.items;
  if (res?.value && Array.isArray(res.value)) return res.value;
  if (res?.Results && Array.isArray(res.Results)) return res.Results;
  if (res && typeof res === 'object') {
    for (const v of Object.values(res)) {
      if (Array.isArray(v)) return v as any[];
    }
  }
  return [];
}

function toAssignment(raw: any): AssignmentForUI | null {
  const id = String(raw?.id ?? raw?.Id ?? raw?.assignmentId ?? raw?.AssignmentId ?? '').trim();
  const salespersonId = String(
    raw?.salespersonId ?? raw?.SalespersonId ?? raw?.userId ?? raw?.UserId ?? ''
  ).trim();
  const salesRouteId = String(
    raw?.routeId ??
      raw?.RouteId ??
      raw?.route_id ??
      raw?.Route_Id ??
      raw?.salesRouteId ??
      raw?.SalesRouteId ??
      raw?.sales_route_id ??
      raw?.Sales_Route_Id ??
      ''
  ).trim();
  const storeId = String(raw?.storeId ?? raw?.StoreId ?? '').trim();
  if (!storeId || (!salespersonId && !salesRouteId)) return null;
  const syntheticId =
    id || (salesRouteId ? `${salesRouteId}::${storeId}` : salespersonId ? `${salespersonId}::${storeId}` : storeId);
  return {
    id: syntheticId,
    salespersonId: salespersonId || undefined,
    salesRouteId: salesRouteId || undefined,
    storeId,
  };
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

export const assignmentsApi = {
  async fetchAll(): Promise<AssignmentForUI[]> {
    try {
      const res = await apiClient.get<any>('/assignments/assignments');
      const list = normalizeList(res);
      const mapped = list.map(toAssignment).filter((a): a is AssignmentForUI => a != null);
      await cacheSet('assignments.all', mapped);
      return mapped;
    } catch (error) {
      const err = error as ApiError;
      if (!isExpectedOfflineError(error)) {
        console.warn('[assignments-api] GET /assignments/assignments failed:', err.message || err);
      }
      const cached = await cacheGet<AssignmentForUI[]>('assignments.all');
      return cached ?? [];
    }
  },
};

