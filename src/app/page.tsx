import { MainLayout } from '@/shared/layout/main-layout';
import { Dashboard } from '@/features/dashboard/components/dashboard';

export default function HomePage() {
  return (
    <MainLayout>
      <Dashboard />
    </MainLayout>
  );
}
