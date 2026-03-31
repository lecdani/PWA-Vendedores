'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, ShoppingCart, DollarSign, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, CreateOrderInput } from '@/shared/api/orders-api';
import { createOrderResilient, updateOrderResilient } from '@/shared/offline/offline-orders';
import { storesApi, StoreForUI } from '@/shared/api/stores-api';
import { assignmentsApi } from '@/shared/api/assignments-api';
import { getOrderReviewPayload } from '@/shared/order-review-payload';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { orderItemMatchesFamily } from '@/shared/utils/order-item-matches-family';
import { FamilySummaryCell } from '@/shared/components/family-summary-cell';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';
import { Badge } from '@/shared/ui/badge';
import { assignmentBelongsToSeller } from '@/shared/utils/assignment-match';

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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryForUI[]>([]);
  const [editableStores, setEditableStores] = useState<StoreForUI[]>([]);
  const [productImageError, setProductImageError] = useState<Record<string, boolean>>({});
  const hasRecentOfflineHint = () => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.sessionStorage.getItem('app_offline_hint');
      if (!raw) return false;
      const ts = Number(raw);
      if (Number.isFinite(ts) && ts > 0) return Date.now() - ts < 10_000;
      return raw === '1';
    } catch {
      return false;
    }
  };

  useEffect(() => {
    categoriesApi.fetchAll().then(setAllCategories);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!editOrderId) {
        if (mounted) setEditableStores([]);
        return;
      }
      const [apiStores, allAssignments] = await Promise.all([
        storesApi.fetchStores(),
        assignmentsApi.fetchAll(),
      ]);
      if (!mounted) return;

      const u = user;
      let allowedStores = apiStores;
      if (u && (String(u.id).trim() || String(u.salesRouteId ?? '').trim())) {
        const allowedStoreIds = new Set(
          allAssignments.filter((a) => assignmentBelongsToSeller(a, u)).map((a) => String(a.storeId))
        );
        allowedStores = apiStores.filter((s) => allowedStoreIds.has(String(s.id)));
      }
      if (storeId && !allowedStores.some((s) => String(s.id) === String(storeId))) {
        const currentStore = apiStores.find((s) => String(s.id) === String(storeId));
        if (currentStore) allowedStores = [currentStore, ...allowedStores];
      }
      setEditableStores(allowedStores);
    })();

    return () => {
      mounted = false;
    };
  }, [editOrderId, user?.id, user?.salesRouteId, storeId]);

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
      salesRouteId: user?.salesRouteId,
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
      const shouldSkipDetailFetch =
        (typeof navigator !== 'undefined' && !navigator.onLine) || hasRecentOfflineHint();
      const detailsRaw = shouldSkipDetailFetch
        ? []
        : await ordersApi.getOrderDetailsByOrderIdRaw(editOrderId);
      const detailsByProduct = new Map<string, Array<{ orderDetailId?: string; row?: number; col?: number }>>();
      (detailsRaw || []).forEach((d: any) => {
        const pid = String(d?.productId ?? d?.ProductId ?? '').trim();
        if (!pid) return;
        const arr = detailsByProduct.get(pid) ?? [];
        arr.push({
          orderDetailId: String(d?.orderDetailId ?? d?.OrderDetailId ?? d?.id ?? d?.Id ?? '').trim() || undefined,
          row: d?.row ?? d?.Row ?? d?.xPosition ?? d?.XPosition,
          col: d?.col ?? d?.Col ?? d?.yPosition ?? d?.YPosition,
        });
        detailsByProduct.set(pid, arr);
      });

      const payloadForUpdate: CreateOrderInput = {
        ...orderPayload,
        items: orderItems.map((item: any) => {
          const pid = String(item.productId || '').trim();
          const arr = detailsByProduct.get(pid) ?? [];
          let foundIndex = arr.findIndex(
            (r) => Number(r?.row) === Number(item?.row) && Number(r?.col) === Number(item?.col)
          );
          if (foundIndex < 0) foundIndex = 0;
          const picked = foundIndex >= 0 ? arr.splice(foundIndex, 1)[0] : undefined;
          return {
            productId: item.productId,
            sku: item.sku,
            productName: item.productName,
            quantity: item.toOrder,
            price: item.price,
            orderDetailId: picked?.orderDetailId,
          };
        }),
      };

      const upd = await updateOrderResilient(editOrderId, payloadForUpdate);
      if (!upd.ok) {
        setSendError(upd.errorMessage || (t('error_saving_order') || 'No se pudo actualizar el pedido.'));
        setSending(false);
        return;
      }

      try {
        const cellRows = orderItems
          .filter((i: any) => i && Number(i.toOrder) > 0 && i.row != null && i.col != null)
          .map((i: any) => ({
            row: Number(i.row),
            col: Number(i.col),
            quantity: Number(i.toOrder) || 0,
          }))
          .filter((x: any) => Number.isFinite(x.row) && Number.isFinite(x.col) && x.quantity > 0);
        if (cellRows.length > 0) {
          window.localStorage.setItem(`order_planogram_cells_${editOrderId}`, JSON.stringify(cellRows));
        }
      } catch {
        // ignore
      }

      setSending(false);
      router.push(`/order/${editOrderId}`);
      return;
    }

    const apiResult = await createOrderResilient(orderPayload);
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

    // Guardar mapa por celda (row-col) para evitar duplicación en planogramas con productos repetidos.
    try {
      const cellRows = orderItems
        .filter((i: any) => i && Number(i.toOrder) > 0 && i.row != null && i.col != null)
        .map((i: any) => ({
          row: Number(i.row),
          col: Number(i.col),
          quantity: Number(i.toOrder) || 0,
        }))
        .filter((x: any) => Number.isFinite(x.row) && Number.isFinite(x.col) && x.quantity > 0);
      if (cellRows.length > 0) {
        window.localStorage.setItem(`order_planogram_cells_${orderIdToUse}`, JSON.stringify(cellRows));
      }
    } catch {
      // ignore
    }

    setSending(false);
    router.push(`/order/${orderIdToUse}`);
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

        {editOrderId && (
          <Card className="mb-4 border-slate-200">
            <CardContent className="p-4">
              <div className="space-y-2">
                <label className="text-xs text-slate-600">Tienda del pedido</label>
                <select
                  value={storeId}
                  onChange={(e) => {
                    const nextId = String(e.target.value || '').trim();
                    setStoreId(nextId);
                    const selected = editableStores.find((s) => String(s.id) === nextId);
                    if (selected) setStoreInfo(selected);
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                >
                  {editableStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
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
              <div key={item.productId ? `${item.productId}-${index}` : index} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {item.imageUrl && !productImageError[String(item.productId ?? index)] ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-10 h-10 rounded object-cover flex-shrink-0"
                      onError={() => {
                        if (typeof navigator !== 'undefined' && !navigator.onLine) {
                          setProductImageError((prev) => ({
                            ...prev,
                            [String(item.productId ?? index)]: true,
                          }));
                        }
                      }}
                    />
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
                      const pcs = orderItems.reduce(
                        (sum: number, item: any) =>
                          orderItemMatchesFamily(item, cat, allCategories) ? sum + item.toOrder : sum,
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
            onClick={handleSendOrder}
            disabled={sending || orderItems.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            {sending ? (
              <span className="flex items-center gap-2">{t('loading')}...</span>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {t('send_order')}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
