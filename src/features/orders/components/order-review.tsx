'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Edit, ShoppingCart, DollarSign, Package, Store as StoreIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, CreateOrderInput } from '@/shared/api/orders-api';
import { storesApi, StoreForUI } from '@/shared/api/stores-api';
import { getOrderReviewPayload, setOrderReviewPayload } from '@/shared/order-review-payload';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';
import { Badge } from '@/shared/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';

export function OrderReview() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [storeId, setStoreId] = useState('CVS-001');
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [planogramData, setPlanogramData] = useState<any[]>([]);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [planogramId, setPlanogramId] = useState<string | undefined>(undefined);
  const [orderSource, setOrderSource] = useState<'planogram' | 'catalog'>('planogram');
  const [stores, setStores] = useState<StoreForUI[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryForUI[]>([]);

  useEffect(() => {
    categoriesApi.fetchAll().then(setAllCategories);
  }, []);

  useEffect(() => {
    const data = getOrderReviewPayload();
    if (data) {
      setStoreId(data.storeId || 'CVS-001');
      setStoreInfo(data.storeInfo ?? null);
      setPlanogramData(data.planogramData || []);
      setEditOrderId(data.editOrderId ?? null);
      setPlanogramId(data.planogramId);
      setOrderSource(data.source ?? 'planogram');
    }
  }, []);

  useEffect(() => {
    if (!editOrderId) return;
    let mounted = true;
    (async () => {
      const [list, order] = await Promise.all([
        storesApi.fetchStores(),
        ordersApi.getOrderById(editOrderId),
      ]);
      if (mounted) {
        setStores(list);
      }
    })();
    return () => { mounted = false; };
  }, [editOrderId]);

  const handleStoreChange = (newStoreId: string) => {
    setStoreId(newStoreId);
    const store = stores.find((s) => s.id === newStoreId);
    if (store) setStoreInfo(store);
  };

  // Filtrar solo los productos con cantidad mayor a 0 para mostrar
  const orderItems = planogramData.filter((item: any) => item.toOrder > 0);

  const totalUnits = orderItems.reduce((sum: number, item: any) => sum + item.toOrder, 0);
  const totalAmount = orderItems.reduce((sum: number, item: any) => sum + (item.toOrder * item.price), 0);
  const uniqueProducts = orderItems.length;

  const handleSendOrder = async () => {
    if (typeof window === 'undefined') return;
    setSending(true);
    setSendError(null);

    const subtotal = totalAmount;
    const tax = 0;
    const total = totalAmount;
    const orderPayload: CreateOrderInput = {
      storeId,
      storeName: storeInfo?.name || storeId,
      storeAddress: storeInfo ? `${storeInfo.address || ''}${storeInfo.city ? `, ${storeInfo.city}` : ''}` : '',
      salespersonId: user?.id,
      vendorNumber: '2F318',
      planogramId: orderSource === 'planogram' ? planogramId : undefined,
      items: orderItems.map((item: any) => ({
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        quantity: item.toOrder,
        price: item.price,
      })),
      subtotal,
      tax,
      total,
    };

    if (editOrderId) {
      const orderBeforeUpdate = await ordersApi.getOrderById(editOrderId);
      const invoiceIdHint = await ordersApi.getInvoiceIdForOrder(editOrderId);
      const updateResult = await ordersApi.updateOrder(editOrderId, orderPayload, invoiceIdHint ?? undefined);
      setSending(false);
      if (!updateResult.ok) {
        const msg = (updateResult.errorMessage || '').toLowerCase();
        setSendError(
          msg.includes('duplicate') || msg.includes('unique') || msg.includes('ya existe') || msg.includes('already exists')
            ? t('po_duplicate')
            : (updateResult.errorMessage || t('error_saving_order') || 'No se pudo guardar el pedido.')
        );
        return;
      }
      setSending(false);
      router.push(`/order/${editOrderId}?confirmed=1`);
      return;
    }

    const apiResult = await ordersApi.createOrder(orderPayload);
    const orderIdRaw = apiResult?.orderId;
    if (apiResult?.errorMessage) {
      const msg = apiResult.errorMessage.toLowerCase();
      setSendError(
        msg.includes('duplicate') || msg.includes('unique') || msg.includes('ya existe') || msg.includes('already exists')
          ? t('po_duplicate')
          : apiResult.errorMessage
      );
      setSending(false);
      return;
    }
    if (orderIdRaw == null || orderIdRaw === '' || String(orderIdRaw).toLowerCase() === 'unknown') {
      setSendError(t('error_saving_order') || 'No se pudo crear el pedido. Revisa la conexión e inténtalo de nuevo.');
      setSending(false);
      return;
    }

    const orderIdToUse = String(orderIdRaw);
    setSending(false);
    router.push(`/order/${orderIdToUse}?confirmed=1`);
  };

  const handleEditOrder = () => {
    setOrderReviewPayload({
      storeId,
      storeInfo,
      planogramData,
      editOrderId: editOrderId ?? undefined,
      source: orderSource,
    });
    if (orderSource === 'catalog') {
      router.push(`/catalog-order/${storeId}${editOrderId ? `?orderId=${editOrderId}` : ''}`);
    } else {
      router.push(`/planogram/${storeId}${editOrderId ? `?orderId=${editOrderId}` : ''}`);
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
            onClick={() => router.back()}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-slate-900">{t('order_review')}</h2>
            <p className="text-xs text-slate-500">{storeInfo?.name || storeId}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {sendError && (
          <Card className="mb-4 border-slate-200 overflow-visible shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm text-red-600">{sendError}</p>
            </CardContent>
          </Card>
        )}

        {/* Selector de tienda (solo en edición) */}
        {editOrderId && stores.length > 0 && (
          <Card className="mb-4 border-slate-200 overflow-visible shadow-sm">
            <CardContent className="p-4 overflow-visible">
              <label className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700">
                <StoreIcon className="h-4 w-4 text-slate-500" />
                {t('store')}
              </label>
              <div className="relative z-[1]">
                <Select value={storeId} onValueChange={handleStoreChange}>
                  <SelectTrigger className="h-11 w-full rounded-lg border-slate-200 bg-white shadow-sm hover:bg-slate-50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 text-slate-900">
                    <SelectValue placeholder={t('select_store')} />
                  </SelectTrigger>
                  <SelectContent
                    className="z-[100] min-w-[var(--radix-select-trigger-width)] max-h-[280px] rounded-lg border-slate-200 bg-white shadow-lg py-1"
                    position="popper"
                    sideOffset={4}
                  >
                    {stores.map((store) => (
                      <SelectItem
                        key={store.id}
                        value={store.id}
                        className="py-2.5 pl-3 pr-9 cursor-pointer rounded-md mx-1 text-left focus:bg-slate-100 data-[highlighted]:bg-slate-100"
                      >
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {storeInfo?.address && (
                <p className="text-xs text-slate-500 mt-2 pl-0.5">{storeInfo.address}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card className="border-slate-200">
            <CardContent className="p-3 text-center">
              <Package className="h-5 w-5 text-indigo-600 mx-auto mb-1" />
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
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <Package className="h-5 w-5 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-900 mb-1">{item.productName}</p>
                    <p className="text-xs text-slate-500 mb-2">{item.sku}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                        {item.toOrder} {t('units')}
                      </Badge>
                      <span className="text-slate-500">× ${item.price}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-900">${(item.toOrder * item.price).toFixed(2)}</p>
                    {item.row != null && item.col != null && (
                      <p className="text-xs text-slate-500 mt-1">
                        {t('position')}: {item.row},{item.col}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Resumen por categoría: todas las registradas, con Pcs (0 o suma del pedido) */}
          {allCategories.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-200 text-slate-800">
                    <th className="text-left py-2 px-4 font-semibold">{t('family_col') || 'Family'}</th>
                    <th className="text-right py-2 px-4 font-semibold w-16">{t('pcs_col') || 'Pcs'}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...allCategories]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((cat) => {
                      const pcs = orderItems.reduce(
                        (sum: number, item: any) =>
                          (item.category || '').trim() === cat.name ? sum + item.toOrder : sum,
                        0
                      );
                      return (
                        <tr key={cat.id} className="border-t border-slate-200 bg-white">
                          <td className="py-2 px-4 text-slate-900">{cat.name}</td>
                          <td className="py-2 px-4 text-right font-medium text-slate-800">{pcs}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Total Card (sin impuestos) */}
        <Card className="border-green-200 bg-green-50 mb-20">
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{t('subtotal')}</span>
                <span className="text-slate-900">${totalAmount.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-slate-900">{t('total')}</span>
                <span className="text-xl text-green-900">${totalAmount.toFixed(2)}</span>
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
            disabled={sending || orderItems.length === 0}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {sending ? (
              <span className="flex items-center gap-2">{t('loading')}...</span>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {editOrderId ? t('save_changes') : t('send_order')}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
