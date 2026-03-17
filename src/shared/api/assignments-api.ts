import { apiClient, ApiError } from './api-client';

export interface AssignmentForUI {
  id: string;
  salespersonId: string;
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
  const salespersonId = String(raw?.salespersonId ?? raw?.SalespersonId ?? raw?.userId ?? raw?.UserId ?? '').trim();
  const storeId = String(raw?.storeId ?? raw?.StoreId ?? '').trim();
  if (!salespersonId || !storeId) return null;
  return { id: id || `${salespersonId}::${storeId}`, salespersonId, storeId };
}

export const assignmentsApi = {
  async fetchAll(): Promise<AssignmentForUI[]> {
    try {
      const res = await apiClient.get<any>('/assignments/assignments');
      const list = normalizeList(res);
      return list.map(toAssignment).filter((a): a is AssignmentForUI => a != null);
    } catch (error) {
      const err = error as ApiError;
      console.error('[assignments-api] GET /assignments/assignments failed:', err.message || err);
      return [];
    }
  },
};

