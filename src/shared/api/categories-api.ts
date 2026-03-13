import { apiClient } from './api-client';

export interface CategoryForUI {
  id: string;
  name: string;
}

function toCategory(raw: any): CategoryForUI {
  const id = String(raw?.id ?? raw?.Id ?? raw?.name ?? raw?.Name ?? '').trim() || `temp-${Math.random().toString(36).slice(2, 10)}`;
  const name = String(raw?.name ?? raw?.Name ?? '').trim() || 'Categoría';
  return { id, name };
}

/** Lista todas las categorías registradas. GET /categories/categories */
export const categoriesApi = {
  async fetchAll(): Promise<CategoryForUI[]> {
    try {
      const res = await apiClient.get<any>('/categories/categories');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      return (list as any[]).map(toCategory);
    } catch (err) {
      console.warn('[categories-api] fetchAll failed:', err);
      return [];
    }
  },
};
