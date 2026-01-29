import { MainLayout } from '@/shared/layout/main-layout';
import { OrderReview } from '@/features/orders/components/order-review';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function OrderReviewPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <OrderReview />
      </MainLayout>
    </ProtectedRoute>
  );
}
