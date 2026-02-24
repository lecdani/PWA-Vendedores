import { apiClient, ApiError } from './api-client';

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

export const planogramsApi = {
  /** Lista todos los planogramas. GET /planograms/planograms */
  async fetchAll(): Promise<PlanogramForUI[]> {
    try {
      const res = await apiClient.get<any>('/planograms/planograms');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      return (list as any[]).map(toPlanogram);
    } catch (error) {
      const err = error as ApiError;
      console.error('[planograms-api] GET /planograms/planograms failed:', err.message || err);
      return [];
    }
  },

  /** Obtiene el planograma activo (el que usa la PWA para armar el pedido). */
  async getActive(): Promise<PlanogramForUI | null> {
    const all = await this.fetchAll();
    return all.find((p) => p.isActive) ?? null;
  },

  /** Obtiene un planograma por id. GET /planograms/planograms/{id} */
  async getById(id: string): Promise<PlanogramForUI | null> {
    try {
      const res = await apiClient.get<any>(`/planograms/planograms/${encodeURIComponent(id)}`);
      return res ? toPlanogram(res) : null;
    } catch {
      return null;
    }
  },
};
