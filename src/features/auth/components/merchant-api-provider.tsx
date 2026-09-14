"use client";

import { createContext, useContext, useState } from "react";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import { parsePublicEnvironment } from "@/lib/env";

const ApiContext = createContext<MerchantApi | null>(null);

/** One stable browser transport; no identity, cookies or requests are created during rendering. */
export function MerchantApiProvider({
  children,
  api,
}: {
  children: React.ReactNode;
  api?: MerchantApi | null;
}) {
  const [client] = useState(() => {
    if (api !== undefined) return api;
    const { apiOrigin } = parsePublicEnvironment(
      { NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN },
      process.env.NODE_ENV,
    );
    return apiOrigin ? createMerchantApi({ apiOrigin, mode: process.env.NODE_ENV }) : null;
  });
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export const useMerchantApi = () => useContext(ApiContext);
