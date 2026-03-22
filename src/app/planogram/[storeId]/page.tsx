import { MainLayout } from '@/shared/layout/main-layout';
import { Planogram } from '@/features/planogram/components/planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function PlanogramPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ orderId?: string; mode?: string }>;
}) {
  const { storeId } = await params;
  const { orderId, mode } = await searchParams;
  const flowMode = mode === 'invoice' ? 'invoice' : 'create';
  return (
    <ProtectedRoute>
      <MainLayout>
        <Planogram storeId={storeId} orderId={orderId ?? undefined} mode={flowMode} />
      </MainLayout>
    </ProtectedRoute>
  );
}
