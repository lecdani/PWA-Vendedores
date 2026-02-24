import { MainLayout } from '@/shared/layout/main-layout';
import { Planogram } from '@/features/planogram/components/planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function PlanogramPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { storeId } = await params;
  const { orderId } = await searchParams;
  return (
    <ProtectedRoute>
      <MainLayout>
        <Planogram storeId={storeId} orderId={orderId ?? undefined} />
      </MainLayout>
    </ProtectedRoute>
  );
}
