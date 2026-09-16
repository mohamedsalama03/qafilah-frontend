import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { ProductScreen } from "@/features/products/components/product-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product details" };

export default async function ProductPage({
  params,
}: {
  params: Promise<{ storeUuid: string; productUuid: string }>;
}) {
  const { storeUuid, productUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <ProductScreen productUuid={productUuid} />
    </StoreWorkspace>
  );
}
