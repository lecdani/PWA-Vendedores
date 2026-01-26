import { MainLayout } from '@/shared/layout/main-layout';
import { PendingPOD } from '@/features/pod/components/pending-pod';

export default function PendingPODPage() {
  return (
    <MainLayout>
      <PendingPOD />
    </MainLayout>
  );
}
