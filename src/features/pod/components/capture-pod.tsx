'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Camera, Upload, CheckCircle, X, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Textarea } from '@/shared/ui/textarea';
import { Label } from '@/shared/ui/label';

export function CapturePOD({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [podImage, setPodImage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);

  // Obtener datos del pedido desde localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const orders = JSON.parse(localStorage.getItem('orders') || '[]');
      const order = orders.find((o: any) => o.id === orderId);
      setOrderData(order || null);
    }
  }, [orderId]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
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
  };

  const handleSubmit = async () => {
    if (!podImage) {
      alert(t('pod_image_required'));
      return;
    }

    setUploading(true);
    
    // Simular subida
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        // Actualizar el pedido en localStorage
        const orders = JSON.parse(localStorage.getItem('orders') || '[]');
        const orderIndex = orders.findIndex((o: any) => o.id === orderId);
        
        if (orderIndex !== -1) {
          // Actualizar el pedido existente
          orders[orderIndex] = {
            ...orders[orderIndex],
            status: 'completed',
            podUploaded: true,
            podImageUrl: podImage,
            comments: notes,
            completedDate: new Date().toISOString()
          };
          
          // Guardar en localStorage
          localStorage.setItem('orders', JSON.stringify(orders));
        }
        
        setUploading(false);
        
        // Navegar al detalle del pedido actualizado
        router.push(`/order/${orderId}`);
      }
    }, 2000);
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
            <p className="text-xs text-slate-500">{orderId}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* Instructions */}
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Camera className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-blue-900 mb-1">{t('pod_instructions_title')}</p>
                <p className="text-xs text-blue-700">{t('pod_instructions')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Image Capture Area */}
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
                    className="bg-blue-600 hover:bg-blue-700"
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
                <div className="relative w-full aspect-video rounded-lg border border-slate-200 overflow-hidden">
                  <Image 
                    src={podImage} 
                    alt="POD" 
                    fill
                    className="object-contain"
                    unoptimized
                  />
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
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
            />
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="mb-4 border-slate-200">
          <CardContent className="p-4">
            <Label className="text-sm text-slate-700 mb-2 block">{t('additional_notes')}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notes_placeholder')}
              className="min-h-24 resize-none"
            />
          </CardContent>
        </Card>

        {/* Order Info */}
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
                    <span className="text-slate-900">{orderData.storeName || orderData.storeId}</span>
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
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('units')}:</span>
                    <span className="text-slate-900">{orderData.totalUnits || orderData.items?.reduce((sum: number, item: any) => sum + (item.toOrder || 0), 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('total')}:</span>
                    <span className="text-slate-900 font-semibold">${orderData.total.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Button */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <Button
          onClick={handleSubmit}
          disabled={!podImage || uploading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-300"
        >
          {uploading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {t('uploading')}...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              {t('complete_delivery')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
