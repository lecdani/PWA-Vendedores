'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Grid3x3, Loader2, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi } from '@/shared/api/distributions-api';
import { productsApi, getProductImageUrl } from '@/shared/api/products-api';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { ordersApi } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { setOrderReviewPayload } from '@/shared/order-review-payload';

export interface ProductPosition {
  row: number;
  col: number;
  productId: string;
  productName: string;
  sku: string;
  category: string;
  idealStock: number;
  currentStock: number;
  toOrder: number;
  price: number;
  imageUrl?: string;
}

export function Planogram({ storeId, orderId }: { storeId: string; orderId?: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [planogramData, setPlanogramData] = useState<ProductPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planogramId, setPlanogramId] = useState<string | null>(null);
  const [planogramName, setPlanogramName] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryForUI[]>([]);
  const [limitError, setLimitError] = useState<string | null>(null);

  const MAX_QTY_PER_PRODUCT_PLANOGRAM = 10;

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
        const [activePlan, products, categories] = await Promise.all([
          planogramsApi.getActive(),
          productsApi.fetchAll(),
          categoriesApi.fetchAll(),
        ]);

        if (!mounted) return;
        if (!activePlan) {
          setLoadError(t('no_active_planogram') || 'No hay planograma activo. Activa uno en el Admin.');
          setPlanogramData([]);
          setLoading(false);
          return;
        }

        setAllCategories(categories);
        setPlanogramId(activePlan.id);
        setPlanogramName(activePlan.name ?? null);
        const distList = await distributionsApi.getByPlanogram(activePlan.id);
        if (!mounted) return;

        const categoryById = new Map<string, string>();
        categories.forEach((c) => {
          categoryById.set(c.id, c.name);
          categoryById.set(String(Number(c.id)), c.name);
        });

        const productMap = new Map<string, (typeof products)[0]>();
        products.forEach((p) => {
          productMap.set(p.id, p);
          const numId = Number(p.id);
          if (!Number.isNaN(numId)) productMap.set(String(numId), p);
        });
        const getProduct = (productId: string) =>
          productMap.get(productId) ?? productMap.get(String(Number(productId)));

        const resolveCategory = (p: (typeof products)[0] | null): string => {
          if (!p) return '';
          const name = (p.category || '').trim();
          if (name) return name;
          const id = p.categoryId != null ? String(p.categoryId) : '';
          return id ? (categoryById.get(id) ?? categoryById.get(String(Number(id))) ?? '') : '';
        };

        const uniqueProductIds = [...new Set(distList.map((d) => d.productId).filter(Boolean))];
        const priceResults = await Promise.all(
          uniqueProductIds.map(async (id) => ({ id, price: await histpricesApi.getLatest(id) }))
        );
        const priceMap = new Map(priceResults.map((r) => [r.id, r.price]));

        const grid: ProductPosition[] = [];

        for (let row = 0; row < 10; row++) {
          for (let col = 0; col < 10; col++) {
            const dist = distList.find((d) => d.xPosition === row && d.yPosition === col);
            const product = dist ? getProduct(dist.productId) : null;
            const productIdStr = product?.id ?? '';
            const price =
              productIdStr && priceMap.has(productIdStr)
                ? priceMap.get(productIdStr)!
                : product?.currentPrice ?? 0;
            grid.push({
              row,
              col,
              productId: productIdStr,
              productName: product?.name ?? '',
              sku: product?.sku ?? '',
              category: resolveCategory(product ?? null),
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
          const qtyByProduct = new Map<string, number>();
          details.forEach((d: any) => {
            const pid = String(d?.productId ?? d?.ProductId ?? '');
            const qty = Number(d?.quantity ?? d?.Quantity ?? 0);
            if (pid) qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + qty);
          });
          const merged = grid.map((item) => {
            const qty = item.productId
              ? (qtyByProduct.get(item.productId) ?? qtyByProduct.get(String(Number(item.productId))) ?? 0)
              : 0;
            return { ...item, toOrder: qty };
          });
          setPlanogramData(merged);
        } else {
          setPlanogramData(grid);
        }
      } catch (e) {
        if (mounted) setLoadError((e as Error)?.message ?? 'Error al cargar planograma');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [storeId, orderId, t]);

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

      const next = [...prev];
      next[idx] = { ...current, toOrder: qty };
      return next;
    });
  };

  const incQty = (row: number, col: number) => {
    const current = planogramData.find((p) => p.row === row && p.col === col);
    if (!current || !current.productId) return;
    setQtyForCell(row, col, (current.toOrder || 0) + 1);
  };

  const decQty = (row: number, col: number) => {
    const current = planogramData.find((p) => p.row === row && p.col === col);
    if (!current || !current.productId) return;
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
    });
    router.push('/order-review');
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
              onClick={() => router.push('/select-store')}
              className="p-2 h-auto"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{storeInfo?.name ?? t('product_organization')}</h2>
              <p className="text-xs text-slate-500">{planogramName ?? t('planogram')}</p>
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
            <p className="text-xs text-green-600 mb-0.5">{t('total')}</p>
            <p className="text-sm text-green-900">${totalValue.toFixed(2)}</p>
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
                        className="text-[9px] leading-tight font-semibold text-slate-900 truncate max-w-[42px]"
                        title={item.sku}
                      >
                        {item.sku || '—'}
                      </span>
                    </div>
                    <span
                      className="text-[8px] leading-tight font-medium text-slate-600 break-words line-clamp-2 w-full mt-0.5"
                      title={item.productName}
                    >
                      {item.productName || ''}
                    </span>

                    <div className="mt-1 flex items-center gap-0.5">
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

        {/* Resumen por categoría: todas las categorías registradas, con Pcs (0 o suma del pedido) */}
        {allCategories.length > 0 && (
          <div className="mt-6 border border-slate-200 rounded-lg bg-slate-50/50 overflow-x-auto">
            <table className="w-full text-sm min-w-[360px]">
              <thead>
                <tr className="bg-slate-200 text-slate-800">
                  <th className="text-left py-2 px-3 font-semibold whitespace-normal break-words">
                    {t('family_col') || 'Family'}
                  </th>
                  <th className="text-right py-2 px-3 font-semibold w-16">{t('pcs_col') || 'Pcs'}</th>
                </tr>
              </thead>
              <tbody>
                {[...allCategories]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((cat) => {
                    const pcs = planogramData
                      .filter((item) => (item.category || '').trim() === cat.name)
                      .reduce((sum, item) => sum + item.toOrder, 0);
                    return (
                      <tr key={cat.id} className="border-t border-slate-200 bg-white">
                        <td className="py-2 px-3 text-slate-900 whitespace-normal break-words">
                          {cat.name}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-slate-800">{pcs}</td>
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
          <Button
            onClick={handleSendOrder}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            disabled={totalToOrder === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {t('review_order')}
          </Button>
        </div>
      </div>
    </div>
  );
}
