'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, 
  Store as StoreIcon, 
  Package, 
  DollarSign,
  Grid3x3,
  Printer,
  Download,
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
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi } from '@/shared/api/distributions-api';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import {
  collectPresentationRowsFromGrid,
  collectPresentationRowsFromOrderLines,
  getPresentationSummaryKey,
  getProductFromMap,
  sumQtyForPresentation,
  type PlanogramPresentationSummaryRow,
} from '@/shared/utils/planogram-presentation-summary';
import { PresentationSummaryCell } from '@/shared/components/presentation-summary-cell';
import type { ProductForUI } from '@/shared/api/products-api';
import { getBackendAssetUrl } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Separator } from '@/shared/ui/separator';
import { getSalesRouteCodeById } from '@/shared/api/sales-routes-api';
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

function invoiceVolLabel(volume?: number, unit?: string): string {
  if (volume == null || !Number.isFinite(Number(volume))) return '';
  const u = String(unit || '').trim();
  return u ? `${volume} ${u}` : String(volume);
}

export type InvoiceDisplayState = {
  invoiceNumber: string;
  date: string;
  total: number;
  items: Array<{
    qty: number;
    code: string;
    sku?: string;
    description: string;
    price: number;
    amount: number;
    /** Id de línea de pedido / detalle factura — necesario para no colapsar presentaciones al resolver por SKU duplicado. */
    productId?: string;
  }>;
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

function detailLineQty(item: any): number {
  return Number(item?.quantity ?? item?.toOrder ?? 0) || 0;
}

function effectiveUnitPriceFromDetailItem(item: any): number {
  const qty = detailLineQty(item);
  const p =
    Number(
      item?.price ??
        item?.unitPrice ??
        item?.UnitPrice ??
        item?.Price ??
        item?.listPrice ??
        item?.ListPrice ??
        item?.salePrice ??
        item?.SalePrice ??
        item?.product?.unitPrice ??
        item?.product?.price ??
        item?.product?.listPrice ??
        item?.product?.currentPrice ??
        item?.Product?.UnitPrice ??
        item?.Product?.Price ??
        item?.Product?.ListPrice ??
        item?.Product?.CurrentPrice ??
        0
    ) || 0;
  if (p > 0) return p;
  const amt =
    Number(
      item?.amount ??
        item?.Amount ??
        item?.lineTotal ??
        item?.LineTotal ??
        item?.subtotal ??
        item?.Subtotal ??
        0
    ) || 0;
  if (qty > 0 && amt > 0) return amt / qty;
  return 0;
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
  const [invoiceViewMode, setInvoiceViewMode] = useState<'product' | 'family'>('family');
  const [invoicePrintLayout, setInvoicePrintLayout] = useState<'normal' | 'ticket'>('normal');
  /** Código de ruta vía GET /salesRoutes/{id} cuando el perfil no trae sellerCode ni salesRouteCode. */
  const [vendorRouteFetched, setVendorRouteFetched] = useState('');

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
  const [familyIdByProductId, setFamilyIdByProductId] = useState<Record<string, string>>({});
  const [productMap, setProductMap] = useState<Map<string, ProductForUI>>(() => new Map());
  /** Productos del pedido vía GET por id (misma fuente que Admin) — el listado suele traer menos datos de presentación y rompe la agrupación en factura. */
  const [invoiceProductById, setInvoiceProductById] = useState<Map<string, ProductForUI>>(() => new Map());
  const [storeHasPlanogram, setStoreHasPlanogram] = useState<boolean | null>(null);
  const [planogramSummaryRows, setPlanogramSummaryRows] = useState<PlanogramPresentationSummaryRow[]>([]);

  const orderProductIdsKey = useMemo(() => {
    if (!order?.items?.length) return '';
    return [
      ...new Set(order.items.map((i: any) => String(i.productId || '').trim()).filter(Boolean)),
    ]
      .sort()
      .join(',');
  }, [order?.items]);

  useEffect(() => {
    if (!orderProductIdsKey) {
      setInvoiceProductById(new Map());
      return;
    }
    let cancelled = false;
    const ids = orderProductIdsKey.split(',').filter(Boolean);
    void (async () => {
      const m = new Map<string, ProductForUI>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const p = await productsApi.getById(id);
            if (p && !cancelled) {
              m.set(String(p.id), p);
              const n = Number(id);
              if (!Number.isNaN(n)) m.set(String(n), p);
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setInvoiceProductById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id, orderProductIdsKey]);

  useEffect(() => {
    categoriesApi.fetchAll().then(setAllCategories);
  }, []);

  useEffect(() => {
    productsApi.fetchAll().then((list) => {
      const acc: Record<string, string> = {};
      const m = new Map<string, ProductForUI>();
      for (const p of list) {
        const fid = String(p.familyId ?? p.categoryId ?? '').trim();
        if (fid) {
          acc[String(p.id)] = fid;
          const n = Number(p.id);
          if (!Number.isNaN(n)) acc[String(n)] = fid;
        }
        m.set(String(p.id), p);
        const n = Number(p.id);
        if (!Number.isNaN(n)) m.set(String(n), p);
      }
      setFamilyIdByProductId(acc);
      setProductMap(m);
    });
  }, []);

  /**
   * Misma regla que Admin `OrderDetailView`: rejilla de presentaciones del plano solo si la tienda no es solo-catálogo
   * y el pedido tiene `planogramId` (pedido creado desde planograma).
   */
  const isCatalogOnlyStore = storeHasPlanogram === false;
  const orderHasPlanogramRecord = !!(order?.planogramId && String(order.planogramId).trim());
  const usePlanogramGridForPresentationSummary = !isCatalogOnlyStore && orderHasPlanogramRecord;
  /** Factura/POD en flujo vendedor: igual que antes, solo se oculta si la tienda es explícitamente sin planograma. */
  const usePlanogramWorkflowUi = storeHasPlanogram !== false;
  const showPhysicalPlanogramButton = storeHasPlanogram === true;

  const presentationRowsOrderSummary = useMemo(() => {
    if (!usePlanogramGridForPresentationSummary || !order) return [];
    if (planogramSummaryRows.length > 0) return planogramSummaryRows;
    return collectPresentationRowsFromOrderLines(order.items || [], productMap);
  }, [usePlanogramGridForPresentationSummary, order, productMap, planogramSummaryRows]);

  /** Catálogo (o sin rejilla): presentaciones solo a partir de líneas del pedido. */
  const catalogPresentationRowsFromOrder = useMemo(() => {
    if (usePlanogramGridForPresentationSummary || !order) return [];
    return collectPresentationRowsFromOrderLines(order.items || [], productMap);
  }, [usePlanogramGridForPresentationSummary, order, productMap]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!usePlanogramGridForPresentationSummary || !order?.planogramId || productMap.size === 0) {
        if (mounted) setPlanogramSummaryRows([]);
        return;
      }
      try {
        const planogramId = String(order.planogramId).trim();
        let distributions = await distributionsApi.getByPlanogram(planogramId);
        if (!distributions.length) {
          const active = await planogramsApi.getActive();
          if (active?.id) {
            distributions = await distributionsApi.getByPlanogram(String(active.id));
          }
        }
        const cells = distributions.map((d) => ({
          productId: String(d.productId ?? '').trim(),
        }));
        const rows = collectPresentationRowsFromGrid(cells, productMap);
        if (mounted) setPlanogramSummaryRows(rows);
      } catch {
        if (mounted) setPlanogramSummaryRows([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [usePlanogramGridForPresentationSummary, order?.planogramId, productMap]);

  const productForInvoiceLine = useCallback(
    (productId: string | undefined) => {
      const pid = String(productId ?? '').trim();
      if (!pid) return undefined;
      return getProductFromMap(invoiceProductById, pid) ?? getProductFromMap(productMap, pid);
    },
    [invoiceProductById, productMap]
  );

  const resolveLineForFamilyMatch = (item: any) => {
    if (!item) return item;
    const pid = String(item.productId ?? item.ProductId ?? '').trim();
    let fid = String(item.familyId ?? item.categoryId ?? item.FamilyId ?? item.CategoryId ?? '').trim();
    if (!fid && pid) {
      fid = familyIdByProductId[pid] ?? familyIdByProductId[String(Number(pid))] ?? '';
    }
    return fid ? { ...item, familyId: fid } : item;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sc = String(user?.sellerCode || '').trim();
      const src = String(user?.salesRouteCode || '').trim();
      if (sc || src) {
        if (!cancelled) setVendorRouteFetched('');
        return;
      }
      const rid = String(user?.salesRouteId || '').trim();
      if (!rid) {
        if (!cancelled) setVendorRouteFetched('');
        return;
      }
      const code = await getSalesRouteCodeById(rid);
      if (!cancelled) setVendorRouteFetched(code || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.sellerCode, user?.salesRouteCode, user?.salesRouteId]);

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
        const itemNeedsResolvedPrice = (i: any) =>
          detailLineQty(i) > 0 && effectiveUnitPriceFromDetailItem(i) <= 0;
        const needsPrice = apiOrder.items.some(itemNeedsResolvedPrice);
        const needsProductName = apiOrder.items.some(
          (i: any) => String(i.productId ?? i.ProductId ?? '').trim() && !(i.productName || i.sku || '').trim()
        );
        const needsImage = apiOrder.items.some(
          (i: any) => String(i.productId ?? i.ProductId ?? '').trim() && !i.imageUrl
        );
        const needsCategory = apiOrder.items.some(
          (i: any) => String(i.productId ?? i.ProductId ?? '').trim() && (i.category == null || i.category === '')
        );
        const needsFamilyId = apiOrder.items.some(
          (i: any) =>
            String(i.productId ?? i.ProductId ?? '').trim() &&
            !(i.familyId ?? i.categoryId ?? i.FamilyId ?? i.CategoryId)
        );
        /** Alinear nombre mostrado con catálogo (shortName) aunque el API envíe nombre largo. */
        const needsCatalogSnapshot = apiOrder.items.some((i: any) =>
          String(i.productId ?? i.ProductId ?? '').trim()
        );
        const needsComputedTotals =
          (Number(apiOrder.total) <= 0 || Number(apiOrder.subtotal) <= 0) &&
          apiOrder.items.some((i: any) => detailLineQty(i) > 0);
        if (
          needsPrice ||
          needsProductName ||
          needsImage ||
          needsCategory ||
          needsFamilyId ||
          needsCatalogSnapshot ||
          needsComputedTotals
        ) {
          const enrichedItems = await Promise.all(
            apiOrder.items.map(async (item: any) => {
              const pid = String(item.productId ?? item.ProductId ?? '').trim();
              let productName = (item.productName || item.sku || '').trim();
              let price = effectiveUnitPriceFromDetailItem(item);
              let imageUrl = item.imageUrl;
              let category = (item.category || '').trim();
              let familyId = String(item.familyId ?? item.FamilyId ?? item.categoryId ?? item.CategoryId ?? '').trim();
              let product: Awaited<ReturnType<typeof productsApi.getById>> = null;
              if (pid) {
                product = await productsApi.getById(pid);
                if (product) {
                  const sn = String(product.shortName ?? '').trim();
                  productName = (sn || productName || product.name || product.code || product.sku || '').trim();
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
                if (!price && product) {
                  const presId = String(product.presentationId ?? '').trim();
                  if (presId) price = await histpricesApi.getLatest(presId);
                }
              }
              return {
                ...item,
                productId: pid || item.productId,
                productName: productName || item.productName,
                price,
                imageUrl: imageUrl || item.imageUrl,
                category: category || item.category,
                familyId: familyId || item.familyId,
                categoryId: familyId || item.categoryId,
              };
            })
          );
          const computedSubtotal = enrichedItems.reduce(
            (s: number, i: any) => s + detailLineQty(i) * (Number(i.price) || 0),
            0
          );
          orderToSet = {
            ...apiOrder,
            items: enrichedItems,
            subtotal: apiOrder.subtotal || computedSubtotal,
            total: apiOrder.total || computedSubtotal + (apiOrder.tax || 0),
          };
        }
        {
          const items = orderToSet.items || [];
          const recomputed = items.reduce(
            (s: number, i: any) => s + detailLineQty(i) * (effectiveUnitPriceFromDetailItem(i) || Number(i.price) || 0),
            0
          );
          if (recomputed > 0) {
            const tax = Number(orderToSet.tax ?? 0);
            if (Number(orderToSet.subtotal) <= 0) {
              orderToSet = { ...orderToSet, subtotal: recomputed };
            }
            if (Number(orderToSet.total) <= 0) {
              orderToSet = { ...orderToSet, total: recomputed + tax };
            }
          }
        }
        if (cancelled) return;
        setOrder(orderToSet);
        const name = (orderToSet.storeName || '').trim();
        const sid = String(orderToSet.storeId || '').trim();
        const orderPgId = String((orderToSet as any).planogramId ?? '').trim();
        const inferPlanogramFromOrder = () => (orderPgId ? true : null);
        let resolvedStore: Awaited<ReturnType<typeof storesApi.fetchStoreById>> = null;
        if (sid) {
          try {
            resolvedStore = await storesApi.fetchStoreById(sid);
          } catch {
            resolvedStore = null;
          }
        }
        if (resolvedStore) {
          setStoreHasPlanogram(resolvedStore.hasPlanogram !== false);
          const looksLikeId = !name || name === sid || /^[0-9a-f-]{36}$/i.test(name) || /^\d+$/.test(name);
          if (looksLikeId) {
            setInvoiceStoreName(resolvedStore.name);
            setInvoiceStoreAddress((resolvedStore.address || '').trim());
            const cityRaw = (resolvedStore.city || '').trim();
            if (cityRaw && citiesApi.looksLikeCityId(cityRaw)) {
              try {
                const cityName = await citiesApi.getCityNameById(cityRaw);
                setInvoiceStoreCity(cityName);
              } catch {
                setInvoiceStoreCity(cityRaw);
              }
            } else {
              setInvoiceStoreCity(cityRaw);
            }
          } else {
            setInvoiceStoreName(name || resolvedStore.name || orderToSet.storeName || '—');
            setInvoiceStoreAddress(orderToSet.storeAddress || '');
            setInvoiceStoreCity('');
          }
        } else {
          setStoreHasPlanogram(inferPlanogramFromOrder());
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

  const initialLineUnits = order.items.reduce((s, i) => s + (Number(i.toOrder ?? i.quantity ?? 0) || 0), 0);
  const totalUnits = order.totalUnits ?? initialLineUnits;
  const subtotalFromItems = order.items.reduce(
    (s, i) =>
      s +
      (Number(i.toOrder ?? i.quantity ?? 0) || 0) * effectiveUnitPriceFromDetailItem(i as any),
    0
  );
  const displayTotal =
    Number(order.total) > 0 ? Number(order.total) : subtotalFromItems;

  /** Líneas tal como en la factura: primero GET factura; si aún no hay, mismo shape desde localStorage. */
  const invoiceLinesFromApi =
    invoiceFromApi?.items && invoiceFromApi.items.length > 0 ? invoiceFromApi.items : [];

  const linesFromStorageAsInvoice: Array<{
    qty: number;
    code: string;
    sku?: string;
    description: string;
    price: number;
    amount: number;
  }> = savedDeliveryItems.map((row) => {
    const pid = String(row.productId || '').trim();
    const qty = Number(row.quantity) || 0;
    const oi = order.items.find((x: any) => String(x.productId) === pid);
    const price =
      Number(row.unitPrice) > 0 ? Number(row.unitPrice) : Number(oi?.price) || 0;
    const skuVal = String(row.sku || oi?.sku || '').trim();
    const p = productForInvoiceLine(pid);
    const fullName = String(p?.name || row.productName || oi?.productName || oi?.sku || '—').trim() || '—';
    const skuFromProduct = String(p?.commerceSku ?? '').trim();
    const lineSku = skuVal || skuFromProduct;
    return {
      qty,
      code: String(lineSku || pid || '—').trim() || '—',
      ...(lineSku ? { sku: lineSku } : {}),
      description: fullName,
      price,
      amount: qty * price,
      ...(pid ? { productId: pid } : {}),
    };
  });

  /** Catálogo / factura sin líneas en API: mismo criterio que rellenar totales desde ítems del pedido. */
  const linesFromOrderAsInvoice: Array<{
    qty: number;
    code: string;
    sku?: string;
    description: string;
    price: number;
    amount: number;
    productId?: string;
  }> = (order.items || [])
    .map((it: any) => {
      const qty = Number(it.toOrder ?? it.quantity ?? 0) || 0;
      if (qty <= 0) return null;
      const pid = String(it.productId ?? it.ProductId ?? '').trim();
      const sku = String(it.sku ?? it.Sku ?? '').trim();
      const price = Number(it.price ?? it.unitPrice ?? 0) || 0;
      const code = String(sku || pid || '—').trim() || '—';
      return {
        qty,
        code,
        ...(sku ? { sku } : {}),
        description: String(it.productName ?? '').trim() || '—',
        price,
        amount: qty * price,
        ...(pid ? { productId: pid } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Si tenemos celdas facturadas guardadas en front, preferirlas sobre la API para NO agrupar productos duplicados.
  const hasDeliveredCellsInFront =
    savedDeliveryItems.some((x) => x && x.row != null && x.col != null) || false;
  const effectiveInvoiceLines = hasDeliveredCellsInFront
    ? linesFromStorageAsInvoice
    : invoiceLinesFromApi.length > 0
      ? invoiceLinesFromApi
      : linesFromStorageAsInvoice.length > 0
        ? linesFromStorageAsInvoice
        : linesFromOrderAsInvoice;

  /** Solo factura API o entrega guardada en front — no el fallback del pedido (evita marcar «confirmado» pedidos iniciales). */
  const hasBillingLinesFromApiOrStorage = hasDeliveredCellsInFront
    ? linesFromStorageAsInvoice.length > 0
    : invoiceLinesFromApi.length > 0 || linesFromStorageAsInvoice.length > 0;

  const toInvoiceRows = effectiveInvoiceLines.map((line, idx) => {
    const code = String(line.code || '').trim();
    const normCode = code.replace(/-/g, '').toLowerCase();
    const linePid = String((line as { productId?: string }).productId || '').trim();
    const oi =
      (linePid
        ? order.items.find(
            (x: any) =>
              String(x.productId ?? x.ProductId ?? '') === linePid ||
              String(x.productId ?? x.ProductId ?? '') === String(Number(linePid))
          )
        : undefined) ||
      order.items.find((x: any) => String(x.sku || '').trim() === code) ||
      order.items.find((x: any) => String(x.productId) === code) ||
      (code.length >= 8
        ? order.items.find((x: any) => {
            const pid = String(x.productId || '').replace(/-/g, '').toLowerCase();
            return pid && (pid === normCode || String(x.productId) === code);
          })
        : undefined);
    const pidEff = linePid || String(oi?.productId || '').trim();
    const p = productForInvoiceLine(pidEff);
    const lineSkuRaw = String((line as { sku?: string }).sku || '').trim();
    const internalCode = String(p?.internalCode ?? '').trim();
    const pCommerce = String(p?.commerceSku ?? '').trim();
    /** La API de factura a veces envía el código interno ("01") en `sku`; el SKU real va en el producto. */
    const lineSkuMisleading =
      lineSkuRaw &&
      internalCode &&
      lineSkuRaw.toLowerCase() === internalCode.toLowerCase();
    const lineSkuUse = lineSkuMisleading ? '' : lineSkuRaw;
    const oiSkuRaw = String(oi?.sku ?? '').trim();
    const oiSkuMisleading =
      oiSkuRaw &&
      internalCode &&
      oiSkuRaw.toLowerCase() === internalCode.toLowerCase();
    const oiSku = oiSkuMisleading ? '' : oiSkuRaw;
    const displaySku = pCommerce || lineSkuUse || oiSku;
    const productName = String(p?.name || line.description || oi?.productName || '—').trim() || '—';
    const qty = Number(line.qty ?? 0) || 0;
    const apiPrice = Number(line.price ?? 0) || 0;
    const apiAmount = Number(line.amount ?? 0) || 0;
    const oiUnit = Number(oi?.price ?? (oi as any)?.unitPrice ?? 0) || 0;
    let unitPrice = apiPrice > 0 ? apiPrice : oiUnit;
    let lineTotal = apiAmount > 0 ? apiAmount : qty * unitPrice;
    if (lineTotal <= 0 && qty > 0 && unitPrice > 0) lineTotal = qty * unitPrice;
    if (unitPrice <= 0 && qty > 0 && lineTotal > 0) unitPrice = lineTotal / qty;
    return {
      key: `line-${idx}`,
      productId: pidEff,
      productName,
      matchKey: code,
      displaySku,
      imageUrl: (oi as any)?.imageUrl as string | undefined,
      qty,
      price: unitPrice,
      lineTotal,
    };
  });

  const invoiceRowMatchesOrderItem = (row: (typeof toInvoiceRows)[0], item: any) => {
    const code = String(row.matchKey || '').trim();
    const norm = code.replace(/-/g, '').toLowerCase();
    const pid = String(item.productId || '').replace(/-/g, '').toLowerCase();
    if (String(item.sku || '').trim() === code) return true;
    if (String(item.productId) === code) return true;
    if (row.productId && String(item.productId) === row.productId) return true;
    if (code.length >= 8 && pid && pid === norm) return true;
    return false;
  };

  const presentationRowsInvoiceSummary = usePlanogramGridForPresentationSummary
    ? (planogramSummaryRows.length > 0 ? planogramSummaryRows : presentationRowsOrderSummary)
    : [];
  const invoiceSummaryCells = hasDeliveredCellsInFront
    ? savedDeliveryItems
        .map((row) => ({
          productId: String(row.productId ?? '').trim(),
          quantity: Number(row.quantity ?? 0) || 0,
        }))
        .filter((r) => r.productId && r.quantity > 0)
    : toInvoiceRows
        .map((row) => ({
          productId: String(row.productId ?? '').trim(),
          quantity: Number(row.qty ?? 0) || 0,
        }))
        .filter((r) => r.productId && r.quantity > 0);

  const catalogPresentationRowsFromInvoice = !usePlanogramGridForPresentationSummary
    ? collectPresentationRowsFromOrderLines(invoiceSummaryCells, productMap)
    : [];

  const toInvoiceUnits = toInvoiceRows.reduce((s, r) => s + r.qty, 0);
  const toInvoiceTotal = toInvoiceRows.reduce((s, r) => s + r.lineTotal, 0);

  const invoiceItems = toInvoiceRows.map((row) => {
    const rowPid = String(row.productId || '').trim();
    let matched = rowPid
      ? (order.items.find(
          (item: any) =>
            String(item.productId ?? item.ProductId ?? '').trim() === rowPid ||
            String(item.productId ?? item.ProductId ?? '').trim() === String(Number(rowPid))
        ) as any)
      : undefined;
    if (!matched) {
      matched = order.items.find((item: any) => invoiceRowMatchesOrderItem(row, item)) as any;
    }
    const resolved = matched ? resolveLineForFamilyMatch(matched) : null;
    let familyId = String(
      resolved?.familyId ??
        resolved?.FamilyId ??
        resolved?.categoryId ??
        resolved?.CategoryId ??
        ''
    ).trim();
    const pid = String(row.productId || '').trim();
    if (!familyId && pid) {
      familyId =
        String(familyIdByProductId[pid] ?? familyIdByProductId[String(Number(pid))] ?? '').trim();
    }
    const categoryName = String(resolved?.category ?? matched?.category ?? '').trim().toLowerCase();
    const family = familyId
      ? allCategories.find((c) => sameFamilyId(String(c.id), familyId))
      : allCategories.find((c) => String(c.name || '').trim().toLowerCase() === categoryName) || null;
    const familyName = (family?.name || resolved?.category || matched?.category || '').trim() || undefined;
    const familyCode = String(family?.code || '').trim() || undefined;
    const familySku = String(family?.sku || '').trim() || undefined;
    const familyShortName = String(family?.shortName || '').trim() || undefined;
    const familyVolume =
      family?.volume != null && Number.isFinite(Number(family.volume)) ? Number(family.volume) : undefined;
    const familyUnit = family?.unit?.trim() || undefined;
    const p = productForInvoiceLine(pid);
    let familyInvoiceKey = getPresentationSummaryKey(p);
    if (!familyInvoiceKey) {
      familyInvoiceKey = pid ? `pid:${pid}` : `row:${row.matchKey}`;
    }
    const volPart = invoiceVolLabel(
      p?.presentationVolume ?? familyVolume,
      p?.presentationUnit ?? familyUnit
    );
    const presTitle = String(p?.presentationName ?? family?.name ?? '').trim();
    const presentationLabel =
      [presTitle, volPart].filter(Boolean).join(' · ') || familyName || undefined;
    const commercialSku = String(p?.commerceSku || row.displaySku || '').trim();
    const presentationGenericCode = String(p?.presentationGenericCode ?? '').trim() || undefined;
    return {
      qty: row.qty,
      code: row.matchKey,
      ...(commercialSku ? { sku: commercialSku } : {}),
      description: row.productName,
      price: row.price,
      amount: row.lineTotal,
      familyId: familyId || undefined,
      familyName,
      familyCode,
      familySku,
      familyShortName,
      familyVolume,
      familyUnit,
      familyInvoiceKey,
      presentationLabel,
      presentationGenericCode,
    };
  });

  const isCancelled = matchesCancelledStatus(order?.status);

  /** Fase UI: prioriza líneas de la API como «facturado» aunque el status del pedido venga mal */
  const orderPhase = (() => {
    if (isCancelled) return 'cancelled';
    if (matchesInvoicedStatus(order?.status)) return 'invoiced';
    if (hasBillingLinesFromApiOrStorage) {
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
  const showInvoiceDocumentUi = showInvoiceSection && usePlanogramWorkflowUi;
  const showInvoiceRetry =
    usePlanogramWorkflowUi &&
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
      return usePlanogramWorkflowUi ? t('invoiced') || 'Facturado' : t('status_delivered');
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

  const vendorCode =
    String(user?.sellerCode || '').trim() ||
    String(user?.salesRouteCode || '').trim() ||
    String(vendorRouteFetched || '').trim() ||
    String(order.vendorNumber || '').trim() ||
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
    usePlanogramWorkflowUi
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

  /** Misma lógica que Admin: pedido inicial = cantidades del pedido; facturado = líneas de factura. */
  const handleViewPlanogramAsOrder = () => {
    router.push(
      `/view-planogram/${encodeURIComponent(String(orderId ?? '').trim())}?source=order`
    );
  };
  const handleViewPlanogramAsInvoice = () => {
    router.push(
      `/view-planogram/${encodeURIComponent(String(orderId ?? '').trim())}?source=invoice`
    );
  };

  const handleEditInitialOrder = () => {
    const sid = String(order.storeId || '').trim();
    if (!sid) return;
    const hasPgOrder = !!(order?.planogramId && String(order.planogramId).trim());
    if (usePlanogramWorkflowUi && hasPgOrder) {
      router.push(`/planogram/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}`);
      return;
    }
    router.push(`/catalog-order/${encodeURIComponent(sid)}?orderId=${encodeURIComponent(orderId)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Success Confirmation Banner */}
      {showConfirmation && (
        <div className="print-ticket-suppress fixed top-16 left-0 right-0 z-50 bg-green-600 text-white px-4 py-3 shadow-lg animate-in slide-in-from-top">
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
      <div className="print-ticket-suppress bg-white px-4 py-2 sticky top-0 z-10">
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
                {usePlanogramWorkflowUi ? `${headerMainNumber || invoiceNumberDisplay}` : t('order_detail')}
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
          <Card className="print-ticket-suppress border-slate-300 bg-slate-100 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm text-slate-800 font-medium">{t('order_cancelled')}</p>
              <p className="text-xs text-slate-600 mt-1">{t('order_cancelled_admin_only_delete')}</p>
            </CardContent>
          </Card>
        )}
        {/* Pedido / Tienda: resaltar PO, tienda como secundario */}
        <Card className="print-ticket-suppress border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <StoreIcon className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                {usePlanogramWorkflowUi ? (
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
            className={`print-ticket-suppress shadow-sm overflow-hidden ${
              orderPhase === 'invoiced'
                ? 'border-green-200 bg-green-50/40'
                : 'border-blue-200 bg-blue-50/30'
            }`}
          >
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle
                className={`text-sm ${orderPhase === 'invoiced' ? 'text-green-950' : 'text-blue-950'}`}
              >
                {usePlanogramWorkflowUi
                  ? orderPhase === 'invoiced'
                    ? t('order_invoiced_title')
                    : t('order_confirmed_title')
                  : orderPhase === 'invoiced'
                    ? t('order_delivered_title')
                    : t('order_confirmed_title')}
              </CardTitle>
              {usePlanogramWorkflowUi ? (
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
              {showPhysicalPlanogramButton && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <Button
                    type="button"
                    onClick={handleViewPlanogramAsInvoice}
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
                    {usePlanogramWorkflowUi && orderPhase === 'invoiced' && invoiceFromApi?.date && (
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
                      {usePlanogramWorkflowUi ? t('order_billed_items') : t('order_items_summary')}
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
                              <p className="text-xs text-slate-500 mb-2">{row.displaySku || row.matchKey}</p>
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
                  {usePlanogramGridForPresentationSummary && presentationRowsInvoiceSummary.length > 0 ? (
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
                          {presentationRowsInvoiceSummary.map((prow) => {
                            const pcs = sumQtyForPresentation(
                              invoiceSummaryCells,
                              productMap,
                              prow.presentationId
                            );
                            return (
                              <tr key={prow.presentationId} className="bg-slate-50/80">
                                <td className="px-3 py-2.5 align-top">
                                  <PresentationSummaryCell row={prow} />
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
                  ) : catalogPresentationRowsFromInvoice.length > 0 ? (
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
                          {catalogPresentationRowsFromInvoice.map((prow) => {
                            const pcs = sumQtyForPresentation(
                              invoiceSummaryCells,
                              productMap,
                              prow.presentationId
                            );
                            return (
                              <tr key={prow.presentationId} className="bg-slate-50/80">
                                <td className="px-3 py-2.5 align-top">
                                  <PresentationSummaryCell row={prow} />
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
                  ) : null}
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
              <div className="flex gap-2 flex-wrap print:hidden">
                <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium ${
                      invoiceViewMode === 'family' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'
                    }`}
                    onClick={() => setInvoiceViewMode('family')}
                  >
                    {t('invoice_tab_families')}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium border-l border-slate-200 ${
                      invoiceViewMode === 'product' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'
                    }`}
                    onClick={() => setInvoiceViewMode('product')}
                  >
                    {t('invoice_tab_products')}
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
                  title={t('download_invoice')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('download_invoice')}
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
              vendorCode={vendorCode || '—'}
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
        <Card className="print-ticket-suppress border-slate-200 overflow-hidden">
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
                {usePlanogramWorkflowUi
                  ? t('pod_already_invoiced') || 'Este pedido ya está facturado y no requiere cargar POD aquí.'
                  : t('pod_complete_catalog') ||
                    'El comprobante y el pedido ya están registrados.'}
              </p>
            )}
          </CardContent>
        </Card>
        )}

        {/* Pedido inicial */}
        <Card className="print-ticket-suppress border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden">
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
                {showPhysicalPlanogramButton && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <Button
                      type="button"
                      onClick={handleViewPlanogramAsOrder}
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
                      const quantity = Number(item.toOrder ?? item.quantity ?? 0) || 0;
                      const price = effectiveUnitPriceFromDetailItem(item);
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
                {usePlanogramGridForPresentationSummary && presentationRowsOrderSummary.length > 0 ? (
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
                        {presentationRowsOrderSummary.map((prow) => {
                          const pcs = sumQtyForPresentation(order.items || [], productMap, prow.presentationId);
                          return (
                            <tr key={prow.presentationId} className="bg-slate-50/80">
                              <td className="px-3 py-2.5 align-top">
                                <PresentationSummaryCell row={prow} />
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
                ) : catalogPresentationRowsFromOrder.length > 0 ? (
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
                        {catalogPresentationRowsFromOrder.map((prow) => {
                          const pcs = sumQtyForPresentation(order.items || [], productMap, prow.presentationId);
                          return (
                            <tr key={prow.presentationId} className="bg-slate-50/80">
                              <td className="px-3 py-2.5 align-top">
                                <PresentationSummaryCell row={prow} />
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
                ) : null}
                {orderPhase === 'initial' && (
                  order.storeId ? (
                    usePlanogramGridForPresentationSummary ? (
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
        <Card className="print-ticket-suppress border-slate-200 overflow-hidden">
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
                {usePlanogramWorkflowUi
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
