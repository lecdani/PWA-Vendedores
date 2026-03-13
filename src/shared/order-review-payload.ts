/**
 * Payload en memoria para pasar datos de planogram a order-review sin usar sessionStorage.
 * Se borra al leer (una sola vez).
 */
let payload: {
  storeId?: string;
  storeInfo?: any;
  planogramData?: any[];
  planogramId?: string;
  editOrderId?: string | null;
  /** Origen del pedido: planogram = grilla; catalog = catálogo de productos. */
  source?: 'planogram' | 'catalog';
} | null = null;

export function setOrderReviewPayload(p: typeof payload) {
  payload = p;
}

export function getOrderReviewPayload(): typeof payload {
  const p = payload;
  payload = null;
  return p;
}
