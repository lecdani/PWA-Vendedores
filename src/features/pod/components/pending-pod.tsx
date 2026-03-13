'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { FileCheck, Camera, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { Card, CardContent } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

function looksLikeId(name: string): boolean {
  if (!name || !name.trim()) return true;
  return /^[0-9a-f-]{36}$/i.test(name.trim()) || /^\d+$/.test(name.trim());
}

export function PendingPOD() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [pendingOrders, setPendingOrders] = useState<OrderForUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeCache, setStoreCache] = useState<Record<string, { name: string; address: string; city: string }>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      if (user?.id) {
        let all = await ordersApi.getOrdersByUser(user.id);
        const pending = all.filter(
          (o) => ((o.status || '').toLowerCase() === 'pending' && (o.podRequired !== false) && !o.podUploaded)
        );
        // Mismo criterio que historial: rellenar total con precios de histprices cuando sea 0
        const enriched = await Promise.all(
          pending.map(async (order): Promise<OrderForUI> => {
            if (Number(order.total) > 0) return order;
            const items = order?.items && Array.isArray(order.items) ? order.items : [];
            if (!items.length) return order;
            try {
              const enrichedItems = await Promise.all(
                items.map(async (item: any) => {
                  let price = Number(item.price) || 0;
                  if (item.productId && !price) {
                    price = await histpricesApi.getLatest(String(item.productId)); // último del historial
                  }
                  return { ...item, price };
                })
              );
              const subtotal = enrichedItems.reduce((s, i) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price ?? 0), 0);
              const total = subtotal + Number(order.tax ?? 0);
              return { ...order, items: enrichedItems, subtotal, total };
            } catch {
              return order;
            }
          })
        );
        setPendingOrders(enriched);
      } else {
        setPendingOrders([]);
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  useEffect(() => {
    if (!pendingOrders.length) return;
    const needStore = [...new Set(pendingOrders.map((o) => o.storeId).filter(Boolean))].filter(
      (storeId) => {
        const order = pendingOrders.find((o) => o.storeId === storeId);
        return order && looksLikeId(order.storeName || '');
      }
    ) as string[];
    if (needStore.length === 0) return;
    let mounted = true;
    (async () => {
      const next: Record<string, { name: string; address: string; city: string }> = {};
      for (const id of needStore) {
        if (!mounted) break;
        const store = await storesApi.fetchStoreById(id);
        if (store && mounted) {
          const cityRaw = (store.city || '').trim();
          const city = cityRaw && citiesApi.looksLikeCityId(cityRaw)
            ? (await citiesApi.getCityNameById(cityRaw)) || ''
            : cityRaw;
          next[id] = { name: store.name, address: store.address || '', city };
        }
      }
      if (mounted) setStoreCache((prev) => ({ ...prev, ...next }));
    })();
    return () => { mounted = false; };
  }, [pendingOrders]);

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-slate-900 text-lg mb-1">{t('pending_deliveries')}</h2>
        <p className="text-sm text-slate-500">{t('pod_subtitle')}</p>
      </div>

      {/* Alert */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-amber-900 mb-1">{t('pod_required')}</p>
          <p className="text-xs text-amber-700">{t('pod_warning')}</p>
        </div>
      </div>

      {/* Pending Orders List - misma info que historial: tienda, total, dirección, fecha */}
      {loading ? (
        <p className="text-sm text-slate-500 py-4">{t('loading')}...</p>
      ) : pendingOrders.length > 0 ? (
        <div className="space-y-3">
          {pendingOrders.map((order) => {
            const cached = order.storeId ? storeCache[order.storeId] : null;
            const displayStoreName = cached?.name || (order.storeName && !looksLikeId(order.storeName) ? order.storeName : t('store'));
            const displayAddress = (cached?.address || order.storeAddress || '').trim();
            const displayCity = (cached?.city || '').trim();
            const displayPo = (order.po || '').trim();
            const titleMain = displayPo ? `PO - ${displayPo}` : displayStoreName;
            const subtitleStore = displayPo ? displayStoreName : null;
            const computedTotal = order.items?.length
              ? order.items.reduce((s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0) * (Number(i.price) || 0), 0)
              : 0;
            const totalDisplay =
              Number(order.total) > 0
                ? Number(order.total)
                : computedTotal > 0
                  ? computedTotal
                  : Number(order.subtotal) > 0
                    ? Number(order.subtotal)
                    : 0;
            const hasTotal = totalDisplay > 0;
            const articlesCount = order.items?.length ?? 0;
            return (
              <Card
                key={order.id}
                className="border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer active:scale-[0.98]"
                onClick={() => router.push(`/capture-pod/${order.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{titleMain}</p>
                      {subtitleStore ? (
                        <p className="text-xs text-slate-500 mt-0.5 truncate" title={subtitleStore}>{subtitleStore}</p>
                      ) : null}
                      {((displayAddress || displayCity) && (() => {
                        const ubicacion = [displayAddress, displayCity].filter(Boolean).join(', ');
                        return ubicacion ? (
                          <p className="text-xs text-slate-500 mt-0.5 truncate" title={ubicacion}>
                            {t('location')}: {ubicacion}
                          </p>
                        ) : null;
                      })())}
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(order.date).toLocaleDateString()}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {t('waiting_pod')}
                        </Badge>
                        <span className="text-xs text-slate-500">{order.totalUnits || articlesCount} {t('units')}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{t('total')}</p>
                      <p className="text-base font-semibold text-slate-900">
                        {hasTotal ? `$${Number(totalDisplay).toFixed(2)}` : t('total_not_available')}
                      </p>
                      <p className="text-xs text-slate-500">{order.totalUnits || articlesCount} {t('units')}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs text-slate-500">
                      {t('delivery_date')}: {new Date(order.deliveryDate || order.date).toLocaleDateString()}
                    </span>
                    <Button
                      onClick={(e) => { e.stopPropagation(); router.push(`/capture-pod/${order.id}`); }}
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 shrink-0"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      {t('capture_pod')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="p-4 bg-green-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <FileCheck className="h-8 w-8 text-green-600" />
          </div>
          <p className="text-slate-900 mb-1">{t('no_pending_pod')}</p>
          <p className="text-sm text-slate-500">{t('all_deliveries_closed')}</p>
        </div>
      )}
    </div>
  );
}
