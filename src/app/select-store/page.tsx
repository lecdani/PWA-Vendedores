import { MainLayout } from '@/shared/layout/main-layout';
import { SelectStore } from '@/features/store-selection/components/select-store';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function SelectStorePage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <SelectStore />
      </MainLayout>
    </ProtectedRoute>
  );
}
