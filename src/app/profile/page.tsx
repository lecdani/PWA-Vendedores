import { MainLayout } from '@/shared/layout/main-layout';
import { Profile } from '@/features/profile/components/profile';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <Profile />
      </MainLayout>
    </ProtectedRoute>
  );
}
