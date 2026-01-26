'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, TrendingUp, Package, DollarSign, Store as StoreIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
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
  ResponsiveContainer 
} from 'recharts';

interface Order {
  id: string;
  storeId: string;
  storeName: string;
  date: string;
  total: number;
  status: string;
  items: any[];
}

export function SalesReport() {
  const { t } = useLanguage();
  const router = useRouter();
  
  // Filtros
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedStore, setSelectedStore] = useState('all');
  
  // Datos de ejemplo - En producción vendrían de localStorage o API
  const [orders] = useState<Order[]>([
    {
      id: 'ORD-2026-001',
      storeId: 'ST001',
      storeName: 'Beauty Shop Miami',
      date: '2026-01-10',
      total: 450.50,
      status: 'completed',
      items: [
        { productName: 'Lip Gloss Nude', sku: 'ECL-001', quantity: 10, price: 15.50 },
        { productName: 'Eye Shadow Palette', sku: 'ECL-020', quantity: 5, price: 45.00 },
      ]
    },
    {
      id: 'ORD-2026-002',
      storeId: 'ST002',
      storeName: 'Glamour Store Orlando',
      date: '2026-01-12',
      total: 680.00,
      status: 'completed',
      items: [
        { productName: 'Foundation Natural', sku: 'ECL-010', quantity: 8, price: 35.00 },
        { productName: 'Mascara Black', sku: 'ECL-015', quantity: 12, price: 25.00 },
      ]
    },
    {
      id: 'ORD-2026-003',
      storeId: 'ST001',
      storeName: 'Beauty Shop Miami',
      date: '2026-01-13',
      total: 320.75,
      status: 'pending',
      items: [
        { productName: 'Blush Pink', sku: 'ECL-025', quantity: 15, price: 18.50 },
      ]
    },
    {
      id: 'ORD-2026-004',
      storeId: 'ST003',
      storeName: 'Cosmetics Plus Tampa',
      date: '2026-01-14',
      total: 890.25,
      status: 'completed',
      items: [
        { productName: 'Lip Gloss Nude', sku: 'ECL-001', quantity: 20, price: 15.50 },
        { productName: 'Foundation Natural', sku: 'ECL-010', quantity: 10, price: 35.00 },
        { productName: 'Eye Shadow Palette', sku: 'ECL-020', quantity: 8, price: 45.00 },
      ]
    },
    {
      id: 'ORD-2026-005',
      storeId: 'ST002',
      storeName: 'Glamour Store Orlando',
      date: '2026-01-15',
      total: 525.00,
      status: 'completed',
      items: [
        { productName: 'Mascara Black', sku: 'ECL-015', quantity: 21, price: 25.00 },
      ]
    },
  ]);

  // Filtrar órdenes
  const filteredOrders = orders.filter(order => {
    const matchesStatus = selectedStatus === 'all' || order.status === selectedStatus;
    const matchesStore = selectedStore === 'all' || order.storeId === selectedStore;
    
    let matchesDate = true;
    if (fromDate && toDate) {
      const orderDate = new Date(order.date);
      matchesDate = orderDate >= new Date(fromDate) && orderDate <= new Date(toDate);
    }
    
    return matchesStatus && matchesStore && matchesDate;
  });

  // Calcular estadísticas
  const completedOrders = filteredOrders.filter(o => o.status === 'completed');
  const totalRevenue = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const totalProductsSold = completedOrders.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0);
  }, 0);
  const averageOrder = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  // Datos para gráficos
  const salesByDay = filteredOrders.reduce((acc: any[], order) => {
    const date = new Date(order.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    const existing = acc.find(item => item.date === date);
    
    if (existing) {
      existing.sales += order.total;
      existing.orders += 1;
    } else {
      acc.push({ date, sales: order.total, orders: 1 });
    }
    
    return acc;
  }, []);

  // Top productos
  const topProducts = filteredOrders.reduce((acc: any[], order) => {
    order.items.forEach(item => {
      const existing = acc.find(p => p.sku === item.sku);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.quantity * item.price;
      } else {
        acc.push({
          name: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          revenue: item.quantity * item.price
        });
      }
    });
    return acc;
  }, []).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  // Ventas por tienda
  const salesByStore = filteredOrders.reduce((acc: any[], order) => {
    const existing = acc.find(s => s.storeId === order.storeId);
    
    if (existing) {
      existing.sales += order.total;
      existing.orders += 1;
    } else {
      acc.push({
        storeId: order.storeId,
        storeName: order.storeName,
        sales: order.total,
        orders: 1
      });
    }
    
    return acc;
  }, []).sort((a, b) => b.sales - a.sales);

  // Obtener lista única de tiendas
  const uniqueStores = Array.from(new Set(orders.map(o => o.storeId))).map(storeId => {
    const order = orders.find(o => o.storeId === storeId);
    return { id: storeId, name: order?.storeName || storeId };
  });

  const handleClearFilters = () => {
    setFromDate('');
    setToDate('');
    setSelectedStatus('all');
    setSelectedStore('all');
  };

  const handleExportReport = () => {
    // Generar CSV simple
    const headers = ['ID', 'Fecha', 'Tienda', 'Estado', 'Total'];
    const rows = filteredOrders.map(order => [
      order.id,
      new Date(order.date).toLocaleDateString(),
      order.storeName,
      order.status,
      `$${order.total.toFixed(2)}`
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/')}
            className="p-2 h-auto -ml-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-sm text-slate-900 font-medium">{t('sales_report')}</h2>
            <p className="text-xs text-slate-500">{t('sales_report_subtitle')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportReport}
            disabled={filteredOrders.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            {t('export_report')}
          </Button>
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* Filtros */}
        <Card className="border-slate-200 shadow-sm mb-4 mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('date_range')}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-slate-600 mb-1 block">{t('from_date')}</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">{t('to_date')}</label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-slate-600 mb-1 block">{t('status')}</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="all">{t('all_status')}</option>
                  <option value="completed">{t('completed')}</option>
                  <option value="pending">{t('pending')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">{t('store')}</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="all">{t('all_stores')}</option>
                  {uniqueStores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="w-full"
            >
              {t('clear_filters')}
            </Button>
          </CardContent>
        </Card>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-green-700 mb-1">{t('total_revenue')}</p>
                  <p className="text-lg text-green-900 font-semibold">${totalRevenue.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-blue-700 mb-1">{t('completed_orders')}</p>
                  <p className="text-lg text-blue-900 font-semibold">{completedOrders.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-purple-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Package className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-purple-700 mb-1">{t('products_sold')}</p>
                  <p className="text-lg text-purple-900 font-semibold">{totalProductsSold}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-orange-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-orange-700 mb-1">{t('average_order')}</p>
                  <p className="text-lg text-orange-900 font-semibold">${averageOrder.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gráfico de Ventas por Día */}
        {salesByDay.length > 0 && (
          <Card className="border-slate-200 shadow-sm mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('sales_by_day')}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={salesByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }} 
                    stroke="#64748b"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }} 
                    stroke="#64748b"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="sales" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Top Productos */}
        {topProducts.length > 0 && (
          <Card className="border-slate-200 shadow-sm mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('top_products')}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topProducts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="sku" 
                    tick={{ fontSize: 11 }} 
                    stroke="#64748b"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }} 
                    stroke="#64748b"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px'
                    }}
                  />
                  <Bar dataKey="quantity" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-4 space-y-2">
                {topProducts.map((product, index) => (
                  <div key={product.sku} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        #{index + 1}
                      </Badge>
                      <div>
                        <p className="text-xs text-slate-900">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.sku}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-900 font-semibold">{product.quantity} {t('units')}</p>
                      <p className="text-xs text-green-600">${product.revenue.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ventas por Tienda */}
        {salesByStore.length > 0 && (
          <Card className="border-slate-200 shadow-sm mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('sales_by_store')}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {salesByStore.map((store) => (
                  <div key={store.storeId} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 rounded-lg">
                        <StoreIcon className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-900">{store.storeName}</p>
                        <p className="text-xs text-slate-500">{store.orders} {t('orders')}</p>
                      </div>
                    </div>
                    <p className="text-sm text-green-600 font-semibold">${store.sales.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabla de Pedidos Detallados */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('detailed_orders')}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-slate-500 text-sm">{t('no_data_available')}</p>
              </div>
            ) : (
              filteredOrders.map((order) => (
                <div key={order.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 font-medium mb-1">{order.id}</p>
                      <p className="text-xs text-slate-600 mb-1">{order.storeName}</p>
                      <p className="text-xs text-slate-500">{new Date(order.date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <Badge 
                        variant="outline" 
                        className={order.status === 'completed' 
                          ? 'bg-green-50 text-green-700 border-green-200 mb-1' 
                          : 'bg-amber-50 text-amber-700 border-amber-200 mb-1'
                        }
                      >
                        {order.status === 'completed' ? t('completed') : t('pending')}
                      </Badge>
                      <p className="text-sm text-green-600 font-semibold">${order.total.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-1">{t('products')}:</p>
                    <div className="space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-slate-600">{item.productName}</span>
                          <span className="text-slate-500">{item.quantity} × ${item.price}</span>
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
    </div>
  );
}
