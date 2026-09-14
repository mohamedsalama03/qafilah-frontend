import type { Metadata } from "next";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store overview" };

export default async function StorePage({ params }: { params: Promise<{ storeUuid: string }> }) {
  const { storeUuid } = await params;
  return <StoreWorkspace storeUuid={storeUuid} />;
}
