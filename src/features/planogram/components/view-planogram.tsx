'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Grid3x3, Loader2, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { planogramsApi } from '@/shared/api/planograms-api';
import { distributionsApi } from '@/shared/api/distributions-api';
import { productsApi, getProductImageUrl } from '@/shared/api/products-api';
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

export function ViewPlanogram({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [order, setOrder] = useState<OrderForUI | null>(null);
  const [grid, setGrid] = useState<ProductPosition[]>([]);
  const [planogramName, setPlanogramName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      const apiOrder = await ordersApi.getOrderById(orderId);
      if (!mounted || !apiOrder) {
        if (mounted) {
          setOrder(apiOrder || null);
          setLoading(false);
        }
        return;
      }
      setOrder(apiOrder);

      const activePlan = await planogramsApi.getActive();
      if (!mounted || !activePlan) {
        setGrid([]);
        setLoading(false);
        return;
      }
      setPlanogramName(activePlan.name ?? null);

      const distList = await distributionsApi.getByPlanogram(activePlan.id);
      if (!mounted) return;

      const products = await productsApi.fetchAll();
      const productMap = new Map(products.map((p) => [p.id, p]));
      products.forEach((p) => {
        const numId = Number(p.id);
        if (!Number.isNaN(numId)) productMap.set(String(numId), p);
      });
      const getProduct = (id: string) => productMap.get(id) ?? productMap.get(String(Number(id)));

      const orderItemsByProductId = new Map<string, { productName: string; sku: string; quantity: number; price: number }>();
      for (const item of apiOrder.items) {
        const id = String(item.productId ?? item.ProductId ?? '');
        if (id) {
          let price = Number(item.price) || 0;
          if (!price) {
            const { histpricesApi } = await import('@/shared/api/histprices-api');
            price = await histpricesApi.getLatest(id);
          }
          orderItemsByProductId.set(id, {
            productName: (item.productName || item.sku || getProduct(id)?.name || '').trim(),
            sku: item.sku || getProduct(id)?.sku || '',
            quantity: item.toOrder ?? item.quantity ?? 0,
            price,
          });
        }
      }

      const planogramGrid: ProductPosition[] = [];
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          const dist = distList.find((d) => d.xPosition === row && d.yPosition === col);
          const product = dist ? getProduct(dist.productId) : null;
          const orderItem = product ? orderItemsByProductId.get(product.id) ?? orderItemsByProductId.get(String(Number(product.id))) : null;
          planogramGrid.push({
            row,
            col,
            productId: product?.id ?? '',
            productName: orderItem?.productName ?? product?.name ?? product?.sku ?? '',
            sku: orderItem?.sku ?? product?.sku ?? '',
            toOrder: orderItem?.quantity ?? 0,
            price: orderItem?.price ?? product?.currentPrice ?? 0,
            imageUrl: product ? getProductImageUrl(product) : undefined,
          });
        }
      }
      if (mounted) setGrid(planogramGrid);
      setLoading(false);
    })();

    return () => { mounted = false; };
  }, [orderId]);

  if (loading || !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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

  const getCellStyle = (item: ProductPosition) => {
    if (!item.productId) return 'bg-slate-400 border-slate-500';
    if (item.toOrder > 0) return 'bg-blue-50 border-blue-300';
    return 'bg-slate-100 border-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push(`/order/${orderId}`)} className="p-2 h-auto">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{planogramName ?? t('planogram')}</h2>
              <p className="text-xs text-slate-500">{order.storeName}</p>
            </div>
          </div>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{t('view_only')}</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{productsWithQty}</p>
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

      <div className="px-4 py-4">
        <p className="text-sm text-slate-600 mb-3">{t('planogram_view_only')}</p>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="grid grid-cols-10 gap-1.5 min-w-[320px] max-w-2xl mx-auto">
            {grid.map((item) => (
              <div
                key={`${item.row}-${item.col}`}
                className={`aspect-square rounded-lg border ${getCellStyle(item)} flex flex-col items-center justify-center p-1 text-center min-h-0`}
              >
                {item.productId ? (
                  <>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0 mx-auto" />
                    ) : (
                      <div className="w-5 h-5 rounded bg-slate-200 flex items-center justify-center flex-shrink-0 mx-auto">
                        <Package className="h-2.5 w-2.5 text-slate-500" />
                      </div>
                    )}
                    <span className="text-[9px] leading-tight font-medium text-slate-800 break-words line-clamp-2 w-full mt-0.5" title={item.productName || item.sku}>
                      {item.productName || item.sku}
                    </span>
                    {item.toOrder > 0 && (
                      <span className="text-xs font-semibold text-blue-700 mt-0.5">{item.toOrder} u</span>
                    )}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-400" />{t('no_quantity')}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-300" />{t('with_quantity')}</span>
        </div>
      </div>
    </div>
  );
}
