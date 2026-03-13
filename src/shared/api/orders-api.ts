import { apiClient, ApiError, API_BASE_URL } from './api-client';
import { histpricesApi } from './histprices-api';
import { productsApi } from './products-api';

// Tipos ligeros para no acoplar demasiado al backend
export interface OrderItemInput {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  price: number;
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
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development' && arr.length === 0 && list != null) {
    console.warn('[orders-api] GET /invoice/invoices devolvió datos pero la lista normalizada está vacía. Keys del response:', list && typeof list === 'object' ? Object.keys(list) : typeof list);
  }
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
  const root = inv?.data ?? inv?.invoice ?? inv?.value ?? inv?.result ?? inv;
  const v =
    root?.pod ??
    root?.Pod ??
    root?.POD ??
    root?.podUrl ??
    root?.PodUrl ??
    root?.podImageUrl ??
    root?.PodImageUrl ??
    root?.podPath ??
    root?.PodPath ??
    root?.ruta ??
    root?.Ruta ??
    root?.imagePath ??
    root?.ImagePath ??
    root?.filePath ??
    root?.FilePath ??
    root?.fileName ??
    root?.FileName ??
    root?.PodFileName ??
    root?.url ??
    root?.Url ??
    root?.link ??
    root?.Link ??
    root?.Reference ??
    root?.reference ??
    inv?.pod ??
    inv?.Pod ??
    inv?.POD ??
    inv?.podUrl ??
    inv?.PodUrl ??
    inv?.podPath ??
    inv?.podImageUrl ??
    inv?.ruta ??
    inv?.url ??
    inv?.link;
  const str = typeof v === 'string' ? v.trim() : v != null && v !== '' ? String(v).trim() : '';
  if (str) return str;
  const base64 = root?.podBase64 ?? root?.PodBase64 ?? inv?.podBase64 ?? inv?.PodBase64;
  if (typeof base64 === 'string' && base64.length > 0) return `data:image/png;base64,${base64}`;
  return '';
}

/** Extrae cantidad de un registro de detalle (diversos nombres del backend). */
function detailQuantity(d: any): number {
  const n = Number(d?.quantity ?? d?.Quantity ?? d?.qty ?? d?.Qty ?? d?.amount ?? d?.Amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Extrae subtotal/importe de un registro de detalle (diversos nombres del backend). */
function detailSubtotal(d: any): number {
  const n = Number(d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.amount ?? d?.Amount ?? d?.total ?? d?.Total ?? d?.price ?? d?.Price ?? 0);
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

/** Normaliza lista de detalles desde respuesta de API (array o objeto con data/items/details/invoiceDetails). */
function normalizeDetailList(raw: any): any[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  const arr = raw?.invoiceDetails ?? raw?.InvoiceDetails ?? raw?.details ?? raw?.Details ?? raw?.items ?? raw?.Items ?? raw?.data ?? raw?.Data ?? [];
  return Array.isArray(arr) ? arr : [];
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
        ? { name: product.name || '', sku: product.sku || '' }
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
}

/** Solo hay 2 estados: pending o invoiced. La BD puede enviar "pending"/"invoiced" o true/false (isInvoiced). Acepta respuesta envuelta (data/order). */
function normalizeOrderStatus(raw: any): 'pending' | 'invoiced' {
  const inner = raw?.data ?? raw?.order ?? raw?.Order ?? raw?.value ?? raw?.result ?? raw;
  const v =
    inner?.status ?? inner?.Status ?? inner?.isInvoiced ?? inner?.IsInvoiced
    ?? inner?.orderStatus ?? inner?.OrderStatus ?? inner?.state ?? inner?.State
    ?? inner?.invoiceStatus ?? inner?.InvoiceStatus ?? inner?.order_state
    ?? raw?.status ?? raw?.Status ?? raw?.isInvoiced ?? raw?.IsInvoiced
    ?? raw?.orderStatus ?? raw?.OrderStatus ?? raw?.state ?? raw?.State;
  if (v === true) return 'invoiced';
  if (v === false) return 'pending';
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'invoiced' || s === 'facturado' || s === 'completed' || s === 'delivered' || s === '1') return 'invoiced';
  return 'pending';
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
    const qty = Number(d?.quantity ?? d?.Quantity ?? 0);
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
   * Crea un pedido en la API (header + detalles) usando los endpoints:
   * - POST /orders/orders
   * - POST /orderdetails/orderdetails
   *
   * Devuelve el id del pedido creado en backend (orderId) si se pudo obtener.
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrderResult | null> {
    // 1) Crear header de pedido (el backend espera PO como varchar, único)
    const poTrimmed = (input.po ?? '').trim();
    const headerBody: Record<string, unknown> = {
      storeId: input.storeId,
      StoreId: input.storeId,
      salespersonId: input.salespersonId,
      SalespersonId: input.salespersonId,
      vendorNumber: input.vendorNumber,
      VendorNumber: input.vendorNumber,
      status: 'pending',
      Status: 'pending',
      createdAt: new Date().toISOString(),
      CreatedAt: new Date().toISOString(),
      subtotal: input.subtotal,
      Subtotal: input.subtotal,
      tax: input.tax,
      Tax: input.tax,
      total: input.total,
      Total: input.total,
    };
    if (poTrimmed) {
      headerBody.po = poTrimmed;
      headerBody.Po = poTrimmed;
    }
  if ((input.planogramId ?? '').trim()) {
    const pid = String(input.planogramId).trim();
    headerBody.planogramId = pid;
    headerBody.PlanogramId = pid;
    headerBody.planogram_id = pid;
    headerBody.PLANOGRAM_ID = pid;
  }

    let createdOrder: any;
    try {
      createdOrder = await apiClient.post<any>('/orders/orders', headerBody);
    } catch (error) {
      const err = error as ApiError;
      return { errorMessage: err.message || 'Error al crear el pedido' };
    }

    let orderId: string | number | null = null;
    if (typeof createdOrder === 'string' && createdOrder.trim().length > 0) {
      orderId = createdOrder.trim();
    } else if (typeof createdOrder === 'object') {
      orderId =
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

    if (orderId == null || orderId === '') {
      console.warn('[orders-api] createOrder: respuesta sin orderId.', createdOrder);
      return { errorMessage: 'El servidor no devolvió el ID del pedido.' };
    }

    // 2) Crear detalles de pedido
    for (const item of input.items) {
      const detailBody = {
        orderId,
        OrderId: orderId,
        productId: item.productId,
        ProductId: item.productId,
        quantity: item.quantity,
        Quantity: item.quantity,
        unitPrice: item.price,
        UnitPrice: item.price,
        subtotal: item.quantity * item.price,
        Subtotal: item.quantity * item.price,
      };
      await safePost<any>('/orderdetails/orderdetails', detailBody);
    }

    // 3) Crear factura: POST /invoice/invoices enviando el id del pedido para vincular factura ↔ pedido
    let invoiceId: number | string | undefined;
    const invoiceBody = {
      orderId,
      OrderId: orderId,
      storeId: input.storeId,
      StoreId: input.storeId,
      total: input.total,
      Total: input.total,
      subtotal: input.subtotal,
      Subtotal: input.subtotal,
      tax: input.tax,
      Tax: input.tax,
      createdAt: new Date().toISOString(),
      CreatedAt: new Date().toISOString(),
    };
    const invoiceRes = await safePost<any>('/invoice/invoices', invoiceBody);
    if (invoiceRes != null) {
      if (typeof invoiceRes === 'string' && invoiceRes.trim()) {
        invoiceId = invoiceRes.trim();
      } else {
        const r = invoiceRes as any;
        invoiceId =
          r?.invoiceId ?? r?.InvoiceId ?? r?.id ?? r?.Id
          ?? r?.data?.invoiceId ?? r?.data?.InvoiceId ?? r?.data?.id ?? r?.data?.Id
          ?? r?.value?.invoiceId ?? r?.value?.id ?? r?.value?.Id
          ?? undefined;
      }
      if (invoiceId && input.items.length > 0) {
        for (const item of input.items) {
          const lineSubtotal = item.quantity * item.price;
          const detailBody = {
            invoiceId: String(invoiceId),
            InvoiceId: String(invoiceId),
            productId: String(item.productId),
            ProductId: String(item.productId),
            quantity: Number(item.quantity) || 0,
            Quantity: Number(item.quantity) || 0,
            subtotal: lineSubtotal,
            Subtotal: lineSubtotal,
          };
          const postDetail = await safePost<any>('/invoicedetails/invoicedetails', detailBody);
          if (postDetail === null) {
            console.error('[orders-api] POST invoicedetails falló para productId', item.productId);
          }
        }
      }
    }

    return { orderId, invoiceId };
  },

  /**
   * Actualiza un pedido existente (solo si está pendiente).
   * PUT /orders/order/{id}, PUT/POST/DELETE orderdetails, PUT invoice, PUT invoicedetails.
   * optionalInvoiceId: si el backend no devuelve invoiceId en el pedido, pasar el id de la factura (p. ej. desde getInvoiceIdForOrder).
   */
  async updateOrder(orderId: string | number, input: CreateOrderInput, optionalInvoiceId?: string | number | null): Promise<{ ok: boolean; errorMessage?: string }> {
    const id = String(orderId);
    const existingOrder = await safeGet<any>(`/orders/orders/${encodeURIComponent(id)}`);
    let salespersonId = input.salespersonId;
    if (!salespersonId && existingOrder) {
      salespersonId = existingOrder.salespersonId ?? existingOrder.SalespersonId ?? existingOrder.userId ?? existingOrder.UserId;
      if (salespersonId != null) salespersonId = String(salespersonId);
    }
    const headerBody: Record<string, unknown> = {
      storeId: input.storeId,
      StoreId: input.storeId,
      status: 'pending',
      Status: 'pending',
      subtotal: input.subtotal,
      Subtotal: input.subtotal,
      tax: input.tax,
      Tax: input.tax,
      total: input.total,
      Total: input.total,
    };
    if (salespersonId) {
      headerBody.salespersonId = salespersonId;
      headerBody.SalespersonId = salespersonId;
    }
    const poTrimmed = (input.po ?? '').trim();
    if (poTrimmed) {
      headerBody.po = poTrimmed;
      headerBody.Po = poTrimmed;
    }
    if ((input.planogramId ?? '').trim()) {
      const pid = String(input.planogramId).trim();
      headerBody.planogramId = pid;
      headerBody.PlanogramId = pid;
      headerBody.planogram_id = pid;
      headerBody.PLANOGRAM_ID = pid;
    }
    try {
      await apiClient.put<any>(`/orders/order/${encodeURIComponent(id)}`, headerBody);
    } catch (error) {
      const err = error as ApiError;
      return { ok: false, errorMessage: err.message || 'Error al actualizar el pedido' };
    }

    const existingDetails = await this.getOrderDetailsByOrderIdRaw(id);
    const byProductId = new Map<string, { id: string; detail: any }>();
    existingDetails.forEach((d: any) => {
      const pid = String(d?.productId ?? d?.ProductId ?? '');
      const detailId = d?.id ?? d?.Id ?? d?.orderDetailId ?? d?.OrderDetailId;
      if (pid && detailId != null) byProductId.set(pid, { id: String(detailId), detail: d });
    });

    const newProductIds = new Set(input.items.map((i) => String(i.productId)));
    for (const item of input.items) {
      const pid = String(item.productId);
      const detailBody = {
        orderId: id,
        OrderId: id,
        productId: item.productId,
        ProductId: item.productId,
        quantity: item.quantity,
        Quantity: item.quantity,
        unitPrice: item.price,
        UnitPrice: item.price,
        subtotal: item.quantity * item.price,
        Subtotal: item.quantity * item.price,
      };
      const existing = byProductId.get(pid);
      if (existing) {
        await safePut<any>(`/orderdetails/orderdetails/${encodeURIComponent(existing.id)}`, detailBody);
      } else {
        await safePost<any>('/orderdetails/orderdetails', detailBody);
      }
    }
    // Si el backend no expone DELETE en orderdetails, actualizamos a cantidad 0 en lugar de borrar
    for (const [pid, { id: detailId, detail }] of byProductId) {
      if (!newProductIds.has(pid)) {
        const productId = detail?.productId ?? detail?.ProductId ?? pid;
        const zeroBody = {
          orderId: id,
          OrderId: id,
          productId,
          ProductId: productId,
          quantity: 0,
          Quantity: 0,
          unitPrice: 0,
          UnitPrice: 0,
          subtotal: 0,
          Subtotal: 0,
        };
        await safePut<any>(`/orderdetails/orderdetails/${encodeURIComponent(detailId)}`, zeroBody);
      }
    }

    // Obtener invoiceId: pedido, lista por orderId, o getInvoiceIdForOrder
    let invoiceId: string | number | null = null;
    if (existingOrder) {
      const fromOrder =
        existingOrder.invoiceId ?? existingOrder.InvoiceId
        ?? existingOrder.invoice?.id ?? existingOrder.Invoice?.Id
        ?? (Array.isArray(existingOrder.invoices) ? existingOrder.invoices[0]?.id ?? existingOrder.invoices[0]?.Id : null)
        ?? (Array.isArray(existingOrder.Invoices) ? existingOrder.Invoices[0]?.id ?? existingOrder.Invoices[0]?.Id : null);
      if (fromOrder != null) invoiceId = String(fromOrder);
    }
    if (invoiceId == null) invoiceId = await this.getInvoiceIdForOrder(id);
    if (invoiceId == null && optionalInvoiceId != null && optionalInvoiceId !== '') invoiceId = String(optionalInvoiceId);

    if (invoiceId != null) {
      const invIdStr = String(invoiceId).trim();
      const rawInv = await getInvoiceById(invIdStr) ?? await this.getInvoiceForOrder(id);
      const existingInvoice = unwrapInvoiceResponse(rawInv) ?? rawInv;
      const orderIdForBody = id;
      const invBody: Record<string, unknown> = {
        id: invIdStr,
        Id: invIdStr,
        orderId: orderIdForBody,
        OrderId: orderIdForBody,
        storeId: input.storeId,
        StoreId: input.storeId,
        total: Number(input.total),
        Total: Number(input.total),
        subtotal: Number(input.subtotal),
        Subtotal: Number(input.subtotal),
        tax: Number(input.tax),
        Tax: Number(input.tax),
      };
      if (existingInvoice && typeof existingInvoice === 'object') {
        for (const [k, v] of Object.entries(existingInvoice)) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'object' && !Array.isArray(v)) continue;
          if (Array.isArray(v)) continue;
          if (invBody[k] === undefined) invBody[k] = v;
        }
      }

      const putInvRes = await safePut<any>(`/invoice/invoices/${encodeURIComponent(invIdStr)}`, invBody);
      if (putInvRes === null) return { ok: false, errorMessage: 'Error al actualizar la factura' };

      const invDetailsList = await this.getInvoiceDetailsByInvoiceId(invIdStr);
      const invByProduct = new Map<string, { id: string; detail: any }>();
      invDetailsList.forEach((d: any) => {
        const pid = String(d?.productId ?? d?.ProductId ?? '').trim();
        const did = d?.id ?? d?.Id ?? d?.invoiceDetailId ?? d?.InvoiceDetailId ?? d?.invoice_detail_id ?? d?.Invoice_Detail_Id;
        if (pid && did != null) invByProduct.set(pid, { id: String(did), detail: d });
      });

      for (const item of input.items) {
        const pid = String(item.productId).trim();
        const lineSubtotal = item.quantity * item.price;
        const existing = invByProduct.get(pid);
        const productIdVal = item.productId;
        if (existing) {
          const d = existing.detail;
          const detailBody: Record<string, unknown> = {
            id: existing.id,
            Id: existing.id,
            invoiceId: invIdStr,
            InvoiceId: invIdStr,
            productId: productIdVal,
            ProductId: productIdVal,
            quantity: Number(item.quantity),
            Quantity: Number(item.quantity),
            subtotal: Number(lineSubtotal),
            Subtotal: Number(lineSubtotal),
          };
          if (d && typeof d === 'object') {
            for (const [k, v] of Object.entries(d)) {
              if (v === null || v === undefined) continue;
              if (typeof v === 'object' && !Array.isArray(v)) continue;
              if (Array.isArray(v)) continue;
              if (detailBody[k] === undefined) detailBody[k] = v;
            }
          }
          const putDetailRes = await safePut<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(existing.id)}`, detailBody);
          if (putDetailRes === null) return { ok: false, errorMessage: 'Error al actualizar detalle de factura' };
        } else {
          const postBody = {
            invoiceId: invIdStr,
            InvoiceId: invIdStr,
            productId: productIdVal,
            ProductId: productIdVal,
            quantity: Number(item.quantity),
            Quantity: Number(item.quantity),
            subtotal: Number(lineSubtotal),
            Subtotal: Number(lineSubtotal),
          };
          const postRes = await safePost<any>('/invoicedetails/invoicedetails', postBody);
          if (postRes === null) return { ok: false, errorMessage: 'Error al crear detalle de factura' };
        }
      }
      for (const [pid, { id: detailId, detail: d }] of invByProduct) {
        if (!newProductIds.has(pid)) {
          const productIdVal = d?.productId ?? d?.ProductId ?? pid;
          const zeroBody: Record<string, unknown> = {
            id: detailId,
            Id: detailId,
            invoiceId: invIdStr,
            InvoiceId: invIdStr,
            productId: productIdVal,
            ProductId: productIdVal,
            quantity: 0,
            Quantity: 0,
            subtotal: 0,
            Subtotal: 0,
          };
          if (d && typeof d === 'object') {
            for (const [k, v] of Object.entries(d)) {
              if (v === null || v === undefined) continue;
              if (typeof v === 'object' && !Array.isArray(v)) continue;
              if (Array.isArray(v)) continue;
              if (zeroBody[k] === undefined) zeroBody[k] = v;
            }
          }
          const putZeroRes = await safePut<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(detailId)}`, zeroBody);
          if (putZeroRes === null) return { ok: false, errorMessage: 'Error al actualizar factura' };
        }
      }
    }
    return { ok: true };
  },

  /**
   * Detalles de factura por invoiceId. GET /invoicedetails/invoicedetails/invoice/{invoiceId}
   */
  async getInvoiceDetailsByInvoiceId(invoiceId: string): Promise<any[]> {
    const id = String(invoiceId).trim();
    if (!id) return [];
    const res = await safeGet<any>(`/invoicedetails/invoicedetails/invoice/${encodeURIComponent(id)}`);
    return normalizeDetailList(res);
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
    let total = Number(inv?.total ?? inv?.Total ?? inv?.amount ?? inv?.Amount ?? inv?.totalAmount ?? inv?.TotalAmount ?? inv?.grandTotal ?? inv?.GrandTotal ?? 0);
    if (total <= 0) {
      const details = inv?.invoiceDetails ?? inv?.InvoiceDetails ?? inv?.details ?? inv?.Details ?? inv?.items ?? inv?.Items ?? [];
      const arr = Array.isArray(details) ? details : [];
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
      status: 'completed',
      Status: 'completed',
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
   * luego GET /invoice/invoices/{id} y GET /invoicedetails/invoicedetails/invoice/{invoiceId} para items y totales.
   */
  async getInvoiceDisplayForOrder(orderId: string, optionalInvoiceId?: string | number): Promise<{
    invoiceNumber: string;
    date: string;
    total: number;
    storeId?: string;
    items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
    /** Ruta del POD desde la factura (ej. /imagenes/dani.png) para pedidos viejos */
    pod?: string;
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
    const order = await this.getOrderById(orderId);
    if (!invId && order?.invoiceId != null) invId = String(order.invoiceId);
    if (!invId && order?.backendOrderId != null) {
      const byBackend = await this.getInvoiceIdForOrder(String(order.backendOrderId));
      if (byBackend != null) invId = String(byBackend);
    }
    if (!invId) return null;

    if (!invoice) {
      rawInvoice = await getInvoiceById(invId);
    } else if (!rawInvoice) {
      rawInvoice = await getInvoiceById(invId);
    }
    invoice = unwrapInvoiceResponse(rawInvoice ?? invoice);
    if (invoice == null && rawInvoice != null) invoice = rawInvoice;

    let details = normalizeDetailList(invoice);
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
          const latestPrice = orderItem?.price > 0 ? orderItem.price : await histpricesApi.getLatest(pid);
          price = latestPrice;
          amount = qty * price;
        }
        return { qty, code, description, price, amount };
      })
    );

    const total = Number(invoice?.total ?? invoice?.Total ?? invoice?.amount ?? invoice?.Amount ?? 0);
    const totalFromDetails = items.reduce((s, i) => s + i.amount, 0);
    const date = invoice?.date ?? invoice?.Date ?? invoice?.createdAt ?? invoice?.CreatedAt ?? order?.date ?? new Date().toISOString();
    const invNumber = invoice?.invoiceNumber ?? invoice?.InvoiceNumber ?? invoice?.invoiceId ?? invoice?.InvoiceId ?? invId;
    const podFromInvoice = getPodFromInvoice(rawInvoice) || getPodFromInvoice(invoice);

    return {
      invoiceNumber: String(invNumber),
      date: typeof date === 'string' ? date : (date instanceof Date ? date.toISOString() : new Date().toISOString()),
      total: total > 0 ? total : totalFromDetails,
      storeId: invoice?.storeId ?? invoice?.StoreId ?? order?.storeId,
      items,
      ...(podFromInvoice ? { pod: podFromInvoice } : {}),
    };
  },

  /**
   * Asocia el POD a la factura enviando solo el fileName (clave en S3).
   * La imagen debe subirse antes con POST /images/upload; este PATCH solo envía el link/fileName.
   * PATCH /invoice/invoices/{id}/pod — body: { id, pod: fileName } (sin base64).
   */
  async uploadPODForInvoice(params: {
    invoiceId: number | string;
    /** Nombre del archivo devuelto por POST /images/upload (clave S3). */
    fileName: string;
    notes?: string;
  }): Promise<boolean> {
    const id = String(params.invoiceId).trim();
    const fileName = (params.fileName || '').trim();
    if (!fileName) return false;
    const body: Record<string, unknown> = { id, pod: fileName };
    if (params.notes) body.notes = params.notes;
    try {
      const res = await safePatch<any>(`/invoice/invoices/${encodeURIComponent(id)}/pod`, body);
      return res !== null && res !== undefined;
    } catch (e) {
      console.error('[orders-api] uploadPODForInvoice failed:', e);
      return false;
    }
  },

  /**
   * Registra un VisitLog al crear un pedido en una tienda.
   * POST /visit-logs/visit-logs con { storeId, salespersonId, visitDate }.
   * Devuelve el id del visit log creado para poder actualizarlo o eliminarlo después.
   */
  async createVisitLog(params: {
    storeId: string;
    salespersonId: string;
    visitDate?: string;
  }): Promise<string | number | null> {
    const visitDate = (params.visitDate || new Date().toISOString().slice(0, 10)) as string;
    const body = {
      storeId: params.storeId,
      StoreId: params.storeId,
      salespersonId: params.salespersonId,
      SalespersonId: params.salespersonId,
      visitDate,
      VisitDate: visitDate,
    };

    const res = await safePost<any>('/visit-logs/visit-logs', body);
    if (res == null) return null;

    // La API puede devolver directamente el id (string/number) o un objeto envolviendo el id.
    let root: any = res;
    if (typeof res === 'object' && res !== null) {
      const data = (res as any).data ?? (res as any).value ?? (res as any).visitLog ?? (res as any).VisitLog;
      if (data && typeof data === 'object') {
        root = data;
      }
    }

    let id: string | number | null = null;
    if (typeof root === 'string' || typeof root === 'number') {
      id = root;
    } else if (typeof root === 'object' && root !== null) {
      id = root.id ?? root.Id ?? root.visitLogId ?? root.VisitLogId ?? null;
    }

    return id != null && id !== false ? id : null;
  },

  /**
   * Actualiza un VisitLog (StoreId; SalespersonId y VisitDate se envían para no romper FK en el backend).
   * PUT /visit-logs/visit-logs/{id}
   */
  async updateVisitLog(
    visitLogId: string | number,
    params: { storeId: string; salespersonId: string; visitDate: string }
  ): Promise<boolean> {
    const idStr = String(visitLogId).trim();
    const visitDate = (params.visitDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const body = {
      StoreId: String(params.storeId).trim(),
      storeId: String(params.storeId).trim(),
      SalespersonId: String(params.salespersonId).trim(),
      salespersonId: String(params.salespersonId).trim(),
      VisitDate: visitDate,
      visitDate,
    };
    const res = await safePut<any>(`/visit-logs/visit-logs/${encodeURIComponent(idStr)}`, body);
    return res != null;
  },

  /**
   * Elimina un VisitLog (p. ej. cuando se elimina el pedido).
   * DELETE /visit-logs/visit-logs/{id}
   */
  async deleteVisitLog(visitLogId: string | number): Promise<boolean> {
    const res = await safeDelete<any>(`/visit-logs/visit-logs/${encodeURIComponent(String(visitLogId))}`);
    return res !== null;
  },

  /**
   * Lista visit logs del vendedor. GET /visit-logs/visit-logs y filtra por salespersonId.
   */
  async getVisitLogsBySalesperson(salespersonId: string): Promise<Array<{ id: string | number; storeId: string; visitDate: string }>> {
    const raw = await safeGet<any>('/visit-logs/visit-logs');
    const arr = Array.isArray(raw)
      ? raw
      : raw?.data ?? raw?.items ?? raw?.visitLogs ?? raw?.VisitLogs ?? [];
    const sid = String(salespersonId).toLowerCase();
    const toDateOnly = (x: any): string => {
      if (x == null) return '';
      const s = typeof x === 'string' ? x : (x instanceof Date ? x.toISOString() : String(x));
      return s.slice(0, 10);
    };
    return (arr as any[])
      .filter(
        (v: any) =>
          sid === String(v?.salespersonId ?? v?.SalespersonId ?? v?.userId ?? v?.UserId ?? '').toLowerCase()
      )
      .map((v: any) => ({
        id: v?.id ?? v?.Id ?? '',
        storeId: String(v?.storeId ?? v?.StoreId ?? '').trim(),
        visitDate: toDateOnly(v?.visitDate ?? v?.VisitDate ?? v?.createdAt ?? v?.CreatedAt ?? ''),
      }))
      .filter((v) => v.storeId && v.id !== '' && v.id != null);
  },

  /**
   * Actualiza el estado del pedido en backend.
   * PUT /orders/order/{id}/status
   * Body: { orderId: "guid", isInvoiced: true }
   */
  async updateOrderStatus(
    orderId: string | number,
    isInvoiced: boolean = true
  ): Promise<boolean> {
    const idStr = String(orderId).trim();
    const body = {
      orderId: idStr,
      OrderId: idStr,
      isInvoiced,
      IsInvoiced: isInvoiced,
    };
    const id = encodeURIComponent(idStr);
    const res = await safePut<any>(`/orders/order/${id}/status`, body);
    return res !== null;
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
      const details = inv?.invoiceDetails ?? inv?.InvoiceDetails ?? inv?.details ?? inv?.Details ?? inv?.items ?? inv?.Items ?? [];
      const arr = Array.isArray(details) ? details : [];
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
        if (next.invoiceId == null || next.invoiceId === '') next = { ...next, invoiceId: invId };
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
    let details = await this.getOrderDetailsByOrderIdRaw(orderId);
    if (!details?.length && orderRaw) {
      const nested = orderRaw?.orderDetails ?? orderRaw?.OrderDetails ?? orderRaw?.details ?? orderRaw?.Details ?? orderRaw?.items ?? orderRaw?.Items ?? raw?.orderDetails ?? raw?.OrderDetails ?? raw?.details ?? raw?.Details ?? raw?.items ?? raw?.Items;
      details = Array.isArray(nested) ? nested : [];
    }
    const backendId = orderRaw?.orderId ?? orderRaw?.OrderId ?? orderRaw?.id ?? orderRaw?.Id ?? raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? orderId;
    if (!details?.length && backendId !== orderId) {
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
    // Asegurar invoiceId: del pedido (todas las variantes en raw/orderRaw), por lista, o por endpoint
    if (result && (result.invoiceId == null || result.invoiceId === '')) {
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
      if (result.status === 'pending' && (podText || (invRoot && (invRoot?.isInvoiced === true || invRoot?.IsInvoiced === true || String(invRoot?.status ?? invRoot?.Status ?? '').toLowerCase() === 'invoiced')))) {
        result.status = 'invoiced';
      }
    }
    return result;
  },

  /**
   * Detalles de un pedido. GET /orderdetails/orderdetails/order/{orderId}
   * Acepta array o objeto con data/items/orderDetails/details.
   */
  async getOrderDetailsByOrderIdRaw(orderId: string): Promise<any[]> {
    const list = await safeGet<any>(`/orderdetails/orderdetails/order/${encodeURIComponent(orderId)}`);
    if (list == null) return [];
    if (Array.isArray(list)) return list;
    const arr = list?.orderDetails ?? list?.OrderDetails ?? list?.details ?? list?.Details ?? list?.data ?? list?.Data ?? list?.items ?? list?.Items ?? [];
    return Array.isArray(arr) ? arr : [];
  },
};

