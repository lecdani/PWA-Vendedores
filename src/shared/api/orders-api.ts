import { apiClient, ApiError, API_BASE_URL } from './api-client';
import { histpricesApi } from './histprices-api';
import { productsApi } from './products-api';

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
    console.error(`[orders-api] GET ${endpoint} failed:`, err.message || err);
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

/** Extrae cantidad de un registro de detalle (diversos nombres del backend). */
function detailQuantity(d: any): number {
  const n = Number(
    d?.quantity ??
      d?.Quantity ??
      d?.qty ??
      d?.Qty ??
      d?.invoiceQty ??
      d?.InvoiceQty ??
      d?.deliveredQuantity ??
      d?.DeliveredQuantity ??
      d?.deliveredQty ??
      d?.DeliveredQty ??
      d?.units ??
      d?.Units ??
      d?.pcs ??
      d?.Pcs ??
      d?.lineQuantity ??
      d?.LineQuantity ??
      d?.orderQuantity ??
      d?.OrderQuantity ??
      d?.count ??
      d?.Count ??
      d?.toOrder ??
      d?.ToOrder ??
      0
  );
  if (Number.isFinite(n) && n > 0) return n;
  /** Algunos backends solo envían subtotal + precio unitario */
  const sub = Number(
    d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.amount ?? d?.Amount ?? d?.lineTotal ?? d?.LineTotal ?? 0
  );
  const up = Number(d?.unitPrice ?? d?.UnitPrice ?? d?.price ?? d?.Price ?? d?.unit_price ?? 0);
  if (sub > 0 && up > 0) {
    const q = sub / up;
    if (Number.isFinite(q) && q > 0) return Math.round(q * 1000) / 1000;
  }
  return 0;
}

/** Extrae subtotal/importe de un registro de detalle (diversos nombres del backend). */
function detailSubtotal(d: any): number {
  const n = Number(
    d?.subtotal ??
      d?.Subtotal ??
      d?.SubTotal ??
      d?.lineTotal ??
      d?.LineTotal ??
      d?.amount ??
      d?.Amount ??
      d?.total ??
      d?.Total ??
      d?.price ??
      d?.Price ??
      0
  );
  if (Number.isFinite(n) && n > 0) return n;
  const qty = detailQuantity(d);
  const up = Number(d?.unitPrice ?? d?.UnitPrice ?? 0);
  if (qty > 0 && up > 0) return qty * up;
  return Number.isFinite(n) ? n : 0;
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
    if (node.length > 0 && isLineLikeRecord(node[0])) return node;
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
  if (Array.isArray(payload)) return payload.length > 0 && isLineLikeRecord(payload[0]) ? payload : [];
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
  if (Array.isArray(extracted) && extracted.length > 0 && isLineLikeRecord(extracted[0])) return extracted;
  return deepFindLongestLineItemArray(payload, 0, 8);
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
  /** Id del vendedor asignado al pedido. */
  salespersonId?: string;
  /** Código PO (Purchase Order), único. */
  po?: string;
   /** ID del planograma asociado al pedido (tabla orders.planogram_id). */
  planogramId?: string;
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
 * eternal-api `UpdateStatusCommand`: `Guid OrderId`, `OrderStatus NewStatus` (Created=1, Invoiced=2, Canceled=3).
 * System.Text.Json por defecto usa camelCase en JSON → `orderId`, `newStatus`.
 * Si `NewStatus` llega 0, suele ser: casing distinto, o enum como string (`JsonStringEnumConverter`).
 * Probamos varias formas en secuencia hasta que una responda OK.
 */
function orderStatusEnumName(code: 1 | 2 | 3): 'Created' | 'Invoiced' | 'Canceled' {
  if (code === 1) return 'Created';
  if (code === 2) return 'Invoiced';
  return 'Canceled'; // C# enum: Canceled (una L)
}

async function putOrderStatusUntilOk(orderId: string, statusCode: 1 | 2 | 3): Promise<boolean> {
  const id = String(orderId).trim();
  if (!id) return false;
  const n = Number(statusCode);
  if (!Number.isInteger(n) || n < 1 || n > 3) return false;
  const name = orderStatusEnumName(statusCode);
  const path = `/orders/order/${encodeURIComponent(id)}/status`;

  const candidates = [
    JSON.stringify({ orderId: id, newStatus: n }),
    JSON.stringify({ OrderId: id, NewStatus: n }),
    JSON.stringify({ orderId: id, newStatus: name }),
    JSON.stringify({ OrderId: id, NewStatus: name }),
  ];

  for (const payload of candidates) {
    const res = await safePut<any>(path, payload);
    if (res !== null) return true;
  }
  return false;
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
    const subtotalRow = Number(d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? 0);
    const unitPrice =
      Number(d?.unitPrice ?? d?.UnitPrice ?? d?.price ?? d?.Price ?? d?.product?.unitPrice ?? d?.Product?.UnitPrice ?? 0) ||
      (qty > 0 && subtotalRow > 0 ? subtotalRow / qty : 0);
    return {
      productId: String(d?.productId ?? d?.ProductId ?? ''),
      productName: String(d?.productName ?? d?.ProductName ?? d?.product?.name ?? d?.Product?.Name ?? d?.description ?? d?.Description ?? d?.name ?? d?.Name ?? '').trim(),
      sku: String(d?.sku ?? d?.Sku ?? d?.product?.sku ?? d?.Product?.Sku ?? ''),
      toOrder: qty,
      quantity: qty,
      price: unitPrice,
      row: d?.row ?? d?.Row,
      col: d?.col ?? d?.Col ?? d?.column ?? d?.Column,
    };
  });
  const rawTotal =
    raw?.total ?? raw?.Total ?? raw?.orderTotal ?? raw?.OrderTotal ?? raw?.amount ?? raw?.Amount
    ?? raw?.invoice?.total ?? raw?.Invoice?.Total ?? raw?.invoice?.amount ?? raw?.Invoice?.Amount;
  let total = Number(rawTotal ?? 0);
  let subtotal = Number(raw?.subtotal ?? raw?.Subtotal ?? raw?.SubTotal ?? total);
  const tax = Number(raw?.tax ?? raw?.Tax ?? 0);
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
  };
}

export const ordersApi = {
  /**
   * Crea un pedido con Unit of Work (header + detalles en un solo POST /orders/orders).
   * Devuelve el id del pedido creado en backend (orderId) si se pudo obtener.
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrderResult | null> {
    // Unit of Work: crear cabecera + detalles en un solo request
    const generatedOrderId = generateUuidV4();
    const poTrimmed = (input.po ?? '').trim();
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
    if (poTrimmed) {
      payload.po = poTrimmed;
      payload.Po = poTrimmed;
    }
    if ((input.planogramId ?? '').trim()) {
      const pid = String(input.planogramId).trim();
      payload.planogramId = pid;
      payload.PlanogramId = pid;
      payload.planogram_id = pid;
      payload.PLANOGRAM_ID = pid;
    }

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

    return { orderId: createdOrderId, invoiceId };
  },

  /**
   * Factura en BD solo cuando va COMPLETA (Unit of Work): cabecera + ítems + POD en un solo POST.
   * - Con `podFileName`: POST /invoice/invoices una vez con todo (no antes, no sin POD).
   * - Sin `podFileName`: no crea nada; solo devuelve id si ya existe factura para el pedido (lectura).
   */
  async ensureInvoiceForOrder(
    orderId: string | number,
    deliveredItems?: DeliveredItemInput[],
    options?: { podFileName?: string; notes?: string }
  ): Promise<string | number | null> {
    const orderIdStr = String(orderId).trim();
    if (!orderIdStr) return null;

    const podFileName = String(options?.podFileName ?? '').trim();
    const withPod = !!podFileName;

    const existingRaw = await this.getInvoiceIdForOrder(orderIdStr);
    const existingStr =
      existingRaw != null && String(existingRaw).trim() !== '' ? String(existingRaw).trim() : '';

    /** Nunca persistir factura incompleta: sin POD no hay POST. */
    if (!withPod) {
      return existingStr ? existingRaw : null;
    }

    if (existingStr) {
      const inv = await getInvoiceById(existingStr);
      if (inv && getPodFromInvoice(inv)) return existingRaw;
    }

    const order = await this.getOrderById(orderIdStr);
    if (!order) return null;

    /** Id de factura: nuevo UUID o reintento con registro huérfano (sin POD) listado por orderId. */
    const invoiceGuid =
      existingStr ? existingStr : generateUuidV4();

    const mappedItems =
      Array.isArray(deliveredItems) && deliveredItems.length > 0
        ? deliveredItems.map((it) => {
            const invoiceDetailId = generateUuidV4();
            const qty = Number(it.quantity) || 0;
            const price = Number(it.unitPrice) || 0;
            const subtotal = qty * price;
            /** Contrato API: invoiceDetailId, invoiceId, productId, quantity, subtotal (+ PascalCase .NET). */
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

    /** Factura completa = al menos una línea + POD; si no, no tocar BD. */
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
      pod: podFileName,
      Pod: podFileName,
    };

    const n = String(options?.notes ?? '').trim();
    if (n) {
      body.notes = n;
      body.Notes = n;
    }

    const created = await safePost<any>('/invoice/invoices', body);
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
   */
  async updateOrder(orderId: string | number, input: CreateOrderInput, optionalInvoiceId?: string | number | null): Promise<{ ok: boolean; errorMessage?: string }> {
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

    const res = await safePut<any>(`/orders/orders/${encodeURIComponent(idStr)}`, body);
    if (res === null) {
      return { ok: false, errorMessage: 'No se pudo actualizar el pedido.' };
    }
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
    items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
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
        const pid = detailProductId(d);
        const orderItem = orderItemsByProduct.get(pid);
        let description =
          (detailProductName(d) || orderItem?.productName || orderItem?.sku || '').trim();
        if (!description && pid) {
          const product = await productsApi.getById(pid);
          description = (product?.name || product?.sku || '').trim();
        }
        description = description || '—';
        const code = (orderItem?.sku || (d?.sku ?? d?.Sku ?? d?.product?.sku ?? d?.Product?.Sku ?? pid)) || '—';
        if ((price === 0 || amount === 0) && pid) {
          let latestPrice = orderItem?.price ?? 0;
          if (!(latestPrice > 0)) {
            const product = await productsApi.getById(pid);
            const familyId = String(product?.familyId ?? product?.categoryId ?? '').trim();
            latestPrice = familyId ? await histpricesApi.getLatest(familyId) : 0;
          }
          price = latestPrice;
          amount = qty * price;
        }
        return { qty, code, description, price, amount };
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
   * Obsoleto: el API no expone PATCH .../pod. Usar ensureInvoiceForOrder(orderId, items, { podFileName }).
   */
  async uploadPODForInvoice(_params: {
    invoiceId: number | string;
    fileName: string;
    notes?: string;
  }): Promise<boolean> {
      return false;
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
    return putOrderStatusUntilOk(idStr, ORDER_STATUS_CODE.invoiced);
  },

  /**
   * Cancelación solicitada por el vendedor (pedido inicial sin facturar).
   * PUT /orders/order/{id}/status con estado cancelado. La eliminación física queda solo para administración.
   */
  async cancelOrderBySeller(orderId: string | number): Promise<boolean> {
    const idStr = String(orderId).trim();
    if (!idStr) return false;
    return putOrderStatusUntilOk(idStr, ORDER_STATUS_CODE.cancelled);
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
   * Lista pedidos del usuario con total real. Obtiene el listado, cada pedido completo (getOrderById)
   * y enriquece el total con el de la factura (GET /invoice/invoices) cuando el pedido no trae total.
   */
  async getOrdersByUser(userId: string): Promise<OrderForUI[]> {
    const list = await safeGet<any>(`/orders/orders/user/${encodeURIComponent(userId)}`);
    const arr = Array.isArray(list) ? list : list?.data ?? list?.Data ?? list?.items ?? list?.Items ?? list?.value ?? list?.Value ?? [];
    if (!arr.length) return [];
    const ids = (arr as any[]).map((raw: any) =>
      String(raw?.orderId ?? raw?.OrderId ?? (raw as any)?.OrderID ?? raw?.id ?? raw?.Id ?? '')
    ).filter(Boolean);
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

    const result = orders.map((o) => {
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
        const podFromInv = getPodFromInvoice(inv);
        if (podFromInv) {
          next = { ...next, podImageUrl: next.podImageUrl || podFromInv, podFileName: next.podFileName || podFromInv, podUploaded: true };
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
          const pod = getPodFromInvoice(invRaw);
          if (pod) {
            result[idx] = { ...result[idx], podImageUrl: pod, podFileName: pod, podUploaded: true };
          }
        })
      );
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
    const raw = await safeGet<any>(`/orders/orders/${encodeURIComponent(orderId)}`);
    if (!raw) return null;
    const orderRaw = raw?.data ?? raw?.order ?? raw?.Order ?? raw?.value ?? raw?.result ?? raw;
    let details = extractOrderDetailsFromOrderPayload(raw);
    if (!details.length) details = extractOrderDetailsFromOrderPayload(orderRaw);
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
      const podText = getPodFromInvoice(nestedInv);
      if (podText) {
        result.podImageUrl = result.podImageUrl || podText;
        result.podFileName = result.podFileName || podText;
        if (!result.podUploaded) result.podUploaded = true;
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
      const podText = getPodFromInvoice(invForPod);
      if (podText) {
        result.podImageUrl = result.podImageUrl || podText;
        result.podFileName = result.podFileName || podText;
        if (!result.podUploaded) result.podUploaded = true;
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
    return result;
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

