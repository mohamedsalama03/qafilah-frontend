"use client";

import { useQuery } from "@tanstack/react-query";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { StoreController } from "@/lib/stores/controller";
import type { MediaTarget } from "./contracts";
import { mediaPermissions } from "./model";

export const mediaKeys = {
  list: (scope: QueryScope, target: MediaTarget) => storeKeys.resource(scope, "media", target),
};
export interface MediaAuthority {
  api: MerchantApi | null;
  session: ReturnType<typeof useMerchantSession>;
  stores: StoreController;
  scope: QueryScope;
}
export function assertMediaAccess(
  options: MediaAuthority,
  target: MediaTarget,
  operation?: "create" | "update" | "delete",
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
    (target.kind === "variant" &&
      !current.context.permissions.includes("products.variants.view")) ||
    !current.context.permissions.includes(mediaPermissions.view) ||
    (operation && !current.context.permissions.includes(mediaPermissions[operation]))
  )
    throw new ApiError("forbidden");
  if (!api) throw new ApiError("configuration");
}
export function handleMediaAuthorityError(options: MediaAuthority, error: ApiError): void {
  if (error.kind === "unauthenticated" || error.kind === "session-expired")
    void options.session.auth.handleScopedReadError(error);
  else if (error.kind === "forbidden") {
    for (const resource of ["media", "product-variant", "product-variants", "product", "products"])
      options.session.queryClient.removeQueries({
        queryKey: storeKeys.resource(options.scope, resource),
        type: "inactive",
      });
    void options.stores.revalidate();
  }
}
export async function loadScopedMedia(
  options: MediaAuthority,
  target: MediaTarget,
  signal?: AbortSignal,
) {
  const capturedTarget = { ...target };
  return options.session.scope.run(
    options.scope,
    async (scopedSignal) => {
      await Promise.resolve();
      if (scopedSignal.aborted) throw new ApiError("cancelled");
      assertMediaAccess(options, capturedTarget);
      try {
        const input = {
          storeUuid: options.scope.storeUuid,
          productUuid: capturedTarget.productUuid,
        };
        const result =
          capturedTarget.kind === "product"
            ? await options.api!.listProductMedia(input, scopedSignal)
            : await options.api!.listVariantMedia(
                { ...input, variantUuid: capturedTarget.variantUuid },
                scopedSignal,
              );
        assertMediaAccess(options, capturedTarget);
        return result;
      } catch (error) {
        options.session.scope.assertCurrent(options.scope);
        const normalized = normalizeUnexpectedError(error);
        handleMediaAuthorityError(options, normalized);
        throw normalized;
      }
    },
    signal,
  );
}
export function useMedia(target: MediaTarget) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state } = useStores();
  const scope = state.scope!;
  return useQuery({
    queryKey: mediaKeys.list(scope, target),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => loadScopedMedia({ api, session, stores, scope }, target, signal),
  });
}
