import { ConnectionUnavailable } from "@/features/auth/components/connection-unavailable";

export const dynamic = "force-dynamic";

// Do not serialize a merchant shell before real identity and store authority are available.
export default function MerchantPage() {
  return <ConnectionUnavailable />;
}
