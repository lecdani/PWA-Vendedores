import { apiClient } from '@/shared/api/api-client';

export interface BrandForUI {
  id: string;
  name: string;
}

function toBrand(raw: any): BrandForUI {
  const id = String(raw?.id ?? raw?.Id ?? '').trim();
  return {
    id: id || `temp-${Math.random().toString(36).slice(2, 10)}`,
    name: String(raw?.name ?? raw?.Name ?? '').trim() || '—',
  };
}

export const brandsApi = {
  async fetchAll(): Promise<BrandForUI[]> {
    try {
      const res = await apiClient.get<any>('/brands/brands');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      return (list as any[]).map(toBrand);
    } catch {
      return [];
    }
  },
};
