import { SessionBoundary } from "@/features/auth/components/session-boundary";

export const dynamic = "force-dynamic";

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <SessionBoundary>{children}</SessionBoundary>;
}
