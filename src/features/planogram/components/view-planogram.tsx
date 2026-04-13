'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Grid3x3, Loader2, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi, type DistributionForUI } from '@/shared/api/distributions-api';
import {
  productsApi,
  getProductImageUrl,
  getProductShortDisplayName,
  type ProductForUI,
} from '@/shared/api/products-api';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';

interface ProductPosition {
  row: number;
  col: number;
  productId: string;
  productName: string;
  sku: string;
  toOrder: number;
  price: number;
  imageUrl?: string;
}

type LineItem = { qty: number; code: string; description: string; price: number; amount: number };

type InvoicePlanogramLine = LineItem & { productId?: string; sku?: string };

type QRow = { productName: string; sku: string; quantity: number; price: number };

function normKey(s: string): string {
  return String(s || '')
    .trim()
    .replace(/-/g, '')
    .toLowerCase();
}

function matchesInvoicedOrderStatus(status: string | undefined): boolean {
  const s = (status || '').toLowerCase().trim();
  return ['invoiced', 'facturado', 'invoice', 'billed', 'facturada'].includes(s);
}

/**
 * Colas por productId desde líneas de factura — misma lógica que Admin `OrderPlanogramView`
 * (code/sku/id/catálogo + nombre único) para que el planograma facturado no quede vacío ni caiga al pedido inicial.
 */
function buildQuantitiesQueueFromInvoiceLines(
  invoiceItems: InvoicePlanogramLine[],
  orderItems: Array<{ productId?: string; ProductId?: string; productName?: string; sku?: string; price?: number }>,
  getProduct: (id: string) => ProductForUI | undefined,
  catalogProducts: ProductForUI[]
): Map<string, QRow[]> {
  const map = new Map<string, QRow[]>();

  const resolveProductId = (line: InvoicePlanogramLine): string => {
    const fromApi = String(line.productId ?? '').trim();
    if (fromApi) return fromApi;

    const code = String(line.code || line.sku || '').trim();
    if (!code || code === '—') return '';
    const normCode = normKey(code);
    const desc = String(line.description || '').trim();

    const oi =
      orderItems.find((x: any) => String(x.sku || '').trim() === code) ||
      orderItems.find((x: any) => String(x.productId ?? x.ProductId ?? '') === code) ||
      (code.length >= 8
        ? orderItems.find((x: any) => {
            const pid = normKey(String(x.productId ?? x.ProductId ?? ''));
            return pid && (pid === normCode || String(x.productId ?? x.ProductId) === code);
          })
        : undefined);

    let productId = oi ? String(oi.productId ?? oi.ProductId ?? '') : '';

    if (!productId && /^[0-9a-f-]{36}$/i.test(code)) {
      productId = code;
    }

    if (!productId) {
      const hit = catalogProducts.find((p) => {
        const skuT = String(p.sku || '').trim();
        const codeT = String(p.code || '').trim();
        const comm = String(p.commerceSku || '').trim();
        return (
          skuT === code ||
          codeT === code ||
          comm === code ||
          normKey(skuT) === normCode ||
          normKey(codeT) === normCode ||
          normKey(comm) === normCode ||
          normKey(String(p.id)) === normCode
        );
      });
      if (hit) productId = String(hit.id);
    }

    if (!productId && desc.length > 2) {
      const lower = desc.toLowerCase();
      const nameHits = catalogProducts.filter(
        (p) => (p.name || '').trim().toLowerCase() === lower || (p.shortName || '').trim().toLowerCase() === lower
      );
      if (nameHits.length === 1) productId = String(nameHits[0].id);
    }

    return productId;
  };

  for (const line of invoiceItems) {
    const code = String(line.code || line.sku || '').trim();
    const productId = resolveProductId(line);
    if (!productId) continue;

    const oi =
      orderItems.find((x: any) => String(x.productId ?? x.ProductId ?? '') === productId) ||
      orderItems.find(
        (x: any) => normKey(String(x.productId ?? x.ProductId ?? '')) === normKey(productId)
      );

    const prod = getProduct(productId);
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    const price = Number(line.price) || 0;
    const name = prod
      ? getProductShortDisplayName(prod)
      : (line.description || (oi as any)?.productName || code).trim();
    const sku = String(
      (oi as any)?.sku || prod?.commerceSku || prod?.sku || prod?.code || code
    ).trim();
    const row: QRow = { productName: name, sku, quantity: qty, price };
    const arr = map.get(productId) ?? [];
    arr.push(row);
    map.set(productId, arr);
  }
  return map;
}

async function buildOrderQuantityQueue(
  orderItems: any[],
  getProduct: (id: string) => ProductForUI | undefined
): Promise<Map<string, QRow[]>> {
  const map = new Map<string, QRow[]>();
  const { histpricesApi } = await import('@/shared/api/histprices-api');
  for (const item of orderItems) {
    const id = String(item.productId ?? item.ProductId ?? '').trim();
    if (!id) continue;
    const q = Number(item.toOrder ?? item.quantity ?? 0) || 0;
    if (q <= 0) continue;
    let price = Number(item.price) || 0;
    if (!price) {
      const productForPrice = getProduct(id);
      const presId = String(productForPrice?.presentationId ?? '').trim();
      price = presId ? await histpricesApi.getLatest(presId) : 0;
    }
    const gp = getProduct(id);
    const row: QRow = {
      productName: gp ? getProductShortDisplayName(gp) : (item.productName || item.sku || '').trim(),
      sku: String(gp?.code ?? item.sku ?? '').trim(),
      quantity: q,
      price,
    };
    const arr = map.get(id) ?? [];
    arr.push(row);
    map.set(id, arr);
  }
  return map;
}

function buildGridFromProductQueue(
  distList: DistributionForUI[],
  getProduct: (id: string) => ProductForUI | undefined,
  queueByProductId: Map<string, QRow[]>
): ProductPosition[] {
  const queues = new Map<string, QRow[]>();
  queueByProductId.forEach((arr, k) => {
    queues.set(k, [...arr]);
  });
  const grid: ProductPosition[] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const dist = distList.find((d) => d.xPosition === row && d.yPosition === col);
      const product = dist ? getProduct(dist.productId) : null;
      const pid = product ? String(product.id).trim() : '';
      let qlist: QRow[] | undefined;
      if (pid) {
        if (queues.has(pid)) qlist = queues.get(pid);
        else {
          const numKey = String(Number(pid));
          if (queues.has(numKey)) qlist = queues.get(numKey);
        }
      }
      const next = qlist && qlist.length > 0 ? qlist.shift()! : null;
      grid.push({
        row,
        col,
        productId: product?.id ?? '',
        productName: (next?.productName ?? '').trim() || (product ? getProductShortDisplayName(product) : ''),
        sku: String(next?.sku || product?.code || '').trim(),
        toOrder: next?.quantity ?? 0,
        price: next?.price ?? product?.currentPrice ?? 0,
        imageUrl: product ? getProductImageUrl(product) : undefined,
      });
    }
  }
  return grid;
}

function buildTenByTenGrid(
  distList: DistributionForUI[],
  orderItemsByProductId: Map<string, { productName: string; sku: string; quantity: number; price: number }>,
  hasCellQty: boolean,
  cellQty: Map<string, number>,
  getProduct: (id: string) => ProductForUI | undefined
): ProductPosition[] {
  const planogramGrid: ProductPosition[] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const dist = distList.find((d) => d.xPosition === row && d.yPosition === col);
      const product = dist ? getProduct(dist.productId) : null;
      const orderItem = product
        ? orderItemsByProductId.get(product.id) ??
          orderItemsByProductId.get(String(Number(product.id)))
        : null;
      planogramGrid.push({
        row,
        col,
        productId: product?.id ?? '',
        productName: product
          ? getProductShortDisplayName(product)
          : (orderItem?.productName ?? '').trim(),
        sku: String(product?.code ?? orderItem?.sku ?? '').trim(),
        toOrder: hasCellQty ? (cellQty.get(`${row}-${col}`) ?? 0) : (orderItem?.quantity ?? 0),
        price: orderItem?.price ?? product?.currentPrice ?? 0,
        imageUrl: product ? getProductImageUrl(product) : undefined,
      });
    }
  }
  return planogramGrid;
}

async function buildOrderLineMapByProductId(
  orderItems: any[],
  getProduct: (id: string) => ProductForUI | undefined
): Promise<Map<string, { productName: string; sku: string; quantity: number; price: number }>> {
  const orderItemsByProductId = new Map<
    string,
    { productName: string; sku: string; quantity: number; price: number }
  >();
  const { histpricesApi } = await import('@/shared/api/histprices-api');
  for (const item of orderItems) {
    const id = String(item.productId ?? item.ProductId ?? '').trim();
    if (!id) continue;
    let price = Number(item.price) || 0;
    if (!price) {
      const productForPrice = getProduct(id);
      const presId = String(productForPrice?.presentationId ?? '').trim();
      price = presId ? await histpricesApi.getLatest(presId) : 0;
    }
    const gp = getProduct(id);
    orderItemsByProductId.set(id, {
      productName: gp ? getProductShortDisplayName(gp) : (item.productName || item.sku || '').trim(),
      sku: String(gp?.code ?? item.sku ?? '').trim(),
      quantity: Number(item.toOrder ?? item.quantity ?? 0) || 0,
      price,
    });
  }
  return orderItemsByProductId;
}

async function enrichQueuePrices(
  queue: Map<string, QRow[]>,
  orderItems: any[],
  getProduct: (id: string) => ProductForUI | undefined
): Promise<Map<string, QRow[]>> {
  const { histpricesApi } = await import('@/shared/api/histprices-api');
  const out = new Map<string, QRow[]>();
  for (const [id, rows] of queue.entries()) {
    const nextRows = await Promise.all(
      rows.map(async (row) => {
        if (row.price > 0) return row;
        const oi =
          orderItems.find((x: any) => String(x.productId ?? x.ProductId) === id) ||
          orderItems.find(
            (x: any) => normKey(String(x.productId ?? x.ProductId ?? '')) === normKey(id)
          );
        let price = Number(oi?.price ?? oi?.unitPrice ?? 0) || 0;
        if (!price) {
          const productForPrice = getProduct(id);
          const presId = String(productForPrice?.presentationId ?? '').trim();
          price = presId ? await histpricesApi.getLatest(presId) : 0;
        }
        return { ...row, price };
      })
    );
    out.set(id, nextRows);
  }
  return out;
}

export function ViewPlanogram({
  orderId,
  quantitySource = 'order',
}: {
  orderId: string;
  quantitySource?: 'order' | 'invoice';
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [order, setOrder] = useState<OrderForUI | null>(null);
  const [grid, setGrid] = useState<ProductPosition[]>([]);
  const [planogramName, setPlanogramName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantitiesFromInvoice, setQuantitiesFromInvoice] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const resolvedOrderId = decodeURIComponent(String(orderId ?? '').trim());

    (async () => {
      setLoading(true);
      setLoadError(null);
      setQuantitiesFromInvoice(false);
      setPlanogramName(null);
      setOrder(null);
      setGrid([]);

      try {
        const apiOrder = await ordersApi.getOrderById(resolvedOrderId);
        if (!mounted) return;
        if (!apiOrder) {
          setOrder(null);
          setGrid([]);
          return;
        }
        setOrder(apiOrder);

        const planogramIdFromOrder = String((apiOrder as any).planogramId ?? '').trim();

        let planogram = null as Awaited<ReturnType<typeof planogramsApi.getById>>;
        if (planogramIdFromOrder) {
          planogram = await planogramsApi.getById(planogramIdFromOrder);
          if (!planogram) {
            const all = await planogramsApi.fetchAll();
            planogram = all.find((p) => String(p.id) === String(planogramIdFromOrder)) ?? null;
          }
        } else {
          planogram = await planogramsApi.getActive();
        }

        if (!planogram) {
          if (mounted) {
            setLoadError(
              planogramIdFromOrder ? t('view_planogram_not_found') : t('no_active_planogram')
            );
            setGrid(buildTenByTenGrid([], new Map(), false, new Map(), () => undefined));
          }
          return;
        }

        if (mounted) setPlanogramName(planogram.name ?? null);

        const distList = await distributionsApi.getByPlanogram(planogram.id);
        if (!mounted) return;

        const products = await productsApi.fetchAll();
        if (!mounted) return;

        const productMap = new Map(products.map((p) => [p.id, p]));
        products.forEach((p) => {
          const numId = Number(p.id);
          if (!Number.isNaN(numId)) productMap.set(String(numId), p);
        });
        const getProduct = (id: string) => productMap.get(id) ?? productMap.get(String(Number(id)));

        const orderItems = Array.isArray(apiOrder.items) ? apiOrder.items : [];
        const isInvoiceView = quantitySource === 'invoice';

        /**
         * Pedido inicial (source=order): solo celdas guardadas al crear el pedido — no mezclar con entrega/confirmación.
         * Facturado (source=invoice): colas por línea de factura (como Admin); sin localStorage de celdas.
         */
        let initialCellQty = new Map<string, number>();
        let hasInitialCellQty = false;
        if (!isInvoiceView) {
          try {
            const rawInitial =
              typeof window !== 'undefined'
                ? window.localStorage.getItem(`order_planogram_cells_${resolvedOrderId}`)
                : null;
            const parsed0 = rawInitial ? JSON.parse(rawInitial) : null;
            const parsed = Array.isArray(parsed0?.items) ? parsed0.items : parsed0;
            if (Array.isArray(parsed)) {
              parsed.forEach((r: any) => {
                const row = Number(r?.row);
                const col = Number(r?.col);
                const q = Number(r?.quantity ?? r?.qty ?? 0);
                if (Number.isFinite(row) && Number.isFinite(col) && q > 0) {
                  initialCellQty.set(
                    `${row}-${col}`,
                    (initialCellQty.get(`${row}-${col}`) ?? 0) + q
                  );
                }
              });
            }
            hasInitialCellQty = initialCellQty.size > 0;
          } catch {
            initialCellQty = new Map();
            hasInitialCellQty = false;
          }
        }

        if (!mounted) return;

        if (isInvoiceView) {
          const invoiceHint = apiOrder.invoiceId ?? undefined;
          let invoiceDisplay: Awaited<ReturnType<typeof ordersApi.getInvoiceDisplayForOrder>> = null;
          try {
            invoiceDisplay = await ordersApi.getInvoiceDisplayForOrder(
              resolvedOrderId,
              invoiceHint,
              apiOrder
            );
          } catch {
            invoiceDisplay = null;
          }
          const st = (apiOrder.status || '').toLowerCase().trim();
          const mightHaveInvoice =
            (invoiceHint != null && String(invoiceHint).trim() !== '') ||
            matchesInvoicedOrderStatus(apiOrder.status) ||
            ['confirmed', 'completed', 'complete', 'confirmado', 'cerrado', 'closed'].includes(st);
          if (!invoiceDisplay?.items?.length && mightHaveInvoice) {
            try {
              const alt = await ordersApi.getInvoiceDisplayForOrder(
                resolvedOrderId,
                undefined,
                apiOrder
              );
              if (alt?.items?.length) invoiceDisplay = alt;
            } catch {
              /* ignore */
            }
          }
          if (!mounted) return;

          let queue = new Map<string, QRow[]>();
          let usedInvoiceQuantities = false;

          if (invoiceDisplay?.items?.length) {
            const fromInv = buildQuantitiesQueueFromInvoiceLines(
              invoiceDisplay.items as InvoicePlanogramLine[],
              orderItems as any[],
              getProduct,
              products
            );
            if (fromInv.size > 0) {
              queue = fromInv;
              usedInvoiceQuantities = true;
            }
          }

          /** Igual que Admin: solo si no hay líneas de factura se usan cantidades del pedido (evita mezclar inicial vs facturado). */
          if (!usedInvoiceQuantities && !(invoiceDisplay?.items?.length)) {
            queue = await buildOrderQuantityQueue(orderItems, getProduct);
          } else if (usedInvoiceQuantities) {
            queue = await enrichQueuePrices(queue, orderItems, getProduct);
          }

          if (mounted) {
            setQuantitiesFromInvoice(usedInvoiceQuantities);
            setGrid(buildGridFromProductQueue(distList, getProduct, queue));
          }
        } else if (hasInitialCellQty) {
          const orderItemsByProductId = await buildOrderLineMapByProductId(orderItems, getProduct);
          if (mounted) {
            setQuantitiesFromInvoice(false);
            setGrid(
              buildTenByTenGrid(
                distList,
                orderItemsByProductId,
                true,
                initialCellQty,
                getProduct
              )
            );
          }
        } else {
          const queue = await buildOrderQuantityQueue(orderItems, getProduct);
          if (mounted) {
            setQuantitiesFromInvoice(false);
            setGrid(buildGridFromProductQueue(distList, getProduct, queue));
          }
        }
      } catch (e) {
        console.warn('[ViewPlanogram] load failed', e);
        if (mounted) {
          setLoadError(t('view_planogram_load_error'));
          setGrid(buildTenByTenGrid([], new Map(), false, new Map(), () => undefined));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [orderId, quantitySource]);

  if (loading || !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-sm text-slate-600">{t('loading')}...</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-slate-600 mb-4">{t('no_orders_found')}</p>
            <Button onClick={() => router.push('/history')}>{t('order_history')}</Button>
          </div>
        )}
      </div>
    );
  }

  const totalToOrder = grid.reduce((s, i) => s + i.toOrder, 0);
  const totalValue = grid.reduce((s, i) => s + i.toOrder * i.price, 0);
  const productsWithQty = grid.filter((i) => i.productId && i.toOrder > 0).length;
  const orderRouteId = order?.id ?? decodeURIComponent(String(orderId ?? '').trim());

  const getCellStyle = (item: ProductPosition) => {
    if (!item.productId) return 'bg-slate-400 border-slate-500';
    if (item.toOrder > 0) return 'bg-indigo-50 border-indigo-300';
    return 'bg-slate-100 border-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push(`/order/${encodeURIComponent(orderRouteId)}`)} className="p-2 h-auto">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{planogramName ?? t('planogram')}</h2>
              <p className="text-xs text-slate-500">{order.storeName}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">{t('view_only')}</Badge>
            {quantitiesFromInvoice && (
              <span className="text-[10px] text-green-700 font-medium text-right max-w-[140px] leading-tight">
                {t('planogram_quantities_invoice')}
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{productsWithQty}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-2 text-center">
            <p className="text-xs text-indigo-600 mb-0.5">{t('units')}</p>
            <p className="text-sm text-indigo-900">{totalToOrder}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <p className="text-xs text-green-600 mb-0.5">{t('total')}</p>
            <p className="text-sm text-green-900">${totalValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {loadError ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}
        <p className="text-sm text-slate-600 mb-3">
          {quantitiesFromInvoice ? t('planogram_view_invoice_hint') : t('planogram_view_only')}
        </p>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="grid grid-cols-10 gap-1.5 min-w-[320px] max-w-2xl mx-auto">
            {grid.map((item) => (
              <div
                key={`${item.row}-${item.col}`}
                className={`aspect-square rounded-lg border ${getCellStyle(item)} flex flex-col items-center justify-center p-0.5 text-center min-h-0`}
              >
                {item.productId ? (
                  <>
                    <div className="flex justify-center w-full shrink-0 min-w-0">
                      <div className="inline-flex flex-row items-center justify-center gap-px max-w-full min-w-0">
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
                          className="text-[10px] leading-tight font-semibold text-slate-900 truncate max-w-[32px] min-w-0 text-center"
                          title={item.sku || undefined}
                        >
                          {item.sku || '—'}
                        </span>
                      </div>
                    </div>
                    <span
                      className="text-[7px] leading-tight font-bold text-slate-600 break-words line-clamp-2 w-full mt-px"
                      title={item.productName}
                    >
                      {item.productName || ''}
                    </span>
                    {item.toOrder > 0 && (
                      <span className="text-[10px] leading-none font-extrabold text-indigo-800 mt-px tabular-nums">
                        {item.toOrder} u
                      </span>
                    )}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-400" />{t('no_quantity')}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-50 border border-indigo-300" />{t('with_quantity')}</span>
        </div>
      </div>
    </div>
  );
}
