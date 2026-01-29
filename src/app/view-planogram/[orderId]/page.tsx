import { MainLayout } from '@/shared/layout/main-layout';
import { ViewPlanogram } from '@/features/planogram/components/view-planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function ViewPlanogramPage({ params }: { params: { orderId: string } }) {
  return (
    <ProtectedRoute>
      <MainLayout>
        <ViewPlanogram orderId={params.orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
