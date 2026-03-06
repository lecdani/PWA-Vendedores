import { apiClient, ApiError } from './api-client';

const cityCache = new Map<string, Promise<string>>();

function looksLikeCityId(value: string): boolean {
  if (!value || !value.trim()) return false;
  const v = value.trim();
  return /^[0-9a-f-]{36}$/i.test(v) || /^\d+$/.test(v);
}

/**
 * Obtiene el nombre de una ciudad por id.
 * Si el valor no parece un id (ej. ya es un nombre), se resuelve con cache.
 */
export async function getCityNameById(cityIdOrName: string): Promise<string> {
  const key = (cityIdOrName ?? '').trim();
  if (!key) return '';
  if (!looksLikeCityId(key)) return key;

  let cached = cityCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const res = await apiClient.get<any>(`/cities/cities/${encodeURIComponent(key)}`);
        const name = res?.name ?? res?.Name ?? '';
        return typeof name === 'string' ? name.trim() : '';
      } catch (err) {
        const e = err as ApiError;
        console.warn('[cities-api] getCityNameById failed for', key, e?.message);
        return '';
      }
    })();
    cityCache.set(key, cached);
  }
  return cached;
}

export const citiesApi = {
  getCityNameById,
  looksLikeCityId,
};
