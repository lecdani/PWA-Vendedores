import { uploadImage } from '@/shared/api/images-api';
import {
  ordersApi,
  orderCacheIdsMatch,
  type CreateOrderInput,
  type DeliveredItemInput,
  type OrderForUI,
} from '@/shared/api/orders-api';
import {
  offlineDb,
  type CreateOrderPayload,
  type EnsureInvoicePayload,
  type LocalOrderDraft,
  type OfflineJob,
  type PodUploadPayload,
  type UpdateOrderPayload,
  type UpdateStatusPayload,
} from './offline-db';

const TEMP_ORDER_PREFIX = 'local-order-';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function isOnlineNow(): boolean {
  if (!isBrowser()) return true;
  return navigator.onLine;
}

function isConnectivityError(error: unknown): boolean {
  const status = Number((error as any)?.status ?? 0);
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  if (status === 0) return true;
  return (
    message.includes('error de conexión') ||
    message.includes('conexion') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('timeout')
  );
}

function shouldFallbackToOfflineQueue(error?: unknown): boolean {
  if (!isBrowser()) return false;
  if (!navigator.onLine) return true;
  if (isConnectivityError(error)) return true;
  try {
    const raw = window.sessionStorage.getItem('app_offline_hint');
    if (!raw) return false;
    const ts = Number(raw);
    if (Number.isFinite(ts) && ts > 0) {
      return Date.now() - ts < 10_000;
    }
    return raw === '1';
  } catch {
    return false;
  }
}

/**
 * Solo si el navegador reporta sin red: con conexión siempre intentar API primero.
 * (El hint `app_offline_hint` afecta a shouldFallbackToOfflineQueue tras error, no a saltar el POST/PUT inicial.)
 */
function shouldBypassOnlineMutationAttempt(): boolean {
  if (!isBrowser()) return false;
  return !navigator.onLine;
}

export function getCurrentUserIdFromStorage(): string {
  if (!isBrowser()) return '';
  try {
    const raw = window.localStorage.getItem('auth_user');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return String(parsed?.id ?? '').trim();
  } catch {
    return '';
  }
}

function tempOrderId(): string {
  return `${TEMP_ORDER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function orderForUiFromInput(localOrderId: string, input: CreateOrderInput): OrderForUI {
  const now = new Date().toISOString();
  const items = (input.items || []).map((it) => ({
    productId: String(it.productId || ''),
    productName: String(it.productName || ''),
    sku: String(it.sku || ''),
    quantity: Number(it.quantity) || 0,
    toOrder: Number(it.quantity) || 0,
    price: Number(it.price) || 0,
  }));
  const subtotal = Number(input.subtotal) || 0;
  const tax = Number(input.tax) || 0;
  const total = Number(input.total) || subtotal + tax;
  return {
    id: localOrderId,
    backendOrderId: localOrderId,
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
    salespersonId: input.salespersonId ? String(input.salespersonId) : undefined,
    po: input.po,
    planogramId: input.planogramId,
  };
}

async function enqueueJob(job: Omit<OfflineJob, 'id' | 'createdAt' | 'updatedAt' | 'attempts' | 'status'>): Promise<void> {
  const now = Date.now();
  await offlineDb.offlineJobs.add({
    ...job,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function setIdMap(localOrderId: string, remoteOrderId: string): Promise<void> {
  await offlineDb.idMap.put({
    key: `order:${localOrderId}`,
    value: String(remoteOrderId),
  });
}

/** True si aún hay un CREATE_ORDER en cola o en curso para este id local (no crear de nuevo en promote). Incluye `processing` por pestañas paralelas o sync concurrente. */
async function hasPendingCreateJobForLocalId(localId: string): Promise<boolean> {
  const lid = String(localId || '').trim();
  if (!lid) return false;
  const rows = await offlineDb.offlineJobs.where('status').anyOf('pending', 'failed', 'processing').toArray();
  return rows.some((j) => {
    if (j.type !== 'CREATE_ORDER') return false;
    const p = j.payload as CreateOrderPayload;
    return String(p.localOrderId ?? '').trim() === lid;
  });
}

/**
 * Si el pedido local aún no se ha creado en backend, aplicar la edición directamente
 * al payload del CREATE_ORDER evita depender de un UPDATE_ORDER posterior.
 */
async function updateCreateJobPayloadForLocalId(localId: string, input: CreateOrderInput): Promise<boolean> {
  const lid = String(localId || '').trim();
  if (!lid) return false;
  const rows = await offlineDb.offlineJobs.where('status').anyOf('pending', 'failed', 'processing').toArray();
  const createJobs = rows.filter((j) => {
    if (j.type !== 'CREATE_ORDER' || j.id == null) return false;
    const p = j.payload as CreateOrderPayload;
    return String(p?.localOrderId ?? '').trim() === lid;
  });
  if (createJobs.length === 0) return false;
  createJobs.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const keepRow = createJobs[0];
  const keepId = keepRow.id!;
  const keepPayload = (keepRow.payload as CreateOrderPayload) ?? ({ localOrderId: lid, input } as CreateOrderPayload);
  const basePatch = {
    payload: { ...keepPayload, localOrderId: lid, input },
    updatedAt: Date.now(),
  };
  if (keepRow.status === 'processing') {
    await offlineDb.offlineJobs.update(keepId, basePatch);
  } else {
    await offlineDb.offlineJobs.update(keepId, {
      ...basePatch,
      status: 'pending',
      error: undefined,
    });
  }
  const duplicateIds = createJobs
    .slice(1)
    .map((j) => j.id)
    .filter((id): id is number => id != null);
  if (duplicateIds.length > 0) {
    await offlineDb.offlineJobs.bulkDelete(duplicateIds);
  }
  return true;
}

async function dropPendingUpdateJobsForLocalId(localId: string): Promise<void> {
  const lid = String(localId || '').trim();
  if (!lid) return;
  const rows = await offlineDb.offlineJobs.where('status').anyOf('pending', 'failed').toArray();
  const toDelete = rows
    .filter((j) => {
      if (j.type !== 'UPDATE_ORDER' || j.id == null) return false;
      const p = j.payload as UpdateOrderPayload;
      return String(p?.orderId ?? '').trim() === lid;
    })
    .map((j) => j.id as number);
  if (toDelete.length > 0) {
    await offlineDb.offlineJobs.bulkDelete(toDelete);
  }
}

async function resolveOrderId(orderId: string): Promise<string> {
  if (!orderId.startsWith(TEMP_ORDER_PREFIX)) return orderId;
  const found = await offlineDb.idMap.get(`order:${orderId}`);
  return found?.value || orderId;
}

function createInputFromOrderSnapshot(order: OrderForUI): CreateOrderInput {
  const items = (order.items || []).map((it: any) => ({
    productId: String(it?.productId ?? ''),
    sku: String(it?.sku ?? ''),
    productName: String(it?.productName ?? ''),
    quantity: Number(it?.quantity ?? it?.toOrder ?? 0) || 0,
    price: Number(it?.price ?? 0) || 0,
  }));
  const subtotal = Number(order.subtotal ?? 0);
  const tax = Number(order.tax ?? 0);
  const total = Number(order.total ?? subtotal + tax);
  return {
    storeId: String(order.storeId ?? ''),
    storeName: order.storeName,
    storeAddress: order.storeAddress,
    salespersonId: order.salespersonId,
    salesRouteId: (order as any).salesRouteId != null ? String((order as any).salesRouteId) : undefined,
    vendorNumber: order.vendorNumber,
    items,
    subtotal,
    tax,
    total,
    po: order.po,
    planogramId: order.planogramId,
  };
}

/** Borrador local (si existe) es la fuente de verdad frente al payload del job CREATE (p. ej. edición mientras el job está en `processing`). */
async function resolveCreateInputForQueuedLocalOrder(
  localOrderId: string,
  jobPayloadInput: CreateOrderInput
): Promise<CreateOrderInput> {
  const lid = String(localOrderId || '').trim();
  if (!lid) return jobPayloadInput;
  const row = await offlineDb.localOrders.get(lid);
  if (row?.data) return createInputFromOrderSnapshot(row.data as OrderForUI);
  return jobPayloadInput;
}

/**
 * Resuelve id local → remoto vía idMap, o crea en servidor solo si NO hay job CREATE_ORDER para ese local
 * (el flujo online no hace POST pedido aquí: un único POST lo ejecuta el job CREATE_ORDER en la cola).
 */
async function promoteTempOrderToRemote(localOrderId: string, fallbackInput?: CreateOrderInput): Promise<string | null> {
  const localId = String(localOrderId || '').trim();
  if (!localId.startsWith(TEMP_ORDER_PREFIX)) return localId || null;

  const mapped = await offlineDb.idMap.get(`order:${localId}`);
  if (mapped?.value) return String(mapped.value);

  if (await hasPendingCreateJobForLocalId(localId)) {
    return null;
  }

  const draft = await offlineDb.localOrders.get(localId);
  const input =
    draft?.data != null
      ? createInputFromOrderSnapshot(draft.data as OrderForUI)
      : fallbackInput ?? null;
  if (!input) return null;

  const created = await ordersApi.createOrder(input);
  const remoteId = String(created?.orderId ?? '').trim();
  if (!remoteId) return null;
  await setIdMap(localId, remoteId);
  await offlineDb.localOrders.delete(localId);
  return remoteId;
}

let syncRunning = false;
let syncRequestTimer: number | null = null;
let lastVisibilitySyncRequestAt = 0;
const MIN_MS_BETWEEN_VISIBILITY_SYNC = 30_000;
/** Marca fin de la última corrida de cola (éxito o vacía); el intervalo de reintento no dispara antes. */
let lastOfflineQueueCompletedAt = 0;

export function getLastOfflineQueueCompletedAt(): number {
  return lastOfflineQueueCompletedAt;
}

/**
 * Encola una ejecución de la cola (debounce). Evita varias corridas seguidas por online + intervalo + visibilidad.
 */
export function requestProcessOfflineQueue(delayMs = 400): void {
  if (!isBrowser() || !isOnlineNow()) return;
  if (syncRequestTimer != null) {
    window.clearTimeout(syncRequestTimer);
    syncRequestTimer = null;
  }
  const d = Math.max(0, delayMs);
  syncRequestTimer = window.setTimeout(() => {
    syncRequestTimer = null;
    void processOfflineQueue();
  }, d);
}

function orderMatchesCancelCandidates(oid: string, bid: string, candidates: string[]): boolean {
  return candidates.some(
    (c) => orderCacheIdsMatch(oid, c) || (bid && orderCacheIdsMatch(bid, c))
  );
}

async function markOrderCancelledLocally(orderId: string): Promise<void> {
  const id = String(orderId || '').trim();
  if (!id) return;
  const resolved = await resolveOrderId(id);
  const candidates = Array.from(new Set([id, resolved].filter(Boolean)));

  for (const candidate of candidates) {
    const local = await offlineDb.localOrders.get(candidate);
    if (local?.data) {
      await offlineDb.localOrders.put({
        ...local,
        data: { ...local.data, status: 'cancelled' },
        updatedAt: Date.now(),
      });
    }
  }

  const byIdRows = await offlineDb.appCache.where('key').startsWith('orders.byId.').toArray();
  for (const row of byIdRows) {
    const v = row.value as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object') continue;
    const oid = String(v.id ?? '').trim();
    const bid = String(v.backendOrderId ?? '').trim();
    if (!orderMatchesCancelCandidates(oid, bid, candidates)) continue;
    await offlineDb.appCache.put({
      ...row,
      value: { ...v, status: 'cancelled' },
      updatedAt: Date.now(),
    });
  }

  const userCacheRows = await offlineDb.appCache.where('key').startsWith('orders.byUser.').toArray();
  for (const row of userCacheRows) {
    const list = Array.isArray(row.value) ? row.value : [];
    let changed = false;
    const next = list.map((o: any) => {
      const oid = String(o?.id ?? '').trim();
      const bid = String(o?.backendOrderId ?? '').trim();
      if (orderMatchesCancelCandidates(oid, bid, candidates)) {
        changed = true;
        return { ...o, status: 'cancelled' };
      }
      return o;
    });
    if (changed) {
      await offlineDb.appCache.put({
        ...row,
        value: next,
        updatedAt: Date.now(),
      });
    }
  }
}

async function cleanupTempOrderFollowupJobs(localOrderId: string): Promise<void> {
  const id = String(localOrderId || '').trim();
  if (!id || !id.startsWith(TEMP_ORDER_PREFIX)) return;
  const jobs = await offlineDb.offlineJobs.toArray();
  const toDelete: number[] = [];
  for (const job of jobs) {
    const jid = job.id;
    if (jid == null) continue;
    const payload: any = job.payload ?? {};
    const pOrderId = String(payload?.orderId ?? '').trim();
    const pLocalOrderId = String(payload?.localOrderId ?? '').trim();
    const sameOrder = pOrderId === id || pLocalOrderId === id;
    if (!sameOrder) continue;
    // Mantener CREATE_ORDER: al reconectar debe crearse en backend antes del resto.
    if (job.type === 'CREATE_ORDER') continue;
    if (
      job.type === 'UPDATE_ORDER' ||
      job.type === 'ENSURE_INVOICE' ||
      job.type === 'UPDATE_STATUS' ||
      job.type === 'POD_UPLOAD_FILE'
    ) {
      toDelete.push(jid);
      continue;
    }
    if (job.type === 'CANCEL_ORDER') {
      toDelete.push(jid);
    }
  }
  if (toDelete.length > 0) {
    await offlineDb.offlineJobs.bulkDelete(toDelete);
  }
}

async function hasPendingCancelJobForOrder(orderId: string): Promise<boolean> {
  const id = String(orderId || '').trim();
  if (!id) return false;
  const jobs = await offlineDb.offlineJobs.toArray();
  return jobs.some((job) => {
    if (job.type !== 'CANCEL_ORDER') return false;
    const payload: any = job.payload ?? {};
    return String(payload?.orderId ?? '').trim() === id;
  });
}

function jobReferencesOrder(job: OfflineJob, orderId: string): boolean {
  const id = String(orderId || '').trim();
  if (!id) return false;
  const payload: any = job.payload ?? {};
  const pOrderId = String(payload?.orderId ?? '').trim();
  const pLocalOrderId = String(payload?.localOrderId ?? '').trim();
  return pOrderId === id || pLocalOrderId === id;
}

async function pruneOrphanLocalOrders(): Promise<void> {
  const drafts = await offlineDb.localOrders.toArray();
  if (!drafts.length) return;
  const jobs = await offlineDb.offlineJobs.toArray();
  const toDelete: string[] = [];

  for (const draft of drafts) {
    const id = String(draft?.id ?? '').trim();
    if (!id.startsWith(TEMP_ORDER_PREFIX)) continue;
    const hasRelatedJob = jobs.some((j) => jobReferencesOrder(j, id));
    if (hasRelatedJob) continue;

    const status = String((draft?.data as any)?.status ?? '').toLowerCase();
    const map = await offlineDb.idMap.get(`order:${id}`);
    // Si ya tiene mapeo remoto, conservarlo como traza local (evita "desaparecer").
    if (map?.value) continue;
    // Conservar cancelados sin map para mostrar estado correcto en UI.
    if (status === 'cancelled') continue;
    // Sin jobs, sin map y no cancelado: realmente huérfano.
    toDelete.push(id);
  }

  if (toDelete.length > 0) {
    await offlineDb.localOrders.bulkDelete(toDelete);
  }
}

/**
 * Repara casos históricos: pedido local cancelado cuyo CREATE ya salió a backend
 * (hay idMap), pero se perdió el job CANCEL_ORDER.
 */
async function reconcileCancelledTempOrders(): Promise<void> {
  const drafts = await offlineDb.localOrders.toArray();
  for (const draft of drafts) {
    const localId = String(draft?.id ?? '').trim();
    if (!localId.startsWith(TEMP_ORDER_PREFIX)) continue;
    const status = String((draft?.data as any)?.status ?? '').toLowerCase();
    if (status !== 'cancelled') continue;
    const map = await offlineDb.idMap.get(`order:${localId}`);
    const remoteId = String(map?.value ?? '').trim();
    if (!remoteId) continue;
    const hasLocalCancel = await hasPendingCancelJobForOrder(localId);
    const hasRemoteCancel = await hasPendingCancelJobForOrder(remoteId);
    if (!hasLocalCancel && !hasRemoteCancel) {
      await enqueueJob({ type: 'CANCEL_ORDER', payload: { orderId: localId } });
    }
  }
}

async function normalizeOfflineJobsWithIdMap(): Promise<void> {
  const jobs = await offlineDb.offlineJobs.where('status').anyOf('pending', 'failed').toArray();
  if (jobs.length === 0) return;
  const createByLocal = new Set<string>();
  for (const job of jobs) {
    if (job.type !== 'CREATE_ORDER') continue;
    const p: any = job.payload ?? {};
    const localId = String(p?.localOrderId ?? '').trim();
    if (localId) createByLocal.add(localId);
  }

  for (const job of jobs) {
    const id = job.id;
    if (id == null) continue;
    const p: any = job.payload ?? {};
    const orderId = String(p?.orderId ?? '').trim();
    if (!orderId || !orderId.startsWith(TEMP_ORDER_PREFIX)) continue;
    const map = await offlineDb.idMap.get(`order:${orderId}`);
    const remoteId = String(map?.value ?? '').trim();
    if (remoteId) {
      await offlineDb.offlineJobs.update(id, {
        payload: { ...p, orderId: remoteId },
        updatedAt: Date.now(),
      });
      continue;
    }
    // Job local sin map, sin draft y sin CREATE en cola: no tiene forma de sincronizar.
    const localDraft = await offlineDb.localOrders.get(orderId);
    const hasCreateJob = createByLocal.has(orderId);
    if (!localDraft && !hasCreateJob) {
      await offlineDb.offlineJobs.delete(id);
    }
  }
}

export interface OfflineSyncSummary {
  processed: number;
  succeeded: number;
  failed: number;
  syncedOrders: number;
  syncedPods: number;
}

export async function hasPendingOfflineSync(): Promise<boolean> {
  if (!isBrowser()) return false;
  const count = await offlineDb.offlineJobs
    .where('status')
    .anyOf('pending', 'failed', 'processing')
    .count();
  return count > 0;
}

export async function processOfflineQueue(): Promise<OfflineSyncSummary | null> {
  if (syncRunning || !isBrowser() || !isOnlineNow()) return null;
  syncRunning = true;
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent('app-offline-sync', { detail: { phase: 'syncing' } }));
  }
  const summary: OfflineSyncSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    syncedOrders: 0,
    syncedPods: 0,
  };
  try {
    const uid = getCurrentUserIdFromStorage();
    if (uid) {
      const pruned = await ordersApi.reconcileOfflineWithServerUserList(uid);
      if (pruned && isBrowser()) {
        window.dispatchEvent(new CustomEvent('app-data-refresh'));
      }
    }
    await normalizeOfflineJobsWithIdMap();
    const jobs = await offlineDb.offlineJobs.where('status').anyOf('pending', 'failed').toArray();
    // CREATE_ORDER siempre primero: si otro job promovió el local con createOrder, el CREATE no debe duplicar en servidor.
    jobs.sort((a, b) => {
      const ac = a.type === 'CREATE_ORDER' ? 0 : 1;
      const bc = b.type === 'CREATE_ORDER' ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });
    for (const snapshot of jobs) {
      const id = snapshot.id;
      if (id == null) continue;
      const live = await offlineDb.offlineJobs.get(id);
      if (!live || (live.status !== 'pending' && live.status !== 'failed')) continue;
      summary.processed += 1;
      await offlineDb.offlineJobs.update(id, { status: 'processing', updatedAt: Date.now() });
      try {
        const job = live;
        if (job.type === 'CREATE_ORDER') {
          const payload = job.payload as CreateOrderPayload;
          const inputForCreate = await resolveCreateInputForQueuedLocalOrder(
            String(payload.localOrderId ?? ''),
            payload.input
          );
          const existingMap = await offlineDb.idMap.get(`order:${payload.localOrderId}`);
          let rid = String(existingMap?.value ?? '').trim();
          if (!rid) {
            const created = await ordersApi.createOrder(inputForCreate);
            rid = created?.orderId ? String(created.orderId) : '';
            if (!rid) throw new Error(created?.errorMessage || 'No se pudo crear pedido en sincronización');
            await setIdMap(payload.localOrderId, rid);
          }
          const hasFollowupCancel = jobs.some((j) => {
            if (j.id === id || j.type !== 'CANCEL_ORDER') return false;
            const p: any = j.payload ?? {};
            return String(p?.orderId ?? '').trim() === String(payload.localOrderId).trim();
          });
          if (hasFollowupCancel) {
            const local = await offlineDb.localOrders.get(payload.localOrderId);
            if (local?.data) {
              await offlineDb.localOrders.put({
                ...local,
                data: {
                  ...local.data,
                  backendOrderId: rid,
                },
                dirty: false,
                updatedAt: Date.now(),
              });
            }
          } else {
            await offlineDb.localOrders.delete(payload.localOrderId);
          }
          summary.syncedOrders += 1;
          await normalizeOfflineJobsWithIdMap();
        } else if (job.type === 'UPDATE_ORDER') {
          const payload = job.payload as UpdateOrderPayload;
          let resolved = await resolveOrderId(String(payload.orderId));
          if (resolved.startsWith(TEMP_ORDER_PREFIX)) {
            if (await hasPendingCreateJobForLocalId(resolved)) {
              throw new Error('Esperando creación del pedido en servidor; se reintentará en la siguiente sincronización.');
            }
            const promoted = await promoteTempOrderToRemote(resolved, payload.input);
            if (!promoted) throw new Error('No se pudo promover pedido local para editar');
            // createOrder ya persiste el estado de payload.input; no requiere PUT adicional.
            await offlineDb.offlineJobs.delete(id);
            summary.succeeded += 1;
            continue;
          }
          const upd = await ordersApi.updateOrder(resolved, payload.input, payload.optionalInvoiceId);
          if (!upd.ok) throw new Error(upd.errorMessage || 'No se pudo actualizar pedido');
          if (payload.orderId.startsWith(TEMP_ORDER_PREFIX)) {
            await offlineDb.localOrders.delete(payload.orderId);
          }
        } else if (job.type === 'ENSURE_INVOICE') {
          const payload = job.payload as EnsureInvoicePayload;
          let resolved = await resolveOrderId(String(payload.orderId));
          if (resolved.startsWith(TEMP_ORDER_PREFIX)) {
            if (await hasPendingCreateJobForLocalId(resolved)) {
              throw new Error('Esperando creación del pedido en servidor; se reintentará en la siguiente sincronización.');
            }
            const promoted = await promoteTempOrderToRemote(resolved);
            if (!promoted) throw new Error('No se pudo promover pedido local para facturar');
            resolved = promoted;
          }
          const inv = await ordersApi.ensureInvoiceForOrder(resolved, payload.deliveredItems, payload.options);
          if (inv == null) throw new Error('No se pudo crear/reusar factura');
        } else if (job.type === 'UPDATE_STATUS') {
          const payload = job.payload as UpdateStatusPayload;
          let resolved = await resolveOrderId(String(payload.orderId));
          if (resolved.startsWith(TEMP_ORDER_PREFIX)) {
            if (await hasPendingCreateJobForLocalId(resolved)) {
              throw new Error('Esperando creación del pedido en servidor; se reintentará en la siguiente sincronización.');
            }
            const promoted = await promoteTempOrderToRemote(resolved);
            if (!promoted) throw new Error('No se pudo promover pedido local para actualizar estado');
            resolved = promoted;
          }
          const ok = await ordersApi.updateOrderStatus(resolved, payload.isInvoiced);
          if (!ok) throw new Error('No se pudo actualizar estado');
        } else if (job.type === 'CANCEL_ORDER') {
          const payload = job.payload as { orderId: string };
          const originalId = String(payload.orderId || '').trim();
          let resolved = await resolveOrderId(String(payload.orderId));
          // Si sigue siendo local, primero promover a remoto y luego cancelar.
          if (resolved.startsWith(TEMP_ORDER_PREFIX)) {
            if (await hasPendingCreateJobForLocalId(resolved)) {
              throw new Error('Esperando creación del pedido en servidor; se reintentará en la siguiente sincronización.');
            }
            const promoted = await promoteTempOrderToRemote(resolved);
            if (!promoted) throw new Error('No se pudo promover pedido local para cancelar');
            resolved = promoted;
          }
          const ok = await ordersApi.cancelOrderBySeller(resolved);
          if (!ok) throw new Error('No se pudo cancelar pedido');
          if (originalId.startsWith(TEMP_ORDER_PREFIX)) {
            const local = await offlineDb.localOrders.get(originalId);
            if (local?.data) {
              await offlineDb.localOrders.put({
                ...local,
                data: {
                  ...local.data,
                  status: 'cancelled',
                  backendOrderId: resolved,
                },
                dirty: false,
                updatedAt: Date.now(),
              });
            }
          }
        } else if (job.type === 'POD_UPLOAD_FILE') {
          const payload = job.payload as PodUploadPayload;
          const media = await offlineDb.podMedia.get(payload.mediaId);
          if (!media) throw new Error('Archivo POD local no encontrado');
          let invoiceIdForPatch = String(payload.invoiceId ?? '').trim();
          if (invoiceIdForPatch.startsWith(QUEUED_INVOICE_PREFIX)) {
            const rid = await resolveOrderId(String(payload.orderId));
            let resolvedInv = await ordersApi.getInvoiceIdForOrder(rid);
            if (resolvedInv == null && rid.startsWith(TEMP_ORDER_PREFIX)) {
              const m = await offlineDb.idMap.get(`order:${rid}`);
              const promoted = String(m?.value ?? '').trim();
              if (promoted) resolvedInv = await ordersApi.getInvoiceIdForOrder(promoted);
            }
            if (resolvedInv == null) {
              throw new Error('Factura aún no disponible en servidor; reintenta tras sincronizar la factura.');
            }
            invoiceIdForPatch = String(resolvedInv);
          }
          const blob = await (await fetch(media.dataUrl)).blob();
          const file = new File([blob], media.fileName, { type: media.mimeType || 'image/jpeg' });
          const uploaded = await uploadImage(file);
          if (!uploaded.fileName) throw new Error('No se pudo subir imagen POD');
          const okPatch = await ordersApi.uploadPODForInvoice({
            invoiceId: invoiceIdForPatch,
            fileName: uploaded.fileName,
            notes: payload.notes,
          });
          if (!okPatch) throw new Error('No se pudo asociar POD a factura');
          const resolvedOrderId = await resolveOrderId(payload.orderId);
          const okStatus = await ordersApi.updateOrderStatus(resolvedOrderId, true);
          if (!okStatus) throw new Error('No se pudo actualizar estado tras POD');
          await offlineDb.podMedia.delete(payload.mediaId);
          summary.syncedPods += 1;
        }
        await offlineDb.offlineJobs.delete(id);
        summary.succeeded += 1;
      } catch (err: any) {
        await offlineDb.offlineJobs.update(id, {
          status: 'failed',
          attempts: (live.attempts || 0) + 1,
          error: String(err?.message || err || 'sync error'),
          updatedAt: Date.now(),
        });
        summary.failed += 1;
      }
    }
    if (isBrowser()) {
      window.dispatchEvent(
        new CustomEvent('app-offline-sync', { detail: { phase: 'done', summary } })
      );
      // Solo si hubo éxitos: evita bucle de refetch (cada GET dispara app-network-status) y reintentos fallidos cada N s.
      if (summary.succeeded > 0) {
        try {
          const uid = getCurrentUserIdFromStorage();
          if (uid) await ordersApi.refreshOrdersCacheForUser(uid);
        } catch {
          // best-effort
        }
        window.dispatchEvent(new CustomEvent('app-data-refresh'));
      }
    }
    return summary;
  } finally {
    syncRunning = false;
    lastOfflineQueueCompletedAt = Date.now();
  }
}

export function startOfflineSyncListeners(): () => void {
  if (!isBrowser()) return () => undefined;
  const handleOnline = () => {
    void pruneOrphanLocalOrders();
    void reconcileCancelledTempOrders();
    requestProcessOfflineQueue(350);
  };
  const handleVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastVisibilitySyncRequestAt < MIN_MS_BETWEEN_VISIBILITY_SYNC) return;
    lastVisibilitySyncRequestAt = now;
    requestProcessOfflineQueue(400);
  };
  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibility);
  void (async () => {
    await pruneOrphanLocalOrders();
    await reconcileCancelledTempOrders();
    const pending = await hasPendingOfflineSync();
    if (pending && isOnlineNow()) requestProcessOfflineQueue(200);
  })();
  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

export async function getLocalOrdersForUser(userId: string): Promise<OrderForUI[]> {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const rows = await offlineDb.localOrders.where('userId').equals(uid).toArray();
  return rows.map((r) => r.data);
}

export async function getLocalOrderById(orderId: string): Promise<OrderForUI | null> {
  const row = await offlineDb.localOrders.get(orderId);
  return row?.data ?? null;
}

export async function createOrderResilient(input: CreateOrderInput): Promise<{ orderId?: string | number; invoiceId?: string | number; errorMessage?: string; queued?: boolean } | null> {
  if (isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const res = await ordersApi.createOrder(input);
      if (res?.errorMessage && shouldFallbackToOfflineQueue(res.errorMessage)) {
        // continue to offline queue fallback below
      } else {
        return res;
      }
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }
  const localOrderId = tempOrderId();
  const userId = String(input.salespersonId ?? getCurrentUserIdFromStorage() ?? '').trim();
  const draft: LocalOrderDraft = {
    id: localOrderId,
    userId,
    data: orderForUiFromInput(localOrderId, input),
    dirty: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await offlineDb.localOrders.put(draft);
  await enqueueJob({ type: 'CREATE_ORDER', payload: { localOrderId, input } satisfies CreateOrderPayload });
  return { orderId: localOrderId, queued: true };
}

export async function updateOrderResilient(orderId: string | number, input: CreateOrderInput, optionalInvoiceId?: string | number | null): Promise<{ ok: boolean; errorMessage?: string; queued?: boolean }> {
  const id = String(orderId).trim();
  const isLocalTemp = id.startsWith(TEMP_ORDER_PREFIX);
  if (isLocalTemp && await hasPendingCreateJobForLocalId(id)) {
    const existing = await offlineDb.localOrders.get(id);
    const data = orderForUiFromInput(id, input);
    await offlineDb.localOrders.put({
      id,
      userId: existing?.userId || String(input.salespersonId ?? getCurrentUserIdFromStorage() ?? '').trim(),
      data: { ...data, id },
      dirty: true,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    const patchedCreate = await updateCreateJobPayloadForLocalId(id, input);
    if (patchedCreate) {
      await dropPendingUpdateJobsForLocalId(id);
    }
    if (isBrowser() && isOnlineNow()) requestProcessOfflineQueue(250);
    return { ok: true, queued: true };
  }
  if (isLocalTemp && isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const promoted = await promoteTempOrderToRemote(id, input);
      if (promoted) return { ok: true };
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }
  if (!isLocalTemp && isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const res = await ordersApi.updateOrder(id, input, optionalInvoiceId);
      if (res.ok) return { ok: true };
      if (res.queueOffline || shouldFallbackToOfflineQueue(res.errorMessage)) {
        // Sin conexión o error de red: persistir local y encolar PUT para cuando haya red.
      } else {
        return { ok: false, errorMessage: res.errorMessage };
      }
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }

  if (id.startsWith(TEMP_ORDER_PREFIX)) {
    const existing = await offlineDb.localOrders.get(id);
    const data = orderForUiFromInput(id, input);
    await offlineDb.localOrders.put({
      id,
      userId: existing?.userId || String(input.salespersonId ?? getCurrentUserIdFromStorage() ?? '').trim(),
      data: { ...data, id },
      dirty: true,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  } else {
    await ordersApi.persistEditedOrderForOffline(id, input);
  }

  await enqueueJob({ type: 'UPDATE_ORDER', payload: { orderId: id, input, optionalInvoiceId } satisfies UpdateOrderPayload });
  if (isBrowser() && isOnlineNow()) requestProcessOfflineQueue(400);
  return { ok: true, queued: true };
}

const QUEUED_INVOICE_PREFIX = 'queued-invoice-';

/** Marca el pedido en caché/local con factura pendiente de sync (para poder adjuntar POD sin red). */
async function persistQueuedInvoicePlaceholder(orderKey: string, placeholder: string): Promise<void> {
  const k = String(orderKey || '').trim();
  if (!k || typeof window === 'undefined') return;
  const byIdKey = (oid: string) => `orders.byId.${String(oid).trim()}`;

  const touchById = async (oid: string) => {
    const key = byIdKey(oid);
    const row = await offlineDb.appCache.get(key);
    if (row?.value && typeof row.value === 'object') {
      await offlineDb.appCache.put({
        ...row,
        value: { ...(row.value as object), invoiceId: placeholder },
        updatedAt: Date.now(),
      });
    }
  };

  await touchById(k);
  const map = await offlineDb.idMap.get(`order:${k}`);
  const remote = String(map?.value ?? '').trim();
  if (remote && remote !== k) await touchById(remote);

  const allLocal = await offlineDb.localOrders.toArray();
  for (const ro of allLocal) {
    const d = ro.data as Record<string, unknown> | undefined;
    if (!d) continue;
    const id = String(d.id ?? '').trim();
    const bid = String(d.backendOrderId ?? '').trim();
    const rid = String(ro.id);
    if (rid === k || id === k || bid === k) {
      await offlineDb.localOrders.put({
        ...ro,
        data: { ...d, invoiceId: placeholder },
        updatedAt: Date.now(),
      });
    }
  }

  const userRows = await offlineDb.appCache.where('key').startsWith('orders.byUser.').toArray();
  for (const ur of userRows) {
    const list = Array.isArray(ur.value) ? (ur.value as Record<string, unknown>[]) : [];
    let changed = false;
    const next = list.map((o) => {
      const oid = String(o?.id ?? '').trim();
      const ob = String(o?.backendOrderId ?? '').trim();
      if (oid === k || ob === k || (remote && (oid === remote || ob === remote))) {
        changed = true;
        return { ...o, invoiceId: placeholder };
      }
      return o;
    });
    if (changed) {
      await offlineDb.appCache.put({ ...ur, value: next, updatedAt: Date.now() });
    }
  }
}

export function isQueuedOfflineInvoiceId(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return s.startsWith(QUEUED_INVOICE_PREFIX);
}

export async function ensureInvoiceForOrderResilient(orderId: string | number, deliveredItems?: DeliveredItemInput[], options?: { podFileName?: string; notes?: string }): Promise<string | number | null> {
  let id = String(orderId).trim();
  const hasLines = Array.isArray(deliveredItems) && deliveredItems.length > 0;
  if (!hasLines) return null;

  if (id.startsWith(TEMP_ORDER_PREFIX) && isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const promoted = await promoteTempOrderToRemote(id);
      if (promoted) id = promoted;
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }

  if (isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const res = await ordersApi.ensureInvoiceForOrder(id, deliveredItems, options);
      if (res != null) return res;
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
    if (!shouldFallbackToOfflineQueue()) return null;
  }

  await enqueueJob({
    type: 'ENSURE_INVOICE',
    payload: { orderId: id, deliveredItems, options } satisfies EnsureInvoicePayload,
  });
  const placeholder = `${QUEUED_INVOICE_PREFIX}${id}`;
  await persistQueuedInvoicePlaceholder(id, placeholder);
  if (isBrowser() && isOnlineNow()) requestProcessOfflineQueue(400);
  return placeholder;
}

export async function updateOrderStatusResilient(orderId: string | number, isInvoiced = true): Promise<boolean> {
  let id = String(orderId).trim();
  if (id.startsWith(TEMP_ORDER_PREFIX) && isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const promoted = await promoteTempOrderToRemote(id);
      if (promoted) id = promoted;
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }
  if (isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    try {
      const ok = await ordersApi.updateOrderStatus(id, isInvoiced);
      if (ok || !shouldFallbackToOfflineQueue()) return ok;
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }
  await enqueueJob({
    type: 'UPDATE_STATUS',
    payload: { orderId: id, isInvoiced } satisfies UpdateStatusPayload,
  });
  return true;
}

export async function cancelOrderResilient(orderId: string | number): Promise<boolean> {
  const id = String(orderId).trim();
  if (id.startsWith(TEMP_ORDER_PREFIX)) {
    await markOrderCancelledLocally(id);
    await cleanupTempOrderFollowupJobs(id);
    await enqueueJob({ type: 'CANCEL_ORDER', payload: { orderId: id } });
    return true;
  }
  if (isOnlineNow() && !shouldBypassOnlineMutationAttempt()) {
    const CANCEL_NETWORK_DEADLINE_MS = 6000;
    try {
      const ok = await Promise.race([
        ordersApi.cancelOrderBySeller(id),
        new Promise<boolean>((_, reject) => {
          window.setTimeout(() => {
            reject({
              message: 'Tiempo de espera al cancelar',
              status: 0,
            });
          }, CANCEL_NETWORK_DEADLINE_MS);
        }),
      ]);
      if (ok || !shouldFallbackToOfflineQueue()) return ok;
    } catch (error) {
      if (!shouldFallbackToOfflineQueue(error)) throw error;
    }
  }
  await markOrderCancelledLocally(id);
  await enqueueJob({ type: 'CANCEL_ORDER', payload: { orderId: id } });
  return true;
}

export async function queuePodUploadOffline(params: {
  file: File;
  invoiceId: string | number;
  orderId: string | number;
  notes?: string;
}): Promise<boolean> {
  const mediaId = `pod-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer archivo'));
    reader.readAsDataURL(params.file);
  });
  await offlineDb.podMedia.put({
    id: mediaId,
    fileName: params.file.name || `${mediaId}.jpg`,
    mimeType: params.file.type || 'image/jpeg',
    dataUrl,
    createdAt: Date.now(),
  });
  await enqueueJob({
    type: 'POD_UPLOAD_FILE',
    payload: {
      mediaId,
      invoiceId: String(params.invoiceId),
      orderId: String(params.orderId),
      notes: params.notes,
    } satisfies PodUploadPayload,
  });
  return true;
}

