'use client';

import { useState, useEffect } from 'react';
import { X, Package, Minus, Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

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

interface ProductModalProps {
  open: boolean;
  onClose: () => void;
  position: ProductPosition;
  onUpdate: (currentStock: number, toOrder: number) => void;
}

export function ProductModal({ open, onClose, position, onUpdate }: ProductModalProps) {
  const { t } = useLanguage();
  const [toOrder, setToOrder] = useState(position.toOrder);

  useEffect(() => {
    setToOrder(position.toOrder);
  }, [position]);

  const handleSave = () => {
    onUpdate(0, toOrder);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="text-slate-900">{t('product_details')}</h3>
            <p className="text-xs text-slate-500">
              {t('position')}: {position.row},{position.col}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="p-2 h-auto">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Product Info */}
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-slate-900 mb-1">{position.productName}</p>
                <p className="text-xs text-slate-600 mb-2">{position.sku}</p>
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-slate-500">{t('price')}: </span>
                    <span className="text-slate-900">${position.price}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quantity Input */}
          <div>
            <Label className="text-sm text-slate-700 mb-2">{t('quantity_to_order')}</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToOrder(Math.max(0, toOrder - 1))}
                className="h-10 w-10 p-0"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                value={toOrder}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  setToOrder(Math.max(0, val));
                }}
                className="text-center h-10 bg-blue-50 border-blue-200"
                min="0"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToOrder(toOrder + 1)}
                className="h-10 w-10 p-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Subtotal */}
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-700">{t('subtotal')}</span>
              <span className="text-lg text-green-900">${(toOrder * position.price).toFixed(2)}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
