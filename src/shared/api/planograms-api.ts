import { apiClient, ApiError } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

/** Planograma para la PWA (solo lectura) */
export interface PlanogramForUI {
  id: string;
  name: string;
  description?: string;
  version: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toPlanogram(raw: any): PlanogramForUI {
  const id = String(raw?.id ?? raw?.planogramId ?? raw?.Id ?? '');
  const createdAt = raw?.createdAt ? new Date(raw.createdAt) : raw?.CreatedAt ? new Date(raw.CreatedAt) : new Date();
  const updatedAt = raw?.updatedAt ? new Date(raw.updatedAt) : raw?.UpdatedAt ? new Date(raw.UpdatedAt) : createdAt;
  return {
    id,
    name: String(raw?.name ?? raw?.Name ?? raw?.id ?? 'Planograma').trim() || `Planograma ${id}`,
    description: raw?.description ?? raw?.Description,
    version: typeof raw?.version === 'number' ? raw.version : (raw?.Version ?? 1),
    isActive: typeof raw?.isActive === 'boolean' ? raw.isActive : (raw?.IsActive ?? true),
    createdAt,
    updatedAt,
  };
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

function hasRecentOfflineHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem('app_offline_hint');
    if (!raw) return false;
    const ts = Number(raw);
    if (Number.isFinite(ts) && ts > 0) return Date.now() - ts < 10_000;
    return raw === '1';
  } catch {
    return false;
  }
}

export const planogramsApi = {
  /** Lista todos los planogramas. GET /planograms/planograms */
  async fetchAll(): Promise<PlanogramForUI[]> {
    try {
      const res = await apiClient.get<any>('/planograms/planograms');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      const mapped = (list as any[]).map(toPlanogram);
      await cacheSet('planograms.all', mapped);
      return mapped;
    } catch (error) {
      const err = error as ApiError;
      if (!isExpectedOfflineError(error)) {
        console.warn('[planograms-api] GET /planograms/planograms failed:', err.message || err);
      }
      const cached = await cacheGet<PlanogramForUI[]>('planograms.all');
      return cached ?? [];
    }
  },

  /** Obtiene el planograma activo (el que usa la PWA para armar el pedido). */
  async getActive(): Promise<PlanogramForUI | null> {
    if ((typeof navigator !== 'undefined' && !navigator.onLine) || hasRecentOfflineHint()) {
      const cached = await cacheGet<PlanogramForUI[]>('planograms.all');
      const active = (cached ?? []).find((p) => p.isActive);
      if (active) return active;
    }
    const all = await this.fetchAll();
    return all.find((p) => p.isActive) ?? null;
  },

  /** Obtiene un planograma por id. GET /planograms/planograms/{id} */
  async getById(id: string): Promise<PlanogramForUI | null> {
    if ((typeof navigator !== 'undefined' && !navigator.onLine) || hasRecentOfflineHint()) {
      const cached = await cacheGet<PlanogramForUI[]>('planograms.all');
      const found = (cached ?? []).find((p) => String(p.id) === String(id));
      if (found) return found;
      return null;
    }
    try {
      const res = await apiClient.get<any>(`/planograms/planograms/${encodeURIComponent(id)}`);
      const mapped = res ? toPlanogram(res) : null;
      if (mapped) {
        const cached = (await cacheGet<PlanogramForUI[]>('planograms.all')) ?? [];
        const withoutCurrent = cached.filter((p) => String(p.id) !== String(mapped.id));
        await cacheSet('planograms.all', [...withoutCurrent, mapped]);
      }
      return mapped;
    } catch (error) {
      if (!isExpectedOfflineError(error)) {
        const err = error as ApiError;
        console.warn(`[planograms-api] GET /planograms/planograms/${id} failed:`, err.message || err);
      }
      const cached = await cacheGet<PlanogramForUI[]>('planograms.all');
      return (cached ?? []).find((p) => String(p.id) === String(id)) ?? null;
    }
  },
};
