import { MainLayout } from '@/shared/layout/main-layout';
import { Planogram } from '@/features/planogram/components/planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function PlanogramPage({ params }: { params: { storeId: string } }) {
  return (
    <ProtectedRoute>
      <MainLayout>
        <Planogram storeId={params.storeId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
