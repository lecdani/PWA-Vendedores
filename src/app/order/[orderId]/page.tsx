import { MainLayout } from '@/shared/layout/main-layout';
import { OrderDetail } from '@/features/orders/components/order-detail';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <ProtectedRoute>
      <MainLayout>
        <OrderDetail orderId={orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
