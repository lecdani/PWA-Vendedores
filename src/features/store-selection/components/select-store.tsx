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
import { citiesApi } from '@/shared/api/cities-api';
import { assignmentsApi } from '@/shared/api/assignments-api';
import { useAuth } from '@/shared/auth/auth-provider';

export function SelectStore() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [stores, setStores] = useState<StoreForUI[]>([]);
  const [cityNames, setCityNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      const [apiStores, allAssignments] = await Promise.all([
        storesApi.fetchStores(),
        assignmentsApi.fetchAll(),
      ]);
      if (!mounted) return;
      const uid = String(user?.id ?? '').trim();
      if (uid) {
        const allowedStoreIds = new Set(
          allAssignments
            .filter((a) => String(a.salespersonId) === uid)
            .map((a) => String(a.storeId))
        );
        setStores(apiStores.filter((s) => allowedStoreIds.has(String(s.id))));
      } else {
        setStores(apiStores);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const ids = stores
      .map((s) => (s.city || '').trim())
      .filter((c) => c && citiesApi.looksLikeCityId(c));
    if (ids.length === 0) return;
    let mounted = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const id of [...new Set(ids)]) {
        if (!mounted) break;
        const name = await citiesApi.getCityNameById(id);
        if (mounted && name) next[id] = name;
      }
      if (mounted) setCityNames((prev) => ({ ...prev, ...next }));
    })();
    return () => { mounted = false; };
  }, [stores]);

  const getDisplayCity = (store: StoreForUI) =>
    (store.city && citiesApi.looksLikeCityId(store.city))
      ? (cityNames[store.city] ?? '')
      : (store.city || '');

  const filteredStores = stores.filter(store => {
    const displayCity = getDisplayCity(store);
    return (
      store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (store.address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      displayCity.toLowerCase().includes(searchQuery.toLowerCase()) ||
      store.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const handleSelectStore = (store: StoreForUI) => {
    if (store.hasPlanogram === false) {
      router.push(`/catalog-order/${store.id}`);
    } else {
      router.push(`/planogram/${store.id}`);
    }
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
              className="border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer active:scale-98"
              onClick={() => handleSelectStore(store)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-indigo-50 rounded-lg flex-shrink-0">
                    <Store className="h-5 w-5 text-indigo-600" />
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
                    
                    {(() => {
                      const cityDisplay = getDisplayCity(store) || (store.city && !citiesApi.looksLikeCityId(store.city) ? store.city : '');
                      const ubicacion = [store.address, cityDisplay].filter(Boolean).join(', ');
                      return ubicacion ? (
                        <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span>{t('location')}: {ubicacion}</span>
                        </div>
                      ) : null;
                    })()}
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
