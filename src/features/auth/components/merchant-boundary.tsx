"use client";

import { usePathname } from "next/navigation";
import { SessionBoundary } from "./session-boundary";
import { useMerchantApi } from "./merchant-api-provider";
import { StoreProvider } from "@/features/stores/components/store-provider";

export function MerchantBoundary({ children }: { children: React.ReactNode }) {
  const api = useMerchantApi();
  const pathname = usePathname();
  return (
    <SessionBoundary adapter={api?.authAdapter} returnTo={pathname}>
      <StoreProvider>{children}</StoreProvider>
    </SessionBoundary>
  );
}
