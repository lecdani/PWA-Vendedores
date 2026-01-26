import { MainLayout } from '@/shared/layout/main-layout';
import { CapturePOD } from '@/features/pod/components/capture-pod';

export default function CapturePODPage({ params }: { params: { orderId: string } }) {
  return (
    <MainLayout>
      <CapturePOD orderId={params.orderId} />
    </MainLayout>
  );
}
