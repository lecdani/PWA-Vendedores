'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Home, ShoppingCart, BarChart3, User, LogOut, FileCheck } from 'lucide-react';
import { LanguageSelector } from '@/shared/i18n/language-selector';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const [modalTone, setModalTone] = useState<'info' | 'success' | 'warn'>('info');
  const modalTimerRef = useRef<number | null>(null);
  const pendingSyncNoticeRef = useRef(false);
  /**
   * Solo evento nativo `offline` (o carga sin red): NO contar fallos puntuales de API (`app-network-status`),
   * porque cada error+éxito parecía una reconexión y disparaba modal/sync/recarga en bucle.
   */
  const offlineCycleRef = useRef(0);
  const lastHandledOfflineCycleRef = useRef(0);

  useEffect(() => {
    const STICKY_OFFLINE_KEY = 'app_ui_offline_sticky';
    const hasStickyOffline = () => {
      if (typeof window === 'undefined') return false;
      return window.sessionStorage.getItem(STICKY_OFFLINE_KEY) === '1';
    };
    const setStickyOffline = (value: boolean) => {
      if (typeof window === 'undefined') return;
      if (value) window.sessionStorage.setItem(STICKY_OFFLINE_KEY, '1');
      else window.sessionStorage.removeItem(STICKY_OFFLINE_KEY);
    };
    const computeOnline = () => {
      if (typeof navigator === 'undefined') return true;
      if (!navigator.onLine) return false;
      if (hasStickyOffline()) return false;
      return true;
    };

    let wasOnline = computeOnline();
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      offlineCycleRef.current = Math.max(offlineCycleRef.current, 1);
    }
    setIsOnline(wasOnline);
    const setOnlineState = (next: boolean) => {
      if (next === wasOnline) return;
      const goingOnline = !wasOnline && next;
      wasOnline = next;
      setIsOnline(next);
      window.dispatchEvent(
        new CustomEvent(next ? 'app-connection-restored' : 'app-connection-lost')
      );
      if (goingOnline) {
        if (offlineCycleRef.current > lastHandledOfflineCycleRef.current) {
          pendingSyncNoticeRef.current = true;
          setModalTone('info');
          setModalMessage('Conexion restablecida. Sincronizando cambios pendientes...');
          if (modalTimerRef.current != null) window.clearTimeout(modalTimerRef.current);
          modalTimerRef.current = window.setTimeout(() => setModalMessage(null), 8000);
        }
      }
    };

    const onOnline = () => {
      setStickyOffline(false);
      setOnlineState(true);
    };
    const onOffline = () => {
      setStickyOffline(true);
      pendingSyncNoticeRef.current = false;
      offlineCycleRef.current += 1;
      setOnlineState(false);
    };
    const onAppNetworkStatus = (event: Event) => {
      const customEvent = event as CustomEvent<{ online?: boolean }>;
      const online = customEvent.detail?.online;
      // Si API confirma conectividad real, levantar sticky y reflejar online.
      if (online === true) {
        if (typeof navigator === 'undefined' || navigator.onLine) {
          setStickyOffline(false);
          setOnlineState(true);
        }
        return;
      }
      if (online === false) {
        setStickyOffline(true);
        setOnlineState(false);
      }
    };

    /** Una sola navegación al historial por ráfaga de sync (evita bucle). */
    const POST_SYNC_HISTORY_NAV_GUARD_MS = 12_000;
    const POST_SYNC_HISTORY_NAV_GUARD_KEY = 'pwa_post_sync_history_nav_ts';
    const scheduleHistoryAfterSuccessfulSync = () => {
      try {
        const prev = Number(window.sessionStorage.getItem(POST_SYNC_HISTORY_NAV_GUARD_KEY) || 0);
        const now = Date.now();
        if (Number.isFinite(prev) && prev > 0 && now - prev < POST_SYNC_HISTORY_NAV_GUARD_MS) {
          return;
        }
        window.sessionStorage.setItem(POST_SYNC_HISTORY_NAV_GUARD_KEY, String(now));
      } catch {
        // sin sessionStorage: permitir navegar
      }
      // Sin ref en el timeout: Strict Mode no debe cancelar la navegación.
      window.setTimeout(() => {
        window.location.assign('/history');
      }, 1300);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('app-network-status', onAppNetworkStatus as EventListener);
    const onOfflineSync = (event: Event) => {
      const customEvent = event as CustomEvent<{
        phase?: 'syncing' | 'done';
        summary?: { processed?: number; succeeded?: number; failed?: number };
      }>;
      if (customEvent.detail?.phase !== 'done') return;
      const summary = customEvent.detail.summary;
      if (!summary) return;

      const processed = summary.processed ?? 0;
      const succeeded = summary.succeeded ?? 0;
      const failed = summary.failed ?? 0;

      const showReconnectModal = pendingSyncNoticeRef.current;
      if (showReconnectModal) {
        lastHandledOfflineCycleRef.current = offlineCycleRef.current;
        pendingSyncNoticeRef.current = false;
      }

      // Mensaje también si hubo cola sin modal previo (p. ej. solo sticky/API, sin ciclo offline nativo).
      if (showReconnectModal || processed > 0) {
        if (showReconnectModal && processed <= 0) {
          setModalTone('success');
          setModalMessage('Conexion restablecida. No hay cambios pendientes por sincronizar.');
        } else if (succeeded > 0) {
          setModalTone('success');
          setModalMessage('Sincronizacion completada. Tus datos ya estan actualizados.');
        } else if (failed > 0) {
          setModalTone('warn');
          setModalMessage('No se pudieron sincronizar algunos cambios. Reintentaremos automaticamente.');
        } else if (processed > 0) {
          setModalTone('info');
          setModalMessage('Sincronizacion finalizada.');
        }
        if (modalTimerRef.current != null) window.clearTimeout(modalTimerRef.current);
        modalTimerRef.current = window.setTimeout(() => setModalMessage(null), 3600);
      }

      if (succeeded > 0) {
        scheduleHistoryAfterSuccessfulSync();
      }
    };
    window.addEventListener('app-offline-sync', onOfflineSync as EventListener);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('app-network-status', onAppNetworkStatus as EventListener);
      window.removeEventListener('app-offline-sync', onOfflineSync as EventListener);
      if (modalTimerRef.current != null) window.clearTimeout(modalTimerRef.current);
    };
  }, []);

  const getActiveTab = () => {
    if (pathname === '/') return 'home';
    if (pathname?.includes('/history') || pathname?.includes('/order')) return 'orders';
    if (pathname?.includes('/pending-pod')) return 'pod';
    if (pathname?.includes('/sales-report')) return 'reports';
    if (pathname?.includes('/profile')) return 'profile';
    return 'home';
  };

  const activeTab = getActiveTab();
  const isLoginRoute = pathname === '/login';

  const menuItems = [
    { id: 'home', label: t('home'), icon: Home, path: '/', action: null },
    { id: 'orders', label: t('orders'), icon: ShoppingCart, path: '/history', action: null },
    { id: 'pod', label: t('tab_pod'), icon: FileCheck, path: '/pending-pod', action: null },
    { id: 'reports', label: t('reports'), icon: BarChart3, path: '/sales-report', action: null },
    { id: 'profile', label: t('profile'), icon: User, path: '/profile', action: null },
    { id: 'logout', label: t('logout'), icon: LogOut, path: null, action: logout },
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
              <div className="relative w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center shadow-sm" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
                <Image
                  src="/logo-eternal.png"
                  alt="ETERNAL"
                  width={36}
                  height={36}
                  className="object-contain w-auto h-auto p-1 max-w-full max-h-full"
                />
              </div>
              <div>
                <p className="text-slate-900 text-sm font-medium">ETERNAL COSMETICS LLC</p>
                <p className="text-xs text-slate-500 truncate max-w-[140px]">
                  {([user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email) ?? t('seller_portal')}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    isOnline ? 'bg-emerald-500' : 'bg-slate-500'
                  }`}
                  title={isOnline ? 'Online' : 'Offline'}
                  aria-label={isOnline ? 'Online' : 'Offline'}
                />
                <span>{isOnline ? 'Online' : 'Offline'}</span>
              </span>
              <LanguageSelector />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      {!isLoginRoute && modalMessage ? (
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/25 px-4">
          <div
            className={`w-full max-w-sm rounded-xl border p-4 shadow-xl ${
              modalTone === 'success'
                ? 'bg-emerald-50 border-emerald-200'
                : modalTone === 'warn'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-sm text-slate-900">{modalMessage}</p>
          </div>
        </div>
      ) : null}

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
          gridTemplateColumns: 'repeat(6, 1fr)'
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
              {/* Indicador activo - línea indigo arriba (mismo color sistema web) */}
              {isActive && (
                <div 
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '56px',
                    height: '2px',
                    backgroundColor: '#4f46e5',
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
                    color: isActive ? '#4f46e5' : '#94a3b8'
                  }}
                />
              </div>
              
              {/* Texto */}
              <span 
                style={{
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#4f46e5' : '#94a3b8',
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
