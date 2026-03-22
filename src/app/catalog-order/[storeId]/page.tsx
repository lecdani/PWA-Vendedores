import { MainLayout } from '@/shared/layout/main-layout';
import { CatalogOrder } from '@/features/catalog-order/components/catalog-order';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function CatalogOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ orderId?: string; mode?: string }>;
}) {
  const { storeId } = await params;
  const { orderId, mode } = await searchParams;
  const flowMode = mode === 'confirm' ? 'confirm' : 'create';
  return (
    <ProtectedRoute>
      <MainLayout>
        <CatalogOrder storeId={storeId} orderId={orderId ?? undefined} mode={flowMode} />
      </MainLayout>
    </ProtectedRoute>
  );
}
