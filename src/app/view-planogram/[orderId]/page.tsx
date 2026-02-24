import { MainLayout } from '@/shared/layout/main-layout';
import { ViewPlanogram } from '@/features/planogram/components/view-planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function ViewPlanogramPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <ProtectedRoute>
      <MainLayout>
        <ViewPlanogram orderId={orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
