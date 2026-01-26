import { MainLayout } from '@/shared/layout/main-layout';
import { OrderDetail } from '@/features/orders/components/order-detail';

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  return (
    <MainLayout>
      <OrderDetail orderId={params.orderId} />
    </MainLayout>
  );
}
