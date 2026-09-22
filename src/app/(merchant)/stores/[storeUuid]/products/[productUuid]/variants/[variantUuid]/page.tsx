import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { VariantsScreen } from "@/features/variants/components/variants-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Variant details" };

export default async function VariantPage({
  params,
}: {
  params: Promise<{ storeUuid: string; productUuid: string; variantUuid: string }>;
}) {
  const { storeUuid, productUuid, variantUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <VariantsScreen productUuid={productUuid} variantUuid={variantUuid} />
    </StoreWorkspace>
  );
}
