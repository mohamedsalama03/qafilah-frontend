"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { StoreController } from "@/lib/stores/controller";
import type { MerchantProduct, ProductPage } from "./contracts";
import { normalizeProductCriteria } from "./model";
import { productMutationPermissions } from "./mutation-model";
import { productKeys } from "./queries";

export type ProductMutationCommand =
  | { action: "create"; data: Parameters<MerchantApi["createProduct"]>[0]["data"] }
  | { action: "update"; data: Parameters<MerchantApi["updateProduct"]>[0]["data"] }
  | { action: "publish" | "unpublish" | "archive" };

export interface ProductMutationState {
  readonly status: "idle" | "pending" | "success" | "error" | "unknown" | "reconciling";
  readonly action: ProductMutationCommand["action"] | null;
  readonly error: ApiError | null;
  readonly product: MerchantProduct | null;
  readonly creationReviewed?: boolean;
}

interface ProductMutationOptions {
  api: MerchantApi | null;
  session: ReturnType<typeof useMerchantSession>;
  stores: StoreController;
  scope: QueryScope;
  productUuid?: string;
}

const initialState: ProductMutationState = Object.freeze({
  status: "idle",
  action: null,
  error: null,
  product: null,
});
/** No retry scheduler: every write begins with an explicit execute call. */
export function createProductMutationController(options: ProductMutationOptions) {
  const { session, stores, scope, api, productUuid } = options;
  let state = initialState;
  let pending: Promise<MerchantProduct | null> | null = null;
  let reconciliation: Promise<MerchantProduct | ProductPage | null> | null = null;
  const listeners = new Set<() => void>();

  function update(next: ProductMutationState) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function assertAccess(permission = "products.view") {
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
      !current.context.permissions.includes(permission)
    )
      throw new ApiError("forbidden");
    if (!api) throw new ApiError("configuration");
  }

  function isCurrent() {
    return session.scope.getScope() === scope && stores.getSnapshot().scope === scope;
  }

  function handleAuthorityError(error: ApiError) {
    if (error.kind === "unauthenticated" || error.kind === "session-expired")
      void session.auth.handleScopedReadError(error);
    else if (error.kind === "forbidden") void stores.revalidate();
  }

  async function reconcileCache(product: MerchantProduct) {
    // Stop an older GET from replacing the confirmed write response. All keys retain
    // the originating principal, Store and revision; another Store is never touched.
    const detailKey = productKeys.detail(scope, product.id);
    const listsKey = storeKeys.resource(scope, "products");
    await Promise.all([
      session.queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      session.queryClient.cancelQueries({ queryKey: listsKey }),
    ]);
    assertAccess();
    session.queryClient.setQueryData(detailKey, product);
    void session.queryClient.invalidateQueries({ queryKey: listsKey });
  }

  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    execute(command: ProductMutationCommand): Promise<MerchantProduct | null> {
      if (pending) return pending;
      if (reconciliation || state.status === "unknown") return Promise.resolve(null);
      const task = Promise.resolve().then(async () => {
        let invoked = false;
        try {
          assertAccess(productMutationPermissions[command.action]);
          if ((command.action === "create") === Boolean(productUuid))
            throw new ApiError("configuration");
          const product = await session.scope.run(scope, async (signal) => {
            assertAccess(productMutationPermissions[command.action]);
            invoked = true;
            switch (command.action) {
              case "create":
                return api!.createProduct(
                  { storeUuid: scope.storeUuid, data: command.data },
                  signal,
                );
              case "update":
                return api!.updateProduct(
                  { storeUuid: scope.storeUuid, productUuid: productUuid!, data: command.data },
                  signal,
                );
              case "publish":
                return api!.publishProduct(
                  { storeUuid: scope.storeUuid, productUuid: productUuid! },
                  signal,
                );
              case "unpublish":
                return api!.unpublishProduct(
                  { storeUuid: scope.storeUuid, productUuid: productUuid! },
                  signal,
                );
              case "archive":
                return api!.archiveProduct(
                  { storeUuid: scope.storeUuid, productUuid: productUuid! },
                  signal,
                );
            }
          });
          assertAccess(productMutationPermissions[command.action]);
          if (stores.getSnapshot().context?.permissions.includes("products.view"))
            await reconcileCache(product);
          assertAccess(productMutationPermissions[command.action]);
          update({ status: "success", action: command.action, error: null, product });
          return product;
        } catch (error) {
          // Cancellation after dispatch does not prove rollback. The old screen has
          // lost authority, so neither an old result nor an old failure is published.
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          const unknown =
            normalized.mutationOutcome === "unknown" || (invoked && !(error instanceof ApiError));
          update({
            status: unknown ? "unknown" : "error",
            action: command.action,
            error: normalized,
            product: null,
          });
          handleAuthorityError(normalized);
          return null;
        }
      });
      // Install the latch before notifying React: even synchronous repeated events
      // receive this same operation, never a second request.
      pending = task;
      update({ status: "pending", action: command.action, error: null, product: null });
      void task.finally(() => {
        if (pending === task) pending = null;
      });
      return task;
    },
    reconcile(): Promise<MerchantProduct | ProductPage | null> {
      if (reconciliation) return reconciliation;
      if (pending || state.status !== "unknown") return Promise.resolve(null);
      const previous = state;
      const task = Promise.resolve().then(async () => {
        try {
          assertAccess();
          const result = await session.scope.run<MerchantProduct | ProductPage>(scope, (signal) =>
            productUuid
              ? api!.loadProduct({ storeUuid: scope.storeUuid, productUuid }, signal)
              : api!.listProducts(
                  { storeUuid: scope.storeUuid, criteria: normalizeProductCriteria() },
                  signal,
                ),
          );
          assertAccess();
          if ("products" in result) {
            // A finite list cannot establish that an uncertain create did not commit.
            // Keep this form locked; the user can inspect the list and start separately.
            void session.queryClient.invalidateQueries({
              queryKey: storeKeys.resource(scope, "products"),
            });
            update({ ...previous, status: "unknown", creationReviewed: true });
          } else {
            await reconcileCache(result);
            assertAccess();
            update({ status: "idle", action: null, error: null, product: result });
          }
          return result;
        } catch (error) {
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          update({ ...previous, status: "unknown", error: normalized, creationReviewed: false });
          handleAuthorityError(normalized);
          return null;
        }
      });
      reconciliation = task;
      update({ ...previous, status: "reconciling" });
      void task.finally(() => {
        if (reconciliation === task) reconciliation = null;
      });
      return task;
    },
    /** Separate user intent after reviewing the list; never resends the previous input. */
    startSeparateCreate(): boolean {
      if (
        productUuid ||
        pending ||
        reconciliation ||
        state.status !== "unknown" ||
        !state.creationReviewed
      )
        return false;
      try {
        assertAccess(productMutationPermissions.create);
      } catch {
        return false;
      }
      update(initialState);
      return true;
    },
  };
  return controller;
}

// A page/query refresh may remount controls while a write is pending or uncertain.
// These memory-only slots belong to the provider and exact authority scope. Weak
// keys do not keep an abandoned session/scope (or its private result) alive.
const mutationControllers = new WeakMap<
  ProductMutationOptions["session"],
  WeakMap<QueryScope, Map<string, ReturnType<typeof createProductMutationController>>>
>();

export function getProductMutationController(options: ProductMutationOptions) {
  let scopes = mutationControllers.get(options.session);
  if (!scopes) {
    scopes = new WeakMap();
    mutationControllers.set(options.session, scopes);
  }
  let products = scopes.get(options.scope);
  if (!products) {
    products = new Map();
    scopes.set(options.scope, products);
  }
  const key = options.productUuid ?? "create";
  let controller = products.get(key);
  if (!controller) {
    controller = createProductMutationController(options);
    products.set(key, controller);
  }
  return controller;
}

export function useProductMutation(productUuid?: string) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state: store } = useStores();
  const scope = store.scope!;
  const controller = useMemo(
    () => getProductMutationController({ api, session, stores, scope, productUuid }),
    [api, session, stores, scope, productUuid],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return {
    state,
    isPending: state.status === "pending" || state.status === "reconciling",
    isBlocked:
      state.status === "pending" || state.status === "reconciling" || state.status === "unknown",
    execute: controller.execute,
    reconcile: controller.reconcile,
    canStartSeparateCreate: !productUuid && state.status === "unknown" && !!state.creationReviewed,
    startSeparateCreate: controller.startSeparateCreate,
  };
}
