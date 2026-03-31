'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Camera, Upload, CheckCircle, X, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { uploadImage } from '@/shared/api/images-api';
import {
  isQueuedOfflineInvoiceId,
  queuePodUploadOffline,
  updateOrderStatusResilient,
} from '@/shared/offline/offline-orders';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';

export function CapturePOD({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [podImage, setPodImage] = useState<string | null>(null);
  const [podFile, setPodFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);
  const [orderLoadError, setOrderLoadError] = useState(false);
  const [podUploadError, setPodUploadError] = useState<string | null>(null);
  const [podSuccessMessage, setPodSuccessMessage] = useState<string | null>(null);
  const [deliveredItemsPreview, setDeliveredItemsPreview] = useState<
    Array<{ productId: string; quantity: number; unitPrice?: number }>
  >([]);
  const [invoiceSummary, setInvoiceSummary] = useState<{
    invoiceNumber: string;
    total: number;
    units: number;
    date: string;
    ok: boolean;
  } | null>(null);

  const isConnectivityError = (error: unknown): boolean => {
    const status = Number((error as any)?.status ?? 0);
    const message = String((error as any)?.message ?? error ?? '').toLowerCase();
    if (status === 0) return true;
    return (
      message.includes('error de conexión') ||
      message.includes('conexion') ||
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('timeout')
    );
  };

  const readDeliveredFromStorage = () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`order_delivery_confirmation_${orderId}`);
      if (!raw) {
        setDeliveredItemsPreview([]);
        return;
      }
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      setDeliveredItemsPreview(
        items
          .map((it: any) => ({
            productId: String(it?.productId ?? '').trim(),
            quantity: Number(it?.quantity ?? 0) || 0,
            unitPrice: it?.unitPrice != null ? Number(it.unitPrice) : undefined,
          }))
          .filter((it: any) => it.productId && it.quantity > 0)
      );
    } catch {
      setDeliveredItemsPreview([]);
    }
  };

  const deliveredUnitsPreview =
    deliveredItemsPreview.length > 0
      ? deliveredItemsPreview.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
      : 0;

  const deliveredTotalPreview =
    deliveredItemsPreview.length > 0
      ? deliveredItemsPreview.reduce((s, it) => {
          const pid = String(it.productId || '').trim();
          const qty = Number(it.quantity) || 0;
          if (!pid || qty <= 0) return s;
          const priceFromStorage = Number(it.unitPrice);
          const priceFromOrder =
            Number(
              (orderData?.items || []).find((x: any) => String(x?.productId ?? x?.ProductId ?? '').trim() === pid)
                ?.price
            ) || 0;
          const unit = Number.isFinite(priceFromStorage) && priceFromStorage > 0 ? priceFromStorage : priceFromOrder;
          return s + qty * (unit || 0);
        }, 0)
      : 0;

  // Cargar pedido, factura (totales/unidades) y nombre de tienda
  useEffect(() => {
    let mounted = true;
    (async () => {
      readDeliveredFromStorage();
      setOrderLoadError(false);
      const order = await ordersApi.getOrderById(orderId);
      if (!mounted) return;
      if (!order) {
        setOrderData(null);
        setInvoiceSummary(null);
        setOrderLoadError(true);
        return;
      }
      const orderToUse = order;
      setInvoiceSummary(null);
      let invOk = false;
      let invTotal = 0;
      let invUnits = 0;
      let invDate = '';
      let invNumber = '';
      try {
        const inv = await ordersApi.getInvoiceDisplayForOrder(orderId, orderToUse.invoiceId, orderToUse);
        if (inv) {
          const lines = inv.items || [];
          invUnits = lines.reduce((s, it) => s + (Number(it.qty) || 0), 0);
          invTotal = Number(inv.total) || 0;
          if (invTotal <= 0 && lines.length) {
            invTotal = lines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
          }
          invOk = lines.length > 0 || invTotal > 0;
          invDate = inv.date || '';
          invNumber = String(inv.invoiceNumber || '').trim();
        }
      } catch {
        /* sin factura legible */
      }
      const name = (orderToUse.storeName || '').trim();
      const looksLikeId = !name || name === orderToUse.storeId || /^[0-9a-f-]{36}$/i.test(name) || /^\d+$/.test(name);
      let storeNameResolved: string | undefined;
      if (orderToUse.storeId && looksLikeId) {
        const store = await storesApi.fetchStoreById(orderToUse.storeId);
        if (store) {
          if (store?.name) storeNameResolved = store.name;
        }
      } else if (name) {
        storeNameResolved = name;
      }
      if (mounted) {
        setInvoiceSummary({
          invoiceNumber: invNumber,
          total: invTotal,
          units: invUnits,
          date: invDate,
          ok: invOk,
        });
        setOrderData({
          ...orderToUse,
          storeNameResolved: storeNameResolved ?? orderToUse.storeName,
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => readDeliveredFromStorage();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [orderId]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setPodFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPodImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTakePhoto = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveImage = () => {
    setPodImage(null);
    setPodFile(null);
  };

  const handleSubmit = async () => {
    if (!podImage || !podFile) {
      setPodUploadError(t('pod_image_required') || 'Debes agregar una foto o imagen del comprobante de entrega.');
      return;
    }

    setUploading(true);
    setPodUploadError(null);
    setPodSuccessMessage(null);

    try {
      const backendOrderId = orderData?.backendOrderId ?? orderData?.id ?? orderId;
      const rawInvoiceId =
        orderData?.invoiceId ?? (orderData as any)?.InvoiceId ?? (orderData as any)?.invoice_id;
      let invStr = rawInvoiceId != null ? String(rawInvoiceId).trim() : '';
      if (
        invStr === '' &&
        typeof navigator !== 'undefined' &&
        !navigator.onLine &&
        typeof window !== 'undefined'
      ) {
        try {
          const delivery = window.localStorage.getItem(`order_delivery_confirmation_${orderId}`);
          if (delivery) {
            invStr = `queued-invoice-${String(backendOrderId)}`;
          }
        } catch {
          /* noop */
        }
      }
      if (invStr === '') {
        setPodUploadError(
          t('pod_invoice_required_first') ||
            'Este pedido aún no tiene factura. La facturación debe realizarse antes; luego podrás cargar el POD.'
        );
        setUploading(false);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queuePodUploadOffline({
          file: podFile,
          invoiceId: invStr,
          orderId: String(backendOrderId),
          notes: notes || undefined,
        });
        setPodSuccessMessage(
          t('pod_success') ||
            'Comprobante guardado sin conexión. Se sincronizará automáticamente.'
        );
        await new Promise((resolve) => setTimeout(resolve, 1300));
        router.push(`/order/${orderId}`);
        return;
      }

      let fileName = '';
      try {
        const uploaded = await uploadImage(podFile);
        fileName = String(uploaded?.fileName ?? '').trim();
      } catch (error) {
        if (isConnectivityError(error)) {
          await queuePodUploadOffline({
            file: podFile,
            invoiceId: invStr,
            orderId: String(backendOrderId),
            notes: notes || undefined,
          });
          setPodSuccessMessage(
            t('pod_success') ||
              'Comprobante guardado sin conexión. Se sincronizará automáticamente.'
          );
          await new Promise((resolve) => setTimeout(resolve, 1300));
          router.push(`/order/${orderId}`);
          return;
        }
        throw error;
      }
      if (!fileName) {
        setPodUploadError(t('pod_upload_failed') || 'No se pudo subir la imagen.');
        setUploading(false);
        return;
      }

      let invoiceIdForApi = invStr;
      if (isQueuedOfflineInvoiceId(invoiceIdForApi)) {
        const resolved = await ordersApi.getInvoiceIdForOrder(String(backendOrderId));
        if (resolved != null && !isQueuedOfflineInvoiceId(String(resolved))) {
          invoiceIdForApi = String(resolved);
        } else {
          await queuePodUploadOffline({
            file: podFile,
            invoiceId: invStr,
            orderId: String(backendOrderId),
            notes: notes || undefined,
          });
          setPodSuccessMessage(
            t('pod_success') ||
              'Comprobante guardado; la factura está pendiente de sincronizar. Se subirá el POD al reconectar.'
          );
          await new Promise((resolve) => setTimeout(resolve, 1300));
          router.push(`/order/${orderId}`);
          return;
        }
      }
      let patched = false;
      try {
        patched = await ordersApi.uploadPODForInvoice({
          invoiceId: invoiceIdForApi,
          fileName,
          notes: notes || undefined,
        });
      } catch (err) {
        if (isConnectivityError(err)) {
          await queuePodUploadOffline({
            file: podFile,
            invoiceId: invStr,
            orderId: String(backendOrderId),
            notes: notes || undefined,
          });
          setPodSuccessMessage(
            t('pod_success') ||
              'Comprobante guardado sin conexión. Se sincronizará automáticamente.'
          );
          await new Promise((resolve) => setTimeout(resolve, 1300));
          router.push(`/order/${orderId}`);
          return;
        }
        throw err;
      }
      if (!patched) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await queuePodUploadOffline({
            file: podFile,
            invoiceId: invStr,
            orderId: String(backendOrderId),
            notes: notes || undefined,
          });
          setPodSuccessMessage(
            t('pod_success') ||
              'Comprobante guardado sin conexión. Se sincronizará automáticamente.'
          );
          await new Promise((resolve) => setTimeout(resolve, 1300));
          router.push(`/order/${orderId}`);
          return;
        }
        setPodUploadError(
          t('pod_upload_failed') ||
            'No se pudo asociar el comprobante a la factura. Revisa la conexión o inténtalo de nuevo.'
        );
        setUploading(false);
        return;
      }

      const statusOk = await updateOrderStatusResilient(backendOrderId, true);
      if (!statusOk) {
        setPodUploadError(
          t('pod_upload_failed') ||
            'Comprobante guardado pero no se pudo actualizar el estado del pedido. Revisa el detalle del pedido.'
        );
        setUploading(false);
        return;
      }

      setPodSuccessMessage(t('pod_success') || 'Comprobante cargado correctamente. Redirigiendo al pedido...');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`order_delivery_confirmation_${orderId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
      router.refresh();
      router.push(`/order/${orderId}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/pending-pod')}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-slate-900">{t('capture_pod')}</h2>
            <p className="text-xs text-slate-500">{orderData?.storeName || t('delivery_proof')}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {orderLoadError && (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm flex flex-col gap-3">
            <p>{t('order_not_found') || 'No se pudo cargar el pedido. Puede que no exista o no tengas acceso.'}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => router.push('/pending-pod')}>
                {t('back_to_pod') || 'Volver a POD pendientes'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => router.push('/order/' + orderId)}>
                {t('view_order') || 'Ver pedido'}
              </Button>
            </div>
          </div>
        )}
        {!orderLoadError && podSuccessMessage && (
          <div className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-900 text-sm flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
            {podSuccessMessage}
          </div>
        )}
        {!orderLoadError && podUploadError && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-sm flex items-center gap-2">
            <X className="h-5 w-5 text-red-600 shrink-0" />
            {podUploadError}
          </div>
        )}
        {/* Si ya cargó el POD, mostrar mensaje y opción de ver pedido */}
        {!orderLoadError && orderData?.podUploaded && !podImage && !uploading && (
          <Card className="mb-4 border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-6 w-6 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-900 mb-1">
                    {t('pod_already_uploaded') || 'Ya cargaste el comprobante de entrega para este pedido.'}
                  </p>
                  <p className="text-xs text-green-700 mb-3">
                    {t('pod_already_uploaded_hint') || 'Puedes ver el comprobante en el detalle del pedido.'}
                  </p>
                  <Button
                    onClick={() => router.push(`/order/${orderId}`)}
                    className="bg-green-700 hover:bg-green-800"
                  >
                    {t('view_order') || 'Ver pedido'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {/* Instructions - ocultar si ya subió POD y no está re-subiendo */}
        {!orderLoadError && (!orderData?.podUploaded || podImage) && (
        <Card className="mb-4 border-indigo-200 bg-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Camera className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-indigo-900 mb-1">{t('pod_instructions_title')}</p>
                <p className="text-xs text-indigo-700">{t('pod_instructions')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Image Capture Area - no mostrar si ya cargó POD y no está subiendo uno nuevo */}
        {!orderLoadError && (!orderData?.podUploaded || podImage) && (
        <Card className="mb-4 border-slate-200">
          <CardContent className="p-4">
            <Label className="text-sm text-slate-700 mb-3 block">{t('delivery_proof')}</Label>
            
            {!podImage ? (
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                <div className="p-4 bg-slate-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-sm text-slate-600 mb-4">{t('no_image_captured')}</p>
                
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleTakePhoto}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    {t('take_photo')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleTakePhoto}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {t('upload_from_gallery')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="relative w-full aspect-video rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                  {podImage.startsWith('data:') ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL local; next/image falla en algunos entornos sin red
                    <img
                      src={podImage}
                      alt="POD"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  ) : (
                    <Image
                      src={podImage}
                      alt="POD"
                      fill
                      className="object-contain"
                      unoptimized
                    />
                  )}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </CardContent>
        </Card>
        )}

        {/* Order Info */}
        {!orderLoadError && (
        <Card className="border-slate-200 mb-20">
          <CardContent className="p-4">
            <h3 className="text-sm text-slate-900 mb-3">{t('order_information')}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('order_id')}:</span>
                <span className="text-slate-900">{orderId}</span>
              </div>
              {orderData && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('store')}:</span>
                    <span className="text-slate-900">{orderData.storeNameResolved ?? (orderData.storeName || orderData.storeId || '—')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('order_date')}:</span>
                    <span className="text-slate-900">{new Date(orderData.date).toLocaleDateString()}</span>
                  </div>
                  {orderData.deliveryDate && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('delivery_date')}:</span>
                      <span className="text-slate-900">{new Date(orderData.deliveryDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {invoiceSummary?.ok && invoiceSummary.invoiceNumber ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('invoice_id_short')}:</span>
                      <span className="text-slate-900">{invoiceSummary.invoiceNumber}</span>
                    </div>
                  ) : null}
                  {invoiceSummary?.ok && invoiceSummary.date ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('invoice_date_row')}:</span>
                      <span className="text-slate-900">{new Date(invoiceSummary.date).toLocaleDateString()}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('units')}:</span>
                    <span className="text-slate-900">
                      {invoiceSummary?.ok
                        ? invoiceSummary.units
                        : deliveredItemsPreview.length > 0
                          ? deliveredUnitsPreview
                          : (orderData.totalUnits ||
                              orderData.items?.reduce((sum: number, item: any) => sum + (item.toOrder || 0), 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('total')}:</span>
                    <span className="text-slate-900 font-semibold">
                      {invoiceSummary?.ok ? (
                        `$${Number(invoiceSummary.total).toFixed(2)}`
                      ) : (
                        `$${(
                          deliveredItemsPreview.length > 0
                            ? deliveredTotalPreview
                            : (Number(orderData.total) ||
                                (Number(orderData.subtotal) + Number(orderData.tax) || 0) ||
                                (orderData.items || []).reduce(
                                  (s: number, i: any) => s + (i.quantity ?? i.toOrder ?? 0) * (Number(i.price) || 0),
                                  0
                                ) + (Number(orderData.tax) || 0))
                        ).toFixed(2)}`
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {/* Action Button - ocultar si ya cargó POD y no hay imagen nueva */}
      {!orderLoadError && (!orderData?.podUploaded || podImage) && (
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <Button
          onClick={handleSubmit}
          disabled={!podImage || uploading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-300"
        >
          {uploading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {t('uploading') || 'Guardando...'}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              {t('complete_delivery') || 'Completar entrega y guardar comprobante'}
            </>
          )}
        </Button>
      </div>
      )}
    </div>
  );
}
