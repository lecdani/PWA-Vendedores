'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, ChevronRight, Calendar, Store as StoreIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
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

interface Order {
  id: string;
  storeId: string;
  storeName: string;
  orderDate: string;
  totalAmount: number;
  totalUnits: number;
  status: 'completed' | 'pending';
  hasPOD: boolean;
}

export function OrderHistory() {
  const { t } = useLanguage();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orders, setOrders] = useState<Order[]>([]);

  // Obtener pedidos del localStorage y combinar con mock data
  useEffect(() => {
    const getOrders = (): Order[] => {
      if (typeof window === 'undefined') return [];
      
      const savedOrders = JSON.parse(localStorage.getItem('orders') || '[]');
      
      // Convertir los pedidos guardados al formato de Order
      const formattedSavedOrders = savedOrders.map((order: any) => ({
        id: order.id,
        storeId: order.storeId,
        storeName: order.storeName || order.storeId,
        orderDate: order.date,
        totalAmount: order.total,
        totalUnits: order.totalUnits || order.items.reduce((sum: number, item: any) => sum + (item.toOrder || item.quantity || 0), 0),
        status: order.status as 'completed' | 'pending',
        hasPOD: order.podUploaded || false
      }));

      // Mock data
      const mockOrders: Order[] = [
        {
          id: 'ORD-2025-003',
          storeId: 'CVS-002',
          storeName: 'CVS Pharmacy - Downtown',
          orderDate: '2025-11-23',
          totalAmount: 1245.00,
          totalUnits: 98,
          status: 'pending',
          hasPOD: false
        },
        {
          id: 'ORD-2025-002',
          storeId: 'CVS-003',
          storeName: 'CVS Pharmacy - Coral Gables',
          orderDate: '2025-11-22',
          totalAmount: 890.00,
          totalUnits: 72,
          status: 'completed',
          hasPOD: true
        },
        {
          id: 'ORD-2025-001',
          storeId: 'CVS-001',
          storeName: 'CVS Pharmacy - Brickell',
          orderDate: '2025-11-20',
          totalAmount: 1520.50,
          totalUnits: 120,
          status: 'completed',
          hasPOD: true
        },
      ];

      // Combinar y ordenar por fecha (más recientes primero)
      return [...formattedSavedOrders, ...mockOrders].sort((a, b) => 
        new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
      );
    };

    setOrders(getOrders());
  }, []);

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.storeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.storeId.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-50 text-green-700 border-green-200';
      case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return t('completed');
      case 'pending': return t('pending');
      default: return status;
    }
  };

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-slate-900 text-lg mb-1">{t('order_history')}</h2>
        <p className="text-sm text-slate-500">{t('order_history_subtitle')}</p>
      </div>

      {/* Search and Filter */}
      <div className="space-y-3 mb-4">
        <div className="relative">
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
          <SelectTrigger className="h-10 bg-white border-slate-200">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <SelectValue placeholder={t('filter_by_status')} />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all_orders')}</SelectItem>
            <SelectItem value="completed">{t('completed')}</SelectItem>
            <SelectItem value="pending">{t('pending')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results Count */}
      <p className="text-xs text-slate-500 mb-3">
        {filteredOrders.length} {t('orders_found')}
      </p>

      {/* Orders List */}
      {filteredOrders.length > 0 ? (
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <Card
              key={order.id}
              className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer active:scale-98"
              onClick={() => router.push(`/order/${order.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm text-slate-900 mb-0.5">{order.id}</p>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={getStatusColor(order.status)}>
                        {getStatusText(order.status)}
                      </Badge>
                      {order.hasPOD && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          POD ✓
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-900">${order.totalAmount.toFixed(2)}</p>
                    <p className="text-xs text-slate-500">{order.totalUnits} {t('units')}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs text-slate-500 mb-2">
                  <StoreIcon className="h-3 w-3" />
                  <span>{order.storeName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Calendar className="h-3 w-3" />
                    <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </div>
              </CardContent>
            </Card>
          ))}
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
