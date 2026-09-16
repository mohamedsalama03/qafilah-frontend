import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { CreateProductScreen } from "@/features/products/components/product-form-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create product" };

export default async function CreateProductPage({
  params,
}: {
  params: Promise<{ storeUuid: string }>;
}) {
  const { storeUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <CreateProductScreen />
    </StoreWorkspace>
  );
}
