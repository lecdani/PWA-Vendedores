import { MainLayout } from '@/shared/layout/main-layout';
import { Planogram } from '@/features/planogram/components/planogram';

export default function PlanogramPage({ params }: { params: { storeId: string } }) {
  return (
    <MainLayout>
      <Planogram storeId={params.storeId} />
    </MainLayout>
  );
}
