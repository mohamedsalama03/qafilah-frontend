import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { ProductsScreen } from "@/features/products/components/products-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ params }: { params: Promise<{ storeUuid: string }> }) {
  const { storeUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <ProductsScreen />
    </StoreWorkspace>
  );
}
