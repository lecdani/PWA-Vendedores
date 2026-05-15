'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Grid3x3, Loader2, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi } from '@/shared/api/distributions-api';
import { productsApi, getProductImageUrl, getProductShortDisplayName, type ProductForUI } from '@/shared/api/products-api';
import { categoriesApi } from '@/shared/api/categories-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { ordersApi } from '@/shared/api/orders-api';
import {
  ensureInvoiceForOrderResilient,
  updateOrderStatusResilient,
} from '@/shared/offline/offline-orders';
import { storesApi } from '@/shared/api/stores-api';
import { setOrderReviewPayload } from '@/shared/order-review-payload';
import {
  collectPresentationRowsFromGrid,
  sumQtyForPresentation,
} from '@/shared/utils/planogram-presentation-summary';
import { PresentationSummaryCell } from '@/shared/components/presentation-summary-cell';

export interface ProductPosition {
  row: number;
  col: number;
  productId: string;
  productName: string;
  sku: string;
  /** Nombre de familia para mostrar (resuelto desde API de familias cuando hay id). */
  category: string;
  /** Id de familia para agrupar en resumen sin depender solo del nombre. */
  familyId?: string;
  presentationId?: string;
  idealStock: number;
  currentStock: number;
  toOrder: number;
  price: number;
  imageUrl?: string;
}

function resolveUnitPrice(product: any, histprice?: number): number {
  const preferred = Number(histprice);
  if (Number.isFinite(preferred) && preferred > 0) return preferred;
  const candidates = [
    product?.currentPrice,
    product?.price,
    product?.unitPrice,
    product?.salePrice,
    product?.listPrice,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function Planogram({
  storeId,
  orderId,
  mode = 'create',
}: {
  storeId: string;
  orderId?: string;
  mode?: 'create' | 'invoice';
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [planogramData, setPlanogramData] = useState<ProductPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planogramId, setPlanogramId] = useState<string | null>(null);
  const [planogramName, setPlanogramName] = useState<string | null>(null);
  const [productMap, setProductMap] = useState<Map<string, ProductForUI>>(() => new Map());
  const [limitError, setLimitError] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  /**
   * En modo factura: solo estas celdas (row-col) pueden editarse (el pedido inicial no cambia).
   * Esto evita el bug cuando un mismo producto está repetido en varias celdas.
   */
  const allowedCellKeysRef = useRef<Set<string>>(new Set());
  /** Fallback legacy si el backend no devuelve row/col en detalles. */
  const allowedProductIdsRef = useRef<Set<string>>(new Set());

  const MAX_QTY_PER_PRODUCT_PLANOGRAM = 10;
  const isInvoiceFlow = mode === 'invoice' && !!orderId;

  const presentationSummaryRows = useMemo(
    () => collectPresentationRowsFromGrid(planogramData, productMap),
    [planogramData, productMap]
  );

  const cellKey = (row: number, col: number) => `${row}-${col}`;

  const cellAllowed = (row: number, col: number, productId?: string): boolean => {
    if (!isInvoiceFlow) return true;
    const allowedCells = allowedCellKeysRef.current;
    if (allowedCells.size > 0) return allowedCells.has(cellKey(row, col));
    // Fallback: si no hay data por celda, seguir con el bloqueo por producto como estaba antes
    if (!productId) return false;
    const pid = String(productId).trim();
    const allowedProducts = allowedProductIdsRef.current;
    if (allowedProducts.size === 0) return false;
    return allowedProducts.has(pid) || allowedProducts.has(String(Number(pid)));
  };

  const productIdAllowed = (productId: string): boolean => {
    if (!isInvoiceFlow) return true;
    const pid = String(productId).trim();
    const allowed = allowedProductIdsRef.current;
    if (allowed.size === 0) return false;
    return allowed.has(pid) || allowed.has(String(Number(pid)));
  };

  useEffect(() => {
    if (storeId) {
      storesApi.fetchStoreById(storeId).then((store) => {
        if (store) setStoreInfo({ name: store.name, address: store.address, id: store.id });
      });
    }
  }, [storeId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [products, categories, orderHeader] = await Promise.all([
          productsApi.fetchAll(),
          categoriesApi.fetchAll(),
          orderId ? ordersApi.getOrderById(orderId) : Promise.resolve(null),
        ]);

        if (!mounted) return;

        const planogramIdFromOrder = String(orderHeader?.planogramId ?? '').trim();
        let targetPlan = null as Awaited<ReturnType<typeof planogramsApi.getActive>>;
        if (planogramIdFromOrder) {
          targetPlan = await planogramsApi.getById(planogramIdFromOrder);
          if (!targetPlan) {
            const allPlans = await planogramsApi.fetchAll();
            targetPlan = allPlans.find((p) => String(p.id) === planogramIdFromOrder) ?? null;
          }
        }
        if (!targetPlan) {
          targetPlan = await planogramsApi.getActive();
        }

        if (!targetPlan) {
          setLoadError(t('no_active_planogram') || 'No hay planograma activo. Activa uno en el Admin.');
          setPlanogramData([]);
          setProductMap(new Map());
          setLoading(false);
          return;
        }
        setPlanogramId(targetPlan.id);
        setPlanogramName(targetPlan.name ?? null);
        const distList = await distributionsApi.getByPlanogram(targetPlan.id);
        if (!mounted) return;

        const categoryById = new Map<string, string>();
        categories.forEach((c) => {
          categoryById.set(c.id, c.name);
          categoryById.set(String(Number(c.id)), c.name);
        });

        const normalizeId = (v: unknown) =>
          String(v ?? '')
            .trim()
            .replace(/-/g, '')
            .toLowerCase();
        const pmap = new Map<string, ProductForUI>();
        products.forEach((p) => {
          const id = String(p.id ?? '').trim();
          if (!id) return;
          pmap.set(id, p);
          pmap.set(normalizeId(id), p);
          const numId = Number(id);
          if (!Number.isNaN(numId)) pmap.set(String(numId), p);
        });
        if (mounted) setProductMap(new Map(pmap));
        const getProduct = (productId: string) => {
          const raw = String(productId ?? '').trim();
          return pmap.get(raw) ?? pmap.get(normalizeId(raw)) ?? pmap.get(String(Number(raw)));
        };
        // Si la lista general no trae todos los productos del planograma (p.ej. inactivos),
        // cargar faltantes por id para no dejar la grilla vacía.
        const missingProductIds = Array.from(
          new Set(
            distList
              .map((d) => String(d.productId ?? '').trim())
              .filter((id) => id && !getProduct(id))
          )
        );
        if (missingProductIds.length > 0) {
          const fetchedMissing = await Promise.all(
            missingProductIds.map((id) => productsApi.getById(id).catch(() => null))
          );
          fetchedMissing.forEach((p) => {
            if (!p) return;
            const id = String(p.id ?? '').trim();
            if (!id) return;
            pmap.set(id, p);
            pmap.set(normalizeId(id), p);
            const n = Number(id);
            if (!Number.isNaN(n)) pmap.set(String(n), p);
          });
          if (mounted) setProductMap(new Map(pmap));
        }

        const resolveCategory = (p: (typeof products)[0] | null): string => {
          if (!p) return '';
          const id = String(p.familyId ?? p.categoryId ?? '').trim();
          if (id) {
            const fromList = categoryById.get(id) ?? categoryById.get(String(Number(id)));
            if (fromList) return fromList;
          }
          const name = (p.category || '').trim();
          return name;
        };

        const uniquePresentationIds = [
          ...new Set(
            distList
              .map((d) => {
                const p = getProduct(d.productId);
                return String(p?.presentationId ?? '').trim();
              })
              .filter(Boolean)
          ),
        ];
        const priceResults = await Promise.all(
          uniquePresentationIds.map(async (id) => ({ id, price: await histpricesApi.getLatest(id) }))
        );
        const priceMap = new Map(priceResults.map((r) => [r.id, r.price]));

        const grid: ProductPosition[] = [];

        for (let row = 0; row < 10; row++) {
          for (let col = 0; col < 10; col++) {
            const dist = distList.find((d) => d.xPosition === row && d.yPosition === col);
            const product = dist ? getProduct(dist.productId) : null;
            const productIdStr = product?.id ?? '';
            const familyId = String(product?.familyId ?? product?.categoryId ?? '').trim();
            const presId = String(product?.presentationId ?? '').trim();
            const price = resolveUnitPrice(product, presId ? priceMap.get(presId) : undefined);
            grid.push({
              row,
              col,
              productId: productIdStr,
              productName: product ? getProductShortDisplayName(product) : '',
              sku: String(product?.code ?? '').trim() || '—',
              category: resolveCategory(product ?? null),
              familyId: familyId || undefined,
              presentationId: product?.presentationId,
              idealStock: 0,
              currentStock: 0,
              toOrder: 0,
              price,
              imageUrl: product ? getProductImageUrl(product) : undefined,
            });
          }
        }

        if (orderId && mounted) {
          const details = await ordersApi.getOrderDetailsByOrderIdRaw(orderId);
          const qtyByCell = new Map<string, number>();
          const qtyQueueByProduct = new Map<string, number[]>(); // fallback para evitar duplicar en todas las celdas
          const allowedProducts = new Set<string>();
          const allowedCells = new Set<string>();
          let hasCellInfo = false;

          // Preferir celdas guardadas en el front al crear el pedido (sin backend).
          let fromFrontCells: Array<{ row: number; col: number; quantity: number }> = [];
          try {
            const raw = typeof window !== 'undefined' ? window.localStorage.getItem(`order_planogram_cells_${orderId}`) : null;
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed)) {
              fromFrontCells = parsed
                .map((r: any) => ({
                  row: Number(r?.row),
                  col: Number(r?.col),
                  quantity: Number(r?.quantity ?? r?.qty ?? 0),
                }))
                .filter((r) => Number.isFinite(r.row) && Number.isFinite(r.col) && r.quantity > 0);
            }
          } catch {
            fromFrontCells = [];
          }

          if (fromFrontCells.length > 0) {
            fromFrontCells.forEach((r) => {
              const k = cellKey(r.row, r.col);
              qtyByCell.set(k, (qtyByCell.get(k) ?? 0) + r.quantity);
              allowedCells.add(k);
            });
            hasCellInfo = true;
          }

          details.forEach((d: any) => {
            const pid = String(d?.productId ?? d?.ProductId ?? '').trim();
            const qty = Number(d?.quantity ?? d?.Quantity ?? 0);
            // Posición de celda: el backend puede enviar row/col o xPosition/yPosition (planograma).
            const rowRaw =
              d?.row ??
              d?.Row ??
              d?.xPosition ??
              d?.XPosition ??
              d?.xposition ??
              d?.XPOSITION ??
              d?.x_pos ??
              d?.X_Pos;
            const colRaw =
              d?.col ??
              d?.Col ??
              d?.column ??
              d?.Column ??
              d?.yPosition ??
              d?.YPosition ??
              d?.yposition ??
              d?.YPOSITION ??
              d?.y_pos ??
              d?.Y_Pos;
            const row = Number(rowRaw);
            const col = Number(colRaw);
            if (pid) {
              const q = qtyQueueByProduct.get(pid) ?? [];
              if (qty > 0) q.push(qty);
              qtyQueueByProduct.set(pid, q);
              allowedProducts.add(pid);
              if (Number.isFinite(row) && Number.isFinite(col)) {
                hasCellInfo = true;
                const k = cellKey(row, col);
                qtyByCell.set(k, (qtyByCell.get(k) ?? 0) + qty);
                allowedCells.add(k);
              }
            }
          });
          if (isInvoiceFlow) {
            allowedProductIdsRef.current = allowedProducts;
            allowedCellKeysRef.current = hasCellInfo ? allowedCells : new Set();
          } else {
            allowedProductIdsRef.current = new Set();
            allowedCellKeysRef.current = new Set();
          }
          const merged = grid.map((item) => {
            const qtyFromCell = qtyByCell.get(cellKey(item.row, item.col)) ?? 0;
            // IMPORTANTE:
            // En modo factura con planogramas que permiten duplicados, NO podemos inferir cantidades por productId,
            // porque “desbloquearía” celdas duplicadas indebidamente. Solo respetamos cantidades por celda.
            let qty = 0;
            if (hasCellInfo) {
              qty = qtyFromCell;
            } else if (!isInvoiceFlow && item.productId) {
              // En edición de pedido inicial, si el backend no trae row/col,
              // repartir cantidades por producto entre sus celdas para no resetear a cero.
              const pid = String(item.productId).trim();
              const key = qtyQueueByProduct.has(pid) ? pid : String(Number(pid));
              const queue = qtyQueueByProduct.get(key);
              qty = queue && queue.length > 0 ? Number(queue.shift() || 0) : 0;
            }
            return { ...item, toOrder: qty };
          });

          // Bloqueo por celda usando SOLO el planograma ya mostrado:
          // en modo factura, únicamente se pueden editar celdas que tengan cantidad inicial > 0.
          if (isInvoiceFlow) {
            const editableCells = new Set(
              merged
                .filter((i) => i.productId && Number(i.toOrder) > 0)
                .map((i) => cellKey(i.row, i.col))
            );
            allowedCellKeysRef.current = editableCells;
          }

          setPlanogramData(merged);
        } else {
          allowedProductIdsRef.current = new Set();
          allowedCellKeysRef.current = new Set();
          setPlanogramData(grid);
        }
      } catch (e) {
        if (mounted) {
          setLoadError((e as Error)?.message ?? 'Error al cargar planograma');
          setProductMap(new Map());
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [storeId, orderId, t, isInvoiceFlow]);

  const setQtyForCell = (row: number, col: number, nextQty: number) => {
    const raw = Number(nextQty) || 0;
    const clamped = Math.max(0, Math.min(MAX_QTY_PER_PRODUCT_PLANOGRAM, Math.floor(raw)));
    const qty = clamped;
    setLimitError(null);
    setPlanogramData((prev) => {
      const idx = prev.findIndex((p) => p.row === row && p.col === col);
      if (idx < 0) return prev;
      const current = prev[idx];
      if (!current.productId) return prev;
      if (isInvoiceFlow && !cellAllowed(current.row, current.col, current.productId)) return prev;

      const next = [...prev];
      next[idx] = { ...current, toOrder: qty };
      return next;
    });
  };

  const incQty = (row: number, col: number) => {
    const current = planogramData.find((p) => p.row === row && p.col === col);
    if (!current || !current.productId) return;
    if (isInvoiceFlow && !cellAllowed(row, col, current.productId)) return;
    setQtyForCell(row, col, (current.toOrder || 0) + 1);
  };

  const decQty = (row: number, col: number) => {
    const current = planogramData.find((p) => p.row === row && p.col === col);
    if (!current || !current.productId) return;
    if (isInvoiceFlow && !cellAllowed(row, col, current.productId)) return;
    setQtyForCell(row, col, (current.toOrder || 0) - 1);
  };

  const totalToOrder = planogramData.reduce((sum, item) => sum + item.toOrder, 0);
  const totalValue = planogramData.reduce((sum, item) => sum + (item.toOrder * item.price), 0);
  const productsCount = planogramData.filter((item) => item.productId).length;
  const completedCount = planogramData.filter((item) => item.currentStock > 0 || item.toOrder > 0).length;
  const progressPercent = planogramData.length > 0 ? Math.round((completedCount / planogramData.length) * 100) : 0;

  const getCellStyle = (item: ProductPosition) => {
    const hasProduct = !!item.productId;
    if (!hasProduct) return 'bg-slate-400 border-slate-500'; // vacío: solo más oscuro
    const locked = isInvoiceFlow && item.productId && !cellAllowed(item.row, item.col, item.productId);
    if (locked) return 'bg-slate-200 border-slate-300 opacity-60';
    if (item.toOrder > 0) return 'bg-indigo-50 border-indigo-300';
    return 'bg-slate-100 border-slate-200';
  };

  const handleSendOrder = () => {
    setOrderReviewPayload({
      storeId,
      storeInfo,
      planogramId: planogramId ?? undefined,
      planogramData,
      editOrderId: orderId ?? undefined,
      source: 'planogram',
    });
    router.push('/order-review');
  };

  const handleInvoiceFromPlanogram = async () => {
    if (!orderId) return;
    setFlowError(null);
    setContinuing(true);
    try {
      const order = await ordersApi.getOrderById(orderId);
      const backendOrderId = String((order as any)?.backendOrderId ?? order?.id ?? orderId).trim();
      const rows = planogramData
        .filter((i) => i.productId && i.toOrder > 0 && cellAllowed(i.row, i.col, i.productId))
        .map((i) => ({
          productId: String(i.productId),
          quantity: i.toOrder,
          unitPrice: Number(i.price) || 0,
          row: i.row,
          col: i.col,
          sku: String(i.sku || '').trim(),
          productName: String(i.productName || '').trim(),
        }));
      if (rows.length === 0) {
        setFlowError('Indica al menos una cantidad entregada en los productos del pedido.');
        setContinuing(false);
        return;
      }
      const deliveredItems = rows.map((r) => ({
        productId: r.productId,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
      }));
      if (typeof window !== 'undefined') {
        try {
          const deliveredCells = planogramData
            .filter((i) => i.productId && i.toOrder > 0 && cellAllowed(i.row, i.col, i.productId))
            .map((i) => ({
              row: i.row,
              col: i.col,
              productId: String(i.productId),
              quantity: Number(i.toOrder) || 0,
              unitPrice: Number(i.price) || 0,
              sku: String(i.sku || '').trim(),
              productName: String(i.productName || '').trim(),
            }))
            .filter((r) => Number.isFinite(r.row) && Number.isFinite(r.col) && r.quantity > 0);
          if (deliveredCells.length > 0) {
            window.localStorage.setItem(`order_delivered_cells_${orderId}`, JSON.stringify(deliveredCells));
          }
        } catch {
          // ignore
        }
        window.localStorage.setItem(
          `order_delivery_confirmation_${orderId}`,
          JSON.stringify({ mode: 'invoice', source: 'planogram', items: rows })
        );
      }
      const ok = await updateOrderStatusResilient(backendOrderId, false);
      if (!ok) {
        setFlowError('No se pudo confirmar el pedido. Intenta de nuevo.');
        setContinuing(false);
        return;
      }
      const invoiceId = await ensureInvoiceForOrderResilient(backendOrderId, deliveredItems);
      if (invoiceId == null) {
        setFlowError('No se pudo crear la factura. Revisa la conexión o los datos del pedido.');
        setContinuing(false);
        return;
      }
      await updateOrderStatusResilient(backendOrderId, true);
      router.push(`/order/${orderId}`);
    } catch {
      setFlowError('Error al continuar. Revisa la conexión.');
    } finally {
      setContinuing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm text-slate-600">{t('loading')}...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 mb-4">{loadError}</p>
          <Button variant="outline" onClick={() => router.push('/select-store')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                isInvoiceFlow && orderId
                  ? router.push(`/order/${orderId}`)
                  : router.push('/select-store')
              }
              className="p-2 h-auto"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{storeInfo?.name ?? t('product_organization')}</h2>
              <p className="text-xs text-slate-500">
                {isInvoiceFlow
                  ? 'Facturar: ajusta cantidades entregadas. Se genera la factura sin POD; el comprobante puedes cargarlo después.'
                  : (planogramName ?? t('planogram'))}
              </p>
            </div>
          </div>
          
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
            {progressPercent}% {t('completed')}
          </Badge>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{productsCount}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-2 text-center">
            <p className="text-xs text-indigo-600 mb-0.5">{t('units')}</p>
            <p className="text-sm text-indigo-900">{totalToOrder}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <p className="text-[11px] text-green-700 leading-tight">Subtotal: ${totalValue.toFixed(2)}</p>
            <p className="text-[11px] text-green-700 leading-tight">Total: ${totalValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Planogram Grid */}
      <div className="px-4 py-4 pb-24">
        <div className="flex items-center gap-2 mb-3">
          <Grid3x3 className="h-4 w-4 text-slate-600" />
          <p className="text-sm text-slate-600">{t('tap_position_to_count')}</p>
        </div>

        {limitError && (
          <div className="mb-3">
            <p className="text-xs text-red-600 font-medium text-right">{limitError}</p>
          </div>
        )}
        {flowError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {flowError}
          </div>
        )}

        {productsCount === 0 && (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {t('no_products_in_planogram')}
          </div>
        )}

        {productsCount > 0 && (
          <p className="text-xs text-slate-500 mb-2">{t('planogram_loaded')}</p>
        )}

        {/* 10x10 Grid - ancho fijo, con scroll horizontal en pantallas pequeñas y centrado en pantallas grandes */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 overflow-x-auto flex justify-start md:justify-center">
          <div className="inline-grid grid-cols-10 gap-1.5 w-[760px] flex-none">
            {planogramData.map((item) => (
              <div
                key={`${item.row}-${item.col}`}
                className={`aspect-square w-[70px] h-[70px] rounded-lg border ${getCellStyle(item)} hover:opacity-90 transition-opacity relative flex flex-col items-center justify-center p-1.5 text-center`}
              >
                {item.productId ? (
                  <>
                    <div className="flex items-center justify-center gap-1 w-full">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-5 h-5 rounded object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                          <Package className="h-2.5 w-2.5 text-slate-500" />
                        </div>
                      )}
                      <span
                        className="text-[10px] leading-snug font-semibold text-slate-900 truncate max-w-[52px] tabular-nums"
                        title={item.sku}
                      >
                        {item.sku || '—'}
                      </span>
                    </div>
                    <span
                      className="text-[7px] leading-tight font-medium text-slate-600 break-words line-clamp-2 w-full mt-0.5"
                      title={item.productName}
                    >
                      {item.productName || ''}
                    </span>

                    <div className="mt-1 flex items-center gap-0.5">
                      {isInvoiceFlow && !cellAllowed(item.row, item.col, item.productId) ? (
                        <span className="text-[8px] text-slate-400 px-0.5">—</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => decQty(item.row, item.col)}
                            className="w-4 h-4 rounded bg-white/80 border border-slate-200 text-slate-700 text-[10px] font-semibold leading-none"
                            aria-label="Disminuir"
                          >
                            −
                          </button>
                          <input
                            type="tel"
                            inputMode="numeric"
                            value={item.toOrder > 0 ? item.toOrder : 0}
                            onChange={(e) => setQtyForCell(item.row, item.col, Number(e.target.value || 0))}
                            className="w-[28px] h-4 rounded bg-white/80 border border-slate-200 text-[9px] text-slate-900 font-semibold tabular-nums text-center px-0.5"
                            aria-label="Cantidad"
                          />
                          <button
                            type="button"
                            onClick={() => incQty(item.row, item.col)}
                            className="w-4 h-4 rounded bg-white/80 border border-slate-200 text-slate-700 text-[10px] font-semibold leading-none"
                            aria-label="Aumentar"
                          >
                            +
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-400" />
            {t('no_quantity')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-indigo-50 border border-indigo-300" />
            {t('with_quantity')}
          </span>
        </div>

        {/* Resumen “Familias” = presentaciones que tienen producto en esta grilla */}
        {presentationSummaryRows.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[300px] overflow-hidden rounded-lg border border-slate-200 text-sm shadow-sm">
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
              <tbody className="divide-y divide-slate-100 bg-white">
                {presentationSummaryRows.map((row) => {
                  const pcs = sumQtyForPresentation(planogramData, productMap, row.presentationId);
                  return (
                    <tr key={row.presentationId} className="bg-slate-50/80">
                      <td className="px-3 py-2.5 align-top">
                        <PresentationSummaryCell row={row} />
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
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="flex gap-3 max-w-2xl mx-auto">
          {isInvoiceFlow ? (
            <Button
              onClick={handleInvoiceFromPlanogram}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              disabled={totalToOrder === 0 || continuing}
            >
              <Send className="h-4 w-4 mr-2" />
              {continuing ? 'Procesando…' : 'Generar factura'}
            </Button>
          ) : (
            <Button
              onClick={handleSendOrder}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              disabled={totalToOrder === 0}
            >
              <Send className="h-4 w-4 mr-2" />
              {t('review_order')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
