'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Grid3x3 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { ProductModal } from './product-modal';

interface ProductPosition {
  row: number;
  col: number;
  productId: string;
  productName: string;
  sku: string;
  idealStock: number;
  currentStock: number;
  toOrder: number;
  price: number;
}

export function Planogram({ storeId }: { storeId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [selectedPosition, setSelectedPosition] = useState<ProductPosition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [storeInfo, setStoreInfo] = useState<any>(null);

  // Mock planogram data 10x10
  const [planogramData, setPlanogramData] = useState<ProductPosition[]>(() => {
    const data: ProductPosition[] = [];
    const products = [
      { id: 'LIP-001', name: 'Eternal Matte Lipstick', price: 24.99, ideal: 6 },
      { id: 'LIP-002', name: 'Velvet Lip Gloss', price: 19.99, ideal: 8 },
      { id: 'EYE-001', name: 'HD Eyeshadow Palette', price: 45.99, ideal: 4 },
      { id: 'EYE-002', name: 'Precision Eyeliner', price: 16.99, ideal: 10 },
      { id: 'FAC-001', name: 'Foundation Perfect Match', price: 38.99, ideal: 5 },
      { id: 'FAC-002', name: 'HD Powder', price: 28.99, ideal: 6 },
      { id: 'BLU-001', name: 'Natural Blush', price: 22.99, ideal: 7 },
      { id: 'MAS-001', name: 'Volume Mascara', price: 21.99, ideal: 9 },
    ];

    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const product = products[Math.floor(Math.random() * products.length)];
        data.push({
          row,
          col,
          productId: product.id,
          productName: product.name,
          sku: `SKU-${product.id}`,
          idealStock: product.ideal,
          currentStock: 0,
          toOrder: 0,
          price: product.price
        });
      }
    }
    return data;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Obtener información de la tienda del sessionStorage
      const storedData = sessionStorage.getItem('storeInfo');
      if (storedData) {
        setStoreInfo(JSON.parse(storedData));
      }

      // Obtener datos del planograma guardados
      const savedData = sessionStorage.getItem('planogramData');
      if (savedData) {
        const data = JSON.parse(savedData);
        if (data.planogramData) {
          setPlanogramData(data.planogramData);
        }
        if (data.storeInfo) {
          setStoreInfo(data.storeInfo);
        }
      }
    }
  }, []);

  const handleCellClick = (position: ProductPosition) => {
    setSelectedPosition(position);
    setModalOpen(true);
  };

  const handleUpdatePosition = (currentStock: number, toOrder: number) => {
    if (selectedPosition) {
      setPlanogramData(prev =>
        prev.map(item =>
          item.row === selectedPosition.row && item.col === selectedPosition.col
            ? { ...item, currentStock, toOrder }
            : item
        )
      );
    }
    setModalOpen(false);
  };

  const totalToOrder = planogramData.reduce((sum, item) => sum + item.toOrder, 0);
  const totalValue = planogramData.reduce((sum, item) => sum + (item.toOrder * item.price), 0);
  const completedCount = planogramData.filter(item => item.currentStock > 0).length;
  const progressPercent = Math.round((completedCount / planogramData.length) * 100);

  const getCellColor = (item: ProductPosition) => {
    if (item.toOrder === 0) return 'bg-slate-100 border-slate-200';
    if (item.toOrder > 0) return 'bg-blue-50 border-blue-300';
    return 'bg-slate-100 border-slate-200';
  };

  const handleSendOrder = () => {
    if (typeof window !== 'undefined') {
      // Guardar datos en sessionStorage para OrderReview
      sessionStorage.setItem('orderReviewData', JSON.stringify({
        storeId,
        storeInfo,
        planogramData: planogramData
      }));
    }
    router.push('/order-review');
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
              onClick={() => router.push('/select-store')}
              className="p-2 h-auto"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-slate-900 text-sm">{t('product_organization')}</h2>
              <p className="text-xs text-slate-500">{storeId}</p>
            </div>
          </div>
          
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {progressPercent}% {t('completed')}
          </Badge>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">{t('products')}</p>
            <p className="text-sm text-slate-900">100</p>
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
          <p className="text-sm text-slate-600">{t('tap_position_to_count')}</p>
        </div>

        {/* 10x10 Grid */}
        <div className="bg-white rounded-lg p-2 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="grid grid-cols-10 gap-1 min-w-[600px]">
            {planogramData.map((item) => (
              <button
                key={`${item.row}-${item.col}`}
                onClick={() => handleCellClick(item)}
                className={`aspect-square rounded border-2 ${getCellColor(item)} hover:scale-105 transition-transform relative`}
              >
                {/* Row/Col indicator */}
                <div className="absolute top-0 left-0 text-[8px] text-slate-400 px-0.5">
                  {item.row},{item.col}
                </div>
                
                {/* Product indicator */}
                {item.toOrder > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-xs font-semibold">
                      {item.toOrder}
                    </div>
                  </div>
                )}
              </button>
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
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="flex gap-3 max-w-2xl mx-auto">
          <Button
            onClick={handleSendOrder}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={totalToOrder === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {t('review_order')}
          </Button>
        </div>
      </div>

      {/* Product Modal */}
      {selectedPosition && (
        <ProductModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          position={selectedPosition}
          onUpdate={handleUpdatePosition}
        />
      )}
    </div>
  );
}
