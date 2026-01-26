import { MainLayout } from '@/shared/layout/main-layout';
import { SelectStore } from '@/features/store-selection/components/select-store';

export default function SelectStorePage() {
  return (
    <MainLayout>
      <SelectStore />
    </MainLayout>
  );
}
