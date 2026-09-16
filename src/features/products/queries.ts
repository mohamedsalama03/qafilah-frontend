"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantApi } from "@/lib/backend/client";
import type { ProductCriteria, CategoryCriteria } from "./model";

export const productKeys = {
  list: (scope: QueryScope, criteria: ProductCriteria, cursor: string | null) =>
    storeKeys.resource(scope, "products", { criteria, cursor }),
  detail: (scope: QueryScope, productUuid: string) =>
    storeKeys.resource(scope, "product", { productUuid }),
  categories: (scope: QueryScope, criteria: CategoryCriteria, cursor: string | null) =>
    storeKeys.resource(scope, "product-categories", { criteria, cursor }),
};

function useCatalogRead<T>(
  key: readonly unknown[],
  permission: "products.view" | "categories.view",
  operation: (api: MerchantApi, signal: AbortSignal) => Promise<T>,
) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller, state } = useStores();
  const scope = state.scope!;
  function assertAccess() {
    session.scope.assertCurrent(scope);
    const current = controller.getSnapshot();
    if (
      current.scope !== scope ||
      current.context?.store.id !== scope.storeUuid ||
      !current.context.permissions.includes("products.view") ||
      !current.context.permissions.includes(permission)
    )
      throw new ApiError("forbidden");
  }
  return useQuery({
    queryKey: key,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      session.scope.run(
        scope,
        async (scopedSignal) => {
          // StrictMode can cancel its first subscription before any HTTP work is dispatched.
          await Promise.resolve();
          if (scopedSignal.aborted) throw new ApiError("cancelled");
          assertAccess();
          if (!api) throw new ApiError("configuration");
          try {
            const result = await operation(api, scopedSignal);
            assertAccess();
            return result;
          } catch (error) {
            session.scope.assertCurrent(scope);
            const normalized = normalizeUnexpectedError(error);
            if (normalized.kind === "unauthenticated" || normalized.kind === "session-expired")
              session.auth.handleApiError(normalized);
            else if (normalized.kind === "forbidden") {
              // A denial also invalidates other cached views of this capability. Keep the
              // observed error for recovery, but never let a fresh cached page bypass it.
              const resources =
                permission === "products.view" ? ["products", "product"] : ["product-categories"];
              for (const resource of resources)
                session.queryClient.removeQueries({
                  queryKey: storeKeys.resource(scope, resource),
                  type: "inactive",
                });
              void controller.revalidate();
            }
            throw normalized;
          }
        },
        signal,
      ),
  });
}

export function useProductList(criteria: ProductCriteria, cursor: string | null) {
  const { state } = useStores();
  const scope = state.scope!;
  return useCatalogRead(productKeys.list(scope, criteria, cursor), "products.view", (api, signal) =>
    api.listProducts({ storeUuid: scope.storeUuid, criteria, cursor }, signal),
  );
}

export function useProduct(productUuid: string) {
  const { state } = useStores();
  const scope = state.scope!;
  return useCatalogRead(productKeys.detail(scope, productUuid), "products.view", (api, signal) =>
    api.loadProduct({ storeUuid: scope.storeUuid, productUuid }, signal),
  );
}

export function useProductCategories(criteria: CategoryCriteria, cursor: string | null) {
  const { state } = useStores();
  const scope = state.scope!;
  return useCatalogRead(
    productKeys.categories(scope, criteria, cursor),
    "categories.view",
    (api, signal) => api.listCategories({ storeUuid: scope.storeUuid, criteria, cursor }, signal),
  );
}
