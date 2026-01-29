import { MainLayout } from '@/shared/layout/main-layout';
import { OrderHistory } from '@/features/orders/components/order-history';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function HistoryPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <OrderHistory />
      </MainLayout>
    </ProtectedRoute>
  );
}
