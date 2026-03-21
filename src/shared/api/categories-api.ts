import { apiClient } from './api-client';

export interface CategoryForUI {
  id: string;
  name: string;
  code?: string;
  sku?: string;
  volume?: number;
  unit?: string;
}

function toCategory(raw: any): CategoryForUI {
  const id = String(raw?.id ?? raw?.Id ?? raw?.name ?? raw?.Name ?? '').trim() || `temp-${Math.random().toString(36).slice(2, 10)}`;
  const name = String(raw?.name ?? raw?.Name ?? '').trim() || 'Familia';
  const code = String(raw?.code ?? raw?.Code ?? '').trim() || undefined;
  const sku = String(raw?.sku ?? raw?.Sku ?? '').trim() || undefined;
  const volumeRaw = Number(raw?.volume ?? raw?.Volume ?? 0);
  const volume = Number.isFinite(volumeRaw) && volumeRaw > 0 ? volumeRaw : undefined;
  const unit = String(raw?.unit ?? raw?.Unit ?? '').trim() || undefined;
  return { id, name, code, sku, volume, unit };
}

/** Lista todas las familias registradas. GET /families/families */
export const categoriesApi = {
  async fetchAll(): Promise<CategoryForUI[]> {
    try {
      const res = await apiClient.get<any>('/families/families');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      return (list as any[]).map(toCategory);
    } catch (err) {
      console.warn('[categories-api] fetchAll failed:', err);
      return [];
    }
  },
};
