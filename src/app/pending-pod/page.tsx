import { MainLayout } from '@/shared/layout/main-layout';
import { PendingPOD } from '@/features/pod/components/pending-pod';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function PendingPODPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <PendingPOD />
      </MainLayout>
    </ProtectedRoute>
  );
}
