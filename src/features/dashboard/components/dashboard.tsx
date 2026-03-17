'use client';

import { useEffect, useState } from 'react';
import {
  Package,
  ShoppingCart,
  Plus,
  History,
  BarChart3,
  FileCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MetricCard } from './metric-card';
import { ModuleCard } from './module-card';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { ordersApi, OrderForUI } from '@/shared/api/orders-api';

export function Dashboard() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();
  const sellerName =
    [user?.name, user?.lastName].filter(Boolean).join(' ') ||
    user?.email?.split('@')[0] ||
    'Vendedor';

  const [orders, setOrders] = useState<OrderForUI[] | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.id) {
        if (mounted) {
          setOrders([]);
          setLoadingMetrics(false);
        }
        return;
      }
      setLoadingMetrics(true);
      const ordersData = await ordersApi.getOrdersByUser(user.id);
      if (!mounted) return;
      setOrders(ordersData || []);
      setLoadingMetrics(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const allOrders = orders ?? [];
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const ordersToday = allOrders.filter((o) => {
    if (!o.date) return false;
    return new Date(o.date).toISOString().slice(0, 10) === todayIso;
  }).length;

  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const metrics = [
    {
      label: t('total_orders_vendor'),
      value: loadingMetrics ? '—' : String(allOrders.length),
      icon: Package,
      color: 'bg-indigo-50 text-indigo-600',
      iconBg: 'bg-indigo-500',
    },
    {
      label: t('orders_today'),
      value: loadingMetrics ? '—' : String(ordersToday),
      icon: ShoppingCart,
      color: 'bg-emerald-50 text-emerald-600',
      iconBg: 'bg-emerald-500',
    },
  ];

  return (
    <div className="px-4 py-4">
      {/* Welcome Section */}
      <div className="mb-4">
        <h2 className="text-slate-900 text-lg mb-1">
          {t('welcome_greeting')}, {sellerName}! 👋
        </h2>
        <p className="text-sm text-slate-500">
          {t('dashboard_subtitle')}
        </p>
      </div>

      {/* Primary Action */}
      <button
        onClick={() => router.push('/select-store')}
        className="w-full mb-5 text-white rounded-xl p-4 shadow-lg hover:shadow-xl transition-all active:scale-98"
        style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
      >
        <div className="flex items-center justify-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Plus className="h-6 w-6" />
          </div>
          <div className="text-left">
            <p className="text-lg">{t('create_new_order')}</p>
            <p className="text-sm text-indigo-100">{t('start_order_desc')}</p>
          </div>
        </div>
      </button>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {metrics.map((metric, index) => (
          <MetricCard
            key={index}
            label={metric.label}
            value={metric.value}
            icon={metric.icon}
            color={metric.color}
            iconBg={metric.iconBg}
          />
        ))}
      </div>

      {/* Quick Access Modules */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-slate-900">{t('quick_access')}</h3>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <ModuleCard
            title={t('order_history')}
            description={t('view_all_orders')}
            icon={History}
            color="bg-slate-50 text-slate-600"
            iconBg="bg-slate-500"
            onClick={() => router.push('/history')}
          />
          
          <ModuleCard
            title={t('pending_deliveries')}
            description={t('pod_required')}
            icon={FileCheck}
            color="bg-amber-50 text-amber-600"
            iconBg="bg-amber-500"
            onClick={() => router.push('/pending-pod')}
          />

          <ModuleCard
            title={t('reports')}
            description={t('reports_desc')}
            icon={BarChart3}
            color="bg-purple-50 text-purple-600"
            iconBg="bg-purple-500"
            onClick={() => router.push('/sales-report')}
          />
        </div>
      </div>
    </div>
  );
}
