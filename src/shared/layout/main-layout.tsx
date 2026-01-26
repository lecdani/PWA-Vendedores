'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, ShoppingCart, BarChart3, User, Bell } from 'lucide-react';
import { LanguageSelector } from '@/shared/i18n/language-selector';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Badge } from '@/shared/ui/badge';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();

  const getActiveTab = () => {
    if (pathname === '/') return 'home';
    if (pathname?.includes('/history') || pathname?.includes('/order')) return 'orders';
    if (pathname?.includes('/pending-pod')) return 'stats';
    if (pathname?.includes('/profile')) return 'profile';
    return 'home';
  };

  const activeTab = getActiveTab();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-sm">
                <ShoppingCart className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-slate-900 text-sm">Eternal Cosmetics</p>
                <p className="text-xs text-slate-500">{t('seller_portal')}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <Bell className="h-5 w-5 text-slate-600" />
                <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs">
                  2
                </Badge>
              </button>
              <LanguageSelector />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-20 overflow-y-auto">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-10">
        <div className="grid grid-cols-4 gap-1 px-2 py-2">
          <button
            onClick={() => router.push('/')}
            className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors ${
              activeTab === 'home' 
                ? 'bg-blue-50 text-blue-600' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Home className="h-5 w-5" />
            <span className="text-xs">{t('home')}</span>
          </button>

          <button
            onClick={() => router.push('/history')}
            className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors ${
              activeTab === 'orders' 
                ? 'bg-blue-50 text-blue-600' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <ShoppingCart className="h-5 w-5" />
            <span className="text-xs">{t('orders')}</span>
          </button>

          <button
            onClick={() => router.push('/pending-pod')}
            className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors ${
              activeTab === 'stats' 
                ? 'bg-blue-50 text-blue-600' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="h-5 w-5" />
            <span className="text-xs">{t('pod')}</span>
          </button>

          <button
            onClick={() => router.push('/profile')}
            className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors ${
              activeTab === 'profile' 
                ? 'bg-blue-50 text-blue-600' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <User className="h-5 w-5" />
            <span className="text-xs">{t('profile')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
