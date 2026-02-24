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
  items: OrderItemInput[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface CreatedOrderResult {
  orderId: number | string;
  invoiceId?: number | string;
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

function normalizeInvoiceList(list: any): any[] {
  if (Array.isArray(list)) return list;
  if (list?.invoices) return Array.isArray(list.invoices) ? list.invoices : [];
  if (list?.data) return Array.isArray(list.data) ? list.data : [];
  if (list?.items) return Array.isArray(list.items) ? list.items : [];
  if (list?.value) return Array.isArray(list.value) ? list.value : [];
  if (list?.Results) return Array.isArray(list.Results) ? list.Results : [];
  if (list && typeof list === 'object') {
    const arr: any[] = [];
    for (const v of Object.values(list)) {
      if (Array.isArray(v)) arr.push(...v);
    }
    return arr;
  }
  return [];
}

async function getInvoiceList(): Promise<any[]> {
  const list = await safeGet<any>('/invoice/invoices');
  if (list == null) {
    const listSingular = await safeGet<any>('/invoice/invoice');
    return normalizeInvoiceList(listSingular);
  }
  return normalizeInvoiceList(list);
}

/** GET factura por id. Usar este endpoint cuando tengas el invoiceId. Todo desde BD. */
async function getInvoiceById(invoiceId: string): Promise<any | null> {
  const id = String(invoiceId).trim();
  if (!id) return null;
  let one = await safeGet<any>(`/invoice/invoices/${encodeURIComponent(id)}`);
  if (one == null) one = await safeGet<any>(`/invoice/invoice/${encodeURIComponent(id)}`);
  if (one == null) return null;
  // Desempaquetar si la API devuelve { data: {...} } o { invoice: {...} }
  if (one?.data && typeof one.data === 'object') return one.data;
  if (one?.invoice && typeof one.invoice === 'object') return one.invoice;
  if (one?.value && typeof one.value === 'object') return one.value;
  return one;
}

/**
 * Lee la referencia al POD de una factura (ruta, URL o data URL).
 * Si el backend devuelve podBase64, se convierte a data URL para poder mostrarla.
 */
function getPodFromInvoice(inv: any): string {
  if (inv == null) return '';
  const root = inv?.data ?? inv?.invoice ?? inv;
  const v = root?.pod ?? root?.Pod ?? root?.POD ?? root?.podUrl ?? root?.PodUrl ?? root?.podImageUrl ?? root?.PodImageUrl
    ?? root?.fileName ?? root?.FileName ?? root?.PodFileName ?? root?.url ?? root?.Url ?? root?.Reference;
  const str = typeof v === 'string' ? v.trim() : '';
  if (str) return str;
  const base64 = root?.podBase64 ?? root?.PodBase64;
  if (typeof base64 === 'string' && base64.length > 0) {
    return `data:image/png;base64,${base64}`;
  }
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
}

function mapRawOrderToUI(raw: any, details: any[] = []): OrderForUI {
  const id = String(raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? '');
  const date = raw?.createdAt ?? raw?.CreatedAt ?? raw?.date ?? raw?.Date ?? new Date().toISOString();
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
  return {
    id,
    backendOrderId: raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id,
    storeId: String(raw?.storeId ?? raw?.StoreId ?? ''),
    storeName: String(raw?.storeName ?? raw?.StoreName ?? raw?.store?.name ?? raw?.Store?.Name ?? raw?.storeId ?? raw?.StoreId ?? '').trim() || '—',
    storeAddress: raw?.storeAddress ?? raw?.StoreAddress ?? raw?.store?.address ?? raw?.Store?.Address ?? '',
    date: typeof date === 'string' ? date : (date instanceof Date ? date.toISOString() : new Date().toISOString()),
    deliveryDate: raw?.deliveryDate ?? raw?.DeliveryDate,
    status: String(raw?.status ?? raw?.Status ?? 'pending'),
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
    invoiceId: raw?.invoiceId ?? raw?.InvoiceId ?? raw?.invoice?.id ?? raw?.Invoice?.Id,
    salespersonId: salespersonIdRaw != null ? String(salespersonIdRaw) : undefined,
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
    // 1) Crear header de pedido
    const headerBody = {
      // Campos en camelCase y PascalCase para mayor compatibilidad con .NET
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

    const createdOrder = await safePost<any>('/orders/orders', headerBody);
    if (!createdOrder) {
      return null;
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
      return null;
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

    // 3) Crear factura (INVOICE) y sus detalles en la API para que la factura muestre los productos
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
   * optionalInvoiceId: si el backend no devuelve invoiceId en el pedido, pasar el id de la factura (p. ej. desde sessionStorage o getInvoiceIdForOrder).
   */
  async updateOrder(orderId: string | number, input: CreateOrderInput, optionalInvoiceId?: string | number | null): Promise<boolean> {
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
    // El backend exige FK_ORDER_USER_SALESPERSON_ID: incluir salespersonId en el PUT para no violarla
    if (salespersonId) {
      headerBody.salespersonId = salespersonId;
      headerBody.SalespersonId = salespersonId;
    }
    const putOrderRes = await safePut<any>(`/orders/order/${encodeURIComponent(id)}`, headerBody);
    if (putOrderRes === null) return false;

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

    // Obtener invoiceId: pedido, lista por orderId, o el pasado desde la UI (sessionStorage / getInvoiceIdForOrder)
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
      const existingInvoice = await getInvoiceById(invIdStr) ?? await this.getInvoiceForOrder(id);
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

      // Backend devuelve 404 con rutas singulares; intentar plural primero
      let putInvRes = await safePut<any>(`/invoice/invoices/${encodeURIComponent(invIdStr)}`, invBody);
      if (putInvRes === null) putInvRes = await safePut<any>(`/invoice/invoice/${encodeURIComponent(invIdStr)}`, invBody);
      if (putInvRes === null) putInvRes = await safePatch<any>(`/invoice/invoices/${encodeURIComponent(invIdStr)}`, invBody);
      if (putInvRes === null) putInvRes = await safePatch<any>(`/invoice/invoice/${encodeURIComponent(invIdStr)}`, invBody);
      if (putInvRes === null) {
        return false;
      }

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
          // Backend devuelve 404 con ruta singular; intentar plural primero
          let putDetailRes = await safePut<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(existing.id)}`, detailBody);
          if (putDetailRes === null) putDetailRes = await safePut<any>(`/invoicedetails/invoicedetail/${encodeURIComponent(existing.id)}`, detailBody);
          if (putDetailRes === null) putDetailRes = await safePatch<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(existing.id)}`, detailBody);
          if (putDetailRes === null) putDetailRes = await safePatch<any>(`/invoicedetails/invoicedetail/${encodeURIComponent(existing.id)}`, detailBody);
          if (putDetailRes === null) {
            return false;
          }
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
          if (postRes === null) {
            return false;
          }
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
          // Backend devuelve 404 con ruta singular; intentar plural primero
          let putZeroRes = await safePut<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(detailId)}`, zeroBody);
          if (putZeroRes === null) putZeroRes = await safePut<any>(`/invoicedetails/invoicedetail/${encodeURIComponent(detailId)}`, zeroBody);
          if (putZeroRes === null) putZeroRes = await safePatch<any>(`/invoicedetails/invoicedetails/${encodeURIComponent(detailId)}`, zeroBody);
          if (putZeroRes === null) putZeroRes = await safePatch<any>(`/invoicedetails/invoicedetail/${encodeURIComponent(detailId)}`, zeroBody);
          if (putZeroRes === null) {
            return false;
          }
        }
      }
    }
    return true;
  },

  /**
   * Detalles de factura por invoiceId.
   * 1) GET /invoicedetails/invoicedetails/invoice/{invoiceId}
   * 2) GET /invoice/invoices/{id}/details (por si el backend expone detalles como subrecurso)
   * 3) GET /invoicedetails/invoicedetails y filtrar por invoiceId
   */
  async getInvoiceDetailsByInvoiceId(invoiceId: string): Promise<any[]> {
    const id = String(invoiceId).trim();
    if (!id) return [];
    const byInvoice = await safeGet<any>(`/invoicedetails/invoicedetails/invoice/${encodeURIComponent(id)}`);
    let result = normalizeDetailList(byInvoice);
    if (result.length > 0) return result;
    const byInvoiceDetails = await safeGet<any>(`/invoice/invoices/${encodeURIComponent(id)}/details`);
    result = normalizeDetailList(byInvoiceDetails);
    if (result.length > 0) return result;
    const list = await safeGet<any>('/invoicedetails/invoicedetails');
    const arr = normalizeDetailList(list);
    const idLower = id.toLowerCase();
    return arr.filter((d: any) => {
      const invId = d?.invoiceId ?? d?.InvoiceId ?? d?.invoice_id;
      return invId != null && String(invId).toLowerCase() === idLower;
    });
  },

  /**
   * Obtiene el id de la factura asociada a un pedido (para subir POD).
   * Lista GET /invoice/invoices y filtra por OrderId (el backend no expone GET por orderId).
   */
  async getInvoiceIdForOrder(orderId: string): Promise<string | number | null> {
    const orderIdStr = String(orderId).toLowerCase();
    const orderIdNum = Number(orderId);

    const arr = await getInvoiceList();
    const found = (arr as any[]).find((x: any) => {
      const invOrder =
        x?.orderId ?? x?.OrderId ?? x?.order_id ?? x?.Order_Id
        ?? x?.order?.id ?? x?.Order?.Id ?? x?.order?.orderId ?? x?.Order?.OrderId;
      if (invOrder == null) return false;
      if (String(invOrder).toLowerCase() === orderIdStr) return true;
      if (String(invOrder) === orderId) return true;
      if (!Number.isNaN(orderIdNum) && Number(invOrder) === orderIdNum) return true;
      return false;
    });
    if (found) {
      const id = found?.id ?? found?.Id ?? found?.invoiceId ?? found?.InvoiceId;
      return id != null ? id : null;
    }
    return null;
  },

  /** Devuelve el objeto factura completo para este pedido (para hacer PUT con todos los campos). */
  async getInvoiceForOrder(orderId: string): Promise<any | null> {
    const orderIdStr = String(orderId).toLowerCase();
    const arr = await getInvoiceList();
    const found = (arr as any[]).find((x: any) => {
      const invOrder = x?.orderId ?? x?.OrderId ?? x?.order?.id ?? x?.Order?.Id;
      if (invOrder == null) return false;
      return String(invOrder).toLowerCase() === orderIdStr;
    });
    return found ?? null;
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
   * Datos de la factura para pantalla: usa endpoints concretos.
   * - Factura: GET /invoice/invoices/{id} cuando hay invoiceId.
   * - Detalles: del cuerpo de la factura (si vienen anidados) o GET /invoicedetails/invoicedetails/invoice/{id}.
   * - Cantidad/subtotal leídos con todas las variantes de nombres que devuelve la API.
   */
  async getInvoiceDisplayForOrder(orderId: string, optionalInvoiceId?: string | number): Promise<{
    invoiceNumber: string;
    date: string;
    total: number;
    storeId?: string;
    items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
  } | null> {
    const order = await this.getOrderById(orderId);
    let invId = '';
    let invoice: any = null;

    if (order?.invoiceId != null) invId = String(order.invoiceId);
    if (!invId && optionalInvoiceId != null) invId = String(optionalInvoiceId);
    if (!invId) {
      const fromList = await this.getInvoiceForOrder(orderId);
      invoice = fromList;
      if (invoice?.data && typeof invoice.data === 'object') invoice = invoice.data;
      if (invoice?.invoice && typeof invoice.invoice === 'object') invoice = invoice.invoice;
      invId = invoice != null ? String(invoice?.id ?? invoice?.Id ?? invoice?.invoiceId ?? invoice?.InvoiceId ?? '') : '';
    }
    if (!invId) {
      const idFromList = await this.getInvoiceIdForOrder(orderId)
        ?? (order?.backendOrderId != null ? await this.getInvoiceIdForOrder(String(order.backendOrderId)) : null);
      if (idFromList != null) invId = String(idFromList);
    }
    if (!invId) return null;

    if (!invoice) invoice = await getInvoiceById(invId);
    if (invoice?.data && typeof invoice.data === 'object') invoice = invoice.data;
    if (invoice?.invoice && typeof invoice.invoice === 'object') invoice = invoice.invoice;

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

    return {
      invoiceNumber: String(invNumber),
      date: typeof date === 'string' ? date : (date instanceof Date ? date.toISOString() : new Date().toISOString()),
      total: total > 0 ? total : totalFromDetails,
      storeId: invoice?.storeId ?? invoice?.StoreId ?? order?.storeId,
      items,
    };
  },

  /**
   * Guarda en la factura el POD: ruta y opcionalmente la imagen en base64.
   * PATCH /invoice/invoices/{id}/pod con { id, pod (ruta), podBase64? }.
   * Si el backend acepta podBase64, puede guardar el archivo en la ruta indicada.
   */
  async uploadPODForInvoice(params: {
    invoiceId: number | string;
    /** Nombre del archivo (ej. "Dani.png"); se envía como ruta "imagenes/Dani.png" */
    fileName: string;
    contentType?: string;
    notes?: string;
    /** Imagen en data URL (data:image/png;base64,...). Se envía como podBase64 al backend. */
    imageDataUrl?: string | null;
  }): Promise<boolean> {
    const id = String(params.invoiceId).trim();
    const name = (params.fileName || 'POD.png').trim();
    const podPath = name.startsWith('imagenes/') ? name : `imagenes/${name}`;
    let podBase64: string | undefined;
    if (params.imageDataUrl && typeof params.imageDataUrl === 'string' && params.imageDataUrl.startsWith('data:')) {
      const base64 = params.imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
      if (base64.length > 0) podBase64 = base64;
    }
    const body: Record<string, unknown> = { id, pod: podPath };
    if (podBase64) body.podBase64 = podBase64;
    try {
      const res = await safePatch<any>(`/invoice/invoices/${encodeURIComponent(id)}/pod`, body);
      const ok = res !== null && res !== undefined;
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development' && !ok) {
        console.warn('[orders-api] uploadPODForInvoice: PATCH devolvió', res);
      }
      return ok;
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
    let res = await safePut<any>(`/orders/order/${id}/status`, body);
    if (res == null) {
      res = await safePut<any>(`/orders/orders/${id}/status`, body);
    }
    return !!res;
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
    const arr = Array.isArray(list) ? list : list?.data ?? list?.items ?? [];
    if (!arr.length) return [];
    const ids = (arr as any[]).map((raw: any) => String(raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? '')).filter(Boolean);
    const [fullOrders, invoicesList] = await Promise.all([
      Promise.all(ids.map((id) => this.getOrderById(id))),
      safeGet<any>('/invoice/invoices').then((inv: any) => Array.isArray(inv) ? inv : inv?.invoices ?? inv?.data ?? inv?.items ?? []),
    ]);
    let orders = fullOrders.filter((o): o is OrderForUI => o != null);
    // Solo pedidos del vendedor actual (por si el backend devuelve más)
    const uid = String(userId);
    orders = orders.filter((o) => {
      const sid = o.salespersonId ?? (o as any).salespersonId;
      if (sid != null && sid !== '') return String(sid) === uid;
      return true;
    });
    const byOrderId = new Map<string, any>();
    (invoicesList as any[]).forEach((inv: any) => {
      const oid = String(inv?.orderId ?? inv?.OrderId ?? inv?.order?.id ?? inv?.Order?.Id ?? '');
      if (oid) byOrderId.set(oid, inv);
    });
    const sumFromDetails = (inv: any): number => {
      const details = inv?.invoiceDetails ?? inv?.InvoiceDetails ?? inv?.details ?? inv?.Details ?? inv?.items ?? inv?.Items ?? [];
      const arr = Array.isArray(details) ? details : [];
      return arr.reduce((s: number, d: any) => s + Number(d?.subtotal ?? d?.Subtotal ?? d?.SubTotal ?? d?.total ?? d?.Total ?? 0), 0);
    };

    const result = orders.map((o) => {
      if (Number(o.total) > 0) return o;
      const inv = byOrderId.get(o.id) ?? byOrderId.get(String(o.backendOrderId ?? ''));
      if (inv == null) return o;
      let invTotal = Number(
        inv?.total ?? inv?.Total ?? inv?.amount ?? inv?.Amount ?? inv?.totalAmount ?? inv?.TotalAmount ?? inv?.grandTotal ?? inv?.GrandTotal ?? 0
      );
      if (invTotal <= 0) invTotal = sumFromDetails(inv);
      if (invTotal > 0) return { ...o, total: invTotal, subtotal: o.subtotal || invTotal };
      return o;
    });
    for (let i = 0; i < result.length; i++) {
      if (Number(result[i].total) <= 0) {
        const fallback = await this.getInvoiceTotalForOrder(result[i].id) ?? await this.getInvoiceTotalForOrder(String(result[i].backendOrderId ?? ''));
        if (fallback > 0) result[i] = { ...result[i], total: fallback, subtotal: result[i].subtotal || fallback };
      }
    }
    return result;
  },

  /**
   * Obtiene un pedido por id. GET /orders/orders/{id}
   */
  async getOrderById(orderId: string): Promise<OrderForUI | null> {
    const raw = await safeGet<any>(`/orders/orders/${encodeURIComponent(orderId)}`);
    if (!raw) return null;
    let details = await this.getOrderDetailsByOrderIdRaw(orderId);
    if (!details?.length && raw) {
      const nested = raw?.orderDetails ?? raw?.OrderDetails ?? raw?.details ?? raw?.Details ?? raw?.items ?? raw?.Items;
      details = Array.isArray(nested) ? nested : [];
    }
    const backendId = raw?.orderId ?? raw?.OrderId ?? raw?.id ?? raw?.Id ?? orderId;
    if (!details?.length && backendId !== orderId) {
      const altDetails = await this.getOrderDetailsByOrderIdRaw(String(backendId));
      if (altDetails?.length) details = altDetails;
    }
    const result = mapRawOrderToUI(raw, details);
    if (result?.items?.length) {
      result.items = await enrichOrderItemsWithProductNames(result.items);
    }
    // Asegurar invoiceId para POD: si el backend no lo devuelve en el pedido, buscarlo por orderId
    if (result && (result.invoiceId == null || result.invoiceId === '')) {
      const invId = await this.getInvoiceIdForOrder(orderId) ?? await this.getInvoiceIdForOrder(String(backendId));
      if (invId != null) result.invoiceId = invId;
    }
    // Traer el POD de la factura (en BD está guardado como "pod") y mostrarlo en el detalle
    if (result?.invoiceId) {
      const inv = await getInvoiceById(String(result.invoiceId));
      const podText = getPodFromInvoice(inv);
      if (podText) {
        result.podImageUrl = result.podImageUrl || podText;
        result.podFileName = result.podFileName || podText;
        if (!result.podUploaded) result.podUploaded = true;
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

