import { offlineDb } from './offline-db';

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  if (typeof window === 'undefined') return;
  await offlineDb.appCache.put({ key, value, updatedAt: Date.now() });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  const row = await offlineDb.appCache.get(key);
  return (row?.value as T | undefined) ?? null;
}

