'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Grid3x3, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { ProductModal } from './product-modal';
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi } from '@/shared/api/distributions-api';
import { productsApi } from '@/shared/api/products-api';
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
  idealStock: number;
  currentStock: number;
  toOrder: number;
  price: number;
}

export function Planogram({ storeId, orderId }: { storeId: string; orderId?: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [selectedPosition, setSelectedPosition] = useState<ProductPosition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [planogramData, setPlanogramData] = useState<ProductPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planogramId, setPlanogramId] = useState<string | null>(null);
  const [planogramName, setPlanogramName] = useState<string | null>(null);

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
        const [activePlan, products] = await Promise.all([
          planogramsApi.getActive(),
          productsApi.fetchAll(),
        ]);

        if (!mounted) return;
        if (!activePlan) {
          setLoadError(t('no_active_planogram') || 'No hay planograma activo. Activa uno en el Admin.');
          setPlanogramData([]);
          setLoading(false);
          return;
        }

        setPlanogramId(activePlan.id);
        setPlanogramName(activePlan.name ?? null);
        const distList = await distributionsApi.getByPlanogram(activePlan.id);
        if (!mounted) return;

        const productMap = new Map<string, (typeof products)[0]>();
        products.forEach((p) => {
          productMap.set(p.id, p);
          const numId = Number(p.id);
          if (!Number.isNaN(numId)) productMap.set(String(numId), p);
        });
        const getProduct = (productId: string) =>
          productMap.get(productId) ?? productMap.get(String(Number(productId)));

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
              idealStock: 0,
              currentStock: 0,
              toOrder: 0,
              price,
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

  const handleCellClick = (position: ProductPosition) => {
    setSelectedPosition(position);
    setModalOpen(true);
  };

  const handleUpdatePosition = (currentStock: number, toOrder: number) => {
    if (selectedPosition) {
      setPlanogramData(prev =>
        prev.map(item =>
          item.row === selectedPosition.row && item.col === selectedPosition.col
            ? { ...item, currentStock, toOrder }
            : item
        )
      );
    }
    setModalOpen(false);
  };

  const totalToOrder = planogramData.reduce((sum, item) => sum + item.toOrder, 0);
  const totalValue = planogramData.reduce((sum, item) => sum + (item.toOrder * item.price), 0);
  const productsCount = planogramData.filter((item) => item.productId).length;
  const completedCount = planogramData.filter((item) => item.currentStock > 0 || item.toOrder > 0).length;
  const progressPercent = planogramData.length > 0 ? Math.round((completedCount / planogramData.length) * 100) : 0;

  const getCellStyle = (item: ProductPosition) => {
    const hasProduct = !!item.productId;
    if (!hasProduct) return 'bg-slate-400 border-slate-500'; // vacío: solo más oscuro
    if (item.toOrder > 0) return 'bg-blue-50 border-blue-300';
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
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
          
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {progressPercent}% {t('completed')}
          </Badge>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{productsCount}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center">
            <p className="text-xs text-blue-600 mb-0.5">{t('units')}</p>
            <p className="text-sm text-blue-900">{totalToOrder}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <p className="text-xs text-green-600 mb-0.5">{t('total')}</p>
            <p className="text-sm text-green-900">${totalValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Planogram Grid */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Grid3x3 className="h-4 w-4 text-slate-600" />
          <p className="text-sm text-slate-600">{t('tap_position_to_count')}</p>
        </div>

        {productsCount === 0 && (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {t('no_products_in_planogram')}
          </div>
        )}

        {productsCount > 0 && (
          <p className="text-xs text-slate-500 mb-2">{t('planogram_loaded')}</p>
        )}

        {/* 10x10 Grid */}
        <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="grid grid-cols-10 gap-1.5 min-w-[320px] max-w-2xl mx-auto">
            {planogramData.map((item) => (
              <button
                key={`${item.row}-${item.col}`}
                onClick={() => handleCellClick(item)}
                className={`aspect-square rounded-lg border ${getCellStyle(item)} hover:opacity-90 transition-opacity relative flex flex-col items-center justify-center p-1 text-center min-h-0`}
              >
                {item.productId ? (
                  <>
                    <span className="text-[10px] leading-tight font-medium text-slate-800 break-words line-clamp-2 w-full" title={item.productName || item.sku}>
                      {item.productName || item.sku}
                    </span>
                    {item.toOrder > 0 && (
                      <span className="text-xs font-semibold text-blue-700 mt-0.5">
                        {item.toOrder}
                      </span>
                    )}
                  </>
                ) : null}
              </button>
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
            <span className="w-3 h-3 rounded bg-blue-50 border border-blue-300" />
            {t('with_quantity')}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="flex gap-3 max-w-2xl mx-auto">
          <Button
            onClick={handleSendOrder}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={totalToOrder === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {t('review_order')}
          </Button>
        </div>
      </div>

      {/* Product Modal */}
      {selectedPosition && (
        <ProductModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          position={selectedPosition}
          onUpdate={handleUpdatePosition}
        />
      )}
    </div>
  );
}
