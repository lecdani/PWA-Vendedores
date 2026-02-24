'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { 
  ArrowLeft, 
  Store as StoreIcon, 
  Package, 
  DollarSign,
  Download,
  Grid3x3,
  Printer,
  CheckCircle2,
  Camera,
  Pencil,
  Trash2
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';
import { API_BASE_URL } from '@/shared/api/api-client';
import { storesApi } from '@/shared/api/stores-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { productsApi } from '@/shared/api/products-api';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Separator } from '@/shared/ui/separator';
import { Invoice } from './invoice';

export function OrderDetail({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [order, setOrder] = useState<OrderForUI | null>(null);
  const [invoiceStoreName, setInvoiceStoreName] = useState('');
  const [invoiceStoreAddress, setInvoiceStoreAddress] = useState('');
  const [invoiceFromApi, setInvoiceFromApi] = useState<{
    invoiceNumber: string;
    date: string;
    total: number;
    items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
  } | null>(null);

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

      // Intentar obtener el pedido desde la API
      const loadOrder = async () => {
        const apiOrder = await ordersApi.getOrderById(orderId);
        if (apiOrder) {
          let orderToSet = apiOrder;
          const needsPrice = apiOrder.items.some((i: any) => i.productId && !Number(i.price));
          const needsProductName = apiOrder.items.some((i: any) => i.productId && !(i.productName || i.sku || '').trim());
          if (needsPrice || needsProductName) {
            const enrichedItems = await Promise.all(
              apiOrder.items.map(async (item: any) => {
                let productName = (item.productName || item.sku || '').trim();
                let price = Number(item.price) || 0;
                if (item.productId) {
                  // Siempre traer el último precio del historial cuando falta o es 0
                  if (!price) price = await histpricesApi.getLatest(item.productId);
                  if (!productName) {
                    const product = await productsApi.getById(item.productId);
                    if (product) productName = product.name || product.sku || '';
                  }
                }
                return { ...item, productName: productName || item.productName, price };
              })
            );
            const computedSubtotal = enrichedItems.reduce((s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0) * (i.price || 0), 0);
            orderToSet = {
              ...apiOrder,
              items: enrichedItems,
              subtotal: apiOrder.subtotal || computedSubtotal,
              total: apiOrder.total || computedSubtotal + (apiOrder.tax || 0),
            };
          }
          if (typeof window !== 'undefined') {
            try {
              const raw = sessionStorage.getItem('podByOrderId');
              const map = raw ? JSON.parse(raw) : {};
              const cached = map[orderId];
              if (cached?.podImageUrl || cached?.podFileName) {
                orderToSet = {
                  ...orderToSet,
                  podImageUrl: orderToSet.podImageUrl || cached.podImageUrl,
                  podFileName: orderToSet.podFileName || cached.podFileName,
                  podUploaded: orderToSet.podUploaded || true,
                };
              }
              const statusRaw = sessionStorage.getItem('orderStatusByOrderId');
              const statusMap = statusRaw ? JSON.parse(statusRaw) : {};
              const cachedStatus = statusMap[orderId];
              if (cachedStatus && !orderToSet.status?.toLowerCase?.()?.includes('invoiced')) {
                orderToSet = { ...orderToSet, status: cachedStatus };
              }
            } catch {
              // ignorar
            }
          }
          setOrder(orderToSet);
          const name = (orderToSet.storeName || '').trim();
          const looksLikeId = !name || name === orderToSet.storeId || /^[0-9a-f-]{36}$/i.test(name) || /^\d+$/.test(name);
          if (orderToSet.storeId && looksLikeId) {
            const store = await storesApi.fetchStoreById(orderToSet.storeId);
            if (store) {
              setInvoiceStoreName(store.name);
              setInvoiceStoreAddress((store.address || '').trim());
            } else {
              setInvoiceStoreName(name || '—');
              setInvoiceStoreAddress(orderToSet.storeAddress || '');
            }
          } else {
            setInvoiceStoreName(name || orderToSet.storeName || '—');
            setInvoiceStoreAddress(orderToSet.storeAddress || '');
          }
          // Factura: GET con orderId e invoiceId (del pedido o sessionStorage) para GET /invoice e /invoicedetails
          const invoiceIdHint =
            orderToSet.invoiceId ??
            (typeof window !== 'undefined' && (() => {
              try {
                const raw = sessionStorage.getItem('invoiceIdByOrder');
                const map = raw ? JSON.parse(raw) : {};
                return map[orderId];
              } catch {
                return undefined;
              }
            })());
          const invoiceDisplay = await ordersApi.getInvoiceDisplayForOrder(orderId, invoiceIdHint);
          setInvoiceFromApi(invoiceDisplay ?? null);
          if (invoiceDisplay && typeof window !== 'undefined') {
            try {
              const invId = await ordersApi.getInvoiceIdForOrder(orderId);
              if (invId != null) {
                const raw = sessionStorage.getItem('invoiceIdByOrder');
                const map = raw ? JSON.parse(raw) : {};
                map[orderId] = invId;
                sessionStorage.setItem('invoiceIdByOrder', JSON.stringify(map));
              }
            } catch {
              // ignorar
            }
          }
          return;
        }

        setInvoiceFromApi(null);
        // Fallback: buscar en localStorage
        const orders = JSON.parse(localStorage.getItem('orders') || '[]');
        const foundOrder = orders.find((o: any) => o.id === orderId);

        if (foundOrder) {
          const totalUnits = (foundOrder.items || []).reduce(
            (sum: number, item: any) =>
              sum + (item.toOrder || item.quantity || 0),
            0
          );
          setInvoiceStoreName(foundOrder.storeName || foundOrder.storeId || '');
          setInvoiceStoreAddress(foundOrder.storeAddress || '');
          setOrder({
            id: String(foundOrder.id),
            backendOrderId: foundOrder.backendOrderId,
            storeId: foundOrder.storeId,
            storeName: foundOrder.storeName || foundOrder.storeId,
            storeAddress: foundOrder.storeAddress,
            date: foundOrder.date,
            deliveryDate: foundOrder.deliveryDate,
            status: foundOrder.status,
            items: foundOrder.items || [],
            totalUnits,
            subtotal: foundOrder.subtotal,
            tax: foundOrder.tax,
            total: foundOrder.total,
            podRequired: foundOrder.podRequired,
            podUploaded: foundOrder.podUploaded,
            podImageUrl: foundOrder.podImageUrl,
            vendorNumber: foundOrder.vendorNumber,
            comments: foundOrder.comments,
          });
        } else {
          setInvoiceStoreName('');
          setInvoiceStoreAddress('');
          setOrder({
            id: orderId,
            backendOrderId: undefined,
            storeId: 'N/A',
            storeName: '—',
            storeAddress: '',
            date: new Date().toISOString(),
            deliveryDate: undefined,
            status: 'pending',
            items: [],
            totalUnits: 0,
            subtotal: 0,
            tax: 0,
            total: 0,
            podRequired: true,
            podUploaded: false,
          });
        }
      };

      loadOrder();
    }
  }, [orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">Cargando...</p>
      </div>
    );
  }

  const totalUnits = order.totalUnits;
  const displayTotal = order.total > 0 ? order.total : order.items.reduce((s, i) => s + (i.toOrder ?? i.quantity ?? 0) * (i.price ?? 0), 0);

  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed': return 'bg-green-50 text-green-700 border-green-200';
      case 'invoiced': return 'bg-green-50 text-green-700 border-green-200';
      case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getStatusText = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed': return t('completed');
      case 'invoiced': return t('invoiced') || 'Facturado';
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

  const vendorName = [user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email || order.vendorNumber || '';
  const invoiceStoreDisplayName = invoiceStoreName || order.storeName || '';
  const cleanAddress = (addr: string) => (addr || '').replace(/,?\s*[0-9a-f-]{36}\s*$/i, '').replace(/,?\s*\d+\s*$/, '').trim();
  const invoiceStoreDisplayAddress = cleanAddress(invoiceStoreAddress || order.storeAddress || '');
  // Solo API: lo que ve el cliente es únicamente lo que devuelve la BD (GET invoice + invoicedetails). Nada local.
  const invoiceItems = invoiceFromApi?.items ?? [];
  const invoiceNumber = invoiceFromApi?.invoiceNumber ?? '—';
  const invoiceDate = invoiceFromApi?.date ? (invoiceFromApi.date.includes(',') ? invoiceFromApi.date : new Date(invoiceFromApi.date).toLocaleDateString('en-US')) : '—';

  const handleCapturePOD = () => {
    router.push(`/capture-pod/${orderId}`);
  };

  const handleViewPlanogram = () => {
    router.push(`/view-planogram/${orderId}`);
  };

  const canEditOrder = (order.status || '').toLowerCase() === 'pending' && !order.podUploaded;
  const handleEditOrder = () => {
    if (typeof window !== 'undefined' && order.storeId) {
      sessionStorage.setItem('storeInfo', JSON.stringify({
        name: invoiceStoreDisplayName || order.storeName,
        address: invoiceStoreDisplayAddress || order.storeAddress,
      }));
    }
    router.push(`/planogram/${order.storeId}?orderId=${orderId}`);
  };

  const handleDeleteOrder = async () => {
    setDeleting(true);
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('visitLogIdByOrderId');
        const map = raw ? JSON.parse(raw) : {};
        const storedId = map[orderId];
        const visitLogId =
          typeof storedId === 'string' || typeof storedId === 'number'
            ? storedId
            : null;
        if (visitLogId != null) {
          await ordersApi.deleteVisitLog(visitLogId);
          delete map[orderId];
          sessionStorage.setItem('visitLogIdByOrderId', JSON.stringify(map));
        }
      } catch {
        // ignorar
      }
    }
    const ok = await ordersApi.deleteOrder(orderId);
    setDeleting(false);
    setShowDeleteConfirm(false);
    if (ok) {
      router.push('/history');
    }
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
              <p className="text-xs opacity-90">{invoiceStoreDisplayName || order.storeName} · {new Date(order.date).toLocaleDateString()}</p>
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
              <p className="text-xs text-slate-500 truncate">{invoiceStoreDisplayName || order.storeName} · {new Date(order.date).toLocaleDateString()}</p>
            </div>
          </div>
          <Badge variant="outline" className={`${getStatusColor(order.status)} flex-shrink-0`}>
            {getStatusText(order.status)}
          </Badge>
        </div>
      </div>

      <div className="px-4 pb-24 space-y-4">
        {/* Store Info - misma info que en historial: tienda, fecha, dirección */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <StoreIcon className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 mb-1">{invoiceStoreDisplayName || order.storeName || t('store')}</p>
                {invoiceStoreDisplayAddress ? (
                  <p className="text-xs text-slate-600 mb-1">{invoiceStoreDisplayAddress}</p>
                ) : (order.storeAddress ? (
                  <p className="text-xs text-slate-600 mb-1">{order.storeAddress}</p>
                ) : null)}
                <p className="text-xs text-slate-400">{t('order_date')}: {new Date(order.date).toLocaleDateString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('order_summary')}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
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
                <p className="text-lg text-green-900">${displayTotal.toFixed(2)}</p>
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

            {canEditOrder && (
              <div className="flex gap-2 mt-4">
                <Button 
                  variant="outline"
                  onClick={handleEditOrder}
                  className="flex-1 border-amber-300 text-amber-800 hover:bg-amber-50"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  {t('edit_order')}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('delete_order')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Planogram Section */}
        <Card className="border-blue-200 bg-blue-50 overflow-hidden">
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

        {/* Confirmar eliminar pedido */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" aria-modal="true">
            <Card className="w-full max-w-sm border-slate-200 bg-white shadow-lg overflow-hidden">
              <CardHeader className="px-4 pt-4 pb-2">
                <CardTitle className="text-base text-slate-900">{t('delete_order')}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 space-y-4">
                <p className="text-sm text-slate-600">{t('delete_order_confirm')}</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    {t('cancel')}
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
                    onClick={handleDeleteOrder}
                    disabled={deleting}
                  >
                    {deleting ? t('loading') : t('delete_order')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Order Items */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('order_items')}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100 px-4 pb-4">
            {order.items.map((item: any, index: number) => {
              const quantity = item.toOrder || item.quantity || 0;
              const price = item.price ?? 0;
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
                        <span className="text-xs text-slate-500">× ${price.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-900">${(quantity * price).toFixed(2)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Invoice */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
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
          <CardContent className="px-4 pb-4 pt-0">
            <Invoice
              invoiceNumber={invoiceNumber}
              date={typeof invoiceDate === 'string' && invoiceDate.includes(',') ? invoiceDate : new Date(invoiceDate).toLocaleDateString('en-US')}
              vendorName={vendorName}
              storeName={invoiceStoreDisplayName}
              storeAddress={invoiceStoreDisplayAddress}
              items={invoiceItems}
              comments={order.comments || ''}
            />
          </CardContent>
        </Card>

        {/* Sección POD: si hay POD en BD se muestra el texto; si no, se muestra cargar */}
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('delivery_proof') || 'Comprobante de entrega (POD)'}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {order.podImageUrl || order.podFileName ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {t('pod_uploaded') || 'Comprobante registrado'}
                    </p>
                    <p className="text-sm text-green-800 font-mono">
                      {(order.podImageUrl || order.podFileName || '').startsWith('data:')
                        ? (order.podFileName || t('pod_uploaded') || 'Comprobante registrado')
                        : (order.podImageUrl || order.podFileName)}
                    </p>
                  </div>
                </div>
                {(() => {
                  const path = (order.podImageUrl || order.podFileName || '').trim();
                  if (!path) return null;
                  const imageUrl = path.startsWith('data:') || path.startsWith('http')
                    ? path
                    : `${API_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
                  return (
                    <div className="relative w-full aspect-video rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                      <img src={imageUrl} alt="POD" className="w-full h-full object-contain" />
                    </div>
                  );
                })()}
              </div>
            ) : order.status === 'pending' ? (
              <>
                <p className="text-sm text-slate-600 mb-3">
                  {t('pod_not_uploaded') || 'No has cargado el comprobante de entrega'}
                </p>
                <p className="text-xs text-slate-500 mb-3">
                  {t('pod_warning') || 'Carga el comprobante para completar la entrega.'}
                </p>
                <Button
                  onClick={handleCapturePOD}
                  className="w-full bg-amber-600 hover:bg-amber-700"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {t('capture_pod')}
                </Button>
              </>
            ) : (
              <p className="text-xs text-slate-500">
                {t('pod_already_invoiced') || 'Este pedido ya está facturado y no requiere cargar POD aquí.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
