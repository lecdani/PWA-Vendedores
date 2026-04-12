import { apiClient } from './api-client';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';
import type { ApiError } from './api-client';

export interface CategoryForUI {
  id: string;
  name: string;
  /** Nombre corto (UI). */
  shortName?: string;
  code?: string;
  sku?: string;
  volume?: number;
  unit?: string;
  /** Marca de la familia (para filtrar resúmenes de planograma). */
  brandId?: string;
}

function toCategory(raw: any): CategoryForUI {
  const id = String(raw?.id ?? raw?.Id ?? raw?.name ?? raw?.Name ?? '').trim() || `temp-${Math.random().toString(36).slice(2, 10)}`;
  const name = String(raw?.name ?? raw?.Name ?? '').trim() || 'Familia';
  const shortNameRaw = String(raw?.shortName ?? raw?.ShortName ?? '').trim();
  const shortName = shortNameRaw || undefined;
  const code = String(raw?.familyCode ?? raw?.FamilyCode ?? raw?.code ?? raw?.Code ?? '').trim() || undefined;
  const sku = String(raw?.sku ?? raw?.Sku ?? '').trim() || undefined;
  const volumeRaw = Number(raw?.volume ?? raw?.Volume ?? 0);
  const volume = Number.isFinite(volumeRaw) && volumeRaw > 0 ? volumeRaw : undefined;
  const unit = String(raw?.unit ?? raw?.Unit ?? '').trim() || undefined;
  const brandRaw = raw?.brandId ?? raw?.BrandId;
  const brandId =
    brandRaw != null && String(brandRaw).trim() !== '' ? String(brandRaw).trim() : undefined;
  return { id, name, shortName, code, sku, volume, unit, brandId };
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

/** Lista todas las familias registradas. GET /families/families */
export const categoriesApi = {
  async fetchAll(): Promise<CategoryForUI[]> {
    try {
      const res = await apiClient.get<any>('/families/families');
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      const mapped = (list as any[]).map(toCategory);
      await cacheSet('families.all', mapped);
      return mapped;
    } catch (err) {
      if (!isExpectedOfflineError(err)) {
        console.warn('[categories-api] fetchAll failed:', err);
      }
      const cached = await cacheGet<CategoryForUI[]>('families.all');
      return cached ?? [];
    }
  },
};
