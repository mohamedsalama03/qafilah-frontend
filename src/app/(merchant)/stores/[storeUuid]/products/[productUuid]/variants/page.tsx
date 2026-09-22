import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { VariantsScreen } from "@/features/variants/components/variants-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Variants & options" };

export default async function VariantsPage({
  params,
}: {
  params: Promise<{ storeUuid: string; productUuid: string }>;
}) {
  const { storeUuid, productUuid } = await params;
  return (
    <StoreWorkspace storeUuid={storeUuid} title="Products">
      <VariantsScreen productUuid={productUuid} />
    </StoreWorkspace>
  );
}
