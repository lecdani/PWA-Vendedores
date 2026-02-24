import { MainLayout } from '@/shared/layout/main-layout';
import { CapturePOD } from '@/features/pod/components/capture-pod';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function CapturePODPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <ProtectedRoute>
      <MainLayout>
        <CapturePOD orderId={orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
