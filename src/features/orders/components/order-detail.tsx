'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, 
  Store as StoreIcon, 
  Package, 
  DollarSign,
  Grid3x3,
  Printer,
  CheckCircle2,
  Camera,
  ChevronDown,
  ChevronUp,
  Ban,
  Pencil,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { cancelOrderResilient, isQueuedOfflineInvoiceId } from '@/shared/offline/offline-orders';
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { productsApi, getProductImageUrl } from '@/shared/api/products-api';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { orderItemMatchesFamily } from '@/shared/utils/order-item-matches-family';
import { FamilySummaryCell } from '@/shared/components/family-summary-cell';
import { getBackendAssetUrl } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Separator } from '@/shared/ui/separator';
import { Invoice } from './invoice';

/** Estados de API heterogéneos → facturado */
function matchesInvoicedStatus(status: string | undefined) {
  const s = (status || '').toLowerCase().trim();
  return ['invoiced', 'facturado', 'invoice', 'billed', 'facturada'].includes(s);
}

/** Alineado con `normalizeOrderStatus` en orders-api (incl. `3` por si el estado llega sin normalizar). */
function matchesCancelledStatus(status: string | undefined) {
  const s = String(status ?? '').trim().toLowerCase();
  return (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'cancelado' ||
    s === 'anulado' ||
    s === 'void' ||
    s === '3'
  );
}

function sameFamilyId(a: string | undefined, b: string | undefined): boolean {
  const aa = String(a || '').trim();
  const bb = String(b || '').trim();
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const an = Number(aa);
  const bn = Number(bb);
  if (Number.isNaN(an) || Number.isNaN(bn)) return false;
  return an === bn;
}

export type InvoiceDisplayState = {
  invoiceNumber: string;
  date: string;
  total: number;
  items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
  pod?: string;
  storeId?: string;
  /** PO devuelto por la API de factura (prioridad sobre el del pedido). */
  po?: string;
};

/**
 * Evita que un segundo GET (p. ej. solo para POD) pise ítems ya cargados, o que prev vacío + merge solo pod deje líneas vacías.
 */
function mergeInvoiceDisplay(prev: InvoiceDisplayState | null, next: InvoiceDisplayState | null): InvoiceDisplayState | null {
  if (!next) return prev;
  if (!prev) return next;
  const pLen = prev.items?.length ?? 0;
  const nLen = next.items?.length ?? 0;
  const items = nLen >= pLen ? (next.items ?? []) : (prev.items ?? []);
  return {
    ...prev,
    ...next,
    items,
    invoiceNumber: String(next.invoiceNumber || prev.invoiceNumber || '—'),
    date: next.date || prev.date,
    total: Number(next.total) > 0 ? Number(next.total) : Number(prev.total) || 0,
    pod: (next.pod || prev.pod || '').trim() || undefined,
    storeId: next.storeId ?? prev.storeId,
    po: (next.po || prev.po || '').trim() || undefined,
  };
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [order, setOrder] = useState<OrderForUI | null>(null);
  const [invoiceStoreName, setInvoiceStoreName] = useState('');
  const [invoiceStoreAddress, setInvoiceStoreAddress] = useState('');
  const [invoiceStoreCity, setInvoiceStoreCity] = useState('');
  const [invoiceFromApi, setInvoiceFromApi] = useState<InvoiceDisplayState | null>(null);
  const [savedDeliveryItems, setSavedDeliveryItems] = useState<
    Array<{ productId: string; quantity: number; unitPrice?: number; row?: number; col?: number; sku?: string; productName?: string }>
  >([]);
  const [showInitialOrderInvoiced, setShowInitialOrderInvoiced] = useState(false);
  const [invoiceViewMode, setInvoiceViewMode] = useState<'product' | 'family'>('product');
  const [invoicePrintLayout, setInvoicePrintLayout] = useState<'normal' | 'ticket'>('normal');

  const readDeliveryFromStorage = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`order_delivery_confirmation_${orderId}`);
      if (raw) {
        const p = JSON.parse(raw);
        const items = Array.isArray(p?.items) ? p.items : [];
        setSavedDeliveryItems(items);
        return;
      }

      // Si ya se subió POD y se limpió el confirmation, mantener las celdas facturadas (no agrupar por producto).
      const rawCells = window.localStorage.getItem(`order_delivered_cells_${orderId}`);
      if (!rawCells) {
        setSavedDeliveryItems([]);
        return;
      }
      const parsed = JSON.parse(rawCells);
      setSavedDeliveryItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedDeliveryItems([]);
    }
  }, [orderId]);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [loadingPod, setLoadingPod] = useState(false);
  const [orderLoadDone, setOrderLoadDone] = useState(false);
  const [podImageError, setPodImageError] = useState(false);
  const [productImageError, setProductImageError] = useState<Record<string, boolean>>({});
  const [allCategories, setAllCategories] = useState<CategoryForUI[]>([]);
  const [storeHasPlanogram, setStoreHasPlanogram] = useState(true);

  useEffect(() => {
    categoriesApi.fetchAll().then(setAllCategories);
  }, []);

  useEffect(() => {
    readDeliveryFromStorage();
  }, [readDeliveryFromStorage, orderLoadDone]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => readDeliveryFromStorage();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [readDeliveryFromStorage]);

  /** Solo rutas no vacías; evita `podUploaded` en true sin archivo y espacios en URL. */
  const displayPod =
    String(order?.podImageUrl ?? '').trim() ||
    String(order?.podFileName ?? '').trim() ||
    String(invoiceFromApi?.pod ?? '').trim() ||
    '';

  useEffect(() => {
    if (searchParams.get('confirmed') === '1') {
      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 3000);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const loadOrder = async () => {
      const apiOrder = await ordersApi.getOrderById(orderId);
      if (cancelled) return;
      if (apiOrder) {
        const categories = await categoriesApi.fetchAll();
        const categoryById = new Map<string, string>();
        categories.forEach((c) => {
          categoryById.set(c.id, c.name);
          categoryById.set(String(Number(c.id)), c.name);
        });

        let orderToSet = apiOrder;
        const needsPrice = apiOrder.items.some((i: any) => i.productId && !Number(i.price));
        const needsProductName = apiOrder.items.some((i: any) => i.productId && !(i.productName || i.sku || '').trim());
        const needsImage = apiOrder.items.some((i: any) => i.productId && !i.imageUrl);
        const needsCategory = apiOrder.items.some((i: any) => i.productId && (i.category == null || i.category === ''));
        const needsFamilyId = apiOrder.items.some(
          (i: any) => i.productId && !(i.familyId ?? i.categoryId ?? i.FamilyId ?? i.CategoryId)
        );
        if (needsPrice || needsProductName || needsImage || needsCategory || needsFamilyId) {
          const enrichedItems = await Promise.all(
            apiOrder.items.map(async (item: any) => {
              let productName = (item.productName || item.sku || '').trim();
              let price = Number(item.price) || 0;
              let imageUrl = item.imageUrl;
              let category = (item.category || '').trim();
              let familyId = String(item.familyId ?? item.FamilyId ?? item.categoryId ?? item.CategoryId ?? '').trim();
              if (item.productId) {
                const product = await productsApi.getById(item.productId);
                if (product) {
                  if (!productName) productName = product.name || product.code || product.sku || '';
                  if (!imageUrl) imageUrl = getProductImageUrl(product);
                  if (!familyId) familyId = String(product.familyId ?? product.categoryId ?? '').trim();
                  if (familyId) {
                    const resolved = categoryById.get(familyId) ?? categoryById.get(String(Number(familyId)));
                    if (resolved) category = resolved;
                  }
                  if (!category && product.category) category = product.category.trim();
                  if (!category && product.categoryId != null) {
                    const id = String(product.categoryId);
                    category = categoryById.get(id) ?? categoryById.get(String(Number(id))) ?? '';
                  }
                }
                if (!price && familyId) price = await histpricesApi.getLatest(familyId);
              }
              return {
                ...item,
                productName: productName || item.productName,
                price,
                imageUrl: imageUrl || item.imageUrl,
                category: category || item.category,
                familyId: familyId || item.familyId,
                categoryId: familyId || item.categoryId,
              };
            })
          );
          const computedSubtotal = enrichedItems.reduce((s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price || 0), 0);
          orderToSet = {
            ...apiOrder,
            items: enrichedItems,
            subtotal: apiOrder.subtotal || computedSubtotal,
            total: apiOrder.total || computedSubtotal + (apiOrder.tax || 0),
          };
        }
        if (cancelled) return;
        setOrder(orderToSet);
        const name = (orderToSet.storeName || '').trim();
        const looksLikeId = !name || name === orderToSet.storeId || /^[0-9a-f-]{36}$/i.test(name) || /^\d+$/.test(name);
        if (orderToSet.storeId && looksLikeId) {
          const store = await storesApi.fetchStoreById(orderToSet.storeId);
          if (store) {
            setStoreHasPlanogram(store.hasPlanogram !== false);
            setInvoiceStoreName(store.name);
            setInvoiceStoreAddress((store.address || '').trim());
            const cityRaw = (store.city || '').trim();
            if (cityRaw && citiesApi.looksLikeCityId(cityRaw)) {
              const cityName = await citiesApi.getCityNameById(cityRaw);
              setInvoiceStoreCity(cityName);
            } else {
              setInvoiceStoreCity(cityRaw);
            }
          } else {
            setStoreHasPlanogram(true);
            setInvoiceStoreName(name || '—');
            setInvoiceStoreAddress(orderToSet.storeAddress || '');
            setInvoiceStoreCity('');
          }
        } else {
          setInvoiceStoreName(name || orderToSet.storeName || '—');
          setInvoiceStoreAddress(orderToSet.storeAddress || '');
          setInvoiceStoreCity('');
        }
        const invoiceIdHint = orderToSet.invoiceId ?? await ordersApi.getInvoiceIdForOrder(orderId)
          ?? (orderToSet.backendOrderId != null ? await ordersApi.getInvoiceIdForOrder(String(orderToSet.backendOrderId)) : null);
        let invoiceDisplay = await ordersApi.getInvoiceDisplayForOrder(orderId, invoiceIdHint ?? undefined, orderToSet);
        /** Si los ítems vinieron vacíos pero el pedido podría tener factura, segunda pasada sin hint */
        const st = (orderToSet.status || '').toLowerCase().trim();
        const mightHaveInvoice =
          (invoiceIdHint != null && String(invoiceIdHint).trim() !== '') ||
          matchesInvoicedStatus(orderToSet.status) ||
          ['confirmed', 'completed', 'complete', 'confirmado', 'cerrado', 'closed'].includes(st);
        if (!invoiceDisplay?.items?.length && mightHaveInvoice) {
          const alt = await ordersApi.getInvoiceDisplayForOrder(orderId, undefined, orderToSet);
          if (alt?.items?.length) invoiceDisplay = alt;
        }
        if (cancelled) return;
        setInvoiceFromApi(invoiceDisplay ?? null);
        if (invoiceDisplay?.pod) {
          setOrder((prev) =>
            prev ? { ...prev, podImageUrl: invoiceDisplay.pod, podFileName: invoiceDisplay.pod, podUploaded: true } : prev
          );
        }
        setOrderLoadDone(true);
        return;
      }
      if (cancelled) return;
      setInvoiceFromApi(null);
      setInvoiceStoreName('');
      setInvoiceStoreAddress('');
      setInvoiceStoreCity('');
      setOrder(null);
      setOrderLoadDone(true);
    };
    setOrderLoadDone(false);
    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Sincronizar POD de la factura al pedido (la factura devuelve orderId y pod)
  useEffect(() => {
    if (!order) return;
    const pod = String(invoiceFromApi?.pod ?? '').trim();
    if (!pod || (order.podImageUrl === pod && order.podFileName === pod)) return;
    setOrder((prev) => (prev ? { ...prev, podImageUrl: pod, podFileName: pod, podUploaded: true } : prev));
  }, [order?.id, invoiceFromApi?.pod, order?.podImageUrl, order?.podFileName]);

  // Fallback: si no hay POD, cargar factura (devuelve orderId y pod); usa order.invoiceId o resuelve por orderId
  useEffect(() => {
    const hasPath =
      String(order?.podImageUrl ?? '').trim() ||
      String(order?.podFileName ?? '').trim() ||
      String(invoiceFromApi?.pod ?? '').trim();
    if (!order || hasPath) return;
    /** `loadOrder` ya trajo la factura sin POD: no otro GET ni dejar `loadingPod` en true bloqueando el CTA. */
    if (invoiceFromApi != null && !String(invoiceFromApi?.pod ?? '').trim()) {
      return;
    }
    let cancelled = false;
    setLoadingPod(true);
    ordersApi.getInvoiceDisplayForOrder(orderId, order.invoiceId ?? undefined, order).then((display) => {
      if (cancelled) return;
      setLoadingPod(false);
      if (!display) return;
      setInvoiceFromApi((prev) => mergeInvoiceDisplay(prev, display));
      const p = String(display.pod ?? '').trim();
      if (p) setOrder((prev) => (prev ? { ...prev, podImageUrl: p, podFileName: p, podUploaded: true } : prev));
    });
    return () => {
      cancelled = true;
      setLoadingPod(false);
    };
  }, [orderId, order?.id, order?.invoiceId, order?.podImageUrl, order?.podFileName, invoiceFromApi?.pod]);

  useEffect(() => {
    setPodImageError(false);
  }, [displayPod]);

  // Pedido facturado sin POD en estado: forzar carga de factura por API para obtener POD
  useEffect(() => {
    const isInvoiced = matchesInvoicedStatus(order?.status);
    if (!order || !isInvoiced || order.podImageUrl || order.podFileName || invoiceFromApi?.pod) return;
    let cancelled = false;
    setLoadingPod(true);
    ordersApi.getInvoiceDisplayForOrder(orderId, order.invoiceId ?? undefined, order).then((display) => {
      if (cancelled) return;
      setLoadingPod(false);
      if (!display) return;
      /** Antes solo se fusionaba `pod` y se perdían `items` si el primer estado tenía líneas vacías y este GET traía la factura completa */
      if (!display.pod && !(display.items?.length)) return;
      setInvoiceFromApi((prev) => mergeInvoiceDisplay(prev, display));
      if (display.pod) {
        setOrder((prev) => (prev ? { ...prev, podImageUrl: display.pod, podFileName: display.pod, podUploaded: true } : prev));
      }
    });
    return () => { cancelled = true; };
  }, [order?.id, order?.status, order?.invoiceId, order?.podImageUrl, order?.podFileName, invoiceFromApi?.pod, orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {orderLoadDone ? (
          <div className="text-center">
            <p className="text-slate-600 mb-4">Pedido no encontrado</p>
            <Button variant="outline" onClick={() => router.back()}>Volver</Button>
          </div>
        ) : (
          <p className="text-slate-600">Cargando...</p>
        )}
      </div>
    );
  }

  const initialLineUnits = order.items.reduce((s, i) => s + (i.toOrder ?? i.quantity ?? 0), 0);
  const totalUnits = order.totalUnits ?? initialLineUnits;
  const displayTotal =
    order.total > 0 ? order.total : order.items.reduce((s, i) => s + (i.toOrder ?? i.quantity ?? 0) * (i.price ?? 0), 0);

  /** Líneas tal como en la factura: primero GET factura; si aún no hay, mismo shape desde localStorage. */
  const invoiceLinesFromApi =
    invoiceFromApi?.items && invoiceFromApi.items.length > 0 ? invoiceFromApi.items : [];

  const linesFromStorageAsInvoice: Array<{
    qty: number;
    code: string;
    description: string;
    price: number;
    amount: number;
  }> = savedDeliveryItems.map((row) => {
    const pid = String(row.productId || '').trim();
    const qty = Number(row.quantity) || 0;
    const oi = order.items.find((x: any) => String(x.productId) === pid);
    const price =
      Number(row.unitPrice) > 0 ? Number(row.unitPrice) : Number(oi?.price) || 0;
    return {
      qty,
      code: String(row.sku || oi?.sku || pid || '—').trim() || '—',
      description: String(row.productName || oi?.productName || oi?.sku || '—').trim() || '—',
      price,
      amount: qty * price,
    };
  });

  // Si tenemos celdas facturadas guardadas en front, preferirlas sobre la API para NO agrupar productos duplicados.
  const hasDeliveredCellsInFront =
    savedDeliveryItems.some((x) => x && x.row != null && x.col != null) || false;
  const effectiveInvoiceLines =
    hasDeliveredCellsInFront ? linesFromStorageAsInvoice : (invoiceLinesFromApi.length > 0 ? invoiceLinesFromApi : linesFromStorageAsInvoice);

  const toInvoiceRows = effectiveInvoiceLines.map((line, idx) => {
    const code = String(line.code || '').trim();
    const normCode = code.replace(/-/g, '').toLowerCase();
    const oi =
      order.items.find((x: any) => String(x.sku || '').trim() === code) ||
      order.items.find((x: any) => String(x.productId) === code) ||
      (code.length >= 8
        ? order.items.find((x: any) => {
            const pid = String(x.productId || '').replace(/-/g, '').toLowerCase();
            return pid && (pid === normCode || String(x.productId) === code);
          })
        : undefined);
    return {
      key: `line-${idx}`,
      productId: String(oi?.productId || (line as any)?.productId || ''),
      productName: line.description,
      sku: line.code,
      imageUrl: (oi as any)?.imageUrl as string | undefined,
      qty: line.qty,
      price: line.price,
      lineTotal: line.amount,
    };
  });

  const invoiceRowMatchesOrderItem = (row: (typeof toInvoiceRows)[0], item: any) => {
    const code = String(row.sku || '').trim();
    const norm = code.replace(/-/g, '').toLowerCase();
    const pid = String(item.productId || '').replace(/-/g, '').toLowerCase();
    if (String(item.sku || '').trim() === code) return true;
    if (String(item.productId) === code) return true;
    if (row.productId && String(item.productId) === row.productId) return true;
    if (code.length >= 8 && pid && pid === norm) return true;
    return false;
  };

  const toInvoiceUnits = toInvoiceRows.reduce((s, r) => s + r.qty, 0);
  const toInvoiceTotal = toInvoiceRows.reduce((s, r) => s + r.lineTotal, 0);

  const invoiceItems = toInvoiceRows.map((row) => {
    const matched = order.items.find((item: any) => invoiceRowMatchesOrderItem(row, item));
    const familyId = String(
      matched?.familyId ?? matched?.FamilyId ?? matched?.categoryId ?? matched?.CategoryId ?? ''
    ).trim();
    const categoryName = String(matched?.category ?? '').trim().toLowerCase();
    const family = familyId
      ? allCategories.find((c) => sameFamilyId(String(c.id), familyId))
      : allCategories.find((c) => String(c.name || '').trim().toLowerCase() === categoryName) || null;
    const familyName = (family?.name || matched?.category || '').trim() || undefined;
    const familyCode = String(family?.code || '').trim() || undefined;
    const familySku = String(family?.sku || '').trim() || undefined;
    return {
      qty: row.qty,
      code: row.sku,
      description: row.productName,
      price: row.price,
      amount: row.lineTotal,
      familyId: familyId || undefined,
      familyName,
      familyCode,
      familySku,
    };
  });

  const isCancelled = matchesCancelledStatus(order?.status);

  /** Fase UI: prioriza líneas de la API como «facturado» aunque el status del pedido venga mal */
  const orderPhase = (() => {
    if (isCancelled) return 'cancelled';
    if (matchesInvoicedStatus(order?.status)) return 'invoiced';
    if (effectiveInvoiceLines.length > 0) {
      if (invoiceLinesFromApi.length > 0) return 'invoiced';
      return 'confirmed';
    }
    const s = (order?.status || '').toLowerCase().trim();
    if (['confirmed', 'completed', 'complete', 'confirmado', 'cerrado', 'closed'].includes(s)) return 'confirmed';
    const invRaw = order.invoiceId != null ? String(order.invoiceId).trim() : '';
    // Placeholder de factura offline: no es confirmación real; debe poder cancelarse como pedido inicial.
    if (invRaw !== '' && !isQueuedOfflineInvoiceId(invRaw)) return 'confirmed';
    return 'initial';
  })();

  const hasInvoiceId = order.invoiceId != null && String(order.invoiceId).trim() !== '';
  /** Factura ya cargada en pantalla (aunque el pedido aún no traiga `invoiceId` en el primer GET). */
  const hasInvoiceData =
    hasInvoiceId || (invoiceFromApi?.items?.length ?? 0) > 0;
  /**
   * CTA subir POD: no usar solo `podUploaded` (el backend a veces lo envía sin archivo).
   * Misma idea que menú POD: hay factura y no hay ruta de comprobante.
   */
  const showMissingPodUploadCta =
    !displayPod &&
    !loadingPod &&
    orderPhase !== 'initial' &&
    orderPhase !== 'cancelled' &&
    hasInvoiceData;

  const showBilledOrderBlock = orderPhase !== 'initial' && orderPhase !== 'cancelled';
  const showInvoiceSection = orderPhase !== 'initial' && orderPhase !== 'cancelled';
  /** Sin planograma: misma data en API, pero no se muestra documento ni textos de factura al vendedor. */
  const showInvoiceDocumentUi = showInvoiceSection && storeHasPlanogram;
  const showInvoiceRetry =
    storeHasPlanogram &&
    showInvoiceSection &&
    effectiveInvoiceLines.length === 0 &&
    ((order.invoiceId != null && String(order.invoiceId).trim() !== '') ||
      matchesInvoicedStatus(order.status) ||
      orderPhase === 'invoiced');

  /** Flujo: initial -> confirmed -> invoiced. */
  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    if (matchesCancelledStatus(status)) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (matchesInvoicedStatus(status)) return 'bg-green-50 text-green-700 border-green-200';
    if (s === 'confirmed' || ['completed', 'complete', 'confirmado'].includes(s)) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const getStatusText = (status: string) => {
    const s = (status || '').toLowerCase();
    if (matchesCancelledStatus(status)) return t('cancelled') || 'Cancelado';
    if (matchesInvoicedStatus(status))
      return storeHasPlanogram ? t('invoiced') || 'Facturado' : t('status_delivered');
    if (s === 'confirmed' || ['completed', 'complete', 'confirmado'].includes(s)) return t('confirmed');
    return t('initial');
  };

  const canSellerCancelInitial =
    orderPhase === 'initial' && invoiceLinesFromApi.length === 0 && !isCancelled;
  const canSellerEditInitial =
    orderPhase === 'initial' && invoiceLinesFromApi.length === 0 && !isCancelled;
  const showInitialOrderDetails = orderPhase !== 'invoiced' || showInitialOrderInvoiced;

  const handleCancelOrder = async () => {
    if (!canSellerCancelInitial || cancelling) return;
    if (typeof window !== 'undefined' && !window.confirm(t('cancel_order_confirm'))) return;
    setCancelling(true);
    try {
      const ok = await cancelOrderResilient(orderId);
      if (ok) {
        // Reflejar cancelación en caliente; en online va directo al backend.
        setOrder((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
        window.dispatchEvent(new CustomEvent('app-data-refresh'));
        router.push('/history');
      } else {
        alert(t('cancel_order_failed'));
      }
    } finally {
      setCancelling(false);
    }
  };

  const handlePrintInvoice = () => {
    setInvoicePrintLayout('normal');
    window.print();
  };

  const handlePrintTicket = () => {
    const prevMode = invoiceViewMode;
    setInvoiceViewMode('family');
    setInvoicePrintLayout('ticket');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setInvoicePrintLayout('normal');
        setInvoiceViewMode(prevMode);
      }, 200);
    }, 60);
  };

  /** URL de la imagen POD: data/base64 o URL absoluta se devuelve tal cual; nombre de archivo (S3) se resuelve vía backend. */
  const buildPodImageUrl = (podPath: string): string => {
    const raw = (podPath || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return getBackendAssetUrl('images/url/' + raw);
  };

  const podImageUrl = displayPod ? buildPodImageUrl(displayPod) : '';
  const isPodPath = displayPod && !displayPod.startsWith('data:') && !displayPod.startsWith('http');

  const vendorName =
    String((user as any)?.sellerCode || '').trim() ||
    [user?.name, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    order.vendorNumber ||
    '';
  const invoiceStoreDisplayName = invoiceStoreName || order.storeName || '';
  const cleanAddress = (addr: string) => (addr || '').replace(/,?\s*[0-9a-f-]{36}\s*$/i, '').replace(/,?\s*\d+\s*$/, '').trim();
  const invoiceStoreDisplayAddress = cleanAddress(invoiceStoreAddress || order.storeAddress || '');
  // La factura tiene su propio correlativo (InvoiceNumber). PO ya no aplica para mostrar factura.
  const invoiceNumberDisplay = String(
    invoiceFromApi?.invoiceNumber ?? (invoiceFromApi as any)?.InvoiceNumber ?? order.invoiceId ?? order.id ?? '—'
  );
  const poDisplay = String((order as any)?.po ?? '').trim();
  const headerMainNumber =
    storeHasPlanogram
      ? (orderPhase === 'initial' || orderPhase === 'cancelled'
          ? (poDisplay || invoiceNumberDisplay)
          : invoiceNumberDisplay)
      : '';
  const invoiceDate = invoiceFromApi?.date
    ? (invoiceFromApi.date.includes(',') ? invoiceFromApi.date : new Date(invoiceFromApi.date).toLocaleDateString('en-US'))
    : (order.date ? new Date(order.date).toLocaleDateString('en-US') : '—');

  const handleRetryInvoice = async () => {
    setLoadingInvoice(true);
    try {
      const hint = order.invoiceId ?? await ordersApi.getInvoiceIdForOrder(orderId)
        ?? (order.backendOrderId != null ? await ordersApi.getInvoiceIdForOrder(String(order.backendOrderId)) : null);
      const display = await ordersApi.getInvoiceDisplayForOrder(orderId, hint ?? undefined, order);
      setInvoiceFromApi(display ?? null);
      if (display?.pod) {
        setOrder((prev) =>
          prev ? { ...prev, podImageUrl: display.pod, podFileName: display.pod, podUploaded: true } : prev
        );
      }
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCapturePOD = () => {
    router.push(`/capture-pod/${orderId}`);
  };

  /** Pedido inicial → planograma bloqueado: cantidades del pedido; al facturar se crea la factura (POD aparte). */
  const handleStartInvoiceFromPlanogram = () => {
    const sid = String(order.storeId || '').trim();
    if (!sid) return;
    router.push(`/planogram/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}&mode=invoice`);
  };

  /** Pedido inicial (catálogo / sin planograma): facturar con cantidades; POD opcional después. */
  const handleStartConfirmFromCatalog = () => {
    const sid = String(order.storeId || '').trim();
    if (!sid) return;
    router.push(`/catalog-order/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}&mode=confirm`);
  };

  const handleViewPlanogram = () => {
    router.push(`/view-planogram/${orderId}`);
  };

  const handleEditInitialOrder = () => {
    const sid = String(order.storeId || '').trim();
    if (!sid) return;
    if (storeHasPlanogram) {
      router.push(`/planogram/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}`);
      return;
    }
    router.push(`/catalog-order/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Success Confirmation Banner */}
      {showConfirmation && (
        <div className="fixed top-16 left-0 right-0 z-50 bg-green-600 text-white px-4 py-3 shadow-lg animate-in slide-in-from-top">
          <div className="flex items-center gap-3 max-w-2xl mx-auto">
            <CheckCircle2 className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm">
                {matchesInvoicedStatus(order.status) || orderPhase === 'invoiced'
                  ? t('delivery_completed_success')
                  : t('order_sent_success')}
              </p>
              <p className="text-xs opacity-90">{invoiceStoreDisplayName || order.storeName} · {new Date(order.date).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white px-4 py-2 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/history')}
              className="p-2 h-auto -ml-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm text-slate-900 font-medium">
                {storeHasPlanogram ? `${headerMainNumber || invoiceNumberDisplay}` : t('order_detail')}
              </h2>
              <p className="text-xs text-slate-500 truncate">{invoiceStoreDisplayName || order.storeName} · {new Date(order.date).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={`${getStatusColor(order.status)} flex-shrink-0`}>
              {getStatusText(order.status)}
            </Badge>
          </div>
        </div>
      </div>

      <div className="px-4 pb-24 space-y-4">
        {orderPhase === 'cancelled' && (
          <Card className="border-slate-300 bg-slate-100 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm text-slate-800 font-medium">{t('order_cancelled')}</p>
              <p className="text-xs text-slate-600 mt-1">{t('order_cancelled_admin_only_delete')}</p>
            </CardContent>
          </Card>
        )}
        {/* Pedido / Tienda: resaltar PO, tienda como secundario */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <StoreIcon className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                {storeHasPlanogram ? (
                  <>
                    <p className="text-base font-semibold text-slate-900 mb-1.5">{headerMainNumber || invoiceNumberDisplay}</p>
                    <p className="text-xs text-slate-500 mb-0.5">{t('store')}: {invoiceStoreDisplayName || order.storeName || '—'}</p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-slate-900 mb-1">{invoiceStoreDisplayName || order.storeName || t('store')}</p>
                )}
                {(() => {
                  const addr = invoiceStoreDisplayAddress || order.storeAddress || '';
                  const city = invoiceStoreCity || '';
                  const ubicacion = [addr, city].filter(Boolean).join(', ');
                  return ubicacion ? (
                    <p className="text-xs text-slate-600 mb-1">{t('location')}: {ubicacion}</p>
                  ) : null;
                })()}
                <p className="text-xs text-slate-400">{t('order_date')}: {new Date(order.date).toLocaleDateString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pedido confirmado / facturado: mismo layout que pedido inicial (resumen + fechas + líneas + familias) */}
        {showBilledOrderBlock ? (
          <Card
            className={`shadow-sm overflow-hidden ${
              orderPhase === 'invoiced'
                ? 'border-green-200 bg-green-50/40'
                : 'border-blue-200 bg-blue-50/30'
            }`}
          >
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle
                className={`text-sm ${orderPhase === 'invoiced' ? 'text-green-950' : 'text-blue-950'}`}
              >
                {storeHasPlanogram
                  ? orderPhase === 'invoiced'
                    ? t('order_invoiced_title')
                    : t('order_confirmed_title')
                  : orderPhase === 'invoiced'
                    ? t('order_delivered_title')
                    : t('order_confirmed_title')}
              </CardTitle>
              {storeHasPlanogram ? (
                <>
                  <p className="text-xs text-slate-600 mt-1">
                    <span className="font-medium text-slate-700">{t('invoice')}</span>:{' '}
                    <span className="font-semibold text-slate-900">{invoiceNumberDisplay}</span>
                    {' · '}
                    {invoiceFromApi?.date
                      ? invoiceFromApi.date.includes(',')
                        ? invoiceFromApi.date
                        : new Date(invoiceFromApi.date).toLocaleDateString()
                      : new Date(order.date).toLocaleDateString()}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{t('invoice_doc_hint')}</p>
                </>
              ) : (
                <p className="text-xs text-slate-600 mt-1">
                  {new Date(order.date).toLocaleDateString()}
                </p>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-4">
              {showInvoiceRetry && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryInvoice}
                    disabled={loadingInvoice}
                  >
                    {loadingInvoice ? `${t('loading')}...` : (t('retry') || 'Reintentar factura')}
                  </Button>
                </div>
              )}
              {storeHasPlanogram && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <Button
                    type="button"
                    onClick={handleViewPlanogram}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Grid3x3 className="h-4 w-4 mr-2" />
                    {t('view_planogram')}
                  </Button>
                </div>
              )}
              {toInvoiceRows.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-100">
                      <Package className="h-5 w-5 text-slate-600 mx-auto mb-1" />
                      <p className="text-lg text-slate-900">{toInvoiceRows.length}</p>
                      <p className="text-xs text-slate-500">{t('products')}</p>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-indigo-100">
                      <Grid3x3 className="h-5 w-5 text-indigo-600 mx-auto mb-1" />
                      <p className="text-lg text-indigo-900">{toInvoiceUnits}</p>
                      <p className="text-xs text-indigo-600">{t('units')}</p>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-green-100">
                      <DollarSign className="h-5 w-5 text-green-600 mx-auto mb-1" />
                      <p className="text-lg text-green-900">${toInvoiceTotal.toFixed(2)}</p>
                      <p className="text-xs text-green-600">{t('total')}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('order_date')}:</span>
                      <span className="text-slate-900">{new Date(order.date).toLocaleDateString()}</span>
                    </div>
                    {order.deliveryDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('delivery_date')}:</span>
                        <span className="text-slate-900">{new Date(order.deliveryDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    {storeHasPlanogram && orderPhase === 'invoiced' && invoiceFromApi?.date && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('invoice_date_row')}</span>
                        <span className="text-slate-900">
                          {invoiceFromApi.date.includes(',')
                            ? invoiceFromApi.date
                            : new Date(invoiceFromApi.date).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-2">
                      {storeHasPlanogram ? t('order_billed_items') : t('order_items_summary')}
                    </p>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white overflow-hidden">
                      {toInvoiceRows.map((row) => (
                        <div key={row.key} className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            {row.imageUrl && !productImageError[String(row.key)] ? (
                              <img
                                src={row.imageUrl}
                                alt=""
                                className="w-10 h-10 rounded object-cover flex-shrink-0"
                                onError={() => {
                                  if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                    setProductImageError((prev) => ({
                                      ...prev,
                                      [String(row.key)]: true,
                                    }));
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                                <Package className="h-5 w-5 text-slate-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-900 mb-1">{row.productName}</p>
                              <p className="text-xs text-slate-500 mb-2">{row.sku}</p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
                                  {row.qty} {t('units')}
                                </Badge>
                                <span className="text-xs text-slate-500">× ${row.price.toFixed(2)}</span>
                              </div>
                            </div>
                            <p className="text-sm text-slate-900">${row.lineTotal.toFixed(2)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {allCategories.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-700 mb-2">{t('family_col') || 'Family'}</p>
                      <table className="w-full min-w-[280px] overflow-hidden rounded-lg border border-slate-200 text-sm shadow-sm bg-white">
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                              {t('family_col') || 'Family'}
                            </th>
                            <th className="w-14 border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                              {t('pcs_col') || 'Pcs'}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {[...allCategories]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((cat) => {
                              const pcs = toInvoiceRows.reduce((sum, row) => {
                                const oi = order.items.find((item: any) => invoiceRowMatchesOrderItem(row, item));
                                if (!oi) return sum;
                                return orderItemMatchesFamily(oi as any, cat, allCategories) ? sum + row.qty : sum;
                              }, 0);
                              return (
                                <tr key={cat.id} className="bg-slate-50/80">
                                  <td className="px-3 py-2.5 align-top">
                                    <FamilySummaryCell cat={cat} />
                                  </td>
                                  <td className="px-3 py-2.5 text-left align-middle bg-white">
                                    <span className="tabular-nums text-slate-900">{pcs}</span>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600 py-2">{t('invoice_no_items')}</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Factura imprimible: solo tiendas con planograma (catálogo crea factura en backend sin mostrarla). */}
        {showInvoiceDocumentUi ? (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t('invoice')}</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium ${
                      invoiceViewMode === 'product' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'
                    }`}
                    onClick={() => setInvoiceViewMode('product')}
                  >
                    {t('invoice_tab_products')}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium border-l border-slate-200 ${
                      invoiceViewMode === 'family' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'
                    }`}
                    onClick={() => setInvoiceViewMode('family')}
                  >
                    {t('invoice_tab_families')}
                  </button>
                </div>
                {showInvoiceRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryInvoice}
                    disabled={loadingInvoice}
                  >
                    {loadingInvoice ? t('loading') + '...' : (t('retry') || 'Reintentar factura')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintInvoice}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {t('print')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintTicket}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {t('print_ticket')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <Invoice
              invoiceNumber={String(invoiceNumberDisplay ?? '—')}
              date={typeof invoiceDate === 'string' && invoiceDate.includes(',') ? invoiceDate : new Date(invoiceDate).toLocaleDateString('en-US')}
              vendorName={vendorName}
              storeName={invoiceStoreDisplayName}
              storeAddress={invoiceStoreDisplayAddress}
              items={invoiceItems}
              comments={order.comments || ''}
              viewMode={invoiceViewMode}
              printLayout={invoicePrintLayout}
            />
          </CardContent>
        </Card>
        ) : null}

        {/* Sección POD: en inicial se muestra abajo del pedido; cancelados no aplican POD */}
        {orderPhase !== 'initial' && orderPhase !== 'cancelled' && (
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('delivery_proof') || 'Comprobante de entrega (POD)'}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {displayPod ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  <p className="text-xs text-slate-500">
                    {t('pod_uploaded') || 'Comprobante registrado'}
                  </p>
                </div>
                {/* Ruta que viene de la BD (ej. /imagenes/dani.png) */}
                {isPodPath && (
                  <p className="text-xs text-slate-500 font-mono break-all">{displayPod}</p>
                )}
                {/* Imagen: se lee desde tu laptop (base + ubicación de la BD) y se sirve por /api/pod-image */}
                {podImageUrl && (
                  <div className="relative w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-50 min-h-[200px] flex items-center justify-center">
                    {podImageError ? (
                      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                        <p className="text-sm text-amber-700 mb-1">No se pudo cargar la imagen</p>
                        <p className="text-xs text-slate-500 mb-2">Ruta: {displayPod}</p>
                        <a href={podImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 underline break-all">
                          Abrir enlace
                        </a>
                      </div>
                    ) : (
                      <img
                        key={podImageUrl}
                        src={podImageUrl}
                        alt={t('delivery_proof') || 'Comprobante de entrega (POD)'}
                        className="w-full max-h-[320px] object-contain"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setPodImageError(false)}
                        onError={() => setPodImageError(true)}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : loadingPod ? (
              <p className="text-sm text-slate-600">Cargando comprobante...</p>
            ) : showMissingPodUploadCta ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs text-amber-900 font-medium">{t('waiting_pod')}</p>
                  <p className="text-xs text-amber-800 mt-1">{t('pod_detail_upload_hint')}</p>
                </div>
                <Button
                  onClick={handleCapturePOD}
                  className="w-full bg-amber-600 hover:bg-amber-700"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {t('capture_pod')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {storeHasPlanogram
                  ? t('pod_already_invoiced') || 'Este pedido ya está facturado y no requiere cargar POD aquí.'
                  : t('pod_complete_catalog') ||
                    'El comprobante y el pedido ya están registrados.'}
              </p>
            )}
          </CardContent>
        </Card>
        )}

        {/* Pedido inicial */}
        <Card className="border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm text-amber-950">{t('order_initial_title')}</CardTitle>
              <div className="flex items-center gap-2">
                {orderPhase === 'invoiced' && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors px-1 py-0.5"
                    onClick={() => setShowInitialOrderInvoiced((v) => !v)}
                  >
                    <span className="font-medium">
                      {showInitialOrderInvoiced ? 'Ocultar pedido inicial' : 'Ver pedido inicial'}
                    </span>
                    {showInitialOrderInvoiced ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {canSellerEditInitial && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-amber-300 bg-white hover:bg-amber-100 text-amber-900"
                    onClick={handleEditInitialOrder}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {t('edit_order') || 'Editar pedido'}
                  </Button>
                )}
                {canSellerCancelInitial && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-amber-200 bg-white text-amber-800 hover:bg-amber-100"
                    onClick={handleCancelOrder}
                    disabled={cancelling}
                  >
                    <Ban className="h-3.5 w-3.5 mr-1" />
                    {cancelling ? t('loading') : t('cancel_order')}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
              {showInitialOrderDetails ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-white rounded-lg border border-slate-100">
                    <Package className="h-5 w-5 text-slate-600 mx-auto mb-1" />
                    <p className="text-lg text-slate-900">{order.items.length}</p>
                    <p className="text-xs text-slate-500">{t('products')}</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border border-indigo-100">
                    <Grid3x3 className="h-5 w-5 text-indigo-600 mx-auto mb-1" />
                    <p className="text-lg text-indigo-900">{totalUnits}</p>
                    <p className="text-xs text-indigo-600">{t('units')}</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border border-green-100">
                    <DollarSign className="h-5 w-5 text-green-600 mx-auto mb-1" />
                    <p className="text-lg text-green-900">${displayTotal.toFixed(2)}</p>
                    <p className="text-xs text-green-600">{t('total')}</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('order_date')}:</span>
                    <span className="text-slate-900">{new Date(order.date).toLocaleDateString()}</span>
                  </div>
                  {order.deliveryDate && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('delivery_date')}:</span>
                      <span className="text-slate-900">{new Date(order.deliveryDate).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                {storeHasPlanogram && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <Button
                      type="button"
                      onClick={handleViewPlanogram}
                      className="w-full bg-indigo-600 hover:bg-indigo-700"
                    >
                      <Grid3x3 className="h-4 w-4 mr-2" />
                      {t('view_planogram')}
                    </Button>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-2">{t('order_initial_items')}</p>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white overflow-hidden">
                    {order.items.map((item: any, index: number) => {
                      const quantity = item.toOrder || item.quantity || 0;
                      const price = item.price ?? 0;
                      const imgUrl = item.imageUrl;
                      return (
                        <div key={index} className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            {imgUrl && !productImageError[String(item.productId ?? index)] ? (
                              <img
                                src={imgUrl}
                                alt=""
                                className="w-10 h-10 rounded object-cover flex-shrink-0"
                                onError={() => {
                                  if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                    setProductImageError((prev) => ({
                                      ...prev,
                                      [String(item.productId ?? index)]: true,
                                    }));
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                                <Package className="h-5 w-5 text-slate-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-900 mb-1">{item.productName}</p>
                              <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
                                  {quantity} {t('units')}
                                </Badge>
                                <span className="text-xs text-slate-500">× ${price.toFixed(2)}</span>
                              </div>
                            </div>
                            <p className="text-sm text-slate-900">${(quantity * price).toFixed(2)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {allCategories.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-2">{t('family_col') || 'Family'}</p>
                    <table className="w-full min-w-[280px] overflow-hidden rounded-lg border border-slate-200 text-sm shadow-sm bg-white">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                            {t('family_col') || 'Family'}
                          </th>
                          <th className="w-14 border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                            {t('pcs_col') || 'Pcs'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...allCategories]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((cat) => {
                            const pcs = (order.items || []).reduce(
                              (sum: number, item: any) => {
                                const qty = item.toOrder ?? item.quantity ?? 0;
                                return orderItemMatchesFamily(item, cat, allCategories) ? sum + qty : sum;
                              },
                              0
                            );
                            return (
                              <tr key={cat.id} className="bg-slate-50/80">
                                <td className="px-3 py-2.5 align-top">
                                  <FamilySummaryCell cat={cat} />
                                </td>
                                <td className="px-3 py-2.5 text-left align-middle bg-white">
                                  <span className="tabular-nums text-slate-900">{pcs}</span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
                {orderPhase === 'initial' && (
                  order.storeId ? (
                    storeHasPlanogram ? (
                      <Button
                        onClick={handleStartInvoiceFromPlanogram}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        Facturar pedido (planograma)
                      </Button>
                    ) : (
                      <Button
                        onClick={handleStartConfirmFromCatalog}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        Facturar pedido (catálogo)
                      </Button>
                    )
                  ) : (
                    <p className="text-xs text-amber-700">Falta tienda en el pedido; no se puede continuar.</p>
                  )
                )}
              </div>
              ) : null}
          </CardContent>
        </Card>

        {/* Sección POD: para pedido inicial va debajo del bloque inicial */}
        {orderPhase === 'initial' && (
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('delivery_proof') || 'Comprobante de entrega (POD)'}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {displayPod ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  <p className="text-xs text-slate-500">
                    {t('pod_uploaded') || 'Comprobante registrado'}
                  </p>
                </div>
                {isPodPath && (
                  <p className="text-xs text-slate-500 font-mono break-all">{displayPod}</p>
                )}
                {podImageUrl && (
                  <div className="relative w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-50 min-h-[200px] flex items-center justify-center">
                    {podImageError ? (
                      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                        <p className="text-sm text-amber-700 mb-1">No se pudo cargar la imagen</p>
                        <p className="text-xs text-slate-500 mb-2">Ruta: {displayPod}</p>
                        <a href={podImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 underline break-all">
                          Abrir enlace
                        </a>
                      </div>
                    ) : (
                      <img
                        key={podImageUrl}
                        src={podImageUrl}
                        alt={t('delivery_proof') || 'Comprobante de entrega (POD)'}
                        className="w-full max-h-[320px] object-contain"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setPodImageError(false)}
                        onError={() => setPodImageError(true)}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {storeHasPlanogram
                  ? 'Revisa el pedido inicial y luego usa el botón de facturar.'
                  : 'Revisa el pedido inicial y luego confirma el pedido.'}
              </p>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
