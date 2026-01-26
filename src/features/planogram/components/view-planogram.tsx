'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Grid3x3, Package } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';

interface ProductPosition {
  row: number;
  col: number;
  productId: string;
  productName: string;
  sku: string;
  toOrder: number;
  price: number;
}

export function ViewPlanogram({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Obtener el pedido desde localStorage
      const orders = JSON.parse(localStorage.getItem('orders') || '[]');
      const foundOrder = orders.find((o: any) => o.id === orderId);
      setOrder(foundOrder || null);
    }
  }, [orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">{t('no_orders_found')}</p>
          <Button onClick={() => router.push('/history')}>
            {t('order_history')}
          </Button>
        </div>
      </div>
    );
  }

  // Crear un grid 10x10 y mapear los productos del pedido
  const createPlanogramGrid = (): ProductPosition[][] => {
    const grid: ProductPosition[][] = [];
    
    // Inicializar grid 10x10 vacío
    for (let row = 0; row < 10; row++) {
      grid[row] = [];
      for (let col = 0; col < 10; col++) {
        grid[row][col] = {
          row,
          col,
          productId: '',
          productName: '',
          sku: '',
          toOrder: 0,
          price: 0
        };
      }
    }

    // Llenar con los productos del pedido
    order.items.forEach((item: any) => {
      const row = item.row;
      const col = item.col;
      if (row >= 0 && row < 10 && col >= 0 && col < 10) {
        grid[row][col] = {
          row,
          col,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          toOrder: item.toOrder || item.quantity || 0,
          price: item.price
        };
      }
    });

    return grid;
  };

  const planogramGrid = createPlanogramGrid();
  const flatGrid = planogramGrid.flat();
  
  const totalToOrder = order.items.reduce((sum: number, item: any) => sum + (item.toOrder || item.quantity || 0), 0);
  const totalValue = order.total;
  const uniqueProducts = order.items.length;

  const getCellColor = (toOrder: number) => {
    if (toOrder === 0) return 'bg-slate-100 border-slate-200';
    if (toOrder > 0) return 'bg-blue-50 border-blue-300';
    return 'bg-slate-100 border-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/order/${orderId}`)}
              className="p-2 h-auto"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{t('planogram')}</h2>
              <p className="text-xs text-slate-500">{order.id}</p>
            </div>
          </div>
          
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {t('view_only')}
          </Badge>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">{uniqueProducts}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center">
            <p className="text-xs text-blue-600 mb-0.5">{t('units')}</p>
            <p className="text-sm text-blue-900">{totalToOrder}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <p className="text-xs text-green-600 mb-0.5">{t('total')}</p>
            <p className="text-sm text-green-900">${totalValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Planogram Grid */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Grid3x3 className="h-4 w-4 text-slate-600" />
          <p className="text-sm text-slate-600">{t('planogram_view_only')}</p>
        </div>

        {/* 10x10 Grid */}
        <div className="bg-white rounded-lg p-2 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="grid grid-cols-10 gap-1 min-w-[600px]">
            {flatGrid.map((item) => (
              <div
                key={`${item.row}-${item.col}`}
                className={`aspect-square rounded border-2 ${getCellColor(item.toOrder)} relative`}
              >
                {/* Row/Col indicator */}
                <div className="absolute top-0 left-0 text-[8px] text-slate-400 px-0.5">
                  {item.row},{item.col}
                </div>
                
                {/* Product indicator */}
                {item.toOrder > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-xs font-semibold text-blue-900">
                      {item.toOrder}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-slate-100 border-2 border-slate-200"></div>
            <span className="text-slate-600">{t('no_quantity')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-blue-50 border-2 border-blue-300"></div>
            <span className="text-slate-600">{t('with_quantity')}</span>
          </div>
        </div>

        {/* Products List */}
        <Card className="mt-4 border-slate-200">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-slate-900 text-sm">{t('order_items')}</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {order.items.map((item: any, index: number) => {
              const quantity = item.toOrder || item.quantity || 0;
              return (
                <div key={index} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 mb-0.5">{item.productName}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{item.sku}</span>
                        <span>•</span>
                        <span>Pos: {item.row},{item.col}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs mb-1">
                        {quantity} {t('units')}
                      </Badge>
                      <p className="text-xs text-slate-900">${(quantity * item.price).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
