'use client';

import { 
  ShoppingCart, 
  DollarSign, 
  Target, 
  Users, 
  Plus, 
  History, 
  BarChart3,
  FileCheck
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MetricCard } from './metric-card';
import { ModuleCard } from './module-card';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Button } from '@/shared/ui/button';

export function Dashboard() {
  const { t } = useLanguage();
  const router = useRouter();
  const sellerName = "Carlos";

  const metrics = [
    { 
      label: t('orders_today'), 
      value: '12', 
      icon: ShoppingCart, 
      color: 'bg-blue-50 text-blue-600',
      iconBg: 'bg-blue-500'
    },
    { 
      label: t('total_sales'), 
      value: '$2,845', 
      icon: DollarSign, 
      color: 'bg-green-50 text-green-600',
      iconBg: 'bg-green-500'
    },
    { 
      label: t('monthly_goal'), 
      value: '68%', 
      icon: Target, 
      color: 'bg-purple-50 text-purple-600',
      iconBg: 'bg-purple-500'
    },
    { 
      label: t('active_customers'), 
      value: '8', 
      icon: Users, 
      color: 'bg-orange-50 text-orange-600',
      iconBg: 'bg-orange-500'
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
        className="w-full mb-5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-xl p-4 shadow-lg hover:shadow-xl transition-all active:scale-98"
      >
        <div className="flex items-center justify-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Plus className="h-6 w-6" />
          </div>
          <div className="text-left">
            <p className="text-lg">{t('create_new_order')}</p>
            <p className="text-sm text-blue-100">{t('start_order_desc')}</p>
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
