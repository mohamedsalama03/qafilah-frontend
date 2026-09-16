import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { EditProductScreen } from "@/features/products/components/product-form-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ storeUuid: string; productUuid: string }>;
}) {
  const { storeUuid, productUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <EditProductScreen productUuid={productUuid} />
    </StoreWorkspace>
  );
}
