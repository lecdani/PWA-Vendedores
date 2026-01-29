'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, ShoppingCart, BarChart3, User, Bell, LogOut } from 'lucide-react';
import { LanguageSelector } from '@/shared/i18n/language-selector';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Badge } from '@/shared/ui/badge';
import { useAuth } from '@/shared/auth/auth-provider';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, logout } = useAuth();

  const getActiveTab = () => {
    if (pathname === '/') return 'home';
    if (pathname?.includes('/history') || pathname?.includes('/order')) return 'orders';
    if (pathname?.includes('/pending-pod')) return 'pod';
    if (pathname?.includes('/profile')) return 'profile';
    return 'home';
  };

  const activeTab = getActiveTab();

  const menuItems = [
    { id: 'home', label: t('home'), icon: Home, path: '/', action: null },
    { id: 'orders', label: t('orders'), icon: ShoppingCart, path: '/history', action: null },
    { id: 'pod', label: t('pod'), icon: BarChart3, path: '/pending-pod', action: null },
    { id: 'profile', label: t('profile'), icon: User, path: '/profile', action: null },
    { id: 'logout', label: 'Salir', icon: LogOut, path: null, action: logout },
  ];

  const handleNavClick = (item: typeof menuItems[0]) => {
    if (item.action) {
      item.action();
    } else if (item.path) {
      router.push(item.path);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-slate-50" style={{ paddingBottom: '80px' }}>
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-sm">
                <ShoppingCart className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-slate-900 text-sm font-medium">Eternal Cosmetics</p>
                <p className="text-xs text-slate-500">{t('seller_portal')}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <Bell className="h-5 w-5 text-slate-600" />
                <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold">
                  2
                </span>
              </button>
              <LanguageSelector />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* Bottom Navigation Bar - Fijo en la parte inferior con estilo oscuro */}
      <nav 
        style={{ 
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#0f172a',
          zIndex: 9999,
          paddingBottom: 'max(env(safe-area-inset-bottom), 0px)',
          boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1), 0 -2px 4px -1px rgba(0, 0, 0, 0.06)',
          height: '64px',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)'
        }}
      >
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                position: 'relative',
                paddingTop: '4px',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
              aria-label={item.label}
            >
              {/* Indicador activo - línea azul arriba */}
              {isActive && (
                <div 
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '56px',
                    height: '2px',
                    backgroundColor: '#60a5fa',
                    borderRadius: '9999px'
                  }}
                />
              )}
              
              {/* Icono */}
              <div style={{ 
                position: 'relative',
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 0.2s'
              }}>
                <Icon 
                  style={{
                    width: '24px',
                    height: '24px',
                    color: isActive ? '#60a5fa' : '#94a3b8'
                  }}
                />
              </div>
              
              {/* Texto */}
              <span 
                style={{
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#60a5fa' : '#94a3b8',
                  transition: 'color 0.2s'
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
