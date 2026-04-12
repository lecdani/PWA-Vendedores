import { apiClient, ApiError, API_BASE_URL } from './api-client';
import { histpricesApi } from './histprices-api';
import { productsApi } from './products-api';
import { cacheGet, cacheSet } from '@/shared/offline/offline-cache';

async function getOfflineDbIfBrowser() {
  if (typeof window === 'undefined') return null;
  const mod = await import('@/shared/offline/offline-db');
  return mod.offlineDb;
}

function isExpectedOfflineError(error: unknown): boolean {
  const err = error as ApiError;
  const message = String(err?.message ?? error ?? '').toLowerCase();
  return Number((err as any)?.status ?? 0) === 0 || message.includes('error de conexión') || message.includes('network');
}

function userOrdersCacheKey(userId: string): string {
  return `orders.byUser.${String(userId).trim()}`;
}

function orderByIdCacheKey(orderId: string): string {
  return `orders.byId.${String(orderId).trim()}`;
}

/** Importes desde API: number, "12.34", "12,34", espacios. */
function parseMoney(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, '').replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseQtyValue(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  const s = String(v).trim().replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Ids recién creados en API que aún no salen en GET listado: no purgar de caché hasta que el servidor los liste. */
const ORDERS_PENDING_LIST_SYNC_KEY = 'orders.meta.pendingListSync';

async function addPendingListSyncOrderId(orderId: string): Promise<void> {
  const id = String(orderId).trim();
  if (!id || typeof window === 'undefined') return;
  const cur = (await cacheGet<string[]>(ORDERS_PENDING_LIST_SYNC_KEY)) ?? [];
  if (cur.some((x) => String(x).trim() === id)) return;
  await cacheSet(ORDERS_PENDING_LIST_SYNC_KEY, [...cur, id]);
}

async function removePendingListSyncOrderId(orderId: string): Promise<void> {
  const id = String(orderId).trim();
  if (!id || typeof window === 'undefined') return;
  const cur = (await cacheGet<string[]>(ORDERS_PENDING_LIST_SYNC_KEY)) ?? [];
  const next = cur.filter((x) => String(x).trim() !== id);
  if (next.length !== cur.length) await cacheSet(ORDERS_PENDING_LIST_SYNC_KEY, next);
}

/** Cuando el listado del servidor ya incluye el id, deja de tratarlo como “pendiente de listado”. */
async function clearPendingIdsConfirmedOnServer(serverIds: string[]): Promise<void> {
  if (typeof window === 'undefined') return;
  const set = new Set(serverIds.map((x) => String(x).trim()).filter(Boolean));
  const cur = (await cacheGet<string[]>(ORDERS_PENDING_LIST_SYNC_KEY)) ?? [];
  const next = cur.filter((p) => !set.has(String(p).trim()));
  if (next.length !== cur.length) await cacheSet(ORDERS_PENDING_LIST_SYNC_KEY, next);
}

function salespersonIdMatchesCacheUser(orderSp: string, userId: string): boolean {
  const sp = String(orderSp ?? '').trim();
  const uid = String(userId ?? '').trim();
  if (!sp || !uid) return false;
  if (sp === uid) return true;
  if (sp.toLowerCase() === uid.toLowerCase()) return true;
  if (/^\d+$/.test(sp) && /^\d+$/.test(uid) && Number(sp) === Number(uid)) return true;
  return false;
}

/** Pedidos en orders.byId.* que pertenecen al vendedor (historial offline si falta fila en orders.byUser). */
async function listCachedOrdersFromByIdForSalesperson(userId: string): Promise<OrderForUI[]> {
  const db = await getOfflineDbIfBrowser();
  const uid = String(userId).trim();
  if (!db || !uid) return [];
  const rows = await db.appCache.where('key').startsWith('orders.byId.').toArray();
  const seen = new Set<string>();
  const out: OrderForUI[] = [];
  for (const row of rows) {
    const v = row.value as OrderForUI | undefined;
    if (!v || typeof v !== 'object') continue;
    const oid = String(v.id ?? '').trim();
    if (!oid || isTempLocalOrderId(oid)) continue;
    const sp = String(v.salespersonId ?? '').trim();
    if (!salespersonIdMatchesCacheUser(sp, uid)) continue;
    if (seen.has(oid)) continue;
    seen.add(oid);
    out.push(v);
  }
  return out;
}

async function cacheOrder(order: OrderForUI): Promise<void> {
  const id = String(order.id ?? '').trim();
  if (id) await cacheSet(orderByIdCacheKey(id), order);
  const backendId = String(order.backendOrderId ?? '').trim();
  if (backendId) await cacheSet(orderByIdCacheKey(backendId), order);
}

/** Igualdad de ids de pedido entre URL, caché y backend (GUID mayúsc/minús, número vs string). */
export function orderCacheIdsMatch(a: string, b: string): boolean {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.toLowerCase() === y.toLowerCase()) return true;
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx === ny) return true;
  return false;
}

/**
 * Pedido en IndexedDB (clave exacta o escaneo orders.byId.*) para detalle/editar/cancelar sin red.
 */
async function resolveOrderFromOfflineCaches(orderId: string): Promise<OrderForUI | null> {
  const wanted = String(orderId ?? '').trim();
  if (!wanted || typeof window === 'undefined') return null;
  const direct = await cacheGet<OrderForUI>(orderByIdCacheKey(wanted));
  if (direct) return direct;
  const db = await getOfflineDbIfBrowser();
  if (!db) return null;
  const rows = await db.appCache.where('key').startsWith('orders.byId.').toArray();
  for (const row of rows) {
    const v = row.value as OrderForUI | undefined;
    if (!v || typeof v !== 'object') continue;
    const oid = String(v.id ?? '').trim();
    if (!oid || isTempLocalOrderId(oid)) continue;
    const bid = String(v.backendOrderId ?? '').trim();
    if (orderCacheIdsMatch(oid, wanted) || (bid && orderCacheIdsMatch(bid, wanted))) {
      return v;
    }
  }
  return null;
}

/**
 * Id vendedor para caché offline: prioriza auth_user (misma fuente que OrderHistory con user.id)
 * para que orders.byUser.* y salespersonId no queden desalineados si el input llega vacío o distinto.
 */
function resolveCachedSalespersonId(input: CreateOrderInput): string {
  let fromAuth = '';
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('auth_user');
      if (raw) fromAuth = String(JSON.parse(raw)?.id ?? '').trim();
    } catch {
      /* ignore */
    }
  }
  const fromInput = String(input.salespersonId ?? '').trim();
  return fromAuth || fromInput;
}

/** Pedido recién creado en API → mismo shape que UI para detalle/historial sin red (cancelar / editar en cola). */
function buildOrderForUIFromCreateInput(
  input: CreateOrderInput,
  remoteOrderId: string | number,
  invoiceId?: string | number | null,
  resolvedSalespersonId?: string
): OrderForUI {
  const rid = String(remoteOrderId).trim();
  const items = (input.items || []).map((it) => ({
    productId: String(it.productId || ''),
    productName: String(it.productName || ''),
    sku: String(it.sku || ''),
    quantity: Number(it.quantity) || 0,
    toOrder: Number(it.quantity) || 0,
    price: Number(it.price) || 0,
    ...(it.orderDetailId ? { orderDetailId: it.orderDetailId } : {}),
  }));
  const subtotal = Number(input.subtotal) || 0;
  const tax = Number(input.tax) || 0;
  const total = Number(input.total) || subtotal + tax;
  const now = new Date().toISOString();
  const inv =
    invoiceId != null && String(invoiceId).trim() !== '' ? String(invoiceId).trim() : undefined;
  const sp = String(resolvedSalespersonId ?? input.salespersonId ?? '').trim() || undefined;
  return {
    id: rid,
    backendOrderId: rid,
    storeId: String(input.storeId || ''),
    storeName: String(input.storeName || input.storeId || '—'),
    storeAddress: input.storeAddress || '',
    date: now,
    status: 'initial',
    items,
    totalUnits: items.reduce((s, i) => s + (i.quantity ?? i.toOrder ?? 0), 0),
    subtotal,
    tax,
    total,
    podRequired: true,
    podUploaded: false,
    salespersonId: sp,
    po: input.po,
    planogramId: input.planogramId,
    orderOrigin: input.planogramId ? 'planogram' : 'catalog',
    ...(inv ? { invoiceId: inv } : {}),
  };
}

async function persistCreatedOrderToOfflineCaches(
  input: CreateOrderInput,
  created: { orderId: string | number; invoiceId?: string | number }
): Promise<void> {
  if (typeof window === 'undefined') return;
  const oid = String(created.orderId ?? '').trim();
  if (!oid) return;
  const sp = resolveCachedSalespersonId(input);
  const order = buildOrderForUIFromCreateInput(input, oid, created.invoiceId, sp);
  await cacheOrder(order);
  await addPendingListSyncOrderId(oid);
  const uid = sp;
  if (uid) {
    const key = userOrdersCacheKey(uid);
    const existing = (await cacheGet<OrderForUI[]>(key)) ?? [];
    const next = mergeOrdersUnique([order], existing);
    await cacheSet(key, next);
  }
}

/** Tras PUT pedido online: refrescar IndexedDB para detalle/historial offline. */
async function persistUpdatedOrderToOfflineCaches(orderId: string | number, input: CreateOrderInput): Promise<void> {
  if (typeof window === 'undefined') return;
  const idStr = String(orderId).trim();
  if (!idStr || isTempLocalOrderId(idStr)) return;
  const sp = resolveCachedSalespersonId(input);
  const next = buildOrderForUIFromCreateInput(input, idStr, undefined, sp);
  const existing = await cacheGet<OrderForUI>(orderByIdCacheKey(idStr));
  const merged: OrderForUI = {
    ...(existing ?? next),
    ...next,
    id: idStr,
    backendOrderId: idStr,
    invoiceId: existing?.invoiceId ?? next.invoiceId,
    invoiceNumber: existing?.invoiceNumber,
    podImageUrl: existing?.podImageUrl,
    podFileName: existing?.podFileName,
    podUploaded: existing?.podUploaded,
    date: existing?.date ?? next.date,
    status: existing?.status ?? next.status,
    salespersonId: next.salespersonId ?? existing?.salespersonId,
    orderOrigin: next.orderOrigin ?? existing?.orderOrigin,
  };
  await cacheOrder(merged);
  const uid = sp;
  if (uid) {
    const key = userOrdersCacheKey(uid);
    const list = (await cacheGet<OrderForUI[]>(key)) ?? [];
    const rest = list.filter(
      (o) => String(o.id) !== idStr && String(o.backendOrderId ?? '') !== idStr
    );
    await cacheSet(key, mergeOrdersUnique([merged], rest));
  }
}

async function markCancelledInBrowserCaches(orderId: string): Promise<void> {
  const id = String(orderId || '').trim();
  if (!id || typeof window === 'undefined') return;
  const db = await getOfflineDbIfBrowser();
  if (!db) return;

  const byIdKey = orderByIdCacheKey(id);
  const row = await db.appCache.get(byIdKey);
  if (row?.value) {
    await db.appCache.put({
      ...row,
      value: { ...(row.value as any), status: 'cancelled' },
      updatedAt: Date.now(),
    });
  }

  const userRows = await db.appCache.where('key').startsWith('orders.byUser.').toArray();
  for (const userRow of userRows) {
    const list = Array.isArray(userRow.value) ? (userRow.value as any[]) : [];
    let changed = false;
    const next = list.map((o) => {
      const oid = String(o?.id ?? '').trim();
      const bid = String(o?.backendOrderId ?? '').trim();
      if (oid === id || bid === id) {
        changed = true;
        return { ...o, status: 'cancelled' };
      }
      return o;
    });
    if (changed) {
      await db.appCache.put({ ...userRow, value: next, updatedAt: Date.now() });
    }
  }
}

async function applyCancellationOverridesFromCache(orders: OrderForUI[]): Promise<OrderForUI[]> {
  if (typeof window === 'undefined' || orders.length === 0) return orders;
  const out = [...orders];
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    const ids = [String(o.id ?? '').trim(), String(o.backendOrderId ?? '').trim()].filter(Boolean);
    let isCancelled = false;
    for (const id of ids) {
      const cached = await cacheGet<OrderForUI>(orderByIdCacheKey(id));
      if (String(cached?.status ?? '').toLowerCase() === 'cancelled') {
        isCancelled = true;
        break;
      }
    }
    if (isCancelled) out[i] = { ...o, status: 'cancelled' };
  }
  return out;
}

function mergeOrdersUnique(primary: OrderForUI[], secondary: OrderForUI[]): OrderForUI[] {
  const out = [...primary];
  const seen = new Set(
    out.flatMap((o) => [String(o.id || '').trim(), String(o.backendOrderId ?? '').trim()]).filter(Boolean)
  );
  for (const o of secondary) {
    const keys = [String(o.id || '').trim(), String(o.backendOrderId ?? '').trim()].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    out.push(o);
    keys.forEach((k) => seen.add(k));
  }
  return out;
}

/** true en SSR o cuando el navegador reporta conexión (no usar caché de lista como fuente de verdad). */
function browserReportsOnline(): boolean {
  return typeof window === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine);
}

/** Ids de borradores solo en IndexedDB hasta sincronizar (no existen aún en el API). */
function isTempLocalOrderId(orderId: string): boolean {
  return String(orderId ?? '').startsWith('local-order-');
}

/**
 * Si hay un POD en cola offline (POD_UPLOAD_FILE + podMedia), enriquece el pedido para que la UI muestre la imagen sin red.
 */
async function mergeOfflinePendingPodIntoOrder(
  order: OrderForUI | null,
  orderIdRequested: string
): Promise<OrderForUI | null> {
  if (!order || typeof window === 'undefined') return order;
  const db = await getOfflineDbIfBrowser();
  if (!db) return order;

  const ids = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (s) ids.add(s);
  };
  add(orderIdRequested);
  add(order.id);
  add(order.backendOrderId);

  const mapKeys = [String(orderIdRequested).trim(), String(order.id ?? '').trim(), String(order.backendOrderId ?? '').trim()].filter(
    Boolean
  );
  for (const k of mapKeys) {
    const m = await db.idMap.get(`order:${k}`);
    if (m?.value) add(m.value);
  }

  const remotes = new Set([...ids].filter((x) => x && !isTempLocalOrderId(x)));
  if (remotes.size > 0) {
    const allMap = await db.idMap.toArray();
    for (const row of allMap) {
      if (!row.key.startsWith('order:')) continue;
      if (remotes.has(String(row.value ?? '').trim())) add(row.key.slice('order:'.length));
    }
  }

  const podJobs = await db.offlineJobs.where('type').equals('POD_UPLOAD_FILE').toArray();
  const active = podJobs.filter(
    (j) => j.status === 'pending' || j.status === 'failed' || j.status === 'processing'
  );
  const match = active
    .filter((j) => {
      const oid = String((j.payload as { orderId?: string })?.orderId ?? '').trim();
      return oid && ids.has(oid);
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  if (!match) return order;
  const mediaId = String((match.payload as { mediaId?: string })?.mediaId ?? '').trim();
  if (!mediaId) return order;
  const media = await db.podMedia.get(mediaId);
  const dataUrl = media?.dataUrl?.trim();
  if (!dataUrl) return order;

  return {
    ...order,
    podUploaded: true,
    podImageUrl: dataUrl,
    podFileName: media.fileName || order.podFileName,
  };
}

/**
 * Alinea caché con el listado del servidor: quita pedidos que ya no existen (admin).
 * No elimina ids en `orders.meta.pendingListSync` (recién creados aún no listados).
 */
async function reconcileOfflineStoresAgainstRemoteIdSet(
  userId: string,
  remoteIds: Set<string>
): Promise<boolean> {
  const uid = String(userId || '').trim();
  if (!uid || typeof window === 'undefined') return false;
  const db = await getOfflineDbIfBrowser();
  if (!db) return false;
  const pendingArr = (await cacheGet<string[]>(ORDERS_PENDING_LIST_SYNC_KEY)) ?? [];
  const pending = new Set(pendingArr.map((x) => String(x).trim()).filter(Boolean));
  let changed = false;

  const drafts = await db.localOrders.where('userId').equals(uid).toArray();
  for (const row of drafts) {
    const data = row.data as OrderForUI | undefined;
    const lBackend = String(data?.backendOrderId ?? '').trim();
    const lid = String(row.id ?? '').trim();
    const map = await db.idMap.get(`order:${lid}`);
    const mapped = String(map?.value ?? '').trim();
    const eff = lBackend || mapped;
    if (!eff || isTempLocalOrderId(eff)) continue;
    if (!remoteIds.has(eff) && !pending.has(eff)) {
      await purgeOrderFromOfflineClient(eff);
      changed = true;
    }
  }

  const jobs = await db.offlineJobs.toArray();
  for (const job of jobs) {
    const jid = job.id;
    if (jid == null) continue;
    const p: any = job.payload ?? {};
    let drop = false;
    if (job.type === 'CREATE_ORDER') {
      const loc = String(p.localOrderId ?? '').trim();
      if (loc) {
        const m = await db.idMap.get(`order:${loc}`);
        const r = String(m?.value ?? '').trim();
        if (r && !isTempLocalOrderId(r) && !remoteIds.has(r) && !pending.has(r)) drop = true;
      }
    } else {
      const oid = String(p.orderId ?? '').trim();
      if (oid && !isTempLocalOrderId(oid) && !remoteIds.has(oid) && !pending.has(oid)) drop = true;
      else if (oid && isTempLocalOrderId(oid)) {
        const m = await db.idMap.get(`order:${oid}`);
        const r = String(m?.value ?? '').trim();
        if (r && !remoteIds.has(r) && !pending.has(r)) drop = true;
      }
    }
    if (drop) {
      await db.offlineJobs.delete(jid);
      changed = true;
    }
  }

  const byIdRows = await db.appCache.where('key').startsWith('orders.byId.').toArray();
  for (const row of byIdRows) {
    const idPart = row.key.replace(/^orders\.byId\./, '').trim();
    if (!idPart || isTempLocalOrderId(idPart)) continue;
    if (!remoteIds.has(idPart) && !pending.has(idPart)) {
      await db.appCache.delete(row.key);
      changed = true;
    }
  }

  const userRow = await db.appCache.get(userOrdersCacheKey(uid));
  if (userRow?.value && Array.isArray(userRow.value)) {
    const list = userRow.value as OrderForUI[];
    const next = list.filter((o) => {
      const bid = String(o?.backendOrderId ?? '').trim();
      const oid = String(o?.id ?? '').trim();
      const remote = bid || (oid && !isTempLocalOrderId(oid) ? oid : '');
      if (!remote) return true;
      return remoteIds.has(remote) || pending.has(remote);
    });
    if (next.length !== list.length) {
      await db.appCache.put({ ...userRow, value: next, updatedAt: Date.now() });
      changed = true;
    }
  }

  return changed;
}

/** Quita borrador, idMap y cachés cuando el pedido ya no está en el servidor (borrado en admin). */
async function purgeOrderFromOfflineClient(remoteOrLocalId: string): Promise<void> {
  const id = String(remoteOrLocalId || '').trim();
  if (!id || typeof window === 'undefined') return;
  await removePendingListSyncOrderId(id);
  const db = await getOfflineDbIfBrowser();
  if (!db) return;

  await db.localOrders.delete(id);
  await db.idMap.delete(`order:${id}`);
  await db.appCache.delete(orderByIdCacheKey(id));

  const allMaps = await db.idMap.toArray();
  for (const row of allMaps) {
    if (!row.key.startsWith('order:')) continue;
    if (String(row.value) !== id) continue;
    const localKey = row.key.slice('order:'.length);
    await db.idMap.delete(row.key);
    await db.localOrders.delete(localKey);
    await db.appCache.delete(orderByIdCacheKey(localKey));
  }

  const userRows = await db.appCache.where('key').startsWith('orders.byUser.').toArray();
  for (const userRow of userRows) {
    const list = Array.isArray(userRow.value) ? (userRow.value as OrderForUI[]) : [];
    const next = list.filter((o) => {
      const oid = String(o?.id ?? '').trim();
      const bid = String(o?.backendOrderId ?? '').trim();
      return oid !== id && bid !== id;
    });
    if (next.length !== list.length) {
      await db.appCache.put({ ...userRow, value: next, updatedAt: Date.now() });
    }
  }
}

/** Lista de pedidos en caché + todas las entradas orders.byId.* (evita detalle obsoleto tras borrados en BD). */
async function clearOrdersListAndByIdCache(userId: string): Promise<void> {
  const uid = String(userId || '').trim();
  if (!uid || typeof window === 'undefined') return;
  await cacheSet(userOrdersCacheKey(uid), [] as OrderForUI[]);
  const db = await getOfflineDbIfBrowser();
  if (db) {
    const byIdRows = await db.appCache.where('key').startsWith('orders.byId.').toArray();
    if (byIdRows.length) await db.appCache.bulkDelete(byIdRows.map((r) => r.key));
  }
}

// Tipos ligeros para no acoplar demasiado al backend
export interface OrderItemInput {
  orderDetailId?: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  price: number;
}

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 when randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface CreateOrderInput {
  storeId: string;
  storeName?: string;
  storeAddress?: string;
  salespersonId?: string;
  /** FK SALES_ROUTE en ORDER (según modelo ER). */
  salesRouteId?: string;
  vendorNumber?: string;
  /** Código PO (Purchase Order), requerido y único en el sistema. */
  po?: string;
  /** ID del planograma usado al crear el pedido (orders.planogram_id). Opcional para pedidos por catálogo. */
  planogramId?: string;
  items: OrderItemInput[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface CreatedOrderResult {
  orderId?: number | string;
  invoiceId?: number | string;
  /** Mensaje de error del backend (ej. PO duplicado). */
  errorMessage?: string;
}

export interface DeliveredItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

async function safePost<T>(endpoint: string, body: unknown): Promise<T | null> {
  try {
    return await apiClient.post<T>(endpoint, body);
  } catch (error) {
    const err = error as ApiError;
    console.error(`[orders-api] POST ${endpoint} failed:`, err.message || err);
    return null;
  }
}

async function safePut<T>(endpoint: string, body: unknown): Promise<T | null> {
  try {
    if (typeof body === 'string') {
      return await apiClient.putBody<T>(endpoint, body);
    }
    return await apiClient.put<T>(endpoint, body);
  } catch (error) {
    const err = error as ApiError;
    console.error('[orders-api] PUT', endpoint, 'failed:', (err as any)?.message ?? err);
    return null;
  }
}

async function safePatch<T>(endpoint: string, body: unknown): Promise<T | null> {
  try {
    return await apiClient.patch<T>(endpoint, body);
  } catch (error) {
    const err = error as ApiError;
    console.error('[orders-api] PATCH', endpoint, 'failed:', (err as any)?.message ?? err);
    return null;
  }
}

async function safeDelete<T>(endpoint: string): Promise<T | null> {
  try {
    return await apiClient.delete<T>(endpoint);
  } catch (error) {
    const err = error as ApiError;
    console.error(`[orders-api] DELETE ${endpoint} failed:`, err.message || err);
    return null;
  }
}

async function safeGet<T>(endpoint: string): Promise<T | null> {
  try {
    return await apiClient.get<T>(endpoint);
  } catch (error) {
    const err = error as ApiError;
    const st = Number(err?.status ?? 0);
    if (isExpectedOfflineError(error) || st === 404) {
      return null;
    }
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[orders-api] GET ${endpoint} failed:`, err.message || err);
    }
    return null;
  }
}

/** Extrae el primer array que encuentre en un objeto (cualquier nivel de anidación, 2 niveles). */
function extractFirstArray(obj: any, depth = 0): any[] | null {
  if (obj == null || depth > 2) return null;
  if (Array.isArray(obj)) return obj.length > 0 ? obj : null;
  if (typeof obj !== 'object') return null;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v.length > 0 ? (v as any[]) : null;
    const nested = extractFirstArray(v, depth + 1);
    if (nested && nested.length > 0) return nested;
  }
  return null;
}

/**
 * Recorre data/value/invoice/result típicos de .NET para leer cabecera, líneas y POD
 * aunque vengan anidados (evita factura “vacía” en UI y POD solo en el wrapper).
 */
function peelInvoiceLayers(obj: any, maxDepth = 8): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  let cur: any = obj;
  let d = 0;
  while (cur != null && typeof cur === 'object' && d < maxDepth) {
    if (seen.has(cur)) break;
    seen.add(cur);
    out.push(cur);
    const next =
      cur?.data ??
      cur?.Data ??
      cur?.value ??
      cur?.Value ??
      cur?.invoice ??
      cur?.Invoice ??
      cur?.result ??
      cur?.Result ??
      null;
    if (next == null || typeof next !== 'object') break;
    cur = next;
    d++;
  }
  return out;
}

function firstPositiveNumericFromLayers(layers: any[], keys: string[]): number {
  for (const L of layers) {
    if (!L || typeof L !== 'object') continue;
    for (const k of keys) {
      const n = Number((L as any)[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
}

/** Normaliza la respuesta de GET /invoice/invoices (array directo o { data/invoices/Data/Invoices: [...] }). */
function normalizeInvoiceList(list: any): any[] {
  if (list == null) return [];
  if (Array.isArray(list)) return list;
  if (list?.invoices) return Array.isArray(list.invoices) ? list.invoices : [];
  if (list?.Invoices) return Array.isArray(list.Invoices) ? list.Invoices : [];
  if (list?.data) {
    if (Array.isArray(list.data)) return list.data;
    if (list.data && typeof list.data === 'object') {
      const inner = list.data?.items ?? list.data?.Items ?? list.data?.data ?? list.data?.invoices ?? list.data?.Invoices ?? list.data;
      if (Array.isArray(inner)) return inner;
    }
  }
  if (list?.Data) return Array.isArray(list.Data) ? list.Data : [];
  if (list?.items) return Array.isArray(list.items) ? list.items : [];
  if (list?.value) return Array.isArray(list.value) ? list.value : [];
  if (list?.Results) return Array.isArray(list.Results) ? list.Results : [];
  if (list?.result) return Array.isArray(list.result) ? list.result : [];
  const extracted = extractFirstArray(list);
  if (extracted) return extracted;
  if (list && typeof list === 'object') {
    const arr: any[] = [];
    for (const v of Object.values(list)) {
      if (Array.isArray(v)) arr.push(...v);
    }
    return arr;
  }
  return [];
}

/** Unwrap invoice object from API (cada elemento puede ser { value: {...} } o { data: {...} }). */
function unwrapInvoiceItem(x: any): any {
  if (x == null) return null;
  if (x?.value && typeof x.value === 'object') return x.value;
  if (x?.data && typeof x.data === 'object') return x.data;
  return x;
}

async function getInvoiceList(): Promise<any[]> {
  const list = await safeGet<any>('/invoice/invoices');
  const arr = list != null ? normalizeInvoiceList(list) : [];
  return arr;
}

/** Devuelve el objeto "factura" interno de una respuesta GET (para total, id, etc.). */
function unwrapInvoiceResponse(res: any): any {
  if (res == null) return res;
  return res?.data ?? res?.invoice ?? res?.value ?? res?.result ?? res?.resultData ?? res?.Response ?? res;
}

/** GET factura por id. GET /invoice/invoices/{id} — devuelve la respuesta COMPLETA para poder leer Pod en cualquier nivel. */
async function getInvoiceById(invoiceId: string): Promise<any | null> {
  const id = String(invoiceId).trim();
  if (!id) return null;
  const one = await safeGet<any>(`/invoice/invoices/${encodeURIComponent(id)}`);
  return one ?? null;
}

/**
 * Lee la ruta/link del POD de la factura (igual que Sistema Web Admin: en BD se guarda la ruta, ej. imagenes/Dani.png).
 */
function getPodFromInvoice(inv: any): string {
  if (inv == null) return '';
  const podKeys = [
    'pod',
    'Pod',
    'POD',
    'podUrl',
    'PodUrl',
    'podImageUrl',
    'PodImageUrl',
    'podPath',
    'PodPath',
    'ruta',
    'Ruta',
    'imagePath',
    'ImagePath',
    'filePath',
    'FilePath',
    'fileName',
    'FileName',
    'PodFileName',
    'podFileName',
    'url',
    'Url',
    'link',
    'Link',
    'Reference',
    'reference',
  ] as const;
  const layers = peelInvoiceLayers(inv);
  const seen = new Set<any>();
  for (const root of layers) {
    if (root == null || typeof root !== 'object' || seen.has(root)) continue;
    seen.add(root);
    for (const pk of podKeys) {
      const v = (root as any)[pk];
  const str = typeof v === 'string' ? v.trim() : v != null && v !== '' ? String(v).trim() : '';
  if (str) return str;
    }
    const base64 = (root as any)?.podBase64 ?? (root as any)?.PodBase64;
  if (typeof base64 === 'string' && base64.length > 0) return `data:image/png;base64,${base64}`;
  }
  return '';
}

/** FK POD en factura: si tiene valor distinto de vacío/0, se considera vinculado. */
function getPodIdFromInvoice(inv: any): string {
  if (inv == null) return '';
  const layers = peelInvoiceLayers(inv);
  const seen = new Set<any>();
  for (const root of layers) {
    if (root == null || typeof root !== 'object' || seen.has(root)) continue;
    seen.add(root);
    const v =
      (root as any).podId ??
      (root as any).PodId ??
      (root as any).pod_id ??
      (root as any).POD_ID ??
      (root as any).podID;
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (!s || s === '0' || /^null$/i.test(s) || /^undefined$/i.test(s)) continue;
    return s;
  }
  return '';
}

/** Hay comprobante en factura: archivo/ruta en JSON o `podId` persistido. */
export function invoiceHasPodEvidence(inv: any): boolean {
  if (!inv) return false;
  if (getPodIdFromInvoice(inv)) return true;
  return !!getPodFromInvoice(inv)?.trim();
}

/** PO en payload de factura (el backend puede devolverlo solo en la factura). */
function getPoFromInvoice(raw: any): string {
  if (raw == null) return '';
  const poKeys = [
    'po',
    'Po',
    'PO',
    'purchaseOrder',
    'PurchaseOrder',
    'purchase_order',
    'Purchase_Order',
    'orderPo',
    'OrderPo',
    'pO',
  ] as const;
  const layers = peelInvoiceLayers(raw);
  const seen = new Set<any>();
  for (const root of layers) {
    if (root == null || typeof root !== 'object' || seen.has(root)) continue;
    seen.add(root);
    for (const pk of poKeys) {
      const v = (root as any)[pk];
      const str = typeof v === 'string' ? v.trim() : v != null && v !== '' ? String(v).trim() : '';
      if (str) return str;
    }
  }
  return '';
}

/** Precio unitario explícito (sin usar `price` plano: a veces es importe de línea). */
function detailUnitPriceRaw(d: any): number {
  const chain = [
    d?.unitPrice,
    d?.UnitPrice,
    d?.unit_price,
    d?.Unit_Price,
    d?.salePrice,
    d?.SalePrice,
    d?.listPrice,
    d?.ListPrice,
    d?.listUnitPrice,
    d?.ListUnitPrice,
    d?.productPrice,
    d?.ProductPrice,
    d?.unitAmount,
    d?.UnitAmount,
    d?.rate,
    d?.Rate,
    d?.product?.unitPrice,
    d?.Product?.UnitPrice,
    d?.product?.price,
    d?.Product?.Price,
    d?.product?.salePrice,
    d?.Product?.SalePrice,
  ];
  for (const c of chain) {
    const n = parseMoney(c);
    if (n > 0) return n;
  }
  return 0;
}

/** Extrae cantidad de un registro de detalle (diversos nombres del backend). */
function detailQuantity(d: any): number {
  const keys = [
    d?.quantity,
    d?.Quantity,
    d?.qty,
    d?.Qty,
    d?.invoiceQty,
    d?.InvoiceQty,
    d?.deliveredQuantity,
    d?.DeliveredQuantity,
    d?.deliveredQty,
    d?.DeliveredQty,
    d?.units,
    d?.Units,
    d?.pcs,
    d?.Pcs,
    d?.lineQuantity,
    d?.LineQuantity,
    d?.orderQuantity,
    d?.OrderQuantity,
    d?.orderedQuantity,
    d?.OrderedQuantity,
    d?.count,
    d?.Count,
    d?.toOrder,
    d?.ToOrder,
  ];
  for (const k of keys) {
    const n = parseQtyValue(k);
    if (n > 0) return n;
  }
  /** Solo subtotal + P.U. (sin cantidad explícita) */
  const sub = parseMoney(
    d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.amount ?? d?.Amount ?? d?.lineTotal ?? d?.LineTotal ?? 0
  );
  const up = detailUnitPriceRaw(d) || parseMoney(d?.price ?? d?.Price);
  if (sub > 0 && up > 0) {
    const q = sub / up;
    if (Number.isFinite(q) && q > 0) return Math.round(q * 1000) / 1000;
  }
  return 0;
}

/**
 * Importe de línea (extendido). Evita tratar `price` como total si ya hay unitPrice y cantidad.
 * `detailSubtotal` se mantiene como nombre por compatibilidad con el resto del archivo.
 */
function detailSubtotal(d: any): number {
  const lineAmountKeys = [
    'extendedPrice',
    'ExtendedPrice',
    'extendedAmount',
    'ExtendedAmount',
    'lineAmount',
    'LineAmount',
    'lineTotal',
    'LineTotal',
    'totalLineAmount',
    'TotalLineAmount',
    'grossLineAmount',
    'GrossLineAmount',
    'netLineTotal',
    'NetLineTotal',
    'amount',
    'Amount',
    'subtotal',
    'Subtotal',
    'SubTotal',
    'grossAmount',
    'GrossAmount',
    'netAmount',
    'NetAmount',
    'value',
    'Value',
    'totalPrice',
    'TotalPrice',
    'linePrice',
    'LinePrice',
  ];
  for (const k of lineAmountKeys) {
    const n = parseMoney((d as any)?.[k]);
    if (n > 0) return n;
  }
  const qty = detailQuantity(d);
  const up = detailUnitPriceRaw(d);
  if (qty > 0 && up > 0) return qty * up;
  const pOnly = parseMoney(d?.price ?? d?.Price);
  if (qty > 0 && pOnly > 0) return pOnly * qty;
  if (pOnly > 0) return pOnly;
  return 0;
}

/** Extrae productId de un registro de detalle. */
function detailProductId(d: any): string {
  return String(d?.productId ?? d?.ProductId ?? d?.product_id ?? d?.product?.id ?? d?.Product?.Id ?? '').trim();
}

/** Extrae el nombre del producto desde un registro de detalle factura (detalle primero, luego producto anidado). */
function detailProductName(d: any): string {
  const fromDetail =
    d?.productName ?? d?.ProductName ??
    d?.description ?? d?.Description ??
    d?.name ?? d?.Name ??
    d?.product?.name ?? d?.Product?.Name ??
    d?.product?.description ?? d?.Product?.Description ??
    d?.product?.productName ?? d?.Product?.ProductName ??
    '';
  return (typeof fromDetail === 'string' ? fromDetail : '').trim();
}

/** ¿Parece una línea de pedido/factura? (producto identificable; cantidades pueden venir solo en subtotal/precio). */
function isLineLikeRecord(el: any): boolean {
  if (el == null || typeof el !== 'object' || Array.isArray(el)) return false;
  const pid = detailProductId(el);
  const sku = String(el?.sku ?? el?.Sku ?? '').trim();
  return pid.length > 0 || sku.length > 0;
}

/**
 * Línea de factura en APIs raras: a veces no traen productId/sku pero sí importe o texto.
 * (El POD se lee bien en el mismo JSON porque se escanean más claves — esto alinea líneas con eso.)
 */
function isInvoiceLineCandidate(el: any): boolean {
  if (el == null || typeof el !== 'object' || Array.isArray(el)) return false;
  if (isLineLikeRecord(el)) return true;
  if (el?.product && typeof el.product === 'object') return true;
  if (el?.Product && typeof el.Product === 'object') return true;
  const nm = (
    detailProductName(el) ||
    String(el?.code ?? el?.Code ?? el?.itemCode ?? el?.ItemCode ?? el?.description ?? el?.Description ?? '').trim()
  );
  const sub = detailSubtotal(el);
  const q = detailQuantity(el);
  if (nm.length > 0 && (sub > 0 || q > 0)) return true;
  /** Línea típica de detalle de factura con id propio, aunque falte nombre/SKU */
  const lineId = String(
    el?.invoiceDetailId ??
      el?.InvoiceDetailId ??
      el?.orderDetailId ??
      el?.OrderDetailId ??
      el?.lineNumber ??
      el?.LineNumber ??
      ''
  ).trim();
  if (lineId.length > 0 && (sub > 0 || q > 0)) return true;
  /** Cantidad e importe de línea (sin confundir con un solo monto suelto) */
  if (q > 0 && sub > 0) return true;
  return false;
}

/**
 * Recorre todo el árbol del JSON de factura (como hace getPodFromInvoice con las capas) y elige el array
 * más largo que parezca líneas de factura. Cubre hermanos de `data`, nombres raros de propiedad, etc.
 */
function findBestInvoiceDetailsArray(raw: any): any[] {
  if (raw == null) return [];
  const buckets: any[][] = [];
  const seenNodes = new WeakSet<object>();
  const seenArrays = new Set<any>();

  function visit(obj: any, depth: number) {
    if (obj == null || depth > 16) return;
    if (typeof obj !== 'object') return;
    if (seenNodes.has(obj)) return;
    seenNodes.add(obj);
    if (Array.isArray(obj)) {
      for (const el of obj) visit(el, depth + 1);
      return;
    }
    for (const v of Object.values(obj)) {
      if (!Array.isArray(v) || v.length === 0 || seenArrays.has(v)) continue;
      const first = v[0];
      if (first && typeof first === 'object' && !Array.isArray(first) && isInvoiceLineCandidate(first)) {
        seenArrays.add(v);
        buckets.push(v);
      }
    }
    for (const v of Object.values(obj)) {
      if (v != null && typeof v === 'object') visit(v, depth + 1);
    }
  }

  visit(raw, 0);
  if (buckets.length === 0) return [];
  buckets.sort((a, b) => b.length - a.length);
  return buckets[0];
}

/** Busca en profundidad el array más largo de objetos tipo línea (factura/pedido anidados raros). */
function deepFindLongestLineItemArray(node: any, depth: number, maxDepth: number): any[] {
  if (node == null || depth > maxDepth) return [];
  if (Array.isArray(node)) {
    if (node.length > 0 && isInvoiceLineCandidate(node[0])) return node;
    return [];
  }
  if (typeof node !== 'object') return [];
  let best: any[] = [];
  for (const v of Object.values(node)) {
    const got = deepFindLongestLineItemArray(v, depth + 1, maxDepth);
    if (got.length > best.length) best = got;
  }
  return best;
}

const ORDER_OR_INVOICE_LINE_KEYS = [
  'invoiceDetails',
  'InvoiceDetails',
  'orderDetails',
  'OrderDetails',
  'details',
  'Details',
  'items',
  'Items',
  'invoiceItems',
  'InvoiceItems',
  'orderLines',
  'OrderLines',
  'lines',
  'Lines',
  'invoiceLines',
  'InvoiceLines',
  'orderDetailList',
  'OrderDetailList',
  'orderDetailDtos',
  'OrderDetailDtos',
  'lineItems',
  'LineItems',
  'detalles',
  'Detalles',
  'products',
  'Products',
  'rows',
  'Rows',
  'detailLines',
  'DetailLines',
] as const;

/** Líneas de pedido desde cualquier forma habitual del GET /orders/orders/{id}. */
function extractOrderDetailsFromOrderPayload(payload: any): any[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.length > 0 && isInvoiceLineCandidate(payload[0]) ? payload : [];
  }
  const layers = peelInvoiceLayers(payload);
  const seenLayers = new Set<any>();
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || seenLayers.has(layer)) continue;
    seenLayers.add(layer);
    for (const k of ORDER_OR_INVOICE_LINE_KEYS) {
      const v = (layer as any)[k];
      if (Array.isArray(v) && v.length) return v;
    }
  }
  for (const k of ORDER_OR_INVOICE_LINE_KEYS) {
    const v = (payload as any)[k];
    if (Array.isArray(v) && v.length) return v;
  }
  const extracted = extractFirstArray(payload);
  if (Array.isArray(extracted) && extracted.length > 0 && isInvoiceLineCandidate(extracted[0])) return extracted;
  const deep = deepFindLongestLineItemArray(payload, 0, 8);
  if (deep.length) return deep;
  return findBestInvoiceDetailsArray(payload);
}

/** Normaliza lista de detalles desde respuesta de API (array o objeto con data/items/details/invoiceDetails). */
function normalizeDetailList(raw: any): any[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  const detailKeys = ORDER_OR_INVOICE_LINE_KEYS;
  const layers = peelInvoiceLayers(raw);
  const seenLayers = new Set<any>();
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || seenLayers.has(layer)) continue;
    seenLayers.add(layer);
    for (const k of detailKeys) {
      const v = (layer as any)[k];
      if (Array.isArray(v) && v.length) return v;
    }
  }
  const fallbackKeys = detailKeys.map((k) => (raw as any)?.[k]).find((v) => Array.isArray(v) && v.length);
  if (Array.isArray(fallbackKeys)) return fallbackKeys;
  const extracted = extractFirstArray(raw);
  if (Array.isArray(extracted) && extracted.length > 0 && isLineLikeRecord(extracted[0])) return extracted;
  const deep = deepFindLongestLineItemArray(raw, 0, 8);
  return deep;
}

function looksLikeId(s: string): boolean {
  if (!s || !String(s).trim()) return true;
  const t = String(s).trim();
  return /^[0-9a-f-]{36}$/i.test(t) || /^\d+$/.test(t);
}

const productNameCache = new Map<string, { name: string; sku: string }>();

async function enrichOrderItemsWithProductNames(
  items: OrderForUI['items']
): Promise<OrderForUI['items']> {
  if (!items?.length) return items;
  const out = [...items];
  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    const pid = String(item?.productId ?? '').trim();
    const currentName = String(item?.productName ?? '').trim();
    const currentSku = String(item?.sku ?? '').trim();
    if (!pid) continue;
    if (currentName && !looksLikeId(currentName)) continue;
    let cached = productNameCache.get(pid);
    if (!cached) {
      const product = await productsApi.getById(pid);
      cached = product
        ? { name: product.name || '', sku: product.code || product.sku || '' }
        : { name: currentName, sku: currentSku };
      productNameCache.set(pid, cached);
    }
    out[i] = {
      ...item,
      productName: cached.name || item.productName,
      sku: cached.sku || item.sku,
    };
  }
  return out;
}

/** Formato de pedido para la UI (historial, detalle, planograma, POD) */
export interface OrderForUI {
  id: string;
  backendOrderId?: number | string;
  storeId: string;
  storeName: string;
  storeAddress?: string;
  date: string;
  deliveryDate?: string;
  status: string;
  items: Array<{
    productId: string;
    productName: string;
    sku: string;
    toOrder?: number;
    quantity?: number;
    price: number;
    row?: number;
    col?: number;
  }>;
  totalUnits: number;
  subtotal: number;
  tax: number;
  total: number;
  podRequired?: boolean;
  podUploaded?: boolean;
  /** URL o texto de referencia al POD (ej. nombre de archivo "Dani.png") */
  podImageUrl?: string;
  podFileName?: string;
  vendorNumber?: string;
  comments?: string;
  /** Id de la factura en el backend (para POD). */
  invoiceId?: number | string;
  /** Nº humano de factura (solo UI; no reemplaza `invoiceId`). */
  invoiceNumber?: string;
  /** Id del vendedor asignado al pedido. */
  salespersonId?: string;
  /** Código PO (Purchase Order), único. */
  po?: string;
   /** ID del planograma asociado al pedido (tabla orders.planogram_id). */
  planogramId?: string;
  /**
   * Origen en la PWA: catálogo vs grilla de planograma.
   * El backend puede rellenar `planogramId` también en catálogo; esto evita mezclar el resumen por rejilla completa.
   */
  orderOrigin?: 'catalog' | 'planogram';
  /** Nº de líneas de factura (relleno en historial cuando se muestran datos de factura). */
  invoiceLineCount?: number;
}

/** Una factura asociada a un pedido del vendedor (reporte de ventas por factura). */
export interface InvoiceReportRow {
  invoiceId: string;
  orderId: string;
  po: string;
  storeId: string;
  orderDate: string;
  invoiceDate: string;
  total: number;
  items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
  /** Tienda / cliente si vienen en el JSON de la factura (evita consultas extra). */
  storeDisplayName?: string;
  storeDisplayAddress?: string;
  storeDisplayCity?: string;
}

function extractInvoiceOrderIdFromLayer(inv: any): string {
  if (inv == null) return '';
  return String(
    inv?.orderId ??
      inv?.OrderId ??
      (inv as any)?.OrderID ??
      inv?.order_id ??
      inv?.Order_Id ??
      inv?.order?.id ??
      inv?.Order?.Id ??
      inv?.order?.orderId ??
      inv?.Order?.OrderId ??
      ''
  ).trim();
}

/** PO en cabecera de factura (prioridad sobre el pedido). */
function extractPoFromInvoiceLayers(
  invLayer: any,
  display?: { invoiceNumber?: string } | null
): string {
  if (invLayer != null && typeof invLayer === 'object') {
    const v = String(
      invLayer.po ??
        invLayer.Po ??
        invLayer.PO ??
        invLayer.purchaseOrder ??
        invLayer.PurchaseOrder ??
        invLayer.orderPo ??
        invLayer.OrderPo ??
        invLayer.referencePo ??
        invLayer.ReferencePo ??
        ''
    ).trim();
    if (v) return v;
  }
  if (display?.invoiceNumber) {
    const n = String(display.invoiceNumber).trim();
    if (n && n !== '—') return n;
  }
  return '';
}

function extractStoreDisplayFromInvoice(invLayer: any): {
  name?: string;
  address?: string;
  city?: string;
} {
  if (invLayer == null || typeof invLayer !== 'object') return {};
  const name = String(
    invLayer.storeName ??
      invLayer.StoreName ??
      invLayer.clientName ??
      invLayer.ClientName ??
      invLayer.customerName ??
      invLayer.CustomerName ??
      invLayer.store?.name ??
      invLayer.Store?.Name ??
      ''
  ).trim();
  const address = String(
    invLayer.storeAddress ??
      invLayer.StoreAddress ??
      invLayer.address ??
      invLayer.Address ??
      invLayer.store?.address ??
      invLayer.Store?.Address ??
      ''
  ).trim();
  const city = String(
    invLayer.storeCity ??
      invLayer.StoreCity ??
      invLayer.city ??
      invLayer.City ??
      invLayer.store?.city ??
      invLayer.Store?.City ??
      ''
  ).trim();
  return {
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
    ...(city ? { city } : {}),
  };
}

function findOrderMatchingInvoiceOid(orders: OrderForUI[], oid: string): OrderForUI | undefined {
  const n = String(oid).trim();
  if (!n) return undefined;
  const lower = n.toLowerCase();
  const num = Number(n);
  const numStr = !Number.isNaN(num) ? String(num) : '';
  return orders.find((o) => {
    const id = String(o.id).trim();
    const back = String(o.backendOrderId ?? '').trim();
    return (
      id === n ||
      id.toLowerCase() === lower ||
      back === n ||
      (numStr !== '' && (back === numStr || id === numStr)) ||
      back.toLowerCase() === lower
    );
  });
}

/**
 * Backend (numérico): 1 = Created, 2 = Invoiced, 3 = Cancelled.
 * PWA interna: initial (= created), confirmed (legacy / strings viejos), invoiced, cancelled.
 */
function normalizeOrderStatus(raw: any): 'initial' | 'confirmed' | 'invoiced' | 'cancelled' {
  const inner = raw?.data ?? raw?.order ?? raw?.Order ?? raw?.value ?? raw?.result ?? raw;
  const v =
    inner?.status ?? inner?.Status ?? inner?.isInvoiced ?? inner?.IsInvoiced
    ?? inner?.orderStatus ?? inner?.OrderStatus ?? inner?.state ?? inner?.State
    ?? inner?.invoiceStatus ?? inner?.InvoiceStatus ?? inner?.order_state
    ?? raw?.status ?? raw?.Status ?? raw?.isInvoiced ?? raw?.IsInvoiced
    ?? raw?.orderStatus ?? raw?.OrderStatus ?? raw?.state ?? raw?.State;
  if (v === true) return 'invoiced';
  if (v === false) return 'initial';

  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v === 3) return 'cancelled';
    if (v === 2) return 'invoiced';
    if (v === 1) return 'initial';
  }

  const sTrim = String(v ?? '').trim();
  if (/^\d+$/.test(sTrim)) {
    const n = Number(sTrim);
    if (n === 3) return 'cancelled';
    if (n === 2) return 'invoiced';
    if (n === 1) return 'initial';
  }

  const s = sTrim.toLowerCase();
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'cancelado' ||
    s === 'anulado' ||
    s === 'void'
  ) {
    return 'cancelled';
  }
  if (
    s === 'invoiced' ||
    s === 'facturado' ||
    s === 'invoice' ||
    s === 'billed' ||
    s === 'facturada' ||
    s === 'delivered'
  ) {
    return 'invoiced';
  }
  if (s === 'created' || s === 'creado' || s === 'pending' || s === 'initial' || s === 'new') {
    return 'initial';
  }
  if (s === 'completed' || s === 'confirmado' || s === 'confirmed') return 'confirmed';
  return 'initial';
}

/** Códigos enviados al PUT /orders/order/{id}/status (mismo contrato numérico que el backend). */
export const ORDER_STATUS_CODE = {
  created: 1,
  invoiced: 2,
  cancelled: 3,
} as const;

/**
 * eternal-api `UpdateStatusCommand`: `Guid OrderId`, `OrderStatus NewStatus` (Created=1, Invoiced=2, Cancelled/Canceled=3).
 * Si el API usa `JsonStringEnumConverter`, los números en JSON pueden fallar; probamos cadenas del enum (.NET suele usar `Cancelled` con doble L).
 */
function orderStatusEnumName(code: 1 | 2 | 3): 'Created' | 'Invoiced' | 'Canceled' {
  if (code === 1) return 'Created';
  if (code === 2) return 'Invoiced';
  return 'Canceled';
}

function buildOrderStatusPayloadCandidates(orderId: string, statusCode: 1 | 2 | 3): string[] {
  const id = String(orderId).trim();
  const n = statusCode;
  const name = orderStatusEnumName(statusCode);
  const seen = new Set<string>();
  const add = (obj: Record<string, unknown>) => {
    const s = JSON.stringify(obj);
    if (!seen.has(s)) seen.add(s);
  };

  // Muchas rutas ASP.NET toman el id de la URL y el cuerpo solo lleva el nuevo estado.
  if (statusCode === 3) {
    add({ newStatus: n });
    add({ NewStatus: n });
    add({ newStatus: String(n) });
    add({ NewStatus: String(n) });
    for (const s of ['Cancelled', 'Canceled', 'cancelled', 'canceled', 'CANCELLED']) {
      add({ newStatus: s });
      add({ NewStatus: s });
    }
  } else if (statusCode === 2) {
    add({ newStatus: n });
    add({ NewStatus: n });
    add({ newStatus: String(n) });
    add({ NewStatus: String(n) });
    for (const s of ['Invoiced', 'invoiced']) {
      add({ newStatus: s });
      add({ NewStatus: s });
    }
  }

  if (statusCode === 3) {
    for (const s of ['Cancelled', 'Canceled', 'cancelled', 'canceled', 'CANCELLED']) {
      add({ orderId: id, newStatus: s });
      add({ OrderId: id, NewStatus: s });
    }
  } else if (statusCode === 2) {
    for (const s of ['Invoiced', 'invoiced']) {
      add({ orderId: id, newStatus: s });
      add({ OrderId: id, NewStatus: s });
    }
  }

  add({ orderId: id, newStatus: n });
  add({ OrderId: id, NewStatus: n });
  add({ orderId: id, newStatus: name });
  add({ OrderId: id, NewStatus: name });

  return [...seen];
}

type PutOrderStatusResult = { ok: boolean; remoteGone?: boolean; connectivityFail?: boolean };

async function putOrderStatusUntilOk(
  orderId: string,
  statusCode: 1 | 2 | 3,
  options?: { notFoundAsSuccess?: boolean }
): Promise<PutOrderStatusResult> {
  const id = String(orderId).trim();
  if (!id) return { ok: false };
  const n = Number(statusCode);
  if (!Number.isInteger(n) || n < 1 || n > 3) return { ok: false };
  const path = `/orders/order/${encodeURIComponent(id)}/status`;
  const candidates = buildOrderStatusPayloadCandidates(id, statusCode);
  const nf = options?.notFoundAsSuccess === true;
  let lastErrMsg: string | undefined;
  let connectivityFail = false;

  for (const payload of candidates) {
    try {
      await apiClient.putBody<unknown>(path, payload);
      return { ok: true };
    } catch (error) {
      const err = error as ApiError;
      const st = Number(err?.status ?? 0);
      if (nf && st === 404) return { ok: true, remoteGone: true };
      lastErrMsg = String((err as any)?.message ?? err ?? '');
      if (st === 0 || isExpectedOfflineError(error)) {
        connectivityFail = true;
        break;
      }
    }
  }
  if (lastErrMsg && process.env.NODE_ENV === 'development') {
    console.warn('[orders-api] PUT', path, 'all status payloads failed:', lastErrMsg);
  }

  if (connectivityFail) {
    return { ok: false, connectivityFail: true };
  }

  if (nf) {
    const stillThere = await safeGet<unknown>(`/orders/orders/${encodeURIComponent(id)}`);
    if (stillThere == null) return { ok: true, remoteGone: true };
    if (normalizeOrderStatus(stillThere) === 'cancelled') {
      return { ok: true };
    }
  }
  return { ok: false };
}

function parseOrderOriginFromRaw(raw: any): 'catalog' | 'planogram' | undefined {
  const v =
    raw?.orderOrigin ??
    raw?.OrderOrigin ??
    raw?.orderSource ??
    raw?.OrderSource ??
    raw?.creationSource ??
    raw?.CreationSource ??
    raw?.orderType ??
    raw?.OrderType;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (['catalog', 'catálogo', 'catalogo', 'cat'].includes(s)) return 'catalog';
  if (['planogram', 'planograma', 'grid', 'layout'].includes(s)) return 'planogram';
  return undefined;
}

/** Si el GET no trae `orderOrigin`, conservar el valor guardado al crear el pedido en la PWA. */
async function mergeCachedOrderOriginOntoResult(result: OrderForUI, hintIds: string[]): Promise<OrderForUI> {
  for (const id of hintIds) {
    const idTrim = String(id ?? '').trim();
    if (!idTrim) continue;
    const prev = await resolveOrderFromOfflineCaches(idTrim);
    if (prev?.orderOrigin && !result.orderOrigin) {
      return { ...result, orderOrigin: prev.orderOrigin };
    }
  }
  return result;
}

function mapRawOrderToUI(raw: any, details: any[] = []): OrderForUI {
  const id = String(raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? '');
  const date = raw?.createdAt ?? raw?.CreatedAt ?? raw?.date ?? raw?.Date ?? new Date().toISOString();
  const planogramIdRaw =
    (raw?.planogramId ??
      raw?.PlanogramId ??
      raw?.planogram_id ??
      raw?.PLANOGRAM_ID ??
      '') as string;
  const items = (details || []).map((d: any) => {
    const qty = detailQuantity(d);
    const lineAmt = detailSubtotal(d);
    const upRaw = detailUnitPriceRaw(d);
    const pFlat = parseMoney(d?.price ?? d?.Price);
    const unitPrice =
      upRaw > 0
        ? upRaw
        : qty > 0 && lineAmt > 0
          ? lineAmt / qty
          : pFlat > 0
            ? pFlat
            : 0;
    return {
      productId: detailProductId(d),
      productName: String(d?.productName ?? d?.ProductName ?? d?.product?.name ?? d?.Product?.Name ?? d?.description ?? d?.Description ?? d?.name ?? d?.Name ?? '').trim(),
      sku: String(d?.sku ?? d?.Sku ?? d?.product?.sku ?? d?.Product?.Sku ?? d?.product?.code ?? d?.Product?.Code ?? ''),
      toOrder: qty,
      quantity: qty,
      price: unitPrice,
      row: d?.row ?? d?.Row,
      col: d?.col ?? d?.Col ?? d?.column ?? d?.Column,
    };
  });
  const rawTotal =
    raw?.total ?? raw?.Total ?? raw?.orderTotal ?? raw?.OrderTotal ?? raw?.amount ?? raw?.Amount
    ?? raw?.totalAmount ?? raw?.TotalAmount ?? raw?.grandTotal ?? raw?.GrandTotal
    ?? raw?.invoice?.total ?? raw?.Invoice?.Total ?? raw?.invoice?.amount ?? raw?.Invoice?.Amount;
  let total = parseMoney(rawTotal);
  let subtotal = parseMoney(raw?.subtotal ?? raw?.Subtotal ?? raw?.SubTotal ?? total);
  const tax = parseMoney(raw?.tax ?? raw?.Tax ?? 0);
  const totalUnits = items.reduce((s, i) => s + (i.quantity ?? i.toOrder ?? 0), 0);
  const computedSubtotal = items.reduce((s, i) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price || 0), 0);
  if (subtotal === 0 && computedSubtotal > 0) subtotal = computedSubtotal;
  if (total === 0 && computedSubtotal > 0) total = computedSubtotal + tax;
  if (total === 0 && subtotal > 0) total = subtotal + tax;
  const salespersonIdRaw = raw?.salespersonId ?? raw?.SalespersonId ?? raw?.userId ?? raw?.UserId;
  const statusNorm = normalizeOrderStatus(raw);
  return {
    id,
    backendOrderId: raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id,
    storeId: String(raw?.storeId ?? raw?.StoreId ?? ''),
    storeName: String(raw?.storeName ?? raw?.StoreName ?? raw?.store?.name ?? raw?.Store?.Name ?? raw?.storeId ?? raw?.StoreId ?? '').trim() || '—',
    storeAddress: raw?.storeAddress ?? raw?.StoreAddress ?? raw?.store?.address ?? raw?.Store?.Address ?? '',
    date: typeof date === 'string' ? date : (date instanceof Date ? date.toISOString() : new Date().toISOString()),
    deliveryDate: raw?.deliveryDate ?? raw?.DeliveryDate,
    status: statusNorm,
    items,
    totalUnits,
    subtotal,
    tax,
    total,
    podRequired: true,
    podUploaded: !!raw?.podUploaded || !!raw?.PodUploaded,
    podImageUrl: raw?.podImageUrl ?? raw?.PodImageUrl,
    podFileName: raw?.podFileName ?? raw?.PodFileName,
    vendorNumber: raw?.vendorNumber ?? raw?.VendorNumber,
    comments: raw?.comments ?? raw?.Comments,
    invoiceId:
      raw?.invoiceId ?? raw?.InvoiceId ?? raw?.Invoice_ID ?? raw?.invoice_id
      ?? raw?.invoice?.id ?? raw?.invoice?.invoiceId ?? raw?.invoice?.InvoiceId
      ?? raw?.Invoice?.Id ?? raw?.Invoice?.invoiceId ?? raw?.Invoice?.InvoiceId
      ?? raw?.invoice?.Id ?? raw?.Invoice?.id,
    salespersonId: salespersonIdRaw != null ? String(salespersonIdRaw) : undefined,
    po: raw?.po ?? raw?.Po ?? raw?.purchaseOrder ?? raw?.PurchaseOrder ?? raw?.PO ?? undefined,
    planogramId: (planogramIdRaw || '').trim() || undefined,
    orderOrigin: parseOrderOriginFromRaw(raw),
  };
}

export const ordersApi = {
  /**
   * Guarda en IndexedDB la versión editada del pedido (detalle/historial offline), sin llamar al API.
   * Úsalo cuando la actualización queda en cola (`UPDATE_ORDER`).
   */
  async persistEditedOrderForOffline(orderId: string | number, input: CreateOrderInput): Promise<void> {
    await persistUpdatedOrderToOfflineCaches(orderId, input);
  },

  async refreshOrdersCacheForUser(userId: string): Promise<void> {
    const uid = String(userId || '').trim();
    if (!uid || typeof window === 'undefined') return;
    const db = await getOfflineDbIfBrowser();
    if (db) {
      await db.appCache.delete(userOrdersCacheKey(uid));
      const byIdRows = await db.appCache.where('key').startsWith('orders.byId.').toArray();
      if (byIdRows.length > 0) {
        await db.appCache.bulkDelete(byIdRows.map((r) => r.key));
      }
    }
    // Rehidratar desde backend (si hay red). Si no hay red, no lanzar error.
    await this.getOrdersByUser(uid);
  },

  /**
   * Crea un pedido con Unit of Work (header + detalles en un solo POST /orders/orders).
   * Devuelve el id del pedido creado en backend (orderId) si se pudo obtener.
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrderResult | null> {
    // Unit of Work: crear cabecera + detalles en un solo request
    const generatedOrderId = generateUuidV4();
    const mappedItems = input.items.map((item) => {
      const detailId = generateUuidV4();
      return {
        orderDetailId: detailId,
        OrderDetailId: detailId,
        productId: item.productId,
        ProductId: item.productId,
        quantity: Number(item.quantity) || 0,
        Quantity: Number(item.quantity) || 0,
      };
    });

    const payload: Record<string, unknown> = {
      id: generatedOrderId,
      Id: generatedOrderId,
      salespersonId: input.salespersonId,
      SalespersonId: input.salespersonId,
      storeId: input.storeId,
      StoreId: input.storeId,
      items: mappedItems,
      Items: mappedItems,
    };
    let createdOrder: any;
    try {
      createdOrder = await apiClient.post<any>('/orders/orders', payload);
    } catch (error) {
      const err = error as ApiError;
      return { errorMessage: err.message || 'Error al crear el pedido' };
    }

    let createdOrderId: string | number | null = null;
    if (typeof createdOrder === 'string' && createdOrder.trim().length > 0) {
      createdOrderId = createdOrder.trim();
    } else if (typeof createdOrder === 'object') {
      createdOrderId =
        createdOrder.orderId ??
        createdOrder.OrderId ??
        createdOrder.id ??
        createdOrder.Id ??
        createdOrder.data?.orderId ??
        createdOrder.data?.OrderId ??
        createdOrder.data?.id ??
        createdOrder.data?.Id ??
        (typeof createdOrder.data === 'string' ? createdOrder.data : null) ??
        createdOrder.value?.orderId ??
        createdOrder.value?.id ??
        (typeof createdOrder.value === 'string' ? createdOrder.value : null) ??
        null;
    }

    if (createdOrderId == null || createdOrderId === '') {
      console.warn('[orders-api] createOrder: respuesta sin orderId.', createdOrder);
      return { errorMessage: 'El servidor no devolvió el ID del pedido.' };
    }

    const invoiceId =
      createdOrder?.invoiceId ??
      createdOrder?.InvoiceId ??
      createdOrder?.data?.invoiceId ??
      createdOrder?.data?.InvoiceId ??
      createdOrder?.value?.invoiceId ??
      createdOrder?.value?.InvoiceId;

    await persistCreatedOrderToOfflineCaches(input, { orderId: createdOrderId, invoiceId });
    return { orderId: createdOrderId, invoiceId };
  },

  /**
   * Crea o reutiliza factura para el pedido. El POD es opcional en el POST; si la factura ya existe,
   * se puede adjuntar el archivo con `uploadPODForInvoice` (PATCH) o pasando `podFileName` aquí.
   */
  async ensureInvoiceForOrder(
    orderId: string | number,
    deliveredItems?: DeliveredItemInput[],
    options?: { podFileName?: string; notes?: string }
  ): Promise<string | number | null> {
    const orderIdStr = String(orderId).trim();
    if (!orderIdStr) return null;

    const podFileName = String(options?.podFileName ?? '').trim();
    const notes = String(options?.notes ?? '').trim();

    const existingRaw = await this.getInvoiceIdForOrder(orderIdStr);
    const existingStr =
      existingRaw != null && String(existingRaw).trim() !== '' ? String(existingRaw).trim() : '';

    if (existingStr) {
      if (podFileName) {
        const inv = await getInvoiceById(existingStr);
        if (!invoiceHasPodEvidence(inv)) {
          const patched = await this.uploadPODForInvoice({
            invoiceId: existingStr,
            fileName: podFileName,
            notes: notes || undefined,
          });
          if (!patched) return null;
        }
      }
      return existingRaw;
    }

    const order = await this.getOrderById(orderIdStr);
    if (!order) return null;

    const invoiceGuid = generateUuidV4();

    const mappedItems =
      Array.isArray(deliveredItems) && deliveredItems.length > 0
        ? deliveredItems.map((it) => {
            const invoiceDetailId = generateUuidV4();
            const qty = Number(it.quantity) || 0;
            const price = Number(it.unitPrice) || 0;
            const subtotal = qty * price;
            return {
              invoiceDetailId,
              InvoiceDetailId: invoiceDetailId,
              invoiceId: invoiceGuid,
              InvoiceId: invoiceGuid,
              productId: it.productId,
              ProductId: it.productId,
              quantity: qty,
              Quantity: qty,
              subtotal,
              Subtotal: subtotal,
            };
          })
        : [];

    if (mappedItems.length === 0) {
      return null;
    }

    const tax = Number(order.tax) || 0;
    const linesSubtotal = mappedItems.reduce(
      (s, row: any) => s + Number(row?.subtotal ?? row?.Subtotal ?? 0),
      0
    );
    const subtotalForInvoice = linesSubtotal;
    const totalForInvoice = subtotalForInvoice + tax;

    const body: Record<string, unknown> = {
      id: invoiceGuid,
      Id: invoiceGuid,
      orderId: orderIdStr,
      OrderId: orderIdStr,
      total: totalForInvoice,
      Total: totalForInvoice,
      subtotal: subtotalForInvoice,
      Subtotal: subtotalForInvoice,
      tax,
      Tax: tax,
      storeId: order.storeId,
      StoreId: order.storeId,
      createdAt: new Date().toISOString(),
      CreatedAt: new Date().toISOString(),
      items: mappedItems,
      Items: mappedItems,
    };

    if (podFileName) {
      body.pod = podFileName;
      body.Pod = podFileName;
    }

    if (notes) {
      body.notes = notes;
      body.Notes = notes;
    }

    let created: any;
    try {
      created = await apiClient.post<any>('/invoice/invoices', body);
    } catch (error) {
      const err = error as ApiError;
      const st = Number(err?.status ?? 0);
      if (st === 0 || isExpectedOfflineError(error)) {
        throw error;
      }
      if (process.env.NODE_ENV === 'development') {
        console.warn('[orders-api] POST /invoice/invoices failed:', err?.message ?? err);
      }
      return null;
    }
    if (created == null) return null;
    const invoiceId =
      created?.invoiceId ??
      created?.InvoiceId ??
      created?.id ??
      created?.Id ??
      created?.data?.invoiceId ??
      created?.data?.InvoiceId ??
      created?.data?.id ??
      created?.data?.Id ??
      created?.value?.invoiceId ??
      created?.value?.InvoiceId ??
      created?.value?.id ??
      created?.value?.Id ??
      null;
    if (invoiceId != null && String(invoiceId).trim() !== '') return invoiceId;
    return invoiceGuid;
  },

  /**
   * Edición de pedido inicial (vendedor): tienda + ítems.
   * Endpoint: PUT /orders/orders/{id}
   * Body mínimo: { id, storeId, items[{ orderDetailId, productId, quantity }] }
   * Si `queueOffline` es true, no reintentar en UI: usar cola offline (`updateOrderResilient`).
   */
  async updateOrder(
    orderId: string | number,
    input: CreateOrderInput,
    optionalInvoiceId?: string | number | null
  ): Promise<{ ok: boolean; errorMessage?: string; queueOffline?: boolean }> {
    void optionalInvoiceId;
    const idStr = String(orderId).trim();
    if (!idStr) return { ok: false, errorMessage: 'Id de pedido inválido.' };

    const body = {
      id: idStr,
      storeId: String(input.storeId || '').trim(),
      items: (Array.isArray(input.items) ? input.items : []).map((item: any) => ({
        orderDetailId: String(item?.orderDetailId || '').trim() || undefined,
        productId: String(item?.productId || '').trim(),
        quantity: Number(item?.quantity) || 0,
      })),
    };

    try {
      await apiClient.put<any>(`/orders/orders/${encodeURIComponent(idStr)}`, body);
    } catch (error) {
      const err = error as ApiError;
      const st = Number(err?.status ?? 0);
      if (st === 0 || isExpectedOfflineError(error)) {
        return {
          ok: false,
          errorMessage: err?.message || 'Sin conexión. Los cambios se pueden guardar en cola.',
          queueOffline: true,
        };
      }
      return { ok: false, errorMessage: err?.message || 'No se pudo actualizar el pedido.' };
    }
    await persistUpdatedOrderToOfflineCaches(idStr, input);
    return { ok: true };
  },

  /**
   * Detalles de factura por invoiceId desde GET /invoice/invoices/{invoiceId}.
   * El backend devuelve la factura con sus detalles anidados.
   */
  async getInvoiceDetailsByInvoiceId(invoiceId: string): Promise<any[]> {
    const id = String(invoiceId).trim();
    if (!id) return [];
    const invoice = await getInvoiceById(id);
    let rows = normalizeDetailList(invoice);
    if (rows.length === 0 && invoice) rows = findBestInvoiceDetailsArray(invoice);
    return rows;
  },

  /**
   * Obtiene el id de la factura asociada a un pedido.
   * Flujo: GET /invoice/invoices → se compara cada factura.orderId/OrderId con el orderId del pedido seleccionado → se devuelve factura.id.
   */
  async getInvoiceIdForOrder(orderId: string): Promise<string | number | null> {
    const orderIdNorm = String(orderId).trim();
    if (!orderIdNorm) return null;
    const orderIdLower = orderIdNorm.toLowerCase();
    const orderIdNum = Number(orderIdNorm);
    const arr = await getInvoiceList();
    for (const x of arr as any[]) {
      const item = unwrapInvoiceItem(x) ?? x;
      const invOrderId =
        item?.orderId ?? item?.OrderId ?? item?.OrderID ?? (item as any)?.Order_ID ?? item?.order_id ?? item?.Order_Id
        ?? item?.order?.id ?? item?.Order?.Id ?? item?.order?.orderId ?? item?.Order?.OrderId
        ?? x?.orderId ?? x?.OrderId ?? (x as any)?.OrderID ?? x?.order_id ?? x?.order?.id ?? x?.Order?.Id;
      if (invOrderId == null || invOrderId === '') continue;
      const invOrderStr = String(invOrderId).trim();
      const invOrderNum = Number(invOrderId);
      const match =
        invOrderStr === orderIdNorm ||
        invOrderStr.toLowerCase() === orderIdLower ||
        (!Number.isNaN(orderIdNum) && !Number.isNaN(invOrderNum) && invOrderNum === orderIdNum) ||
        (invOrderStr && orderIdNorm && invOrderStr.length === orderIdNorm.length && invOrderStr.toLowerCase() === orderIdLower) ||
        invOrderId == orderIdNorm ||
        invOrderId === orderIdNum;
      if (match) {
        const id = item?.id ?? item?.Id ?? item?.invoiceId ?? item?.InvoiceId ?? (item as any)?.InvoiceId ?? x?.id ?? x?.Id ?? x?.invoiceId ?? x?.InvoiceId;
        if (id != null && id !== '') return id;
      }
    }
    return null;
  },

  /** Devuelve el objeto factura completo cuyo orderId/OrderId coincide con el pedido seleccionado. */
  async getInvoiceForOrder(orderId: string): Promise<any | null> {
    const orderIdNorm = String(orderId).trim();
    const orderIdLower = orderIdNorm.toLowerCase();
    const arr = await getInvoiceList();
    for (const x of arr as any[]) {
      const item = unwrapInvoiceItem(x) ?? x;
      const invOrderId =
        item?.orderId ?? item?.OrderId ?? item?.order_id ?? item?.Order_Id
        ?? item?.order?.id ?? item?.Order?.Id ?? x?.orderId ?? x?.OrderId ?? x?.order?.id ?? x?.Order?.Id;
      if (invOrderId == null) continue;
      const invOrderStr = String(invOrderId).trim();
      if (invOrderStr === orderIdNorm || invOrderStr.toLowerCase() === orderIdLower) return item ?? x;
    }
    return null;
  },

  /**
   * Total del pedido desde la factura (igual que en el listado de pedidos).
   * Si no hay factura o total, devuelve 0.
   */
  async getInvoiceTotalForOrder(orderId: string): Promise<number> {
    const inv = await this.getInvoiceForOrder(orderId);
    if (!inv) return 0;
    const layers = peelInvoiceLayers(inv);
    const totalKeys = ['total', 'Total', 'amount', 'Amount', 'totalAmount', 'TotalAmount', 'grandTotal', 'GrandTotal', 'totalUsd', 'TotalUsd'];
    let total = firstPositiveNumericFromLayers(layers, totalKeys);
    if (total <= 0) {
      const arr = normalizeDetailList(inv);
      total = arr.reduce((s: number, d: any) => s + Number(d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.total ?? d?.Total ?? 0), 0);
    }
    return total;
  },

  /**
   * Actualiza el pedido con la URL de la imagen POD y marca como completado.
   * Útil en local: guarda la URL (p. ej. data URL) en BD vía PUT /orders/order/{id}.
   */
  async updateOrderWithPod(orderId: string | number, podImageUrl: string): Promise<boolean> {
    const id = String(orderId);
    const existingOrder = await safeGet<any>(`/orders/orders/${encodeURIComponent(id)}`);
    if (!existingOrder) return false;
    const salespersonId =
      existingOrder.salespersonId ?? existingOrder.SalespersonId ?? existingOrder.userId ?? existingOrder.UserId;
    const body: Record<string, unknown> = {
      storeId: existingOrder.storeId ?? existingOrder.StoreId,
      StoreId: existingOrder.storeId ?? existingOrder.StoreId,
      status: ORDER_STATUS_CODE.invoiced,
      Status: ORDER_STATUS_CODE.invoiced,
      subtotal: existingOrder.subtotal ?? existingOrder.Subtotal,
      Subtotal: existingOrder.subtotal ?? existingOrder.Subtotal,
      tax: existingOrder.tax ?? existingOrder.Tax,
      Tax: existingOrder.tax ?? existingOrder.Tax,
      total: existingOrder.total ?? existingOrder.Total,
      Total: existingOrder.total ?? existingOrder.Total,
      podImageUrl,
      PodImageUrl: podImageUrl,
      podUploaded: true,
      PodUploaded: true,
    };
    if (salespersonId != null) {
      body.salespersonId = String(salespersonId);
      body.SalespersonId = String(salespersonId);
    }
    const res = await safePut<any>(`/orders/order/${encodeURIComponent(id)}`, body);
    return res !== null;
  },

  /**
   * Datos de la factura para pantalla.
   * Flujo: con el orderId del pedido seleccionado se busca la factura en GET /invoice/invoices (comparando orderId),
   * luego GET /invoice/invoices/{id} (ya incluye detalles) para items y totales.
   */
  async getInvoiceDisplayForOrder(
    orderId: string,
    optionalInvoiceId?: string | number,
    /** Pedido ya cargado: evita un GET duplicado y asegura cruce SKU/productId con líneas de factura */
    orderForLines?: OrderForUI | null
  ): Promise<{
    invoiceNumber: string;
    date: string;
    total: number;
    storeId?: string;
    items: Array<{ qty: number; code: string; sku?: string; description: string; price: number; amount: number }>;
    /** Ruta del POD desde la factura (ej. /imagenes/dani.png) para pedidos viejos */
    pod?: string;
    /** PO devuelto por la factura (si el backend lo envía aquí). */
    po?: string;
  } | null> {
    let invId = '';
    let invoice: any = null;

    // 1) Id de factura pasado opcionalmente o obtenido por API
    if (optionalInvoiceId != null && String(optionalInvoiceId).trim()) invId = String(optionalInvoiceId).trim();
    // 2) Comparar orderId en lista: GET /invoice/invoices y buscar donde factura.orderId === orderId del pedido seleccionado
    if (!invId) {
      const idFromList = await this.getInvoiceIdForOrder(orderId);
      if (idFromList != null) invId = String(idFromList);
    }
    let rawInvoice: any = null;
    if (!invId) {
      const fromList = await this.getInvoiceForOrder(orderId);
      invoice = fromList;
      rawInvoice = fromList;
      if (invoice?.data && typeof invoice.data === 'object') invoice = invoice.data;
      if (invoice?.invoice && typeof invoice.invoice === 'object') invoice = invoice.invoice;
      if (invoice != null) invId = String(invoice?.id ?? invoice?.Id ?? invoice?.invoiceId ?? invoice?.InvoiceId ?? '').trim();
    }
    // 3) Pedido desde API (puede traer invoiceId o backendOrderId)
    const order = orderForLines ?? (await this.getOrderById(orderId));
    if (!invId && order?.invoiceId != null) invId = String(order.invoiceId);
    if (!invId && order?.backendOrderId != null) {
      const byBackend = await this.getInvoiceIdForOrder(String(order.backendOrderId));
      if (byBackend != null) invId = String(byBackend);
    }
    if (!invId) return null;

    const invoiceById = await getInvoiceById(invId);
    const rawForInvoice = invoiceById ?? rawInvoice ?? invoice;
    if (rawForInvoice == null) return null;
    const layers = peelInvoiceLayers(rawForInvoice);
    invoice =
      layers[layers.length - 1] ??
      unwrapInvoiceResponse(rawForInvoice) ??
      rawForInvoice;
    if (invoice == null && rawForInvoice != null) invoice = rawForInvoice;

    let details = normalizeDetailList(rawForInvoice);
    /** Mismo criterio que POD: barrido completo del JSON por si las líneas no están en las claves habituales */
    if (details.length === 0) details = findBestInvoiceDetailsArray(rawForInvoice);
    if (details.length === 0) details = await this.getInvoiceDetailsByInvoiceId(invId);

    const orderItemsByProduct = new Map<string, { productName?: string; sku?: string; price?: number }>();
    if (order?.items) {
      order.items.forEach((i: any) => {
        const pid = String(i?.productId ?? i?.ProductId ?? '');
        if (pid) {
          orderItemsByProduct.set(pid, {
            productName: i.productName ?? i.ProductName,
            sku: i.sku ?? i.Sku,
            price: Number(i?.price ?? i?.Price) || 0,
          });
        }
      });
    }

    // Si por alguna razón detailQuantity devuelve 0 para todos, usar todos los detalles para no dejar la factura vacía
    const filtered = details.filter((d: any) => detailQuantity(d) > 0);
    const detailsToUse = filtered.length > 0 ? filtered : details;

    const items = await Promise.all(
      detailsToUse.map(async (d: any) => {
        const qty = detailQuantity(d);
        let amount = detailSubtotal(d);
        let price = qty > 0 ? amount / qty : 0;
        const pid = String(detailProductId(d) || '').trim();
        const orderItem = pid ? orderItemsByProduct.get(pid) : undefined;
        let product: Awaited<ReturnType<typeof productsApi.getById>> | null = null;
        if (pid) {
          try {
            product = await productsApi.getById(pid);
          } catch {
            product = null;
          }
        }
        const detailSku = String(d?.sku ?? d?.Sku ?? d?.product?.sku ?? d?.Product?.Sku ?? '').trim();
        let description =
          (detailProductName(d) || orderItem?.productName || orderItem?.sku || '').trim();
        if (!description && product) {
          description = (product?.name || product?.sku || '').trim();
        }
        description = description || '—';
        const orderSku = String(orderItem?.sku || '').trim();
        const productCommerceSku = String((product as { commerceSku?: string })?.commerceSku ?? '').trim();
        const productCode = String(product?.code || '').trim();
        const skuField = orderSku || detailSku || productCommerceSku || undefined;
        const code = orderSku || detailSku || productCode || (pid ? pid : '') || '—';
        if ((price === 0 || amount === 0) && pid) {
          let latestPrice = orderItem?.price ?? 0;
          if (!(latestPrice > 0)) {
            const p = product ?? (await productsApi.getById(pid).catch(() => null));
            const presId = String(p?.presentationId ?? '').trim();
            latestPrice = presId ? await histpricesApi.getLatest(presId) : 0;
          }
          price = latestPrice;
          amount = qty * price;
        }
        return {
          qty,
          code,
          ...(skuField ? { sku: skuField } : {}),
          description,
          price,
          amount,
          ...(pid ? { productId: pid } : {}),
        };
      })
    );

    const totalKeys = ['total', 'Total', 'amount', 'Amount', 'totalAmount', 'TotalAmount', 'grandTotal', 'GrandTotal', 'totalUsd', 'TotalUsd'];
    let total = firstPositiveNumericFromLayers(layers, totalKeys);
    if (total <= 0) {
      total = Number(invoice?.total ?? invoice?.Total ?? invoice?.amount ?? invoice?.Amount ?? 0);
    }
    const totalFromDetails = items.reduce((s, i) => s + i.amount, 0);
    const dateFields = ['date', 'Date', 'createdAt', 'CreatedAt', 'invoiceDate', 'InvoiceDate'];
    let date: string | undefined;
    for (const L of layers) {
      if (!L || typeof L !== 'object') continue;
      for (const k of dateFields) {
        const v = (L as any)[k];
        if (v != null && v !== '') {
          date = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : String(v);
          break;
        }
      }
      if (date) break;
    }
    if (!date) {
      date =
        (invoice?.date ??
          invoice?.Date ??
          invoice?.createdAt ??
          invoice?.CreatedAt ??
          order?.date ??
          new Date().toISOString()) as string;
    }
    const invNumber = invoice?.invoiceNumber ?? invoice?.InvoiceNumber ?? invoice?.invoiceId ?? invoice?.InvoiceId ?? invId;
    const podFromInvoice = getPodFromInvoice(rawForInvoice);
    const poFromInvoice = getPoFromInvoice(rawForInvoice);

    const dateOut = (typeof date === 'string' && date ? date : new Date().toISOString()) as string;
    return {
      invoiceNumber: String(invNumber),
      date: dateOut,
      total: total > 0 ? total : totalFromDetails,
      storeId: invoice?.storeId ?? invoice?.StoreId ?? order?.storeId,
      items,
      ...(podFromInvoice ? { pod: podFromInvoice } : {}),
      ...(poFromInvoice ? { po: poFromInvoice } : {}),
    };
  },

  /**
   * Asigna imagen POD a la factura (tras POST /images/upload).
   * PATCH /invoice/invoices/{id}/pod — el cuerpo debe ser un JSON **string** (nombre/clave del archivo), no un objeto.
   */
  async uploadPODForInvoice(params: {
    invoiceId: number | string;
    fileName: string;
    notes?: string;
  }): Promise<boolean> {
    const id = String(params.invoiceId).trim();
    const fileName = String(params.fileName ?? '').trim();
    if (!id || !fileName) return false;
    void params.notes;
    try {
      const res = await apiClient.patch<unknown>(
        `/invoice/invoices/${encodeURIComponent(id)}/pod`,
        fileName
      );
      return res !== null && res !== undefined;
    } catch (error) {
      const err = error as ApiError;
      const st = Number(err?.status ?? 0);
      if (st === 0 || isExpectedOfflineError(error)) {
        throw error;
      }
      if (process.env.NODE_ENV === 'development') {
        console.warn('[orders-api] PATCH pod failed:', err?.message ?? err);
      }
      return false;
    }
  },

  // VisitLogs removidos: el sistema ahora usa Assignments (tiendas asignadas).

  /**
   * Actualiza el estado del pedido en backend.
   * PUT /orders/order/{id}/status
   * Body (Swagger eternal-api): `{ "orderId": "<uuid>", "newStatus": 1|2|3 }`
   * 1=Creado, 2=Facturado, 3=Cancelado.
   *
   * `isInvoiced === false`: no hace PUT. El pedido nuevo ya está en Created(1); reenviar 1 suele
   * provocar ArgumentOutOfRangeException en el handler si no permite transición 1→1.
   *
   * `isInvoiced === true`: envía newStatus = 2 (cerrar / facturado tras POD).
   */
  async updateOrderStatus(
    orderId: string | number,
    isInvoiced: boolean = true
  ): Promise<boolean> {
    const idStr = String(orderId).trim();
    if (!isInvoiced) {
      return true;
    }
    const r = await putOrderStatusUntilOk(idStr, ORDER_STATUS_CODE.invoiced);
    return r.ok;
  },

  /**
   * Cancelación solicitada por el vendedor (pedido inicial sin facturar).
   * PUT /orders/order/{id}/status con estado cancelado. La eliminación física queda solo para administración.
   */
  async cancelOrderBySeller(orderId: string | number): Promise<boolean> {
    const idStr = String(orderId).trim();
    if (!idStr) return false;
    const r = await putOrderStatusUntilOk(idStr, ORDER_STATUS_CODE.cancelled, {
      notFoundAsSuccess: true,
    });
    if (r.ok) {
      if (r.remoteGone) await purgeOrderFromOfflineClient(idStr);
      else await markCancelledInBrowserCaches(idStr);
      return true;
    }
    if (r.connectivityFail) {
      throw {
        message: 'Error de conexión. Verifica tu conexión a internet.',
        status: 0,
      } as ApiError;
    }
    const still = await safeGet<unknown>(`/orders/orders/${encodeURIComponent(idStr)}`);
    if (still == null) {
      await purgeOrderFromOfflineClient(idStr);
      return true;
    }
    const norm = normalizeOrderStatus(still);
    if (norm === 'cancelled') {
      await markCancelledInBrowserCaches(idStr);
      return true;
    }
    if (norm === 'initial' || norm === 'confirmed') {
      const deleted = await safeDelete<any>(`/orders/orders/${encodeURIComponent(idStr)}`);
      if (deleted != null) {
        await purgeOrderFromOfflineClient(idStr);
        return true;
      }
    }
    return false;
  },

  /**
   * Elimina un pedido. Solo debe usarse para pedidos pendientes (sin POD).
   * Usa DELETE /orders/orders/{id} (el recurso plural admite DELETE; /orders/order/{id} devuelve 405).
   */
  async deleteOrder(orderId: string | number): Promise<boolean> {
    const res = await safeDelete<any>(`/orders/orders/${encodeURIComponent(String(orderId))}`);
    return res !== null;
  },

  /**
   * Cruza facturas globales con los pedidos del vendedor para métricas y reportes por factura.
   */
  async buildInvoiceReportRows(orders: OrderForUI[]): Promise<InvoiceReportRow[]> {
    if (!orders.length) return [];
    const list = await getInvoiceList();
    const seenInv = new Set<string>();
    const candidates: { invId: string; order: OrderForUI; invLayer: any }[] = [];
    for (const x of list) {
      const inv = unwrapInvoiceItem(x) ?? x;
      const oid = extractInvoiceOrderIdFromLayer(inv);
      if (!oid) continue;
      const order = findOrderMatchingInvoiceOid(orders, oid);
      if (!order) continue;
      const invId = String(
        inv?.id ??
          inv?.Id ??
          inv?.invoiceId ??
          inv?.InvoiceId ??
          (x as any)?.id ??
          (x as any)?.Id ??
          ''
      ).trim();
      if (!invId || seenInv.has(invId)) continue;
      seenInv.add(invId);
      candidates.push({ invId, order, invLayer: inv });
    }
    const rows = await Promise.all(
      candidates.map(async ({ invId, order, invLayer }) => {
        const display = await this.getInvoiceDisplayForOrder(order.id, invId, order);
        const fallbackTotal = Number(
          invLayer?.total ?? invLayer?.Total ?? invLayer?.amount ?? invLayer?.Amount ?? 0
        );
        if (display?.items?.length) {
          const total =
            Number(display.total) > 0 ? Number(display.total) : fallbackTotal;
          const poFromDisplay = String(display.po ?? '').trim();
          return {
            invoiceId: invId,
            orderId: order.id,
            po: poFromDisplay || String(order.po ?? '').trim(),
            storeId: order.storeId,
            orderDate: order.date,
            invoiceDate: display.date,
            total,
            items: display.items,
          } as InvoiceReportRow;
        }
        if (fallbackTotal > 0) {
          const invDate = String(
            invLayer?.date ??
              invLayer?.Date ??
              invLayer?.createdAt ??
              invLayer?.CreatedAt ??
              order.date
          );
          const poFromLayer = String(
            getPoFromInvoice(invLayer) || (invLayer as any)?.po || (invLayer as any)?.Po || ''
          ).trim();
          return {
            invoiceId: invId,
            orderId: order.id,
            po: poFromLayer || String(order.po ?? '').trim(),
            storeId: order.storeId,
            orderDate: order.date,
            invoiceDate: invDate,
            total: fallbackTotal,
            items: [],
          } as InvoiceReportRow;
        }
        return null;
      })
    );
    return rows.filter((r): r is InvoiceReportRow => r != null);
  },

  /**
   * GET listado usuario y purga IndexedDB de ids remotos que ya no existen en servidor (sin esperar recarga).
   */
  async reconcileOfflineWithServerUserList(userId: string): Promise<boolean> {
    if (!browserReportsOnline() || typeof window === 'undefined') return false;
    try {
      const list = await apiClient.get<any>(`/orders/orders/user/${encodeURIComponent(userId)}`);
      const arr = Array.isArray(list)
        ? list
        : list?.data ?? list?.Data ?? list?.items ?? list?.Items ?? list?.value ?? list?.Value ?? [];
      const ids = (arr as any[])
        .map((raw: any) =>
          String(raw?.orderId ?? raw?.OrderId ?? (raw as any)?.OrderID ?? raw?.id ?? raw?.Id ?? '')
        )
        .filter(Boolean);
      return await reconcileOfflineStoresAgainstRemoteIdSet(String(userId), new Set(ids));
    } catch {
      return false;
    }
  },

  /**
   * Lista pedidos del usuario con total real. Obtiene el listado, cada pedido completo (getOrderById)
   * y enriquece el total con el de la factura (GET /invoice/invoices) cuando el pedido no trae total.
   */
  async getOrdersByUser(userId: string): Promise<OrderForUI[]> {
    const online = browserReportsOnline();
    let list: any = null;
    let serverListOk = false;
    if (online) {
      try {
        list = await apiClient.get<any>(`/orders/orders/user/${encodeURIComponent(userId)}`);
        serverListOk = true;
      } catch {
        serverListOk = false;
        list = null;
      }
    } else {
      list = await safeGet<any>(`/orders/orders/user/${encodeURIComponent(userId)}`);
      serverListOk = list != null;
    }
    const arr = Array.isArray(list) ? list : list?.data ?? list?.Data ?? list?.items ?? list?.Items ?? list?.value ?? list?.Value ?? [];
    const ids = (arr as any[]).map((raw: any) =>
      String(raw?.orderId ?? raw?.OrderId ?? (raw as any)?.OrderID ?? raw?.id ?? raw?.Id ?? '')
    ).filter(Boolean);

    if (typeof window !== 'undefined' && online && serverListOk) {
      await clearPendingIdsConfirmedOnServer(ids);
      await reconcileOfflineStoresAgainstRemoteIdSet(String(userId), new Set(ids));
    }

    if (!arr.length) {
      if (typeof window !== 'undefined') {
        const db = await getOfflineDbIfBrowser();
        const localDrafts = db
          ? await db.localOrders.where('userId').equals(String(userId)).toArray()
          : [];
        const localOrders = localDrafts.map((d) => d.data as OrderForUI);
        // Con servidor disponible, la fuente de verdad es backend.
        // No reinyectar pedidos remotos desde caché vieja para evitar "fantasmas".
        if (online && serverListOk) {
          const withPodRaw = await Promise.all(
            localOrders.map((o) => mergeOfflinePendingPodIntoOrder(o, String(o.id)))
          );
          const withPod = withPodRaw.filter((o): o is OrderForUI => o != null);
          await cacheSet(userOrdersCacheKey(userId), withPod);
          await Promise.all(withPod.map((o) => cacheOrder(o)));
          return withPod;
        }
        const cachedOrders = (await cacheGet<OrderForUI[]>(userOrdersCacheKey(userId))) ?? [];
        const fromById = await listCachedOrdersFromByIdForSalesperson(String(userId));
        const mergedEmptyList = mergeOrdersUnique(mergeOrdersUnique(cachedOrders, fromById), localOrders);
        const withPodRaw = await Promise.all(
          mergedEmptyList.map((o) => mergeOfflinePendingPodIntoOrder(o, String(o.id)))
        );
        const withPod = withPodRaw.filter((o): o is OrderForUI => o != null);
        return withPod;
      }
      const cachedOnly = (await cacheGet<OrderForUI[]>(userOrdersCacheKey(userId))) ?? [];
      const fromByIdOnly = await listCachedOrdersFromByIdForSalesperson(String(userId));
      const mergedSsr = await Promise.all(
        mergeOrdersUnique(cachedOnly, fromByIdOnly).map((o) =>
          mergeOfflinePendingPodIntoOrder(o, String(o.id))
        )
      );
      return mergedSsr.filter((o): o is OrderForUI => o != null);
    }
    const [fullOrders, invoicesRaw] = await Promise.all([
      Promise.all(ids.map((id) => this.getOrderById(id))),
      safeGet<any>('/invoice/invoices'),
    ]);
    const invoicesList = invoicesRaw != null ? normalizeInvoiceList(invoicesRaw) : [];
    let orders = fullOrders.filter((o): o is OrderForUI => o != null);
    const uid = String(userId);
    orders = orders.filter((o) => {
      const sid = o.salespersonId ?? (o as any).salespersonId;
      if (sid != null && sid !== '') return String(sid) === uid;
      return true;
    });
    const byOrderId = new Map<string, { inv: any; invId: string | number }>();
    (invoicesList as any[]).forEach((x: any) => {
      const inv = unwrapInvoiceItem(x) ?? x;
      const oid =
        inv?.orderId ?? inv?.OrderId ?? (inv as any)?.OrderID ?? inv?.order_id ?? inv?.Order_Id
        ?? inv?.order?.id ?? inv?.Order?.Id ?? inv?.order?.orderId ?? inv?.Order?.OrderId
        ?? x?.orderId ?? x?.OrderId ?? x?.order?.id ?? x?.Order?.Id;
      const invId = inv?.id ?? inv?.Id ?? inv?.invoiceId ?? inv?.InvoiceId ?? x?.id ?? x?.Id ?? x?.invoiceId ?? x?.InvoiceId;
      if (oid != null && oid !== '' && invId != null && invId !== '') {
        const oidStr = String(oid).trim();
        byOrderId.set(oidStr, { inv, invId });
        byOrderId.set(oidStr.toLowerCase(), { inv, invId });
        const oidNum = Number(oid);
        if (!Number.isNaN(oidNum)) byOrderId.set(String(oidNum), { inv, invId });
      }
    });
    const sumFromDetails = (inv: any): number => {
      const arr = normalizeDetailList(inv);
      return arr.reduce((s: number, d: any) => s + Number(d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.total ?? d?.Total ?? 0), 0);
    };

    let result = orders.map((o) => {
      const match = byOrderId.get(String(o.id).trim())
        ?? byOrderId.get(String(o.backendOrderId ?? '').trim())
        ?? byOrderId.get(String(o.id).toLowerCase())
        ?? byOrderId.get(String(o.backendOrderId ?? '').toLowerCase());
      let next = o;
      if (match) {
        const invId = match.invId;
        const inv = match.inv;
        if (
          (next.status || '').toLowerCase() !== 'initial' &&
          (next.invoiceId == null || next.invoiceId === '')
        ) {
          next = { ...next, invoiceId: invId };
        }
        const invHasPod = invoiceHasPodEvidence(inv);
        // No pisar POD ya resuelto (p. ej. cola offline en getOrderById / data URL local).
        next = { ...next, podUploaded: invHasPod || !!next.podUploaded };
        const invNoHuman =
          inv?.invoiceNumber ??
          inv?.InvoiceNumber ??
          unwrapInvoiceResponse(inv)?.invoiceNumber ??
          unwrapInvoiceResponse(inv)?.InvoiceNumber;
        if (invNoHuman != null && String(invNoHuman).trim() !== '') {
          next = { ...next, invoiceNumber: String(invNoHuman).trim() };
        }
        if (invHasPod) {
        const podFromInv = getPodFromInvoice(inv);
          next = { ...next, podImageUrl: next.podImageUrl || podFromInv, podFileName: next.podFileName || podFromInv };
        }
        if (Number(next.total) <= 0) {
          let invTotal = Number(inv?.total ?? inv?.Total ?? inv?.amount ?? inv?.Amount ?? inv?.totalAmount ?? inv?.TotalAmount ?? inv?.grandTotal ?? inv?.GrandTotal ?? 0);
          if (invTotal <= 0) invTotal = sumFromDetails(inv);
          if (invTotal > 0) next = { ...next, total: invTotal, subtotal: next.subtotal || invTotal };
        }
        if (Number(next.total) > 0) return next;
      }
      const inv = match?.inv ?? byOrderId.get(String(o.id).trim())?.inv ?? byOrderId.get(String(o.backendOrderId ?? '').trim())?.inv;
      if (inv == null) return next;
      let invTotal = Number(
        inv?.total ?? inv?.Total ?? inv?.amount ?? inv?.Amount ?? inv?.totalAmount ?? inv?.TotalAmount ?? inv?.grandTotal ?? inv?.GrandTotal ?? 0
      );
      if (invTotal <= 0) invTotal = sumFromDetails(inv);
      if (invTotal > 0) return { ...next, total: invTotal, subtotal: next.subtotal || invTotal };
      return next;
    });
    for (let i = 0; i < result.length; i++) {
      if (Number(result[i].total) <= 0) {
        const fallback = await this.getInvoiceTotalForOrder(result[i].id) ?? await this.getInvoiceTotalForOrder(String(result[i].backendOrderId ?? ''));
        if (fallback > 0) result[i] = { ...result[i], total: fallback, subtotal: result[i].subtotal || fallback };
      }
    }
    // Pedidos con factura pero sin POD en la lista: traer POD desde GET factura (la factura devuelve orderId y pod)
    const conFacturaSinPod = result
      .map((o, idx) => (o.invoiceId && !o.podUploaded ? idx : -1))
      .filter((i) => i >= 0);
    if (conFacturaSinPod.length > 0) {
      await Promise.all(
        conFacturaSinPod.map(async (idx) => {
          const invRaw = await getInvoiceById(String(result[idx].invoiceId!));
          if (invoiceHasPodEvidence(invRaw)) {
          const pod = getPodFromInvoice(invRaw);
            result[idx] = { ...result[idx], podImageUrl: pod, podFileName: pod, podUploaded: true };
          } else if (invRaw != null) {
            result[idx] = { ...result[idx], podUploaded: false };
          }
          // invRaw == null (offline): no tocar; mergeOfflinePendingPodIntoOrder después aplica POD en cola.
        })
      );
    }
    result = await Promise.all(result.map((o) => mergeOfflinePendingPodIntoOrder(o, String(o.id))));
    result = await applyCancellationOverridesFromCache(result);
    if (typeof window !== 'undefined') {
      const db = await getOfflineDbIfBrowser();
      const localDrafts = db
        ? await db.localOrders.where('userId').equals(String(userId)).toArray()
        : [];
      const prevList = (await cacheGet<OrderForUI[]>(userOrdersCacheKey(userId))) ?? [];
      // Con listado servidor válido, evitar reintroducir basura desde cache previa.
      let mergedList = online && serverListOk ? [...result] : mergeOrdersUnique(result, prevList);
      if (localDrafts.length) {
        const localById = new Map(localDrafts.map((d) => [String(d.id), d.data as OrderForUI]));
        const merged = [...mergedList];
        for (const l of localById.values()) {
          const lid = String(l.id ?? '').trim();
          const lBackend = String(l.backendOrderId ?? '').trim();
          const map = db ? await db.idMap.get(`order:${lid}`) : null;
          const mappedRemote = String(map?.value ?? '').trim();
          const hasRemoteTwin = merged.some((o) => {
            const oid = String(o.id ?? '').trim();
            const oBackend = String(o.backendOrderId ?? '').trim();
            return (
              (lid && (oid === lid || oBackend === lid)) ||
              (lBackend && (oid === lBackend || oBackend === lBackend)) ||
              (mappedRemote && (oid === mappedRemote || oBackend === mappedRemote))
            );
          });
          if (!hasRemoteTwin) merged.unshift(l);
        }
        mergedList = merged;
      }
      await cacheSet(userOrdersCacheKey(userId), mergedList);
      await Promise.all(mergedList.map((o) => cacheOrder(o)));
      return await Promise.all(mergedList.map((o) => mergeOfflinePendingPodIntoOrder(o, String(o.id))));
    }
    return result;
  },

  /**
   * Indica si un código PO ya está en uso por otro pedido (para validación antes de crear/editar).
   * Si se pasa excludeOrderId, ese pedido se ignora (edición: el mismo PO del mismo pedido está permitido).
   */
  async isPoAlreadyUsed(
    po: string,
    options?: { excludeOrderId?: string; userId?: string }
  ): Promise<boolean> {
    const poNorm = (po ?? '').trim().toLowerCase();
    if (!poNorm) return false;
    const userId = options?.userId;
    if (!userId) return false;
    const orders = await this.getOrdersByUser(userId);
    const excludeId = options?.excludeOrderId ? String(options.excludeOrderId).trim() : '';
    const found = orders.some((o) => {
      const oid = String(o.id ?? o.backendOrderId ?? '').trim();
      if (excludeId && oid === excludeId) return false;
      const opo = (o.po ?? '').trim().toLowerCase();
      return opo === poNorm;
    });
    return found;
  },

  /**
   * Obtiene un pedido por id. GET /orders/orders/{id}
   */
  async getOrderById(orderId: string): Promise<OrderForUI | null> {
    const withPendingPod = (o: OrderForUI | null) => mergeOfflinePendingPodIntoOrder(o, orderId);
    if (typeof window !== 'undefined') {
      const db = await getOfflineDbIfBrowser();
      const local = db ? await db.localOrders.get(String(orderId)) : null;
      const mappedRemoteId = db ? await db.idMap.get(`order:${String(orderId)}`) : null;
      const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
      // Borrador offline sin id real: el servidor no tiene este GET; no intentar red ni borrarlo como “404”.
      if (local?.data && isTempLocalOrderId(orderId) && !mappedRemoteId?.value) {
        return await withPendingPod(local.data as OrderForUI);
      }
      if (local?.data && !browserOnline) return await withPendingPod(local.data as OrderForUI);
      const resolvedCache = await resolveOrderFromOfflineCaches(orderId);
      if (resolvedCache && typeof navigator !== 'undefined' && !navigator.onLine) {
        return await withPendingPod(resolvedCache);
      }
      if (mappedRemoteId?.value) {
        const mappedId = String(mappedRemoteId.value).trim();
        const cachedMapped = await resolveOrderFromOfflineCaches(mappedId);
        if (cachedMapped && typeof navigator !== 'undefined' && !navigator.onLine) {
          return await withPendingPod(cachedMapped);
        }
        const mappedRaw = await safeGet<any>(`/orders/orders/${encodeURIComponent(mappedId)}`);
        if (mappedRaw) {
          const mappedOrderRaw =
            mappedRaw?.data ?? mappedRaw?.order ?? mappedRaw?.Order ?? mappedRaw?.value ?? mappedRaw?.result ?? mappedRaw;
          let mappedDetails = extractOrderDetailsFromOrderPayload(mappedRaw);
          if (!mappedDetails.length) mappedDetails = extractOrderDetailsFromOrderPayload(mappedOrderRaw);
          const mappedScanned = findBestInvoiceDetailsArray(mappedRaw);
          if (mappedScanned.length > mappedDetails.length) mappedDetails = mappedScanned;
          const mappedResult = mapRawOrderToUI(mappedOrderRaw, mappedDetails);
          if (mappedResult?.items?.length) {
            mappedResult.items = await enrichOrderItemsWithProductNames(mappedResult.items);
          }
          const mappedWithOrigin = await mergeCachedOrderOriginOntoResult(mappedResult, [
            orderId,
            String(mappedResult.id),
            String(mappedResult.backendOrderId ?? ''),
            mappedId,
          ]);
          await cacheOrder(mappedWithOrigin);
          return await withPendingPod(mappedWithOrigin);
        }
        if (!mappedRaw && cachedMapped && !browserOnline) {
          return await withPendingPod(cachedMapped);
        }
      }
    }
    let raw: any = null;
    let orderFetchStatus = 0;
    try {
      raw = await apiClient.get<any>(`/orders/orders/${encodeURIComponent(orderId)}`);
    } catch (e) {
      orderFetchStatus = Number((e as ApiError)?.status ?? 0);
      raw = null;
    }
    if (!raw) {
      if (typeof window !== 'undefined') {
        const db = await getOfflineDbIfBrowser();
        if (db) {
          const localRow = await db.localOrders.get(String(orderId));
          const mapped = await db.idMap.get(`order:${String(orderId)}`);
          if (localRow?.data && isTempLocalOrderId(orderId) && !mapped?.value) {
            return await withPendingPod(localRow.data as OrderForUI);
          }
        }
        if (browserReportsOnline() && orderFetchStatus === 404) {
          await purgeOrderFromOfflineClient(String(orderId));
          return null;
        }
        const fallback = await resolveOrderFromOfflineCaches(orderId);
        if (fallback) return await withPendingPod(fallback);
      }
      return null;
    }
    const orderRaw = raw?.data ?? raw?.order ?? raw?.Order ?? raw?.value ?? raw?.result ?? raw;
    let details = extractOrderDetailsFromOrderPayload(raw);
    if (!details.length) details = extractOrderDetailsFromOrderPayload(orderRaw);
    const scannedLines = findBestInvoiceDetailsArray(raw);
    if (scannedLines.length > details.length) details = scannedLines;
    const backendId = orderRaw?.orderId ?? orderRaw?.OrderId ?? orderRaw?.id ?? orderRaw?.Id ?? raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? orderId;
    if (!details.length && backendId !== orderId) {
      const altDetails = await this.getOrderDetailsByOrderIdRaw(String(backendId));
      if (altDetails?.length) details = altDetails;
    }
    const result = mapRawOrderToUI(orderRaw, details);
    if (result?.items?.length) {
      result.items = await enrichOrderItemsWithProductNames(result.items);
    }
    // POD desde factura anidada en la respuesta del pedido (si el backend la incluye)
    const nestedInv = orderRaw?.invoice ?? orderRaw?.Invoice ?? orderRaw?.InvoiceData ?? raw?.invoice ?? raw?.Invoice ?? raw?.InvoiceData;
    if (nestedInv && typeof nestedInv === 'object') {
      result.podUploaded = invoiceHasPodEvidence(nestedInv);
      const podText = getPodFromInvoice(nestedInv);
      if (podText) {
        result.podImageUrl = result.podImageUrl || podText;
        result.podFileName = result.podFileName || podText;
      }
      if ((result.invoiceId == null || result.invoiceId === '') && (nestedInv?.id ?? nestedInv?.Id ?? nestedInv?.invoiceId ?? nestedInv?.InvoiceId)) {
        result.invoiceId = nestedInv?.id ?? nestedInv?.Id ?? nestedInv?.invoiceId ?? nestedInv?.InvoiceId;
      }
    }
    // Asegurar invoiceId solo cuando no sea initial.
    if (result && (result.status || '').toLowerCase() !== 'initial' && (result.invoiceId == null || result.invoiceId === '')) {
      const fromRaw =
        raw?.invoiceId ?? raw?.InvoiceId ?? raw?.Invoice_ID ?? raw?.invoice_id
        ?? raw?.data?.invoiceId ?? raw?.data?.InvoiceId ?? raw?.data?.Invoice_ID
        ?? raw?.Data?.InvoiceId ?? raw?.Data?.invoiceId ?? raw?.Order?.InvoiceId ?? raw?.order?.invoiceId
        ?? orderRaw?.invoiceId ?? orderRaw?.InvoiceId ?? orderRaw?.Invoice_ID ?? orderRaw?.invoice_id
        ?? orderRaw?.invoice?.id ?? orderRaw?.Invoice?.Id ?? orderRaw?.invoice?.invoiceId ?? orderRaw?.Invoice?.invoiceId
        ?? orderRaw?.Invoice?.Id ?? orderRaw?.invoice?.Id;
      if (fromRaw != null && fromRaw !== '') {
        result.invoiceId = fromRaw;
      } else {
        const invId = await this.getInvoiceIdForOrder(orderId) ?? await this.getInvoiceIdForOrder(String(backendId));
        if (invId != null) result.invoiceId = invId;
      }
    }
    // Traer POD desde la factura (igual que Sistema Web Admin: GET factura por id, luego getInvoiceForOrder si hace falta).
    let invForPod: any = null;
    if (result?.invoiceId) {
      invForPod = await getInvoiceById(String(result.invoiceId));
    }
    if (!invForPod && result) {
      invForPod = await this.getInvoiceForOrder(orderId);
    }
    if (invForPod) {
      result.podUploaded = invoiceHasPodEvidence(invForPod);
      const podText = getPodFromInvoice(invForPod);
      if (podText) {
        result.podImageUrl = result.podImageUrl || podText;
        result.podFileName = result.podFileName || podText;
      }
      const invRoot = unwrapInvoiceResponse(invForPod);
      const invSt = invRoot?.status ?? invRoot?.Status;
      const invLooksInvoiced =
        invRoot?.isInvoiced === true ||
        invRoot?.IsInvoiced === true ||
        invSt === ORDER_STATUS_CODE.invoiced ||
        invSt === String(ORDER_STATUS_CODE.invoiced) ||
        String(invSt ?? '').trim() === String(ORDER_STATUS_CODE.invoiced) ||
        String(invSt ?? '').toLowerCase() === 'invoiced';
      if (
        (result.status === 'initial' || result.status === 'confirmed') &&
        (podText || (invRoot && invLooksInvoiced))
      ) {
        result.status = 'invoiced';
      }
    }
    if (typeof window !== 'undefined' && result) {
      const resultWithOrigin = await mergeCachedOrderOriginOntoResult(result, [
        orderId,
        String(result.id),
        String(result.backendOrderId ?? ''),
        String(backendId ?? ''),
      ]);
      await cacheOrder(resultWithOrigin);
      return await withPendingPod(resultWithOrigin);
    }
    return await withPendingPod(result);
  },

  /**
   * Detalles de un pedido desde el propio endpoint de orden por Id.
   * Acepta array u objeto con orderDetails/details/data/items.
   */
  async getOrderDetailsByOrderIdRaw(orderId: string): Promise<any[]> {
    const list = await safeGet<any>(`/orders/orders/${encodeURIComponent(orderId)}`);
    if (list == null) return [];
    return extractOrderDetailsFromOrderPayload(list);
  },
};

