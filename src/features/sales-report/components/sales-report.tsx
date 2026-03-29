'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileText,
  TrendingUp,
  Package,
  DollarSign,
  Store as StoreIcon,
  MapPin,
  MapPinned,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { histpricesApi } from '@/shared/api/histprices-api';
import { productsApi } from '@/shared/api/products-api';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI, InvoiceReportRow } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { assignmentsApi } from '@/shared/api/assignments-api';
import { assignmentBelongsToSeller } from '@/shared/utils/assignment-match';
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
  const [invoiceRows, setInvoiceRows] = useState<InvoiceReportRow[]>([]);
  const [storeCache, setStoreCache] = useState<Record<string, string>>({});
  const [storeCityCache, setStoreCityCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromDate, setFromDate] = useState(startOfMonth.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));
  const [selectedStore, setSelectedStore] = useState('all');
  const [assignedStoresCount, setAssignedStoresCount] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);

  /** Tiendas distintas con pedido del vendedor en el mes calendario actual. */
  const storesVisitedThisMonthCount = useMemo(() => {
    const n = new Date();
    const y = n.getFullYear();
    const m = n.getMonth();
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastD = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    const set = new Set<string>();
    for (const o of orders) {
      const d = (o.date || '').toString().slice(0, 10);
      if (d >= start && d <= end && o.storeId) set.add(String(o.storeId));
    }
    return set.size;
  }, [orders]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.id) {
        setOrders([]);
        setInvoiceRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const apiOrders = await ordersApi.getOrdersByUser(user.id);

      if (!mounted) return;

      // Enriquecer pedidos con precios e información de producto cuando falten
      const productNameCache = new Map<string, { name: string; sku: string }>();
      const productFamilyCache = new Map<string, string>();
      const resolveProductName = async (productId: string, currentName: string, currentSku: string) => {
        if (!productId) return { name: currentName, sku: currentSku };
        if (currentName && !looksLikeId(currentName)) return { name: currentName, sku: currentSku };
        let cached = productNameCache.get(productId);
        if (cached) return cached;
        const product = await productsApi.getById(String(productId));
        if (product) {
          cached = { name: product.name || '', sku: product.code || product.sku || '' };
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
                if (!price) {
                  const inlineFamilyId = String(
                    item?.familyId ?? item?.FamilyId ?? item?.categoryId ?? item?.CategoryId ?? ''
                  ).trim();
                  let familyId = inlineFamilyId;
                  const productId = String(item?.productId ?? item?.ProductId ?? '').trim();
                  if (!familyId && productId) {
                    familyId = productFamilyCache.get(productId) || '';
                    if (!familyId) {
                      const product = await productsApi.getById(productId);
                      familyId = String(product?.familyId ?? product?.categoryId ?? '').trim();
                      if (familyId) productFamilyCache.set(productId, familyId);
                    }
                  }
                  if (familyId) price = await histpricesApi.getLatest(familyId);
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

      const invReport = await ordersApi.buildInvoiceReportRows(enriched);
      if (!mounted) return;
      setOrders(enriched);
      setInvoiceRows(invReport);
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
      ]),
    ].filter((id) => id && looksLikeId(orders.find((o) => o.storeId === id)?.storeName || id));
    if (storeIds.length === 0) return;
    let mounted = true;
    (async () => {
      const next: Record<string, string> = {};
      const cityNext: Record<string, string> = {};
      for (const id of storeIds) {
        if (!mounted) break;
        const store = await storesApi.fetchStoreById(id);
        if (store?.name) next[id] = store.name;
        if (store?.city) {
          const cityRaw = store.city.trim();
          cityNext[id] = cityRaw && citiesApi.looksLikeCityId(cityRaw)
            ? (await citiesApi.getCityNameById(cityRaw)) || cityRaw
            : cityRaw;
        }
      }
      if (mounted) {
        setStoreCache((prev) => ({ ...prev, ...next }));
        setStoreCityCache((prev) => ({ ...prev, ...cityNext }));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [orders]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u = user;
      if (!u || (!String(u.id).trim() && !String(u.salesRouteId ?? '').trim())) {
        if (mounted) setAssignedStoresCount(0);
        return;
      }
      const all = await assignmentsApi.fetchAll();
      if (!mounted) return;
      const ids = new Set(all.filter((a) => assignmentBelongsToSeller(a, u)).map((a) => String(a.storeId)));
      setAssignedStoresCount(ids.size);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id, user?.salesRouteId]);

  const getStoreName = (storeId: string, fallback?: string) =>
    storeCache[storeId] || (orders.find((o) => o.storeId === storeId)?.storeName) || fallback || storeId;
  const getStoreCity = (storeId: string) => storeCityCache[storeId] || '';

  /** Reporte por factura: filtros solo fecha + tienda (sin estados de pedido). */
  const filteredInvoices = invoiceRows.filter((inv) => {
    const matchesStore = selectedStore === 'all' || inv.storeId === selectedStore;
    const invDay = (inv.invoiceDate || '').toString().slice(0, 10);
    let matchesDate = true;
    if (fromDate) matchesDate = invDay >= fromDate;
    if (matchesDate && toDate) matchesDate = invDay <= toDate;
    return matchesStore && matchesDate;
  });

  const sortedFilteredInvoices = [...filteredInvoices].sort(
    (a, b) =>
      new Date(b.invoiceDate || b.orderDate).getTime() -
      new Date(a.invoiceDate || a.orderDate).getTime()
  );

  const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
  const totalProductsSold = filteredInvoices.reduce((sum, inv) => {
    return (
      sum +
      (inv.items || []).reduce((itemSum, line) => itemSum + (Number(line.qty) || 0), 0)
    );
  }, 0);
  const averageInvoice =
    filteredInvoices.length > 0 ? totalRevenue / filteredInvoices.length : 0;
  const activeDaysCount = new Set(
    filteredInvoices.map((inv) => (inv.invoiceDate || '').split('T')[0]).filter(Boolean)
  ).size;

  const salesByDayRaw = filteredInvoices.reduce(
    (acc: { date: string; dateSort: string; sales: number; count: number }[], inv) => {
      const dateSort = (inv.invoiceDate || inv.orderDate || '').toString();
      const date = dateSort
        ? new Date(inv.invoiceDate || inv.orderDate).toLocaleDateString('es-ES', {
            month: 'short',
            day: 'numeric',
          })
        : '—';
      const existing = acc.find((item) => item.date === date);
      const amt = Number(inv.total) || 0;
      if (existing) {
        existing.sales += amt;
        existing.count += 1;
      } else {
        acc.push({ date, dateSort, sales: amt, count: 1 });
      }
      return acc;
    },
    []
  );
  const salesByDay = salesByDayRaw
    .sort((a, b) => (a.dateSort || '').localeCompare(b.dateSort || ''))
    .map(({ date, sales, count }) => ({ date, sales, orders: count }));

  const topProducts = (() => {
    const map = new Map<string, { id: string; name: string; sku: string; quantity: number; revenue: number }>();
    filteredInvoices.forEach((inv) => {
      (inv.items || []).forEach((line) => {
        const qty = Number(line.qty) || 0;
        if (qty <= 0) return;
        const price = Number(line.price) || 0;
        const sku = String(line.code || '').trim();
        const pname = String(line.description || '').trim();
        const key = sku || pname || `line-${inv.invoiceId}-${map.size}`;
        const name = productDisplayName(pname, sku, key);
        const existing =
          map.get(key) ?? (sku ? [...map.values()].find((p) => p.sku === sku) : undefined);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += qty * price;
        } else {
          map.set(key, {
            id: key,
            name,
            sku: sku || name.slice(0, 20),
            quantity: qty,
            revenue: qty * price,
          });
        }
      });
    });
    return [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  })();

  const salesByStore = filteredInvoices
    .reduce((acc: { storeId: string; storeName: string; sales: number; invoices: number }[], inv) => {
      const name = getStoreName(inv.storeId, undefined);
      const amt = Number(inv.total) || 0;
      const existing = acc.find((s) => s.storeId === inv.storeId);
      if (existing) {
        existing.sales += amt;
        existing.invoices += 1;
      } else {
        acc.push({
          storeId: inv.storeId,
          storeName: name,
          sales: amt,
          invoices: 1,
        });
      }
      return acc;
    }, [])
    .sort((a, b) => b.sales - a.sales);
  const topStore = salesByStore[0];

  const uniqueStores = Array.from(
    new Set([
      ...orders.map((o) => o.storeId),
      ...invoiceRows.map((r) => r.storeId),
    ])
  )
    .filter(Boolean)
    .map((storeId) => ({
      id: storeId as string,
      name: getStoreName(
        storeId as string,
        orders.find((o) => o.storeId === storeId)?.storeName
      ),
    }));

  const handleClearFilters = () => {
    const n = new Date();
    const som = new Date(n.getFullYear(), n.getMonth(), 1);
    setFromDate(som.toISOString().slice(0, 10));
    setToDate(n.toISOString().slice(0, 10));
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
    const headers = [
      'PO',
      t('sales_invoice_date_col') || 'Fecha factura',
      t('invoice_id_short') || 'Factura',
      t('store') || 'Tienda',
      t('city') || 'Ciudad',
      t('invoice_sku') || 'SKU',
      t('invoice_description') || 'Producto',
      t('invoice_qty') || 'Cantidad',
      t('invoice_unit_price') || 'Precio unitario',
      t('invoice_amount') || 'Total línea',
    ];
    const rows: string[][] = [];
    sortedFilteredInvoices.forEach((inv) => {
      const ord = orders.find((o) => o.id === inv.orderId);
      const invoiceDate = new Date(inv.invoiceDate || inv.orderDate).toLocaleDateString('es-MX', {
        dateStyle: 'short',
      });
      const po = inv.po ? `${inv.po}` : '—';
      const invoiceNo = inv.invoiceId || '—';
      const store = getStoreName(inv.storeId, ord?.storeName);
      const city = getStoreCity(inv.storeId) || '—';
      const lines = inv.items || [];
      if (lines.length === 0) {
        rows.push([po, invoiceDate, invoiceNo, store, city, '—', '—', '0', '0.00', '0.00']);
        return;
      }
      lines.forEach((line) => {
        const qty = Number(line.qty) || 0;
        const unit = Number(line.price) || 0;
        const amount = Number(line.amount) || qty * unit;
        rows.push([
          po,
          invoiceDate,
          invoiceNo,
          store,
          city,
          String(line.code || '').trim() || '—',
          String(line.description || '').trim() || '—',
          String(qty),
          unit.toFixed(2),
          amount.toFixed(2),
        ]);
      });
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
              onClick={handleExportReport}
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4 mr-2" />
              {t('export_csv') || 'CSV'}
            </Button>
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
              <tr><td className="font-semibold pr-4">{t('total_invoices') || 'Facturas'}</td><td>{filteredInvoices.length}</td></tr>
              <tr><td className="font-semibold pr-4">{t('products_sold')}</td><td>{totalProductsSold}</td></tr>
              <tr><td className="font-semibold pr-4">{t('total_revenue')}</td><td>{formatCurrency(totalRevenue)}</td></tr>
              <tr><td className="font-semibold pr-4">{t('average_invoice') || 'Promedio / factura'}</td><td>{formatCurrency(averageInvoice)}</td></tr>
              <tr><td className="font-semibold pr-4">{t('active_days')}</td><td>{activeDaysCount}</td></tr>
              <tr><td className="font-semibold pr-4">{t('metric_assigned_stores')}</td><td>{assignedStoresCount}</td></tr>
              <tr><td className="font-semibold pr-4">{t('stores_visited_this_month')}</td><td>{storesVisitedThisMonthCount}</td></tr>
            </tbody>
          </table>
          <h2 className="text-base font-bold text-slate-900 mt-4 mb-2">{t('detailed_invoices') || 'Facturas detalladas'}</h2>
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>{t('sales_invoice_date_col')}</th>
                <th>Tienda</th>
                <th>Ciudad</th>
                <th>Total</th>
                <th>Productos</th>
              </tr>
            </thead>
            <tbody>
              {sortedFilteredInvoices.map((inv) => {
                const ord = orders.find((o) => o.id === inv.orderId);
                return (
                  <tr key={inv.invoiceId}>
                    <td>{inv.po ? `${inv.po}` : '—'}</td>
                    <td>{new Date(inv.invoiceDate || inv.orderDate).toLocaleDateString('es-MX', { dateStyle: 'short' })}</td>
                    <td>{getStoreName(inv.storeId, ord?.storeName)}</td>
                    <td>{getStoreCity(inv.storeId) || '—'}</td>
                    <td>{formatCurrency(Number(inv.total) || 0)}</td>
                    <td>{(inv.items || []).map((line) => `${line.description || line.code} (${line.qty})`).join('; ') || '—'}</td>
                  </tr>
                );
              })}
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
            <div className="grid grid-cols-1 gap-3 sm:gap-4 mb-4 max-w-full min-w-0">
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
          {/* 1. Facturas (ventas facturadas) */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 w-fit">
                <Package className="h-5 w-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('total_invoices') || 'Facturas'}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{filteredInvoices.length}</p>
              </div>
            </CardContent>
          </Card>
          {/* 2. Unidades facturadas */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-50 w-fit">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('products_sold')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{totalProductsSold}</p>
              </div>
            </CardContent>
          </Card>
          {/* 3. (reservado / coherencia visual) */}
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-violet-50 w-fit">
                <TrendingUp className="h-5 w-5 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('average_invoice') || 'Promedio / factura'}</p>
                <p className="text-lg font-bold text-slate-900 mt-1 break-all">{formatCurrency(averageInvoice)}</p>
              </div>
            </CardContent>
          </Card>
          {/* 4. Ingresos Totales */}
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
          {/* 5. Días con actividad */}
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
          {/* 6. Mejor tienda */}
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
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-50 w-fit">
                <MapPinned className="h-5 w-5 text-cyan-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('metric_assigned_stores')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{assignedStoresCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border border-slate-200/80 shadow-sm bg-white overflow-visible rounded-xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2.5 rounded-xl bg-teal-50 w-fit">
                <MapPin className="h-5 w-5 text-teal-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider break-words">{t('stores_visited_this_month')}</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{storesVisitedThisMonthCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

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
                        <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 font-bold text-sm">
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
                      <div className="p-2 bg-indigo-50 rounded-lg">
                        <StoreIcon className="h-4 w-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{store.storeName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {store.invoices} {t('total_invoices') || 'facturas'}
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
            <CardTitle className="text-base font-semibold text-slate-900">{t('detailed_invoices') || 'Facturas detalladas'}</CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 space-y-4">
            {sortedFilteredInvoices.length === 0 ? (
              <div className="p-12 text-center rounded-xl border border-slate-100 bg-slate-50/50">
                <p className="text-slate-500 text-sm">{t('no_data_available')}</p>
              </div>
            ) : (
              sortedFilteredInvoices.map((inv) => {
                const ord = orders.find((o) => o.id === inv.orderId);
                return (
                  <div
                    key={inv.invoiceId}
                    className="p-5 rounded-xl border border-slate-200 bg-slate-50/30 hover:bg-slate-50/60 transition-colors shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-slate-900 mb-1">
                          {inv.po ? `${inv.po}` : ord?.id ?? inv.orderId}
                        </p>
                        <p className="text-sm text-slate-700">
                          {getStoreName(inv.storeId, ord?.storeName)}
                          {getStoreCity(inv.storeId) ? ` · ${getStoreCity(inv.storeId)}` : ''}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {new Date(inv.invoiceDate || inv.orderDate).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 mb-2">
                          {t('invoiced') || 'Facturado'}
                        </Badge>
                        <p className="text-base font-bold text-slate-900">{formatCurrency(Number(inv.total) || 0)}</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <p className="text-xs font-medium text-slate-500 mb-2">{t('products')}</p>
                      <div className="space-y-1.5">
                        {(inv.items || []).map((line, idx) => (
                          <div key={idx} className="flex justify-between text-xs">
                            <span className="text-slate-700">{line.description || line.code}</span>
                            <span className="text-slate-500 tabular-nums">
                              {line.qty} × {formatCurrency(line.price ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
        </div>
      </main>
    </div>
  );
}
    