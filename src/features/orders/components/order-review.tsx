'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Edit, ShoppingCart, DollarSign, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';
import { Badge } from '@/shared/ui/badge';

export function OrderReview() {
  const { t } = useLanguage();
  const router = useRouter();
  const [storeId, setStoreId] = useState('CVS-001');
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [planogramData, setPlanogramData] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Obtener datos del sessionStorage
      const storedData = sessionStorage.getItem('orderReviewData');
      if (storedData) {
        const data = JSON.parse(storedData);
        setStoreId(data.storeId || 'CVS-001');
        setStoreInfo(data.storeInfo);
        setPlanogramData(data.planogramData || []);
      }
    }
  }, []);

  // Filtrar solo los productos con cantidad mayor a 0 para mostrar
  const orderItems = planogramData.filter((item: any) => item.toOrder > 0);

  const totalUnits = orderItems.reduce((sum: number, item: any) => sum + item.toOrder, 0);
  const totalAmount = orderItems.reduce((sum: number, item: any) => sum + (item.toOrder * item.price), 0);
  const uniqueProducts = orderItems.length;

  const handleSendOrder = () => {
    if (typeof window === 'undefined') return;
    
    // Generar ID único para el pedido
    const orderId = `ORD-${Date.now()}`;
    const orderDate = new Date().toISOString();
    
    // Crear objeto de pedido completo con información de la tienda
    const newOrder = {
      id: orderId,
      storeId,
      storeName: storeInfo?.name || storeId,
      storeAddress: storeInfo ? `${storeInfo.address}, ${storeInfo.city}` : '',
      date: orderDate,
      deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 días después
      status: 'pending',
      items: orderItems,
      totalUnits,
      subtotal: totalAmount,
      tax: totalAmount * 0.085,
      total: totalAmount * 1.085,
      podRequired: true,
      podUploaded: false,
      vendorNumber: '2F318',
    };

    // Guardar en localStorage
    const existingOrders = JSON.parse(localStorage.getItem('orders') || '[]');
    existingOrders.push(newOrder);
    localStorage.setItem('orders', JSON.stringify(existingOrders));

    // Guardar en sessionStorage para mostrar confirmación
    sessionStorage.setItem('orderConfirmation', JSON.stringify({ orderId, showConfirmation: true }));

    // Navegar al detalle del pedido
    router.push(`/order/${orderId}`);
  };

  const handleEditOrder = () => {
    if (typeof window !== 'undefined') {
      // Guardar datos en sessionStorage para el planograma
      sessionStorage.setItem('planogramData', JSON.stringify({
        planogramData: planogramData,
        storeInfo: storeInfo
      }));
    }
    router.push(`/planogram/${storeId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-slate-900">{t('order_review')}</h2>
            <p className="text-xs text-slate-500">{storeId}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card className="border-slate-200">
            <CardContent className="p-3 text-center">
              <Package className="h-5 w-5 text-blue-600 mx-auto mb-1" />
              <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
              <p className="text-lg text-slate-900">{uniqueProducts}</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-3 text-center">
              <ShoppingCart className="h-5 w-5 text-green-600 mx-auto mb-1" />
              <p className="text-xs text-slate-500 mb-0.5">{t('units')}</p>
              <p className="text-lg text-slate-900">{totalUnits}</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="p-3 text-center">
              <DollarSign className="h-5 w-5 text-purple-600 mx-auto mb-1" />
              <p className="text-xs text-slate-500 mb-0.5">{t('total')}</p>
              <p className="text-lg text-slate-900">${totalAmount.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Order Items */}
        <Card className="border-slate-200 mb-4">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-slate-900 text-sm">{t('order_items')}</h3>
          </div>
          
          <div className="divide-y divide-slate-100">
            {orderItems.map((item: any, index: number) => (
              <div key={index} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm text-slate-900 mb-1">{item.productName}</p>
                    <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {item.toOrder} {t('units')}
                      </Badge>
                      <span className="text-slate-500">× ${item.price}</span>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-slate-900">${(item.toOrder * item.price).toFixed(2)}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {t('position')}: {item.row},{item.col}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Total Card */}
        <Card className="border-green-200 bg-green-50 mb-20">
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{t('subtotal')}</span>
                <span className="text-slate-900">${totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{t('tax')} (8.5%)</span>
                <span className="text-slate-900">${(totalAmount * 0.085).toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-slate-900">{t('total')}</span>
                <span className="text-xl text-green-900">${(totalAmount * 1.085).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="flex gap-3 max-w-2xl mx-auto">
          <Button
            variant="outline"
            onClick={handleEditOrder}
            className="flex-1"
          >
            <Edit className="h-4 w-4 mr-2" />
            {t('edit_order')}
          </Button>
          <Button
            onClick={handleSendOrder}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            <Send className="h-4 w-4 mr-2" />
            {t('send_order')}
          </Button>
        </div>
      </div>
    </div>
  );
}
