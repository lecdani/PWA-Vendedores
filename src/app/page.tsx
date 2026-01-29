import { MainLayout } from '@/shared/layout/main-layout';
import { Dashboard } from '@/features/dashboard/components/dashboard';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function HomePage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <Dashboard />
      </MainLayout>
    </ProtectedRoute>
  );
}
