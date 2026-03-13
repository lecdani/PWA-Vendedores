import { MainLayout } from '@/shared/layout/main-layout';
import { CatalogOrder } from '@/features/catalog-order/components/catalog-order';
import { ProtectedRoute } from '@/shared/auth/protected-route';

export default async function CatalogOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { storeId } = await params;
  const { orderId } = await searchParams;
  return (
    <ProtectedRoute>
      <MainLayout>
        <CatalogOrder storeId={storeId} orderId={orderId ?? undefined} />
      </MainLayout>
    </ProtectedRoute>
  );
}
