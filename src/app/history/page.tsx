import { MainLayout } from '@/shared/layout/main-layout';
import { OrderHistory } from '@/features/orders/components/order-history';

export default function HistoryPage() {
  return (
    <MainLayout>
      <OrderHistory />
    </MainLayout>
  );
}
