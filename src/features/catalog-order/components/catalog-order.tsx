'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2, Package, Search, Minus, Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Card, CardContent } from '@/shared/ui/card';
import { productsApi, getProductImageUrl, ProductForUI } from '@/shared/api/products-api';
import { categoriesApi, CategoryForUI } from '@/shared/api/categories-api';
import { histpricesApi } from '@/shared/api/histprices-api';
import { ordersApi } from '@/shared/api/orders-api';
import { storesApi } from '@/shared/api/stores-api';
import { setOrderReviewPayload } from '@/shared/order-review-payload';

/** Item con cantidad para el pedido (misma forma que planogramData para order-review). */
export interface CatalogOrderItem {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  /** Id de familia para resumen por categoría (evita mezclar por nombre duplicado en API). */
  familyId?: string;
  toOrder: number;
  price: number;
  imageUrl?: string;
  row?: number;
  col?: number;
}

interface ProductWithQty extends ProductForUI {
  toOrder: number;
  price: number;
  imageUrl?: string;
  categoryName: string;
}

export function CatalogOrder({ storeId, orderId }: { storeId: string; orderId?: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [storeInfo, setStoreInfo] = useState<{ id: string; name: string; address?: string } | null>(null);
  const [productsWithQty, setProductsWithQty] = useState<ProductWithQty[]>([]);
  const [categories, setCategories] = useState<CategoryForUI[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all');
  const [showOnlyWithQty, setShowOnlyWithQty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (storeId) {
      storesApi.fetchStoreById(storeId).then((store) => {
        if (store) setStoreInfo({ id: store.id, name: store.name, address: store.address });
      });
    }
  }, [storeId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [products, cats] = await Promise.all([
          productsApi.fetchAll(),
          categoriesApi.fetchAll(),
        ]);

        if (!mounted) return;

        const activeProducts = products.filter((p) => p.isActive);
        const categoryById = new Map<string, string>();
        cats.forEach((c) => {
          categoryById.set(c.id, c.name);
          if (c.id && !Number.isNaN(Number(c.id))) categoryById.set(String(Number(c.id)), c.name);
        });

        const getCategoryName = (p: ProductForUI): string => {
          const id = String(p.familyId ?? p.categoryId ?? '').trim();
          if (id) {
            const fromList = categoryById.get(id) ?? categoryById.get(String(Number(id)));
            if (fromList) return fromList;
          }
          const name = (p.category || '').trim();
          return name;
        };

        const uniqueFamilyIds = [...new Set(activeProducts.map((p) => String(p.familyId ?? p.categoryId ?? '').trim()).filter(Boolean))];
        const priceResults = await Promise.all(
          uniqueFamilyIds.map(async (id) => ({ id, price: await histpricesApi.getLatest(id) }))
        );
        const priceMap = new Map(priceResults.map((r) => [r.id, r.price]));

        let withQty: ProductWithQty[] = activeProducts.map((p) => {
          const familyId = String(p.familyId ?? p.categoryId ?? '').trim();
          const price = (familyId ? priceMap.get(familyId) : undefined) ?? p.currentPrice ?? 0;
          return {
            ...p,
            toOrder: 0,
            price,
            imageUrl: getProductImageUrl(p) || undefined,
            categoryName: getCategoryName(p),
          };
        });

        if (orderId && mounted) {
          const details = await ordersApi.getOrderDetailsByOrderIdRaw(orderId);
          const qtyByProduct = new Map<string, number>();
          details.forEach((d: any) => {
            const pid = String(d?.productId ?? d?.ProductId ?? '').trim();
            const qty = Number(d?.quantity ?? d?.Quantity ?? 0);
            if (pid) qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + qty);
          });
          withQty = withQty.map((p) => {
            const qty = qtyByProduct.get(p.id) ?? qtyByProduct.get(String(Number(p.id))) ?? 0;
            return { ...p, toOrder: qty };
          });
        }

        if (mounted) setProductsWithQty(withQty);
        if (mounted) setCategories(cats);
      } catch (e) {
        if (mounted) setLoadError((e as Error)?.message ?? 'Error al cargar catálogo');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [storeId, orderId]);

  const setQuantity = (productId: string, delta: number) => {
    setProductsWithQty((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        const next = Math.max(0, p.toOrder + delta);
        return { ...p, toOrder: next };
      })
    );
  };

  const setQuantityAbsolute = (productId: string, value: number) => {
    const raw = Number(value) || 0;
    const next = Math.max(0, Math.floor(raw));
    setProductsWithQty((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, toOrder: next } : p))
    );
  };

  const filteredProducts = productsWithQty.filter((p) => {
    if (selectedCategoryId !== 'all' && p.categoryId && String(p.categoryId) !== selectedCategoryId) {
      return false;
    }
    if (showOnlyWithQty && p.toOrder <= 0) {
      return false;
    }
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.categoryName || '').toLowerCase().includes(q)
    );
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const aSku = (a.code || a.sku || '').toString().toLowerCase();
    const bSku = (b.code || b.sku || '').toString().toLowerCase();
    if (aSku && bSku && aSku !== bSku) return aSku.localeCompare(bSku);
    const aName = (a.name || '').toString().toLowerCase();
    const bName = (b.name || '').toString().toLowerCase();
    return aName.localeCompare(bName);
  });

  // Siempre mostrar un grid 10x10 (100 celdas) con paginación cuando haya más productos
  const PAGE_SIZE = 100;
  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageProducts = sortedProducts.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE
  );
  const filledPageProducts: (ProductWithQty | null)[] =
    pageProducts.length < PAGE_SIZE
      ? [...pageProducts, ...Array(PAGE_SIZE - pageProducts.length).fill(null)]
      : pageProducts;

  const totalToOrder = productsWithQty.reduce((sum, p) => sum + p.toOrder, 0);
  const totalValue = productsWithQty.reduce((sum, p) => sum + p.toOrder * p.price, 0);

  const handleReviewOrder = () => {
    const planogramData: CatalogOrderItem[] = productsWithQty
      .filter((p) => p.toOrder > 0)
      .map((p) => ({
        productId: p.id,
        productName: p.name || '',
        sku: p.code || p.sku || '',
        category: p.categoryName || '',
        familyId: String(p.familyId ?? p.categoryId ?? '').trim() || undefined,
        toOrder: p.toOrder,
        price: p.price,
        imageUrl: p.imageUrl,
      }));
    setOrderReviewPayload({
      storeId,
      storeInfo: storeInfo ?? undefined,
      planogramData,
      editOrderId: orderId ?? undefined,
      source: 'catalog',
    });
    router.push('/order-review');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm text-slate-600">{t('loading')}...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 mb-4">{loadError}</p>
          <Button variant="outline" onClick={() => router.push('/select-store')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/select-store')}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-slate-900 text-sm">{storeInfo?.name ?? t('product_catalog')}</h2>
            <p className="text-xs text-slate-500">{t('catalog_order_subtitle')}</p>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={t('search_product')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-10 bg-slate-50 border-slate-200"
          />
        </div>

        {/* Filtros rápidos */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3 py-1.5 rounded-full text-xs border ${
              selectedCategoryId === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {t('all_categories') ?? 'Todas'}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategoryId(String(cat.id))}
              className={`px-3 py-1.5 rounded-full text-xs border truncate max-w-[120px] ${
                selectedCategoryId === String(cat.id)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowOnlyWithQty((prev) => !prev)}
            className={`ml-auto px-3 py-1.5 rounded-full text-xs border flex items-center gap-1 ${
              showOnlyWithQty
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <span>{t('only_with_quantity') ?? 'Solo con cantidad'}</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{filteredProducts.length}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-2 text-center">
            <p className="text-xs text-indigo-600 mb-0.5">{t('units')}</p>
            <p className="text-sm text-indigo-900">{totalToOrder}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <p className="text-xs text-green-600 mb-0.5">{t('total')}</p>
            <p className="text-sm text-green-900">${totalValue.toFixed(2)}</p>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span>
              {t('page') ?? 'Página'} {currentPage + 1} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {'<'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                {'>'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Product grid como matriz (similar a planograma) */}
      <div className="px-4 py-4 pb-28">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 overflow-x-auto flex justify-start md:justify-center">
          <div className="inline-grid grid-cols-10 gap-2 w-[960px] flex-none">
            {filledPageProducts.map((product, index) =>
              product ? (
              <div
                key={product.id}
                className="aspect-square min-w-[64px] min-h-[64px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors flex flex-col items-center justify-center p-1.5 text-center"
              >
                <div className="flex items-center justify-center gap-1 w-full mb-0.5">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="w-5 h-5 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <Package className="h-2.5 w-2.5 text-slate-500" />
                    </div>
                  )}
                  <span
                    className="text-[9px] leading-tight font-semibold text-slate-900 truncate max-w-[42px]"
                    title={product.code || product.sku}
                  >
                    {product.code || product.sku || '—'}
                  </span>
                </div>
                <span
                  className="text-[8px] leading-tight font-medium text-slate-600 break-words line-clamp-2 w-full"
                  title={product.name}
                >
                  {product.name || ''}
                </span>
                <span className="text-[8px] text-indigo-600 mt-0.5">
                  ${product.price.toFixed(2)}
                </span>
                <div className="mt-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setQuantity(product.id, -1)}
                    className="w-4 h-4 rounded bg-white/80 border border-slate-200 text-slate-700 text-[10px] font-semibold leading-none"
                    aria-label="Disminuir"
                    disabled={product.toOrder <= 0}
                  >
                    −
                  </button>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={product.toOrder}
                    onChange={(e) => setQuantityAbsolute(product.id, e.target.value)}
                    className="w-[28px] h-4 rounded bg-white/80 border border-slate-200 text-[10px] text-slate-900 font-semibold tabular-nums text-center px-0.5"
                    aria-label="Cantidad"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(product.id, 1)}
                    className="w-4 h-4 rounded bg-white/80 border border-slate-200 text-slate-700 text-[10px] font-semibold leading-none"
                    aria-label="Aumentar"
                  >
                    +
                  </button>
                </div>
              </div>
              ) : (
                <div
                  key={`empty-${index}`}
                  className="aspect-square min-w-[64px] min-h-[64px] rounded-lg border border-transparent bg-transparent"
                />
              )
            )}
          </div>
        </div>

        {sortedProducts.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            {searchTerm.trim() ? t('no_stores_found') : t('no_products_in_planogram')}
          </div>
        )}
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="flex gap-3 max-w-2xl mx-auto">
          <Button
            onClick={handleReviewOrder}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            disabled={totalToOrder === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {t('review_order')}
          </Button>
        </div>
      </div>
    </div>
  );
}
