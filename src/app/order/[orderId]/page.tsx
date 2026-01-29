import { MainLayout } from '@/shared/layout/main-layout';
import { OrderDetail } from '@/features/orders/components/order-detail';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  return (
    <ProtectedRoute>
      <MainLayout>
        <OrderDetail orderId={params.orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
