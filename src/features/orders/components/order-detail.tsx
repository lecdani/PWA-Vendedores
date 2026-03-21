'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { storesApi } from '@/shared/api/stores-api';
import { citiesApi } from '@/shared/api/cities-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { productsApi, getProductImageUrl } from '@/shared/api/products-api';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { orderItemMatchesFamily } from '@/shared/utils/order-item-matches-family';
import { FamilySummaryCell } from '@/shared/components/family-summary-cell';
import { getBackendAssetUrl } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Separator } from '@/shared/ui/separator';
import { Invoice } from './invoice';

export function OrderDetail({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [order, setOrder] = useState<OrderForUI | null>(null);
  const [invoiceStoreName, setInvoiceStoreName] = useState('');
  const [invoiceStoreAddress, setInvoiceStoreAddress] = useState('');
  const [invoiceStoreCity, setInvoiceStoreCity] = useState('');
  const [invoiceFromApi, setInvoiceFromApi] = useState<{
    invoiceNumber: string;
    date: string;
    total: number;
    items: Array<{ qty: number; code: string; description: string; price: number; amount: number }>;
  } | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [loadingPod, setLoadingPod] = useState(false);
  const [orderLoadDone, setOrderLoadDone] = useState(false);
  const [podImageError, setPodImageError] = useState(false);
  const [allCategories, setAllCategories] = useState<CategoryForUI[]>([]);
  const [storeHasPlanogram, setStoreHasPlanogram] = useState(true);

  useEffect(() => {
    categoriesApi.fetchAll().then(setAllCategories);
  }, []);

  const displayPod = (order?.podImageUrl || order?.podFileName || (invoiceFromApi?.pod || '').trim()) || '';
  const orderStatus = (order?.status || '').toLowerCase() === 'invoiced' ? 'invoiced' : 'pending';

  useEffect(() => {
    if (searchParams.get('confirmed') === '1') {
      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 3000);
    }
  }, [searchParams]);

  useEffect(() => {
    const loadOrder = async () => {
      const apiOrder = await ordersApi.getOrderById(orderId);
      if (apiOrder) {
        const categories = await categoriesApi.fetchAll();
        const categoryById = new Map<string, string>();
        categories.forEach((c) => {
          categoryById.set(c.id, c.name);
          categoryById.set(String(Number(c.id)), c.name);
        });

        let orderToSet = apiOrder;
        const needsPrice = apiOrder.items.some((i: any) => i.productId && !Number(i.price));
        const needsProductName = apiOrder.items.some((i: any) => i.productId && !(i.productName || i.sku || '').trim());
        const needsImage = apiOrder.items.some((i: any) => i.productId && !i.imageUrl);
        const needsCategory = apiOrder.items.some((i: any) => i.productId && (i.category == null || i.category === ''));
        const needsFamilyId = apiOrder.items.some(
          (i: any) => i.productId && !(i.familyId ?? i.categoryId ?? i.FamilyId ?? i.CategoryId)
        );
        if (needsPrice || needsProductName || needsImage || needsCategory || needsFamilyId) {
          const enrichedItems = await Promise.all(
            apiOrder.items.map(async (item: any) => {
              let productName = (item.productName || item.sku || '').trim();
              let price = Number(item.price) || 0;
              let imageUrl = item.imageUrl;
              let category = (item.category || '').trim();
              let familyId = String(item.familyId ?? item.FamilyId ?? item.categoryId ?? item.CategoryId ?? '').trim();
              if (item.productId) {
                const product = await productsApi.getById(item.productId);
                if (product) {
                  if (!productName) productName = product.name || product.code || product.sku || '';
                  if (!imageUrl) imageUrl = getProductImageUrl(product);
                  if (!familyId) familyId = String(product.familyId ?? product.categoryId ?? '').trim();
                  if (familyId) {
                    const resolved = categoryById.get(familyId) ?? categoryById.get(String(Number(familyId)));
                    if (resolved) category = resolved;
                  }
                  if (!category && product.category) category = product.category.trim();
                  if (!category && product.categoryId != null) {
                    const id = String(product.categoryId);
                    category = categoryById.get(id) ?? categoryById.get(String(Number(id))) ?? '';
                  }
                }
                if (!price && familyId) price = await histpricesApi.getLatest(familyId);
              }
              return {
                ...item,
                productName: productName || item.productName,
                price,
                imageUrl: imageUrl || item.imageUrl,
                category: category || item.category,
                familyId: familyId || item.familyId,
                categoryId: familyId || item.categoryId,
              };
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
        setOrder(orderToSet);
        const name = (orderToSet.storeName || '').trim();
        const looksLikeId = !name || name === orderToSet.storeId || /^[0-9a-f-]{36}$/i.test(name) || /^\d+$/.test(name);
        if (orderToSet.storeId && looksLikeId) {
          const store = await storesApi.fetchStoreById(orderToSet.storeId);
          if (store) {
            setStoreHasPlanogram(store.hasPlanogram !== false);
            setInvoiceStoreName(store.name);
            setInvoiceStoreAddress((store.address || '').trim());
            const cityRaw = (store.city || '').trim();
            if (cityRaw && citiesApi.looksLikeCityId(cityRaw)) {
              const cityName = await citiesApi.getCityNameById(cityRaw);
              setInvoiceStoreCity(cityName);
            } else {
              setInvoiceStoreCity(cityRaw);
            }
          } else {
            setStoreHasPlanogram(true);
            setInvoiceStoreName(name || '—');
            setInvoiceStoreAddress(orderToSet.storeAddress || '');
            setInvoiceStoreCity('');
          }
        } else {
          setInvoiceStoreName(name || orderToSet.storeName || '—');
          setInvoiceStoreAddress(orderToSet.storeAddress || '');
          setInvoiceStoreCity('');
        }
        const invoiceIdHint = orderToSet.invoiceId ?? await ordersApi.getInvoiceIdForOrder(orderId)
          ?? (orderToSet.backendOrderId != null ? await ordersApi.getInvoiceIdForOrder(String(orderToSet.backendOrderId)) : null);
        const invoiceDisplay = await ordersApi.getInvoiceDisplayForOrder(orderId, invoiceIdHint ?? undefined);
        setInvoiceFromApi(invoiceDisplay ?? null);
        if (invoiceDisplay?.pod) {
          setOrder((prev) =>
            prev ? { ...prev, podImageUrl: invoiceDisplay.pod, podFileName: invoiceDisplay.pod, podUploaded: true } : prev
          );
        }
        setOrderLoadDone(true);
        return;
      }
      setInvoiceFromApi(null);
      setInvoiceStoreName('');
      setInvoiceStoreAddress('');
      setInvoiceStoreCity('');
      setOrder(null);
      setOrderLoadDone(true);
    };
    setOrderLoadDone(false);
    loadOrder();
  }, [orderId]);

  // Sincronizar POD de la factura al pedido (la factura devuelve orderId y pod)
  useEffect(() => {
    if (!order || !invoiceFromApi?.pod) return;
    const pod = (invoiceFromApi.pod || '').trim();
    if (!pod || (order.podImageUrl === pod && order.podFileName === pod)) return;
    setOrder((prev) => (prev ? { ...prev, podImageUrl: pod, podFileName: pod, podUploaded: true } : prev));
  }, [order?.id, invoiceFromApi?.pod, order?.podImageUrl, order?.podFileName]);

  // Fallback: si no hay POD, cargar factura (devuelve orderId y pod); usa order.invoiceId o resuelve por orderId
  useEffect(() => {
    if (!order || order.podImageUrl || order.podFileName || invoiceFromApi?.pod) return;
    let cancelled = false;
    setLoadingPod(true);
    ordersApi.getInvoiceDisplayForOrder(orderId, order.invoiceId ?? undefined).then((display) => {
      if (cancelled) return;
      setLoadingPod(false);
      if (!display) return;
      setInvoiceFromApi(display);
      if (display.pod) setOrder((prev) => (prev ? { ...prev, podImageUrl: display.pod, podFileName: display.pod, podUploaded: true } : prev));
    });
    return () => { cancelled = true; };
  }, [orderId, order?.id, order?.invoiceId, order?.podImageUrl, order?.podFileName, invoiceFromApi?.pod]);

  useEffect(() => {
    setPodImageError(false);
  }, [displayPod]);

  // Pedido facturado sin POD en estado: forzar carga de factura por API para obtener POD
  useEffect(() => {
    const isInvoiced = (order?.status || '').toLowerCase() === 'invoiced';
    if (!order || !isInvoiced || order.podImageUrl || order.podFileName || invoiceFromApi?.pod) return;
    let cancelled = false;
    setLoadingPod(true);
    ordersApi.getInvoiceDisplayForOrder(orderId, order.invoiceId ?? undefined).then((display) => {
      if (cancelled) return;
      setLoadingPod(false);
      if (!display?.pod) return;
      setInvoiceFromApi((prev) => (prev ? { ...prev, pod: display.pod } : { invoiceNumber: '', date: '', total: 0, items: [], pod: display.pod }));
      setOrder((prev) => (prev ? { ...prev, podImageUrl: display.pod, podFileName: display.pod, podUploaded: true } : prev));
    });
    return () => { cancelled = true; };
  }, [order?.id, order?.status, order?.invoiceId, order?.podImageUrl, order?.podFileName, invoiceFromApi?.pod, orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {orderLoadDone ? (
          <div className="text-center">
            <p className="text-slate-600 mb-4">Pedido no encontrado</p>
            <Button variant="outline" onClick={() => router.back()}>Volver</Button>
          </div>
        ) : (
          <p className="text-slate-600">Cargando...</p>
        )}
      </div>
    );
  }

  const totalUnits = order.totalUnits;
  const displayTotal = order.total > 0 ? order.total : order.items.reduce((s, i) => s + (i.toOrder ?? i.quantity ?? 0) * (i.price ?? 0), 0);

  /** Solo 2 estados: pending e invoiced. */
  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'invoiced') return 'bg-green-50 text-green-700 border-green-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const getStatusText = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'invoiced') return t('invoiced') || 'Facturado';
    return t('pending');
  };

  const handleDownloadInvoice = () => {
    window.print();
  };

  const handlePrintInvoice = () => {
    window.print();
  };

  /** URL de la imagen POD: data/base64 o URL absoluta se devuelve tal cual; nombre de archivo (S3) se resuelve vía backend. */
  const buildPodImageUrl = (podPath: string): string => {
    const raw = (podPath || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return getBackendAssetUrl('images/url/' + raw);
  };

  const podImageUrl = displayPod ? buildPodImageUrl(displayPod) : '';
  const isPodPath = displayPod && !displayPod.startsWith('data:') && !displayPod.startsWith('http');

  const vendorName = [user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email || order.vendorNumber || '';
  const invoiceStoreDisplayName = invoiceStoreName || order.storeName || '';
  const cleanAddress = (addr: string) => (addr || '').replace(/,?\s*[0-9a-f-]{36}\s*$/i, '').replace(/,?\s*\d+\s*$/, '').trim();
  const invoiceStoreDisplayAddress = cleanAddress(invoiceStoreAddress || order.storeAddress || '');
  const invoiceItems =
    invoiceFromApi?.items?.length
      ? invoiceFromApi.items
      : (order.items || []).map((i: any) => {
          const qty = i.toOrder ?? i.quantity ?? 0;
          const price = Number(i.price) ?? 0;
          return {
            qty,
            code: (i.sku || i.productId || '').trim() || '—',
            description: (i.productName || i.sku || '').trim() || '—',
            price,
            amount: qty * price,
          };
        });
  const invoiceNumberDisplay = order.po
    ? `PO - ${order.po}`
    : (invoiceFromApi?.invoiceNumber ?? order.invoiceId ?? order.id ?? '—');
  const invoiceDate = invoiceFromApi?.date
    ? (invoiceFromApi.date.includes(',') ? invoiceFromApi.date : new Date(invoiceFromApi.date).toLocaleDateString('en-US'))
    : (order.date ? new Date(order.date).toLocaleDateString('en-US') : '—');

  const handleRetryInvoice = async () => {
    setLoadingInvoice(true);
    try {
      const hint = order.invoiceId ?? await ordersApi.getInvoiceIdForOrder(orderId)
        ?? (order.backendOrderId != null ? await ordersApi.getInvoiceIdForOrder(String(order.backendOrderId)) : null);
      const display = await ordersApi.getInvoiceDisplayForOrder(orderId, hint ?? undefined);
      setInvoiceFromApi(display ?? null);
      if (display?.pod) {
        setOrder((prev) =>
          prev ? { ...prev, podImageUrl: display.pod, podFileName: display.pod, podUploaded: true } : prev
        );
      }
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCapturePOD = () => {
    router.push(`/capture-pod/${orderId}`);
  };

  const handleViewPlanogram = () => {
    router.push(`/view-planogram/${orderId}`);
  };

  const canEditOrder = orderStatus === 'pending' && !order.podUploaded;
  const handleEditOrder = () => {
    if (order.storeId) router.push(`/planogram/${order.storeId}?orderId=${orderId}`);
  };

  // Eliminación de pedidos solo permitida en Sistema Web Admin (no en la PWA).

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Success Confirmation Banner */}
      {showConfirmation && (
        <div className="fixed top-16 left-0 right-0 z-50 bg-green-600 text-white px-4 py-3 shadow-lg animate-in slide-in-from-top">
          <div className="flex items-center gap-3 max-w-2xl mx-auto">
            <CheckCircle2 className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm">
                {(order.status || '').toLowerCase() === 'invoiced' ? t('delivery_completed_success') : t('order_sent_success')}
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
              <h2 className="text-sm text-slate-900 font-medium">{order.po ? `PO - ${order.po}` : t('order_detail')}</h2>
              <p className="text-xs text-slate-500 truncate">{invoiceStoreDisplayName || order.storeName} · {new Date(order.date).toLocaleDateString()}</p>
            </div>
          </div>
          <Badge variant="outline" className={`${getStatusColor(order.status)} flex-shrink-0`}>
            {getStatusText(order.status)}
          </Badge>
        </div>
      </div>

      <div className="px-4 pb-24 space-y-4">
        {/* Pedido / Tienda: resaltar PO, tienda como secundario */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <StoreIcon className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                {order.po ? (
                  <>
                    <p className="text-base font-semibold text-slate-900 mb-1.5">PO - {order.po}</p>
                    <p className="text-xs text-slate-500 mb-0.5">{t('store')}: {invoiceStoreDisplayName || order.storeName || '—'}</p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-slate-900 mb-1">{invoiceStoreDisplayName || order.storeName || t('store')}</p>
                )}
                {(() => {
                  const addr = invoiceStoreDisplayAddress || order.storeAddress || '';
                  const city = invoiceStoreCity || '';
                  const ubicacion = [addr, city].filter(Boolean).join(', ');
                  return ubicacion ? (
                    <p className="text-xs text-slate-600 mb-1">{t('location')}: {ubicacion}</p>
                  ) : null;
                })()}
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
              <div className="text-center p-3 bg-indigo-50 rounded-lg">
                <Grid3x3 className="h-5 w-5 text-indigo-600 mx-auto mb-1" />
                <p className="text-lg text-indigo-900">{totalUnits}</p>
                <p className="text-xs text-indigo-600">{t('units')}</p>
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* Planogram Section: solo si la tienda usa planograma */}
        {storeHasPlanogram && (
          <Card className="border-indigo-200 bg-indigo-50 overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <Grid3x3 className="h-5 w-5 text-indigo-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-indigo-900 mb-1">{t('planogram')}</p>
                  <p className="text-xs text-indigo-700">{t('planogram_warning')}</p>
                </div>
              </div>
              <Button 
                onClick={handleViewPlanogram}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                <Grid3x3 className="h-4 w-4 mr-2" />
                {t('view_planogram')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Eliminación de pedido deshabilitada en PWA: solo administradores en Sistema Web Admin. */}

        {/* Order Items */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('order_items')}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100 px-4 pb-4">
            {order.items.map((item: any, index: number) => {
              const quantity = item.toOrder || item.quantity || 0;
              const price = item.price ?? 0;
              const imgUrl = item.imageUrl;
              return (
                <div key={index} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <Package className="h-5 w-5 text-slate-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-900 mb-1">{item.productName}</p>
                      <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
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

          {/* Resumen por categoría: todas las registradas, con Pcs (0 o suma del pedido) */}
          {allCategories.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <table className="w-full min-w-[280px] overflow-hidden rounded-lg border border-slate-200 text-sm shadow-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                      {t('family_col') || 'Family'}
                    </th>
                    <th className="w-14 border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-600">
                      {t('pcs_col') || 'Pcs'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {[...allCategories]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((cat) => {
                      const pcs = (order.items || []).reduce(
                        (sum: number, item: any) => {
                          const qty = item.toOrder ?? item.quantity ?? 0;
                          return orderItemMatchesFamily(item, cat, allCategories) ? sum + qty : sum;
                        },
                        0
                      );
                      return (
                        <tr key={cat.id} className="bg-slate-50/80">
                          <td className="px-3 py-2.5 align-top">
                            <FamilySummaryCell cat={cat} />
                          </td>
                          <td className="px-3 py-2.5 text-left align-middle bg-white">
                            <span className="tabular-nums text-slate-900">{pcs}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Invoice */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t('invoice')}</CardTitle>
              <div className="flex gap-2 flex-wrap">
                {!invoiceFromApi && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryInvoice}
                    disabled={loadingInvoice}
                  >
                    {loadingInvoice ? t('loading') + '...' : (t('retry') || 'Reintentar factura')}
                  </Button>
                )}
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
              invoiceNumber={invoiceNumberDisplay}
              date={typeof invoiceDate === 'string' && invoiceDate.includes(',') ? invoiceDate : new Date(invoiceDate).toLocaleDateString('en-US')}
              vendorName={vendorName}
              storeName={invoiceStoreDisplayName}
              storeAddress={invoiceStoreDisplayAddress}
              items={invoiceItems}
              comments={order.comments || ''}
            />
          </CardContent>
        </Card>

        {/* Sección POD: mostrar si hay POD en pedido o en la factura cargada (pedidos viejos) */}
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">{t('delivery_proof') || 'Comprobante de entrega (POD)'}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {displayPod ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  <p className="text-xs text-slate-500">
                    {t('pod_uploaded') || 'Comprobante registrado'}
                  </p>
                </div>
                {/* Ruta que viene de la BD (ej. /imagenes/dani.png) */}
                {isPodPath && (
                  <p className="text-xs text-slate-500 font-mono break-all">{displayPod}</p>
                )}
                {/* Imagen: se lee desde tu laptop (base + ubicación de la BD) y se sirve por /api/pod-image */}
                {podImageUrl && (
                  <div className="relative w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-50 min-h-[200px] flex items-center justify-center">
                    {podImageError ? (
                      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                        <p className="text-sm text-amber-700 mb-1">No se pudo cargar la imagen</p>
                        <p className="text-xs text-slate-500 mb-2">Ruta: {displayPod}</p>
                        <a href={podImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 underline break-all">
                          Abrir enlace
                        </a>
                      </div>
                    ) : (
                      <img
                        key={podImageUrl}
                        src={podImageUrl}
                        alt={t('delivery_proof') || 'Comprobante de entrega (POD)'}
                        className="w-full max-h-[320px] object-contain"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setPodImageError(false)}
                        onError={() => setPodImageError(true)}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : orderStatus === 'pending' ? (
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
            ) : loadingPod ? (
              <p className="text-sm text-slate-600">Cargando comprobante...</p>
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
