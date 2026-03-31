'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { FileCheck, Camera, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { Card, CardContent } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

function looksLikeId(name: string): boolean {
  if (!name || !name.trim()) return true;
  return /^[0-9a-f-]{36}$/i.test(name.trim()) || /^\d+$/.test(name.trim());
}

type InvoiceRowMetrics = {
  order: OrderForUI;
  invTotal: number;
  invUnits: number;
  invLineCount: number;
  invDate?: string;
  invOk: boolean;
};

function summarizeInvoiceDisplay(
  inv: Awaited<ReturnType<typeof ordersApi.getInvoiceDisplayForOrder>>
): Omit<InvoiceRowMetrics, 'order'> {
  if (!inv) return { invTotal: 0, invUnits: 0, invLineCount: 0, invDate: undefined, invOk: false };
  const lines = inv.items || [];
  const invLineCount = lines.length;
  const invUnits = lines.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  let invTotal = Number(inv.total) || 0;
  if (invTotal <= 0 && invLineCount) {
    invTotal = lines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  }
  const invOk = invLineCount > 0 || invTotal > 0;
  return { invTotal, invUnits, invLineCount, invDate: inv.date, invOk };
}

export function PendingPOD() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [pendingRows, setPendingRows] = useState<InvoiceRowMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeCache, setStoreCache] = useState<Record<string, { name: string; address: string; city: string }>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const triggerRefresh = () => setRefreshTick((v) => v + 1);
    const onOnline = () => triggerRefresh();
    const onDataRefresh = () => triggerRefresh();
    window.addEventListener('online', onOnline);
    window.addEventListener('app-data-refresh', onDataRefresh as EventListener);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('app-data-refresh', onDataRefresh as EventListener);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      if (user?.id) {
        let all = await ordersApi.getOrdersByUser(user.id);
        const productFamilyCache = new Map<string, string>();
        const pending = all.filter((o) => {
          const hasInvoice = o.invoiceId != null && String(o.invoiceId).trim() !== '';
          return hasInvoice && !o.podUploaded;
        });
        const rows: InvoiceRowMetrics[] = await Promise.all(
          pending.map(async (order) => {
            let metrics = summarizeInvoiceDisplay(null);
            try {
              const inv = await ordersApi.getInvoiceDisplayForOrder(order.id, order.invoiceId, order);
              metrics = summarizeInvoiceDisplay(inv);
            } catch {
              /* mantener invOk false */
            }
            return { order, ...metrics };
          })
        );
        setPendingRows(rows);
      } else {
        setPendingRows([]);
      }
      setLoading(false);
    };
    load();
  }, [user?.id, refreshTick]);

  useEffect(() => {
    if (!pendingRows.length) return;
    const needStore = [...new Set(pendingRows.map((r) => r.order.storeId).filter(Boolean))].filter(
      (storeId) => {
        const row = pendingRows.find((r) => r.order.storeId === storeId);
        return row && looksLikeId(row.order.storeName || '');
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
  }, [pendingRows]);

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-slate-900 text-lg mb-1">{t('pending_deliveries')}</h2>
        <p className="text-sm text-slate-500">{t('pod_pending_invoiced_subtitle')}</p>
      </div>

      {/* Alert */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-amber-900 mb-1">{t('pod_required')}</p>
          <p className="text-xs text-amber-700">{t('pod_warning_deferred')}</p>
        </div>
      </div>

      {/* Pending Orders List - misma info que historial: tienda, total, dirección, fecha */}
      {loading ? (
        <p className="text-sm text-slate-500 py-4">{t('loading')}...</p>
      ) : pendingRows.length > 0 ? (
        <div className="space-y-3">
          {pendingRows.map(({ order, invTotal, invUnits, invDate, invOk }) => {
            const cached = order.storeId ? storeCache[order.storeId] : null;
            const displayStoreName = cached?.name || (order.storeName && !looksLikeId(order.storeName) ? order.storeName : t('store'));
            const displayAddress = (cached?.address || order.storeAddress || '').trim();
            const displayCity = (cached?.city || '').trim();
            const invNo = String(
              order.invoiceNumber ?? (order as any)?.InvoiceNumber ?? (order as any)?.invoiceNumber ?? ''
            ).trim();
            const titleMain = invNo ? `${invNo}` : displayStoreName;
            const subtitleStore = invNo ? displayStoreName : null;
            const hasTotal = invOk && invTotal > 0;
            const displayDate = invOk && invDate ? invDate : order.date;
            const unitsLabel = invOk ? invUnits : null;
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
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(displayDate).toLocaleDateString()}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {t('waiting_pod')}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {unitsLabel != null ? `${unitsLabel} ${t('units')}` : t('total_not_available')}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{t('total')}</p>
                      <p className="text-base font-semibold text-slate-900">
                        {hasTotal ? `$${Number(invTotal).toFixed(2)}` : t('total_not_available')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {unitsLabel != null ? `${unitsLabel} ${t('units')}` : t('total_not_available')}
                      </p>
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
