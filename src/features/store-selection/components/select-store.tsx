'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Search, ChevronRight, MapPin, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { storesApi, StoreForUI } from '@/shared/api/stores-api';

export function SelectStore() {
  const { t } = useLanguage();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [stores, setStores] = useState<StoreForUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      const apiStores = await storesApi.fetchStores();
      if (!mounted) return;
      setStores(apiStores);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredStores = stores.filter(store =>
    store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    store.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    store.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectStore = (storeId: string) => {
    router.push(`/planogram/${storeId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/')}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-slate-900">{t('select_store')}</h2>
            <p className="text-sm text-slate-500">{t('select_store_subtitle')}</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={t('search_store')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 bg-slate-50 border-slate-200"
          />
        </div>
      </div>

      {/* Store List */}
      <div className="px-4 py-4">
        {loading ? (
          <p className="text-xs text-slate-500 mb-3">{t('loading')}...</p>
        ) : error ? (
          <p className="text-xs text-red-600 mb-3">{error}</p>
        ) : (
          <p className="text-xs text-slate-500 mb-3">
            {filteredStores.length} {t('stores_found')}
          </p>
        )}

        <div className="space-y-3">
          {filteredStores.map((store) => (
            <Card
              key={store.id}
              className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer active:scale-98"
              onClick={() => handleSelectStore(store.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-50 rounded-lg flex-shrink-0">
                    <Store className="h-5 w-5 text-blue-600" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="text-sm text-slate-900 mb-0.5">{store.name}</p>
                      </div>
                      <Badge 
                        variant="outline" 
                        className="bg-green-50 text-green-700 border-green-200 flex-shrink-0"
                      >
                        {t('active')}
                      </Badge>
                    </div>
                    
                    {store.address && (
                      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                        <MapPin className="h-3 w-3" />
                        <span>{store.address}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <span>{t('last_visit')}:</span>
                      <span>{new Date(store.lastVisit).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredStores.length === 0 && (
          <div className="text-center py-12">
            <div className="p-4 bg-slate-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Store className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-slate-600 mb-1">{t('no_stores_found')}</p>
            <p className="text-sm text-slate-500">{t('try_different_search')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
