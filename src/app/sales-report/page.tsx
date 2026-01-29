import { MainLayout } from '@/shared/layout/main-layout';
import { SalesReport } from '@/features/sales-report/components/sales-report';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default function SalesReportPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <SalesReport />
      </MainLayout>
    </ProtectedRoute>
  );
}
