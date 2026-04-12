import { MainLayout } from '@/shared/layout/main-layout';
import { ViewPlanogram } from '@/features/planogram/components/view-planogram';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function ViewPlanogramPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<{ source?: string }>;
}) {
  const { orderId } = await params;
  const sp = searchParams ? await searchParams : {};
  const quantitySource = sp?.source === 'invoice' ? 'invoice' : 'order';
  return (
    <ProtectedRoute>
      <MainLayout>
        <ViewPlanogram orderId={orderId} quantitySource={quantitySource} />
      </MainLayout>
    </ProtectedRoute>
  );
}
