'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Badge } from '@/shared/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';

function looksLikeId(name: string): boolean {
  if (!name || !name.trim()) return true;
  return /^[0-9a-f-]{36}$/i.test(name.trim()) || /^\d+$/.test(name.trim());
}

export function OrderHistory() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orders, setOrders] = useState<OrderForUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeCache, setStoreCache] = useState<Record<string, { name: string; address: string }>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      if (user?.id) {
        const apiOrders = await ordersApi.getOrdersByUser(user.id);
        // Mismo criterio que en detalle: si no hay total, rellenar precios con histprices y calcular total
        const enriched = await Promise.all(
          apiOrders.map(async (order): Promise<OrderForUI> => {
            let o: OrderForUI = order;
            if (Number(order.total) <= 0 && order.items?.length) {
              const items = await Promise.all(
                order.items.map(async (item: any) => {
                  let price = Number(item.price) || 0;
                  if (item.productId && !price) {
                    price = await histpricesApi.getLatest(String(item.productId));
                  }
                  return { ...item, price };
                })
              );
              const subtotal = items.reduce((s, i) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price ?? 0), 0);
              const total = subtotal + Number(order.tax ?? 0);
              o = { ...order, items, subtotal, total };
            }
            return o;
          })
        );
        const sorted = [...enriched].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setOrders(sorted);
      } else {
        setOrders([]);
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  useEffect(() => {
    if (!orders.length) return;
    const needStore = [...new Set(orders.map((o) => o.storeId).filter(Boolean))].filter(
      (storeId) => {
        const order = orders.find((o) => o.storeId === storeId);
        return order && looksLikeId(order.storeName || '');
      }
    ) as string[];
    if (needStore.length === 0) return;
    let mounted = true;
    (async () => {
      const next: Record<string, { name: string; address: string }> = {};
      for (const id of needStore) {
        if (!mounted) break;
        const store = await storesApi.fetchStoreById(id);
        if (store && mounted) next[id] = { name: store.name, address: store.address || '' };
      }
      if (mounted) setStoreCache((prev) => ({ ...prev, ...next }));
    })();
    return () => { mounted = false; };
  }, [orders]);

  const filteredOrders = orders.filter((order) => {
    const cached = order.storeId ? storeCache[order.storeId] : null;
    const name = cached?.name || (order.storeName && !looksLikeId(order.storeName) ? order.storeName : '');
    const addr = (cached?.address || order.storeAddress || '').trim();
    const searchStr = (name + ' ' + addr + ' ' + (order.storeId || '')).toLowerCase();
    const matchesSearch = !searchQuery.trim() || searchStr.includes(searchQuery.toLowerCase());
    const statusNorm = (order.status || '').toLowerCase();
    const matchesStatus = statusFilter === 'all' || statusNorm === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  /** Solo 2 estados: pending e invoiced. */
  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'invoiced') return 'bg-green-50 text-green-700 border-green-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const getStatusText = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'invoiced') return t('invoiced') || 'Facturado';
    return t('pending');
  };

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-slate-900 text-lg mb-1">{t('order_history')}</h2>
        <p className="text-sm text-slate-500">{t('order_history_subtitle')}</p>
      </div>

      {/* Search and Filter - misma fila */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={t('search_orders')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 bg-white border-slate-200"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-[180px] shrink-0 bg-white border-slate-200 text-slate-700">
            <Filter className="h-4 w-4 text-slate-500 shrink-0" />
            <SelectValue placeholder={t('filter_by_status')} />
          </SelectTrigger>
            <SelectContent className="z-[100] min-w-[var(--radix-select-trigger-width)] bg-white border border-slate-200 shadow-lg">
            <SelectItem value="all" className="text-slate-800 cursor-pointer">{t('filter_all')}</SelectItem>
            <SelectItem value="invoiced" className="text-slate-800 cursor-pointer">{t('invoiced') || 'Facturado'}</SelectItem>
            <SelectItem value="pending" className="text-slate-800 cursor-pointer">{t('pending')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results Count */}
      <p className="text-xs text-slate-500 mb-3">
        {loading ? `${t('loading')}...` : `${filteredOrders.length} ${t('orders_found')}`}
      </p>

      {/* Orders List */}
      {filteredOrders.length > 0 ? (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const cached = order.storeId ? storeCache[order.storeId] : null;
            const displayStoreName = cached?.name || (order.storeName && !looksLikeId(order.storeName) ? order.storeName : t('store'));
            const displayAddress = (cached?.address || order.storeAddress || '').trim();
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
            const articlesCount = order.items?.length ?? 0;
            const hasTotal = totalDisplay > 0;
            return (
              <Card
                key={order.id}
                className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer active:scale-98"
                onClick={() => router.push(`/order/${order.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{displayStoreName}</p>
                      {displayAddress ? (
                        <p className="text-xs text-slate-500 mt-0.5 truncate" title={displayAddress}>{displayAddress}</p>
                      ) : null}
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(order.date).toLocaleDateString()}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className={getStatusColor(order.status)}>
                          {getStatusText(order.status)}
                        </Badge>
                        {(order.podUploaded || order.podImageUrl || order.podFileName) && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            POD ✓
                          </Badge>
                        )}
                        <span className="text-xs text-slate-500">{articlesCount} {t('articles')}</span>
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
                  <div className="flex items-center justify-end mt-2">
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="p-4 bg-slate-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Search className="h-8 w-8 text-slate-400" />
          </div>
          <p className="text-slate-600 mb-1">{t('no_orders_found')}</p>
          <p className="text-sm text-slate-500">{t('try_different_search')}</p>
        </div>
      )}
    </div>
  );
}
