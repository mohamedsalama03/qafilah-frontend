"use client";

import { useQuery } from "@tanstack/react-query";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { StoreController } from "@/lib/stores/controller";
import type { Pricing } from "./contracts";

export function assertPricingCurrency(options: PricingAuthority, result: Pricing): void {
  if (
    result.price &&
    result.price.currency !== options.stores.getSnapshot().context?.store.currency
  )
    throw new ApiError("invalid-response");
}

export const pricingKeys = {
  detail: (scope: QueryScope, productUuid: string, variantUuid?: string) =>
    storeKeys.resource(scope, "pricing", { productUuid, variantUuid }),
};

export interface PricingAuthority {
  api: MerchantApi | null;
  session: ReturnType<typeof useMerchantSession>;
  stores: StoreController;
  scope: QueryScope;
}

export function assertPricingAccess(
  options: PricingAuthority,
  variantUuid?: string,
  write = false,
): void {
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
    (!!variantUuid && !current.context.permissions.includes("products.variants.view")) ||
    (write &&
      !current.context.permissions.includes(
        variantUuid ? "products.variants.price.update" : "products.price.update",
      ))
  )
    throw new ApiError("forbidden");
  if (!api) throw new ApiError("configuration");
}

export function handlePricingAuthorityError(options: PricingAuthority, error: ApiError) {
  if (error.kind === "unauthenticated" || error.kind === "session-expired")
    void options.session.auth.handleScopedReadError(error);
  else if (error.kind === "forbidden") {
    for (const resource of [
      "pricing",
      "product-variant",
      "product-variants",
      "product",
      "products",
    ])
      options.session.queryClient.removeQueries({
        queryKey: storeKeys.resource(options.scope, resource),
        type: "inactive",
      });
    void options.stores.revalidate();
  }
}

export async function loadScopedPricing(
  options: PricingAuthority,
  productUuid: string,
  variantUuid?: string,
  signal?: AbortSignal,
) {
  return options.session.scope.run(
    options.scope,
    async (scopedSignal) => {
      await Promise.resolve();
      if (scopedSignal.aborted) throw new ApiError("cancelled");
      assertPricingAccess(options, variantUuid);
      try {
        const result = await (variantUuid
          ? options.api!.loadVariantPricing(
              { storeUuid: options.scope.storeUuid, productUuid, variantUuid },
              scopedSignal,
            )
          : options.api!.loadProductPricing(
              { storeUuid: options.scope.storeUuid, productUuid },
              scopedSignal,
            ));
        assertPricingAccess(options, variantUuid);
        assertPricingCurrency(options, result);
        return result;
      } catch (error) {
        options.session.scope.assertCurrent(options.scope);
        const normalized = normalizeUnexpectedError(error);
        handlePricingAuthorityError(options, normalized);
        throw normalized;
      }
    },
    signal,
  );
}

export function usePricing(productUuid: string, variantUuid?: string) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state } = useStores();
  const scope = state.scope!;
  return useQuery({
    queryKey: pricingKeys.detail(scope, productUuid, variantUuid),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      loadScopedPricing({ api, session, stores, scope }, productUuid, variantUuid, signal),
  });
}
