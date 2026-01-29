import { MainLayout } from '@/shared/layout/main-layout';
import { CapturePOD } from '@/features/pod/components/capture-pod';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function CapturePODPage({ params }: { params: { orderId: string } }) {
  return (
    <ProtectedRoute>
      <MainLayout>
        <CapturePOD orderId={params.orderId} />
      </MainLayout>
    </ProtectedRoute>
  );
}
