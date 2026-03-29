'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, ChevronRight, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { productsApi } from '@/shared/api/products-api';
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

/** Pedidos para los que intentamos cargar factura en el historial (totales/unidades/PO desde factura). */
function shouldFetchInvoiceForHistory(order: OrderForUI): boolean {
  if (order.invoiceId != null && String(order.invoiceId).trim() !== '') return true;
  const s = (order.status || '').toLowerCase().trim();
  return ['invoiced', 'facturado', 'invoice', 'billed', 'facturada', 'delivered'].includes(s);
}

export function OrderHistory() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orders, setOrders] = useState<OrderForUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeCache, setStoreCache] = useState<Record<string, { name: string; address: string; city: string }>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      if (user?.id) {
        const apiOrders = await ordersApi.getOrdersByUser(user.id);
        const productFamilyCache = new Map<string, string>();
        const enriched = await Promise.all(
          apiOrders.map(async (order): Promise<OrderForUI> => {
            let o: OrderForUI = order;
            if (Number(order.total) <= 0 && order.items?.length) {
              const items = await Promise.all(
                order.items.map(async (item: any) => {
                  let price = Number(item.price) || 0;
                  if (!price) {
                    const inlineFamilyId = String(
                      item?.familyId ?? item?.FamilyId ?? item?.categoryId ?? item?.CategoryId ?? ''
                    ).trim();
                    let familyId = inlineFamilyId;
                    if (!familyId && item?.productId) {
                      const productId = String(item.productId).trim();
                      familyId = productFamilyCache.get(productId) || '';
                      if (!familyId) {
                        const product = await productsApi.getById(productId);
                        familyId = String(product?.familyId ?? product?.categoryId ?? '').trim();
                        if (familyId) productFamilyCache.set(productId, familyId);
                      }
                    }
                    if (familyId) price = await histpricesApi.getLatest(familyId);
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
        const withInvoice = await Promise.all(
          sorted.map(async (order) => {
            if (!shouldFetchInvoiceForHistory(order)) return order;
            try {
              const inv = await ordersApi.getInvoiceDisplayForOrder(
                order.id,
                order.invoiceId ?? undefined,
                order
              );
              if (!inv) return order;
              const lines = inv.items || [];
              const hasNumericTotal = Number(inv.total) > 0;
              if (lines.length === 0 && !hasNumericTotal) return order;
              const units = lines.reduce((s, it) => s + (Number(it.qty) || 0), 0);
              let total = Number(inv.total) || 0;
              if (total <= 0 && lines.length) {
                total = lines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
              }
              // PO ya no se usa para identificar la factura; usar InvoiceNumber.
              const invNo = String((inv as any)?.invoiceNumber ?? (inv as any)?.InvoiceNumber ?? '').trim();
              return {
                ...order,
                ...(invNo ? { invoiceNumber: invNo } : {}),
                ...(total > 0 ? { total, subtotal: total } : {}),
                ...(units > 0 ? { totalUnits: units } : {}),
                ...(lines.length > 0 ? { invoiceLineCount: lines.length } : {}),
              };
            } catch {
              return order;
            }
          })
        );
        setOrders(withInvoice);
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
  }, [orders]);

  /** Lista: solo «inicial» (todo lo no facturado) vs «facturado». */
  const isListInvoiced = (status: string | undefined) => {
    const s = (status || '').toLowerCase().trim();
    return (
      ['invoiced', 'facturado', 'invoice', 'billed', 'facturada'].includes(s) || s === '2'
    );
  };

  const isOrderInvoicedForList = (o: OrderForUI) => {
    if (o.invoiceId != null && String(o.invoiceId).trim() !== '') return true;
    return isListInvoiced(o.status);
  };

  const isListCancelled = (status: string | undefined) => {
    const s = (status || '').toLowerCase().trim();
    return s === 'cancelled' || s === 'canceled' || s === 'cancelado' || s === '3';
  };

  const filteredOrders = orders.filter((order) => {
    const cached = order.storeId ? storeCache[order.storeId] : null;
    const name = cached?.name || (order.storeName && !looksLikeId(order.storeName) ? order.storeName : '');
    const addr = (cached?.address || order.storeAddress || '').trim();
    const city = (cached?.city || '').trim();
    const po = (order.po || '').trim();
    const searchStr = (po + ' ' + name + ' ' + addr + ' ' + city + ' ' + (order.storeId || '')).toLowerCase();
    const matchesSearch = !searchQuery.trim() || searchStr.includes(searchQuery.toLowerCase());
    const invoiced = isOrderInvoicedForList(order);
    const cancelled = isListCancelled(order.status);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'invoiced' && invoiced) ||
      (statusFilter === 'initial' && !invoiced && !cancelled);
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (order: OrderForUI) => {
    if (isListCancelled(order.status)) return 'bg-slate-100 text-slate-600 border-slate-200';
    return isOrderInvoicedForList(order)
      ? 'bg-green-50 text-green-700 border-green-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const getStatusText = (order: OrderForUI) => {
    if (isListCancelled(order.status)) return t('cancelled') || 'Cancelado';
    return isOrderInvoicedForList(order) ? (t('invoiced') || 'Facturado') : t('initial');
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
            <SelectItem value="initial" className="text-slate-800 cursor-pointer">{t('initial')}</SelectItem>
            <SelectItem value="invoiced" className="text-slate-800 cursor-pointer">{t('invoiced') || 'Facturado'}</SelectItem>
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
            const displayCity = (cached?.city || '').trim();
            const displayPo = (order.po || '').trim();
            const titleMain = displayPo ? `${displayPo}` : displayStoreName;
            const subtitleStore = displayPo ? displayStoreName : null;
            const computedTotalFromOrderItems = order.items?.length
              ? order.items.reduce((s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0) * (Number(i.price) || 0), 0)
              : 0;
            const totalDisplay =
              Number(order.total) > 0
                ? Number(order.total)
                : computedTotalFromOrderItems > 0
                  ? computedTotalFromOrderItems
                  : Number(order.subtotal) > 0
                    ? Number(order.subtotal)
                    : 0;
            const articlesCount =
              order.invoiceLineCount != null && order.invoiceLineCount > 0
                ? order.invoiceLineCount
                : order.items?.length ?? 0;
            const unitsDisplay =
              order.totalUnits != null && order.totalUnits > 0
                ? order.totalUnits
                : order.items?.reduce((s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0), 0) ?? 0;
            const hasTotal = totalDisplay > 0;
            return (
              <Card
                key={order.id}
                className="border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer active:scale-98"
                onClick={() => router.push(`/order/${order.id}`)}
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
                        <Badge variant="outline" className={getStatusColor(order)}>
                          {getStatusText(order)}
                        </Badge>
                        {isOrderInvoicedForList(order) && order.podUploaded ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                            {t('pod')}
                          </span>
                        ) : null}
                        <span className="text-xs text-slate-500">{articlesCount} {t('articles')}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{t('total')}</p>
                      <p className="text-base font-semibold text-slate-900">
                        {hasTotal ? `$${Number(totalDisplay).toFixed(2)}` : t('total_not_available')}
                      </p>
                      <p className="text-xs text-slate-500">{unitsDisplay} {t('units')}</p>
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
