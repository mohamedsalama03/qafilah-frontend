import { MerchantBoundary } from "@/features/auth/components/merchant-boundary";

export const dynamic = "force-dynamic";

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <MerchantBoundary>{children}</MerchantBoundary>;
}
