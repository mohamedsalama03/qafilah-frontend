"use client";

import { useQuery } from "@tanstack/react-query";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { StoreController } from "@/lib/stores/controller";

export const variantKeys = {
  options: (scope: QueryScope, productUuid: string) =>
    storeKeys.resource(scope, "product-options", { productUuid }),
  list: (scope: QueryScope, productUuid: string) =>
    storeKeys.resource(scope, "product-variants", { productUuid }),
  detail: (scope: QueryScope, productUuid: string, variantUuid: string) =>
    storeKeys.resource(scope, "product-variant", { productUuid, variantUuid }),
};

export interface VariantAuthority {
  api: MerchantApi | null;
  session: ReturnType<typeof useMerchantSession>;
  stores: StoreController;
  scope: QueryScope;
}

export function assertVariantAccess(options: VariantAuthority, write?: "create" | "update"): void {
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
    !current.context.permissions.includes("products.variants.view") ||
    (write && !current.context.permissions.includes(`products.variants.${write}`))
  )
    throw new ApiError("forbidden");
  if (!api) throw new ApiError("configuration");
}

export function handleVariantAuthorityError(options: VariantAuthority, error: ApiError) {
  if (error.kind === "unauthenticated" || error.kind === "session-expired")
    void options.session.auth.handleScopedReadError(error);
  else if (error.kind === "forbidden") {
    for (const resource of [
      "product-options",
      "product-variants",
      "product-variant",
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

async function scopedRead<T>(
  options: VariantAuthority,
  read: (api: MerchantApi, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  return options.session.scope.run(
    options.scope,
    async (scopedSignal) => {
      await Promise.resolve();
      if (scopedSignal.aborted) throw new ApiError("cancelled");
      assertVariantAccess(options);
      try {
        const result = await read(options.api!, scopedSignal);
        assertVariantAccess(options);
        return result;
      } catch (error) {
        options.session.scope.assertCurrent(options.scope);
        const normalized = normalizeUnexpectedError(error);
        handleVariantAuthorityError(options, normalized);
        throw normalized;
      }
    },
    signal,
  );
}

export function loadScopedProductOptions(
  options: VariantAuthority,
  productUuid: string,
  signal?: AbortSignal,
) {
  return scopedRead(
    options,
    (api, scopedSignal) =>
      api.listProductOptions({ storeUuid: options.scope.storeUuid, productUuid }, scopedSignal),
    signal,
  );
}

export function loadScopedProductVariants(
  options: VariantAuthority,
  productUuid: string,
  signal?: AbortSignal,
) {
  return scopedRead(
    options,
    (api, scopedSignal) =>
      api.listProductVariants({ storeUuid: options.scope.storeUuid, productUuid }, scopedSignal),
    signal,
  );
}

export function loadScopedProductVariant(
  options: VariantAuthority,
  productUuid: string,
  variantUuid: string,
  signal?: AbortSignal,
) {
  return scopedRead(
    options,
    (api, scopedSignal) =>
      api.loadProductVariant(
        { storeUuid: options.scope.storeUuid, productUuid, variantUuid },
        scopedSignal,
      ),
    signal,
  );
}

function useAuthority(): VariantAuthority {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state } = useStores();
  return { api, session, stores, scope: state.scope! };
}

const readOptions = {
  staleTime: 30_000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useProductOptions(productUuid: string) {
  const authority = useAuthority();
  return useQuery({
    ...readOptions,
    queryKey: variantKeys.options(authority.scope, productUuid),
    queryFn: ({ signal }) => loadScopedProductOptions(authority, productUuid, signal),
  });
}

export function useProductVariants(productUuid: string) {
  const authority = useAuthority();
  return useQuery({
    ...readOptions,
    queryKey: variantKeys.list(authority.scope, productUuid),
    queryFn: ({ signal }) => loadScopedProductVariants(authority, productUuid, signal),
  });
}

export function useProductVariant(productUuid: string, variantUuid: string) {
  const authority = useAuthority();
  return useQuery({
    ...readOptions,
    queryKey: variantKeys.detail(authority.scope, productUuid, variantUuid),
    queryFn: ({ signal }) => loadScopedProductVariant(authority, productUuid, variantUuid, signal),
  });
}
