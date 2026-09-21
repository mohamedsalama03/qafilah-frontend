"use client";

import { useQuery } from "@tanstack/react-query";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { StoreController } from "@/lib/stores/controller";

export const inventoryKeys = {
  detail: (scope: QueryScope, productUuid: string) =>
    storeKeys.resource(scope, "product-inventory", { productUuid }),
};

export interface InventoryAuthority {
  api: MerchantApi | null;
  session: ReturnType<typeof useMerchantSession>;
  stores: StoreController;
  scope: QueryScope;
}

export function assertInventoryAccess(options: InventoryAuthority, write = false): void {
  const { session, stores, scope, api } = options;
  session.scope.assertCurrent(scope);
  const identity = session.auth.getSnapshot();
  const current = stores.getSnapshot();
  if (
    identity.status !== "authenticated" ||
    identity.principal.principalId !== scope.principalId ||
    identity.scopedReadError ||
    current.scope !== scope ||
    current.contextStatus !== "ready" ||
    current.context?.store.id !== scope.storeUuid ||
    !current.context.permissions.includes("products.view") ||
    (write && !current.context.permissions.includes("products.inventory.update"))
  )
    throw new ApiError("forbidden");
  if (!api) throw new ApiError("configuration");
}

export function handleInventoryAuthorityError(options: InventoryAuthority, error: ApiError) {
  if (error.kind === "unauthenticated" || error.kind === "session-expired")
    void options.session.auth.handleScopedReadError(error);
  else if (error.kind === "forbidden") {
    for (const resource of ["product-inventory", "product", "products"])
      options.session.queryClient.removeQueries({
        queryKey: storeKeys.resource(options.scope, resource),
        type: "inactive",
      });
    void options.stores.revalidate();
  }
}

export async function loadScopedProductInventory(
  options: InventoryAuthority,
  productUuid: string,
  signal?: AbortSignal,
) {
  return options.session.scope.run(
    options.scope,
    async (scopedSignal) => {
      await Promise.resolve();
      if (scopedSignal.aborted) throw new ApiError("cancelled");
      assertInventoryAccess(options);
      try {
        const result = await options.api!.loadProductInventory(
          { storeUuid: options.scope.storeUuid, productUuid },
          scopedSignal,
        );
        assertInventoryAccess(options);
        return result;
      } catch (error) {
        options.session.scope.assertCurrent(options.scope);
        const normalized = normalizeUnexpectedError(error);
        handleInventoryAuthorityError(options, normalized);
        throw normalized;
      }
    },
    signal,
  );
}

export function useProductInventory(productUuid: string) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state } = useStores();
  const scope = state.scope!;
  return useQuery({
    queryKey: inventoryKeys.detail(scope, productUuid),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      loadScopedProductInventory({ api, session, stores, scope }, productUuid, signal),
  });
}
