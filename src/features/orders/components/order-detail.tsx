'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Store as StoreIcon, 
  Calendar, 
  Package, 
  DollarSign,
  Download,
  Grid3x3,
  Printer,
  CheckCircle2,
  Camera
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Separator } from '@/shared/ui/separator';
import { Invoice } from './invoice';

export function OrderDetail({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Verificar si hay confirmación en sessionStorage
      const confirmation = sessionStorage.getItem('orderConfirmation');
      if (confirmation) {
        const data = JSON.parse(confirmation);
        if (data.orderId === orderId && data.showConfirmation) {
          setShowConfirmation(true);
          sessionStorage.removeItem('orderConfirmation');
          setTimeout(() => {
            setShowConfirmation(false);
          }, 3000);
        }
      }

      // Obtener el pedido desde localStorage
      const orders = JSON.parse(localStorage.getItem('orders') || '[]');
      const foundOrder = orders.find((o: any) => o.id === orderId);
      
      if (foundOrder) {
        setOrder(foundOrder);
      } else {
        // Fallback a mock data si no se encuentra
        setOrder({
          id: orderId,
          storeId: 'CVS-001',
          storeName: 'CVS Pharmacy - Brickell',
          storeAddress: '1234 Brickell Ave, Miami, FL 33131',
          date: new Date().toISOString(),
          deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'pending',
          vendorNumber: '2F318',
          podRequired: true,
          podUploaded: false,
          items: [],
          subtotal: 0,
          tax: 0,
          total: 0,
          comments: ''
        });
      }
    }
  }, [orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">Cargando...</p>
      </div>
    );
  }

  const totalUnits = order.items.reduce((sum: number, item: any) => sum + (item.toOrder || item.quantity || 0), 0);

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

  const handleDownloadInvoice = () => {
    window.print();
  };

  const handlePrintInvoice = () => {
    window.print();
  };

  // Preparar items para la factura
  const invoiceItems = order.items.map((item: any) => ({
    qty: item.toOrder || item.quantity || 0,
    code: item.sku,
    description: item.productName,
    price: item.price,
    amount: (item.toOrder || item.quantity || 0) * item.price
  }));

  const handleCapturePOD = () => {
    router.push(`/capture-pod/${orderId}`);
  };

  const handleViewPlanogram = () => {
    router.push(`/view-planogram/${orderId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Success Confirmation Banner */}
      {showConfirmation && (
        <div className="fixed top-16 left-0 right-0 z-50 bg-green-600 text-white px-4 py-3 shadow-lg animate-in slide-in-from-top">
          <div className="flex items-center gap-3 max-w-2xl mx-auto">
            <CheckCircle2 className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm">
                {order.status === 'completed' ? t('delivery_completed_success') : t('order_sent_success')}
              </p>
              <p className="text-xs opacity-90">{order.id}</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white px-4 py-2 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/history')}
              className="p-2 h-auto -ml-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm text-slate-900 font-medium">{t('order_detail')}</h2>
              <p className="text-xs text-slate-500 truncate">{order.id}</p>
            </div>
          </div>
          <Badge variant="outline" className={`${getStatusColor(order.status)} flex-shrink-0`}>
            {getStatusText(order.status)}
          </Badge>
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* Store Info */}
        <Card className="border-slate-200 shadow-sm mb-4">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <StoreIcon className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-slate-900 mb-1">{order.storeName || order.storeId}</p>
                <p className="text-xs text-slate-500 mb-2">{order.storeId}</p>
                {order.storeAddress && (
                  <p className="text-xs text-slate-600">{order.storeAddress}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card className="border-slate-200 shadow-sm mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('order_summary')}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <Package className="h-5 w-5 text-slate-600 mx-auto mb-1" />
                <p className="text-lg text-slate-900">{order.items.length}</p>
                <p className="text-xs text-slate-500">{t('products')}</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <Grid3x3 className="h-5 w-5 text-blue-600 mx-auto mb-1" />
                <p className="text-lg text-blue-900">{totalUnits}</p>
                <p className="text-xs text-blue-600">{t('units')}</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600 mx-auto mb-1" />
                <p className="text-lg text-green-900">${order.total.toFixed(2)}</p>
                <p className="text-xs text-green-600">{t('total')}</p>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('order_date')}:</span>
                <span className="text-slate-900">{new Date(order.date).toLocaleDateString()}</span>
              </div>
              {order.deliveryDate && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('delivery_date')}:</span>
                  <span className="text-slate-900">{new Date(order.deliveryDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Planogram Section */}
        <Card className="border-blue-200 bg-blue-50 mb-4">
          <CardContent className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <Grid3x3 className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-900 mb-1">{t('planogram')}</p>
                <p className="text-xs text-blue-700">{t('planogram_warning')}</p>
              </div>
            </div>
            <Button 
              onClick={handleViewPlanogram}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <Grid3x3 className="h-4 w-4 mr-2" />
              {t('view_planogram')}
            </Button>
          </CardContent>
        </Card>

        {/* Order Items */}
        <Card className="border-slate-200 shadow-sm mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('order_items')}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            {order.items.map((item: any, index: number) => {
              const quantity = item.toOrder || item.quantity || 0;
              const position = item.position || `${item.row},${item.col}`;
              
              return (
                <div key={index} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 mb-1">{item.productName}</p>
                      <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                          {quantity} {t('units')}
                        </Badge>
                        <span className="text-xs text-slate-500">× ${item.price}</span>
                        <span className="text-xs text-slate-400">| Pos: {position}</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-900">${(quantity * item.price).toFixed(2)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Invoice */}
        <Card className="border-slate-200 shadow-sm mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t('invoice')}</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintInvoice}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {t('print')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadInvoice}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('download')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Invoice
              invoiceNumber={order.id || ''}
              date={new Date(order.date).toLocaleDateString('en-US')}
              vendorNumber={order.vendorNumber || '2F318'}
              storeName={order.storeName || order.storeId}
              storeAddress={order.storeAddress || ''}
              items={invoiceItems}
              comments={order.comments || ''}
            />
          </CardContent>
        </Card>

        {/* POD Section */}
        {order.podRequired && !order.podUploaded && (
          <Card className="border-amber-200 bg-amber-50 mb-4">
            <CardContent className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <Camera className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-amber-900 mb-1">{t('pod_required')}</p>
                  <p className="text-xs text-amber-700">{t('pod_warning')}</p>
                </div>
              </div>
              <Button 
                onClick={handleCapturePOD}
                className="w-full bg-amber-600 hover:bg-amber-700"
              >
                <Camera className="h-4 w-4 mr-2" />
                {t('capture_pod')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* POD Uploaded */}
        {order.podUploaded && order.podImageUrl && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-green-900">{t('delivery_proof')}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="mb-3">
                <img 
                  src={order.podImageUrl} 
                  alt="POD" 
                  className="w-full rounded-lg border-2 border-green-200"
                />
              </div>
              {order.comments && (
                <div className="bg-white rounded-lg p-3 border border-green-200">
                  <p className="text-xs text-slate-500 mb-1">{t('notes')}:</p>
                  <p className="text-sm text-slate-900">{order.comments}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
