import { apiClient } from './api-client';

/** Código de ruta de ventas (mismo backend que Admin). */
export async function getSalesRouteCodeById(routeId: string): Promise<string | undefined> {
  const id = String(routeId || '').trim();
  if (!id) return undefined;
  try {
    const raw = await apiClient.get<Record<string, unknown>>(`/salesRoutes/${encodeURIComponent(id)}`);
    if (!raw || typeof raw !== 'object') return undefined;
    const code = String(
      raw.code ??
        raw.Code ??
        raw.routeCode ??
        raw.RouteCode ??
        raw.salesRouteCode ??
        raw.SalesRouteCode ??
        ''
    ).trim();
    return code || undefined;
  } catch {
    return undefined;
  }
}
