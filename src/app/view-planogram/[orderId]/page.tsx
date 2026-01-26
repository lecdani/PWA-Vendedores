import { MainLayout } from '@/shared/layout/main-layout';
import { ViewPlanogram } from '@/features/planogram/components/view-planogram';

export default function ViewPlanogramPage({ params }: { params: { orderId: string } }) {
  return (
    <MainLayout>
      <ViewPlanogram orderId={params.orderId} />
    </MainLayout>
  );
}
