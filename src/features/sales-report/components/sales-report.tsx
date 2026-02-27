'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileText, TrendingUp, Package, DollarSign, Store as StoreIcon, MapPin } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { histpricesApi } from '@/shared/api/histprices-api';
import { productsApi } from '@/shared/api/products-api';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function looksLikeId(name: string): boolean {
  if (!name || !name.trim()) return true;
  return /^[0-9a-f-]{36}$/i.test(name.trim()) || /^\d+$/.test(name.trim());
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function getItemDisplayName(item: any): string {
  if (!item) return '—';
  const name = String(item?.productName ?? item?.ProductName ?? item?.description ?? item?.Description ?? item?.name ?? item?.Name ?? '').trim();
  if (name && !looksLikeId(name)) return name;
  const sku = String(item?.sku ?? item?.Sku ?? item?.code ?? item?.Code ?? '').trim();
  if (sku && !looksLikeId(sku)) return sku;
  const pid = String(item?.productId ?? item?.ProductId ?? '').trim();
  if (pid && !looksLikeId(pid)) return pid;
  return sku || pid || '—';
}

function productDisplayName(pname: string, sku: string, pid: string): string {
  if (pname && !looksLikeId(pname)) return pname;
  if (sku && !looksLikeId(sku)) return sku;
  if (pid && !looksLikeId(pid)) return pid;
  return sku || pid || 'Producto';
}

export function SalesReport() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();

  const [orders, setOrders] = useState<OrderForUI[]>([]);
  const [visitLogs, setVisitLogs] = useState<Array<{ id: string | number; storeId: string; visitDate: string }>>([]);
  const [storeCache, setStoreCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromDate, setFromDate] = useState(startOfMonth.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedStore, setSelectedStore] = useState('all');
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.id) {
        setOrders([]);
        setVisitLogs([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const [apiOrders, logs] = await Promise.all([
        ordersApi.getOrdersByUser(user.id),
        ordersApi.getVisitLogsBySalesperson(user.id),
      ]);

      if (!mounted) return;

      // Enriquecer pedidos con precios e información de producto cuando falten
      const productNameCache = new Map<string, { name: string; sku: string }>();
      const resolveProductName = async (productId: string, currentName: string, currentSku: string) => {
        if (!productId) return { name: currentName, sku: currentSku };
        if (currentName && !looksLikeId(currentName)) return { name: currentName, sku: currentSku };
        let cached = productNameCache.get(productId);
        if (cached) return cached;
        const product = await productsApi.getById(String(productId));
        if (product) {
          cached = { name: product.name || '', sku: product.sku || '' };
          productNameCache.set(productId, cached);
        } else {
          cached = { name: currentName, sku: currentSku };
        }
        return cached;
      };

      let enriched: OrderForUI[] = await Promise.all(
        apiOrders.map(async (order): Promise<OrderForUI> => {
          let o: OrderForUI = order;
          if (order.items?.length) {
            const items = await Promise.all(
              order.items.map(async (item: any) => {
                let price = Number(item.price) || 0;
                if (item.productId && !price) {
                  price = await histpricesApi.getLatest(String(item.productId));
                }
                const resolved = await resolveProductName(
                  String(item?.productId ?? item?.ProductId ?? ''),
                  String(item?.productName ?? item?.ProductName ?? item?.description ?? '').trim(),
                  String(item?.sku ?? item?.Sku ?? '').trim()
                );
                return {
                  ...item,
                  price,
                  productName: resolved.name || (item?.productName ?? item?.ProductName ?? ''),
                  sku: resolved.sku || (item?.sku ?? item?.Sku ?? ''),
                };
              })
            );

            // Si el pedido no trae total/subtotal fiables, recalcularlos desde los ítems
            if (Number(order.total) <= 0 || !o.subtotal) {
              const subtotal = items.reduce(
                (s, i) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price ?? 0),
                0
              );
              const total = subtotal + Number(order.tax ?? 0);
              if (total > 0) o = { ...order, items, subtotal, total };
              else o = { ...order, items };
            } else if (items !== order.items) {
              o = { ...order, items };
            }
          }
          return o;
        })
      );

      setOrders(enriched);
      setVisitLogs(logs);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const storeIds = [
      ...new Set([
        ...orders.map((o) => o.storeId).filter(Boolean),
        ...visitLogs.map((v) => v.storeId).filter(Boolean),
      ]),
    ].filter((id) => id && looksLikeId(orders.find((o) => o.storeId === id)?.storeName || id));
    if (storeIds.length === 0) return;
    let mounted = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const id of storeIds) {
        if (!mounted) break;
    
        const store = await storesApi.fetchStoreById(id);
        if (store?.name) next[id] = store.name;
      }
      if (mounted) setStoreCache((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      mounted = false;
    };
  }, [orders, visitLogs]);

  const getStoreName = (storeId: string, fallback?: string) =>
    storeCache[storeId] || (orders.find((o) => o.storeId === storeId)?.storeName) || fallback || storeId;

  const filteredOrders = orders.filter((order) => {
    const statusNorm = (order.status || '').toLowerCase();
    const matchesStatus =
      selectedStatus === 'all' || statusNorm === selectedStatus.toLowerCase();
    const matchesStore =
      selectedStore === 'all' || order.storeId === selectedStore;

    // Comparar solo la parte de fecha YYYY-MM-DD para evitar problemas de zona horaria
    const orderDay = (order.date || '').toString().slice(0, 10);
    let matchesDate = true;
    if (fromDate) {
      matchesDate = orderDay >= fromDate;
    }
    if (matchesDate && toDate) {
      matchesDate = orderDay <= toDate;
    }

    return matchesStatus && matchesStore && matchesDate;
  });

  const filteredVisitLogs = visitLogs.filter((v) => {
    const visitDay = (v.visitDate || '').toString().slice(0, 10);
    let matchesDate = true;
    if (fromDate) {
      matchesDate = visitDay >= fromDate;
    }
    if (matchesDate && toDate) {
      matchesDate = visitDay <= toDate;
    }
    const matchesStore =
      selectedStore === 'all' || v.storeId === selectedStore;
    return matchesDate && matchesStore;
  });

  const sortedFilteredOrders = [...filteredOrders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const isCompleted = (status: string) => {
    const s = (status || '').toLowerCase();
    return s === 'completed' || s === 'invoiced' || s === 'delivered';
  };

  const completedOrders = filteredOrders.filter((o) => isCompleted(o.status));
  const pendingOrders = filteredOrders.filter((o) => (o.status || '').toLowerCase() === 'pending');
  const totalRevenue = completedOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const totalProductsSold = completedOrders.reduce((sum, order) => {
    return sum + (order.items || []).reduce((itemSum, item) => itemSum + (item.toOrder ?? item.quantity ?? 0), 0);
  }, 0);
  const averageOrder = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;
  const activeDaysCount = new Set(
    filteredOrders.map((o) => (o.date || '').split('T')[0]).filter(Boolean)
  ).size;

  const salesByDayRaw = filteredOrders.reduce(
    (acc: { date: string; dateSort: string; sales: number; orders: number }[], order) => {
      const dateSort = order.date || '';
      const date = dateSort ? new Date(order.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }) : '—';
      const existing = acc.find((item) => item.date === date);
      const amt = isCompleted(order.status) ? Number(order.total) || 0 : 0;
      if (existing) {
        existing.sales += amt;
        existing.orders += 1;
      } else {
        acc.push({ date, dateSort, sales: amt, orders: 1 });
      }
      return acc;
    },
    []
  );
  const salesByDay = salesByDayRaw
    .sort((a, b) => (a.dateSort || '').localeCompare(b.dateSort || ''))
    .map(({ date, sales, orders }) => ({ date, sales, orders }));

  const topProducts = (() => {
    const ordersWithItems = filteredOrders.filter((o) => (o.items || []).length > 0);
    const completedFirst = ordersWithItems.filter((o) => isCompleted(o.status));
    const ordersToUse = completedFirst.length > 0 ? completedFirst : ordersWithItems;
    const map = new Map<string, { id: string; name: string; sku: string; quantity: number; revenue: number }>();
    ordersToUse.forEach((order) => {
      (order.items || []).forEach((item: any) => {
        const qty = Number(item?.toOrder ?? item?.quantity ?? item?.qty ?? item?.Qty ?? item?.amount ?? item?.Amount ?? 0);
        if (qty <= 0) return;
        const price = Number(item?.price ?? item?.Price ?? item?.unitPrice ?? 0) || 0;
        const pid = String(item?.productId ?? item?.ProductId ?? '').trim();
        const sku = String(item?.sku ?? item?.Sku ?? item?.code ?? item?.Code ?? '').trim();
        const pname = String(item?.productName ?? item?.ProductName ?? item?.description ?? item?.Description ?? item?.name ?? item?.Name ?? '').trim();
        const key = pid || sku || pname || `item-${order.id}-${map.size}`;
        const name = productDisplayName(pname, sku, pid);
        const existing = map.get(key) ?? map.get(pid) ?? (sku ? [...map.values()].find((p) => p.sku === sku) : undefined);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += qty * price;
        } else {
          map.set(key, {
            id: key,
            name,
            sku: sku || pid || name.slice(0, 20),
            quantity: qty,
            revenue: qty * price,
          });
        }
      });
    });
    return [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  })();
  const salesByStore = filteredOrders
    .filter((o) => isCompleted(o.status))
    .reduce((acc: { storeId: string; storeName: string; sales: number; orders: number }[], order) => {
      const name = getStoreName(order.storeId, order.storeName);
      const amt = Number(order.total) || 0;
      const existing = acc.find((s) => s.storeId === order.storeId);
      if (existing) {
        existing.sales += amt;
        existing.orders += 1;
      } else {
        acc.push({
          storeId: order.storeId,
          storeName: name,
          sales: amt,
          orders: 1,
        });
      }
      return acc;
    }, [])
    .sort((a, b) => b.sales - a.sales);
  const topStore = salesByStore[0];

  const visitsByStore = filteredVisitLogs
    .reduce<{ storeId: string; storeName: string; visits: number }[]>((acc, v) => {
      const name = getStoreName(v.storeId);
      const existing = acc.find((s) => s.storeId === v.storeId);
      if (existing) {
        existing.visits += 1;
      } else {
        acc.push({ storeId: v.storeId, storeName: name, visits: 1 });
      }
      return acc;
    }, [])
    .sort((a, b) => b.visits - a.visits);

  const visitsByDayRaw = filteredVisitLogs.reduce<{ date: string; dateSort: string; visits: number }[]>(
    (acc, v) => {
      const dateSort = v.visitDate || '';
      const date = dateSort
        ? new Date(dateSort).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })
        : '—';
      const existing = acc.find((item) => item.date === date);
      if (existing) {
        existing.visits += 1;
      } else {
        acc.push({ date, dateSort, visits: 1 });
      }
      return acc;
    },
    []
  );
  const visitsByDay = visitsByDayRaw
    .sort((a, b) => (a.dateSort || '').localeCompare(b.dateSort || ''))
    .map(({ date, visits }) => ({ date, visits }));

  const uniqueStores = Array.from(
    new Set([...orders.map((o) => o.storeId), ...visitLogs.map((v) => v.storeId)])
  )
    .filter(Boolean)
    .map((storeId) => ({
      id: storeId as string,
      name: getStoreName(storeId as string, storeId as string),
    }));

  const getStatusText = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'completed') return t('completed');
    if (s === 'invoiced') return t('invoiced') || 'Facturado';
    if (s === 'delivered') return t('delivered') || 'Entregado';
    if (s === 'pending') return t('pending');
    return status;
  };

  const handleClearFilters = () => {
    setFromDate('');
    setToDate('');
    setSelectedStatus('all');
    setSelectedStore('all');

  };

  const escapeCsvCell = (val: string): string => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleExportReport = () => {
    const headers = ['ID', 'Fecha', 'Tienda', 'Estado', 'Total', 'Productos'];
    const rows = filteredOrders.map((order) => {
      const products = (order.items || [])
        .map((item: any) => `${getItemDisplayName(item)} (${item.toOrder ?? item.quantity ?? 0})`)
        .join('; ') || '—';
      return [
        order.id,
        new Date(order.date).toLocaleDateString('es-MX', { dateStyle: 'short' }),
        getStoreName(order.storeId, order.storeName),
        getStatusText(order.status),
        formatCurrency(Number(order.total) || 0),
        products,
      ];
    });
    const csvRows = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
    const BOM = '\uFEFF';
    const csv = BOM + csvRows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-ventas-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (typeof window === 'undefined') return;
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-600">{t('generating_report')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { margin: 1.2cm; size: A4; }
          body * { visibility: hidden; }
          .report-print-area, .report-print-area * { visibility: visible; }
          .report-print-area {
            position: absolute; left: 0; top: 0; right: 0;
            padding: 0; margin: 0; background: #fff;
            max-width: 100%; font-size: 11pt; color: #0f172a;
          }
          .report-print-area h1, .report-print-area h2, .report-print-area h3 { color: #0f172a; font-weight: 700; }
          .report-print-area table { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 10pt; }
          .report-print-area th, .report-print-area td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          .report-print-area th { background: #f1f5f9; font-weight: 600; }
          .report-print-area .print-break { page-break-inside: avoid; }
          .no-print { display: none !important; }
          .print\\:hidden { display: none !important; }
          .report-print-area .recharts-wrapper { max-height: 200px !important; }
        }
      `}} />
      <header className="no-print bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4 max-w-4xl mx-auto">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="p-2 h-auto -ml-2 text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">{t('sales_report')}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t('sales_report_subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4 mr-2" />
              {t('export_pdf')}
            </Button>
          </div>
        </div>
      </header>

      <main ref={reportRef} className="report-print-area px-4 sm:px-6 py-6 pb-28 max-w-4xl mx-auto">
        <div className="hidden print:block print:mb-6">
          <h1 className="text-xl font-bold text-slate-900 mb-1">{t('sales_report')}</h1>
          <p className="text-sm text-slate-500 mb-4">{t('sales_report_subtitle')}</p>
          <table className="w-full mb-4">
            <tbody>
              <tr><td className="font-semibold pr-4">{t('total_orders')}</td><td>{filteredOrders.length}</td></tr>
              <tr><td className="font-semibold pr-4">{t('completed_orders')}</td><td>{completedOrders.length}</td></tr>
              <tr><td className="font-semibold pr-4">{t('pending')}</td><td>{pendingOrders.length}</td></tr>
              <tr><td className="font-semibold pr-4">{t('products_sold')}</td><td>{totalProductsSold}</td></tr>
              <tr><td className="font-semibold pr-4">{t('total_revenue')}</td><td>{formatCurrency(totalRevenue)}</td></tr>
              <tr><td className="font-semibold pr-4">{t('average_order')}</td><td>{formatCurrency(averageOrder)}</td></tr>
              <tr><td className="font-semibold pr-4">{t('active_days')}</td><td>{activeDaysCount}</td></tr>
            </tbody>
          </table>
          <h2 className="text-base font-bold text-slate-900 mt-4 mb-2">{t('detailed_orders')}</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Fecha</th>
                <th>Tienda</th>
                <th>Estado</th>
                <th>Total</th>
                <th>Productos</th>
              </tr>
            </thead>
            <tbody>
              {sortedFilteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{new Date(order.date).toLocaleDateString('es-MX', { dateStyle: 'short' })}</td>
                  <td>{getStoreName(order.storeId, order.storeName)}</td>
                  <td>{getStatusText(order.status)}</td>
                  <td>{formatCurrency(Number(order.total) || 0)}</td>
                  <td>{(order.items || []).map((item: any) => `${getItemDisplayName(item)} (${item.toOrder ?? item.quantity ?? 0})`).join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="print:hidden">
        <Card className="no-print border border-slate-200/80 shadow-sm mb-6 bg-white rounded-xl overflow-hidden max-w-full">
          <CardHeader className="px-4 sm:px-5 pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">{t('date_range')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 sm:px-5 pb-5 max-w-full min-w-0">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4 max-w-full min-w-0">
              <div className="min-w-0">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t('from_date')}</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="text-sm h-10 w-full min-w-0 max-w-full" />
              </div>
              <div className="min-w-0">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t('to_date')}</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="text-sm h-10 w-full min-w-0 max-w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4 max-w-full min-w-0">
              <div className="min-w-0">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t('status')}</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full min-w-0 max-w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-slate-200 focus:border-slate-300"
                >
                  <option value="all">{t('all_status')}</option>
                  <option value="delivered">{t('delivered') || 'Entregado'}</option>
                  <option value="invoiced">{t('invoiced') || 'Facturado'}</option>
                  <option value="pending">{t('pending')}</option>
                </select>
              </div>
              <div className="min-w-0">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t('store')}</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full min-w-0 max-w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-slate-200 focus:border-slate-300"
                >
                  <option value="all">{t('all_stores')}</option>
                  {[...uniqueStores].sort((a, b) => a.name.localeCompare(b.name)).map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleClearFilters} className="w-full border-slate-200">
              {t('clear_filters')}
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          {/* 1. Total pedidos */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 w-fit">
                <Package className="h-5 w-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('total_orders')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{filteredOrders.length}</p>
              </div>
            </CardContent>
          </Card>
          {/* 2. Pedidos Completados */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-blue-50 w-fit">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('completed_orders')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{completedOrders.length}</p>
              </div>
            </CardContent>
          </Card>
          {/* 3. Pendiente */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50 w-fit">
                <Package className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('pending')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{pendingOrders.length}</p>
              </div>
            </CardContent>
          </Card>
          {/* 4. Productos Vendidos */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-violet-50 w-fit">
                <Package className="h-5 w-5 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('products_sold')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{totalProductsSold}</p>
              </div>
            </CardContent>
          </Card>
          {/* 5. Ingresos Totales */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-50 w-fit">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('total_revenue')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1 break-all">{formatCurrency(totalRevenue)}</p>
              </div>
            </CardContent>
          </Card>
          {/* 6. Pedido Promedio */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-sky-50 w-fit">
                <DollarSign className="h-5 w-5 text-sky-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('average_order')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1 break-all">{formatCurrency(averageOrder)}</p>
              </div>
            </CardContent>
          </Card>
          {/* 7. Días con actividad */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-orange-50 w-fit">
                <TrendingUp className="h-5 w-5 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('active_days')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{activeDaysCount}</p>
              </div>
            </CardContent>
          </Card>
          {/* 8. Mejor tienda */}
          {topStore && (
            <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 w-fit">
                  <StoreIcon className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('top_store')}</p>
                  <p className="text-sm font-bold text-slate-900 mt-1 break-words">{topStore.storeName}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="border border-slate-200/80 shadow-sm mb-6 bg-white rounded-xl">
          <CardHeader className="px-5 pb-3">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-teal-600" />
              {t('store_visits')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pt-0 pb-5">
            <div className="flex items-center gap-4 mb-5 p-4 bg-slate-50 rounded-xl">
              <div className="p-3 rounded-xl bg-teal-50">
                <StoreIcon className="h-6 w-6 text-teal-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('total_visits')}</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">{filteredVisitLogs.length}</p>
              </div>
            </div>
            {visitsByStore.length > 0 ? (
              <>
                <p className="text-sm font-medium text-slate-700 mb-3">{t('visits_by_store')}</p>
                <div className="space-y-2">
                  {visitsByStore.map((s) => (
                    <div
                      key={s.storeId}
                      className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-teal-50 rounded-lg">
                          <StoreIcon className="h-4 w-4 text-teal-600" />
                        </div>
                        <p className="text-sm font-medium text-slate-900">{s.storeName}</p>
                      </div>
                      <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 font-medium">
                        {s.visits} {t('visits')}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500 py-4">{t('no_data_available')}</p>
            )}
            {visitsByDay.length > 0 && (
              <>
                <p className="text-sm font-medium text-slate-700 mt-5 mb-3">{t('visits_by_day')}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={visitsByDay}
                    margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        fontSize: '12px',
                        boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
                      }}
                      labelStyle={{ fontWeight: 600, color: '#0f172a' }}
                    />
                    <Bar
                      dataKey="visits"
                      fill="#0d9488"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>

        {salesByDay.length > 0 && (
          <Card className="border border-slate-200/80 shadow-sm mb-6 bg-white rounded-xl">
            <CardHeader className="px-5 pb-3">
              <CardTitle className="text-base font-semibold text-slate-900">{t('sales_by_day')}</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pt-0 pb-5">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={salesByDay}
                  margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`}
                  />
                  <Tooltip
                    cursor={{ stroke: '#bfdbfe', strokeWidth: 2 }}
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px',
                      boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
                    }}
                    labelStyle={{ fontWeight: 600, color: '#0f172a' }}
                    formatter={(value: number) => [formatCurrency(value), t('revenue')]}
                  />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    stroke="#2563eb"
                    strokeWidth={2.3}
                    dot={{ r: 3, strokeWidth: 1, stroke: '#2563eb', fill: '#fff' }}
                    activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#1d4ed8', fill: '#eff6ff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card className="border border-slate-200/80 shadow-sm mb-6 bg-white overflow-visible rounded-xl">
          <CardHeader className="px-5 pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">{t('top_products')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pt-0 pb-5">
            {topProducts.length > 0 ? (
              <>
                <div className="space-y-3 mb-6 min-h-[120px]">
                  {topProducts.map((product, index) => (
                    <div
                      key={`${product.id}-${index}`}
                      className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-blue-100 text-blue-700 font-bold text-sm">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 break-words">{product.name}</p>
                          {product.sku && product.sku !== product.name && (
                            <p className="text-xs text-slate-500 mt-0.5">{product.sku}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-slate-900">
                          {product.quantity} {t('units')}
                        </p>
                        <p className="text-sm font-semibold text-emerald-600">{formatCurrency(product.revenue)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="h-64 min-h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topProducts.map((p) => ({ ...p, label: p.name.length > 25 ? p.name.slice(0, 24) + '…' : p.name }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => `${v}`} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="#64748b" width={140} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(value: number, _name: string, props: any) => [
                          `${value} ${t('units')} · ${formatCurrency(props.payload.revenue)}`,
                          props.payload.name,
                        ]}
                      />
                      <Bar dataKey="quantity" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500 py-8 text-center">{t('no_data_available')}</p>
            )}
          </CardContent>
        </Card>

        {salesByStore.length > 0 && (
          <Card className="border border-slate-200/80 shadow-sm mb-6 bg-white rounded-xl">
            <CardHeader className="px-5 pb-3">
              <CardTitle className="text-base font-semibold text-slate-900">{t('sales_by_store')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-5 pb-5">
              <div className="space-y-2">
                {salesByStore.map((store) => (
                  <div
                    key={store.storeId}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 rounded-lg">
                        <StoreIcon className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{store.storeName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {store.orders} {t('orders')}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-emerald-600">{formatCurrency(store.sales)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border border-slate-200/80 shadow-sm mb-6 bg-white rounded-xl">
          <CardHeader className="px-5 pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">{t('detailed_orders')}</CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 space-y-4">
            {sortedFilteredOrders.length === 0 ? (
              <div className="p-12 text-center rounded-xl border border-slate-100 bg-slate-50/50">
                <p className="text-slate-500 text-sm">{t('no_data_available')}</p>
              </div>
            ) : (
              sortedFilteredOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-5 rounded-xl border border-slate-200 bg-slate-50/30 hover:bg-slate-50/60 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-500 mb-0.5">{order.id}</p>
                      <p className="text-sm font-medium text-slate-900">
                        {getStoreName(order.storeId, order.storeName)}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(order.date).toLocaleDateString('es-ES', { dateStyle: 'medium' })}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge
                        variant="outline"
                        className={
                          isCompleted(order.status)
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 mb-2'
                            : 'bg-amber-50 text-amber-700 border-amber-200 mb-2'
                        }
                      >
                        {getStatusText(order.status)}
                      </Badge>
                      <p className="text-base font-bold text-slate-900">{formatCurrency(Number(order.total) || 0)}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-500 mb-2">{t('products')}</p>
                    <div className="space-y-1.5">
                      {(order.items || []).map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-slate-700">{getItemDisplayName(item)}</span>
                          <span className="text-slate-500 tabular-nums">
                            {item.toOrder ?? item.quantity} × {formatCurrency(item.price ?? 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
        </div>
      </main>
    </div>
  );
}
    