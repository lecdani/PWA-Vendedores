'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { FileCheck, Camera, AlertCircle, Calendar } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Card, CardContent } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

interface PendingOrder {
  id: string;
  storeId: string;
  storeName: string;
  orderDate: string;
  deliveryDate: string;
  totalAmount: number;
  status: 'pending';
  totalUnits: number;
}

export function PendingPOD() {
  const { t } = useLanguage();
  const router = useRouter();
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);

  // Obtener pedidos del localStorage que requieren POD
  const getPendingOrders = (): PendingOrder[] => {
    if (typeof window === 'undefined') return [];
    
    const orders = JSON.parse(localStorage.getItem('orders') || '[]');
    
    // Filtrar solo los pedidos que requieren POD y no lo tienen
    const filtered = orders
      .filter((order: any) => {
        return order.podRequired === true && 
               order.podUploaded !== true && 
               order.status === 'pending';
      })
      .map((order: any) => ({
        id: order.id,
        storeId: order.storeId,
        storeName: order.storeName || order.storeId,
        orderDate: order.date,
        deliveryDate: order.deliveryDate || order.date,
        totalAmount: order.total,
        totalUnits: order.totalUnits || order.items?.reduce((sum: number, item: any) => sum + (item.toOrder || item.quantity || 0), 0) || 0,
        status: order.status
      }));

    return filtered;
  };

  // Cargar pedidos cuando el componente se monta o cuando se enfoca la ventana
  useEffect(() => {
    const loadOrders = () => {
      setPendingOrders(getPendingOrders());
    };

    loadOrders();

    // Actualizar cuando la ventana recibe foco (usuario vuelve a la app)
    window.addEventListener('focus', loadOrders);
    
    // Actualizar cada 2 segundos para asegurar que se vean los cambios
    const interval = setInterval(loadOrders, 2000);

    return () => {
      window.removeEventListener('focus', loadOrders);
      clearInterval(interval);
    };
  }, []);

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

      {/* Pending Orders List */}
      {pendingOrders.length > 0 ? (
        <div className="space-y-3">
          {pendingOrders.map((order) => (
            <Card
              key={order.id}
              className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm text-slate-900 mb-0.5">{order.id}</p>
                    <p className="text-xs text-slate-600 mb-2">{order.storeName}</p>
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                      {t('waiting_pod')}
                    </Badge>
                  </div>
                  <p className="text-slate-900">${order.totalAmount.toFixed(2)}</p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>{t('delivered')}: {new Date(order.deliveryDate).toLocaleDateString()}</span>
                  </div>
                </div>

                <Button
                  onClick={() => router.push(`/capture-pod/${order.id}`)}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  size="sm"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {t('capture_pod')}
                </Button>
              </CardContent>
            </Card>
          ))}
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
