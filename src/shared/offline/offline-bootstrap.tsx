'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { hasPendingOfflineSync, requestProcessOfflineQueue, startOfflineSyncListeners } from './offline-orders';

/**
 * Solo banner offline y disparadores de cola. Modales / recarga tras sync: `main-layout.tsx`.
 */
export function OfflineBootstrap() {
  const pathname = usePathname();
  const isLoginRoute = pathname === '/login';
  const [isOnline, setIsOnline] = useState(true);
  const prevOnlineRef = useRef(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const clearOfflineHint = () => {
      try {
        window.sessionStorage.removeItem('app_offline_hint');
        window.sessionStorage.removeItem('app_ui_offline_sticky');
      } catch {
        // noop
      }
    };

    const onReconnectSync = () => {
      clearOfflineHint();
      setIsOnline(true);
      prevOnlineRef.current = true;
      requestProcessOfflineQueue(300);
    };

    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const stop = startOfflineSyncListeners();

    const onOnline = () => {
      onReconnectSync();
    };
    const onOffline = () => {
      setIsOnline(false);
      prevOnlineRef.current = false;
    };
    const onAppNetworkStatus = (event: Event) => {
      const customEvent = event as CustomEvent<{ online?: boolean }>;
      const online = customEvent.detail?.online;
      if (online === false) {
        setIsOnline(false);
        prevOnlineRef.current = false;
        return;
      }
      if (online === true) {
        if (typeof navigator === 'undefined' || navigator.onLine) {
          setIsOnline(true);
          // No sincronizar en cada GET OK: solo si veníamos como “offline” de red.
          if (!prevOnlineRef.current) {
            prevOnlineRef.current = true;
            clearOfflineHint();
            requestProcessOfflineQueue(300);
          }
        }
      }
    };
    const onConnectionRestored = () => {
      onReconnectSync();
    };
    const onConnectionLost = () => {
      setIsOnline(false);
      prevOnlineRef.current = false;
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('app-network-status', onAppNetworkStatus as EventListener);
    window.addEventListener('app-connection-restored', onConnectionRestored as EventListener);
    window.addEventListener('app-connection-lost', onConnectionLost as EventListener);

    const interval = window.setInterval(() => {
      const nowOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
      if (!nowOnline) {
        prevOnlineRef.current = false;
        return;
      }
      if (!prevOnlineRef.current) {
        prevOnlineRef.current = true;
        clearOfflineHint();
        setIsOnline(true);
        requestProcessOfflineQueue(400);
      }
      void hasPendingOfflineSync().then((pending) => {
        if (pending) requestProcessOfflineQueue(500);
      });
    }, 20000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      stop();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('app-network-status', onAppNetworkStatus as EventListener);
      window.removeEventListener('app-connection-restored', onConnectionRestored as EventListener);
      window.removeEventListener('app-connection-lost', onConnectionLost as EventListener);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      {!isLoginRoute && !isOnline ? (
        <div className="fixed top-0 left-0 right-0 z-[2147483646] bg-amber-500 text-white text-center text-xs py-1.5">
          Sin conexion. Tus cambios de pedidos/POD se guardan y se sincronizaran automaticamente.
        </div>
      ) : null}
    </>
  );
}
