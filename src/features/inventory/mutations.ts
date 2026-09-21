"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { ProductInventory } from "./contracts";
import { inventoryQuantitySchema } from "./model";
import {
  assertInventoryAccess,
  handleInventoryAuthorityError,
  inventoryKeys,
  type InventoryAuthority,
} from "./queries";

export interface InventoryMutationState {
  readonly status:
    "idle" | "pending" | "success" | "error" | "unknown" | "reconciling" | "reviewing";
  /** Local interaction identity only; never an API concurrency token. */
  readonly slot: number;
  readonly inventory: ProductInventory | null;
  readonly product: MerchantProduct | null;
  readonly error: ApiError | null;
  readonly refreshError: ApiError | null;
  readonly guidance?: "current-inventory-reviewed";
  readonly reviewedUnknown?: boolean;
}

interface InventoryMutationOptions extends InventoryAuthority {
  product: MerchantProduct;
}

const initialState: InventoryMutationState = Object.freeze({
  status: "idle",
  slot: 0,
  inventory: null,
  product: null,
  error: null,
  refreshError: null,
});

export function createInventoryMutationController(options: InventoryMutationOptions) {
  const { api, session, stores, scope } = options;
  const productUuid = options.product.id;
  let observedProduct = options.product;
  let state = initialState;
  let pending: Promise<ProductInventory | null> | null = null;
  let review: Promise<ProductInventory | null> | null = null;
  const listeners = new Set<() => void>();

  function update(next: InventoryMutationState) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function isCurrent() {
    return session.scope.getScope() === scope && stores.getSnapshot().scope === scope;
  }

  function assertEditable() {
    assertInventoryAccess(options, true);
    const currentProduct = session.queryClient.getQueryData<MerchantProduct>(
      productKeys.detail(scope, productUuid),
    );
    for (const product of [observedProduct, state.product, currentProduct]) {
      if (
        product &&
        (product.id !== productUuid || product.type !== "simple" || product.status === "archived")
      )
        throw new ApiError("validation");
    }
  }

  async function publishInventory(inventory: ProductInventory, product?: MerchantProduct) {
    const key = inventoryKeys.detail(scope, productUuid);
    // Cancel an older inventory read before publishing confirmed/current observed data.
    await session.queryClient.cancelQueries({ queryKey: key, exact: true });
    assertInventoryAccess(options);
    if (product) {
      await session.queryClient.cancelQueries({
        queryKey: productKeys.detail(scope, productUuid),
        exact: true,
      });
      assertInventoryAccess(options);
      session.queryClient.setQueryData(productKeys.detail(scope, productUuid), product);
    }
    session.queryClient.setQueryData(key, inventory);
  }

  async function refreshProductProjections() {
    // These reads may fail independently of an already confirmed inventory mutation.
    await Promise.all([
      session.queryClient.invalidateQueries(
        { queryKey: productKeys.detail(scope, productUuid), exact: true },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: storeKeys.resource(scope, "products") },
        { throwOnError: true },
      ),
    ]);
  }

  function reviewCurrent(expectedSlot: number, requiredStatus: "unknown" | "success") {
    if (expectedSlot !== state.slot) return Promise.resolve(null);
    if (review) return review;
    if (pending || state.status !== requiredStatus) return Promise.resolve(null);
    const previous = state;
    const task = Promise.resolve().then(async () => {
      try {
        assertInventoryAccess(options);
        const result = await session.scope.run(scope, async (signal) => {
          const [inventory, product] = await Promise.all([
            api!.loadProductInventory({ storeUuid: scope.storeUuid, productUuid }, signal),
            api!.loadProduct({ storeUuid: scope.storeUuid, productUuid }, signal),
          ]);
          return { inventory, product };
        });
        assertInventoryAccess(options);
        if (result.product.id !== productUuid || result.product.type !== "simple")
          throw new ApiError("invalid-response");
        await publishInventory(result.inventory, result.product);
        assertInventoryAccess(options);
        observedProduct = result.product;
        // Two reads show current observations, not an atomic snapshot or a receipt for
        // the uncertain write. A fresh slot never carries the old submitted quantity.
        update({
          ...initialState,
          slot: previous.slot + 1,
          inventory: result.inventory,
          product: result.product,
          guidance: "current-inventory-reviewed",
          reviewedUnknown: requiredStatus === "unknown",
        });
        return result.inventory;
      } catch (error) {
        if (!isCurrent()) return null;
        const normalized = normalizeUnexpectedError(error);
        update(
          requiredStatus === "success"
            ? { ...previous, refreshError: normalized }
            : { ...previous, error: normalized },
        );
        handleInventoryAuthorityError(options, normalized);
        return null;
      }
    });
    review = task;
    update({
      ...previous,
      status: requiredStatus === "unknown" ? "reconciling" : "reviewing",
      error: null,
    });
    void task.finally(() => {
      if (review === task) review = null;
    });
    return task;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    observeProduct(product: MerchantProduct) {
      if (product.id === productUuid) observedProduct = product;
    },
    execute(quantity: number, expectedSlot = state.slot): Promise<ProductInventory | null> {
      if (expectedSlot !== state.slot) return Promise.resolve(null);
      if (pending) return pending;
      if (review || state.status === "unknown" || state.status === "success")
        return Promise.resolve(null);
      const previous = state;
      const task = Promise.resolve().then(async () => {
        let invoked = false;
        let inventory: ProductInventory;
        try {
          assertEditable();
          if (!inventoryQuantitySchema.safeParse(quantity).success)
            throw new ApiError("configuration");
          inventory = await session.scope.run(scope, (signal) => {
            assertEditable();
            invoked = true;
            return api!.updateProductInventory(
              { storeUuid: scope.storeUuid, productUuid, data: { quantity } },
              signal,
            );
          });
          assertInventoryAccess(options, true);
        } catch (error) {
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          const unknown =
            normalized.mutationOutcome === "unknown" || (invoked && !(error instanceof ApiError));
          update({
            ...previous,
            status: unknown ? "unknown" : "error",
            error: normalized,
            refreshError: null,
          });
          handleInventoryAuthorityError(options, normalized);
          return null;
        }
        // Once the PATCH response is confirmed, later cache/read failures cannot
        // relabel this write as unknown or renew its consumed interaction.
        let cacheError: ApiError | null = null;
        try {
          await publishInventory(inventory);
        } catch (error) {
          cacheError = normalizeUnexpectedError(error);
        }
        if (!isCurrent()) return null;
        // Projection refresh is independent: a completed write must not leave an
        // apparently enabled explicit review silently waiting on another GET.
        if (pending === task) pending = null;
        update({
          ...previous,
          status: "success",
          inventory,
          error: null,
          refreshError: cacheError,
        });
        if (cacheError) handleInventoryAuthorityError(options, cacheError);
        else
          void refreshProductProjections().catch((error: unknown) => {
            if (
              !isCurrent() ||
              state.slot !== previous.slot ||
              !["success", "reviewing"].includes(state.status)
            )
              return;
            const normalized = normalizeUnexpectedError(error);
            update({ ...state, refreshError: normalized });
            handleInventoryAuthorityError(options, normalized);
          });
        return inventory;
      });
      // Latch before notifying subscribers, including synchronous reentrant submits.
      pending = task;
      update({ ...previous, status: "pending", error: null, refreshError: null });
      void task.finally(() => {
        if (pending === task) pending = null;
      });
      return task;
    },
    reconcile: (expectedSlot = state.slot) => reviewCurrent(expectedSlot, "unknown"),
    reviewSuccess: (expectedSlot = state.slot) => reviewCurrent(expectedSlot, "success"),
  };
}

// Session-owned memory-only slots survive component remounts. Abandoned sessions
// and authority revisions are weak keys and cannot lend another scope permission.
const mutationControllers = new WeakMap<
  InventoryMutationOptions["session"],
  WeakMap<QueryScope, Map<string, ReturnType<typeof createInventoryMutationController>>>
>();

export function getInventoryMutationController(options: InventoryMutationOptions) {
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
  let controller = products.get(options.product.id);
  if (!controller) {
    controller = createInventoryMutationController(options);
    products.set(options.product.id, controller);
  } else controller.observeProduct(options.product);
  return controller;
}

export function useInventoryMutation(product: MerchantProduct) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state: store } = useStores();
  const scope = store.scope!;
  const controller = useMemo(
    () => getInventoryMutationController({ api, session, stores, scope, product }),
    [api, session, stores, scope, product],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return {
    state,
    isPending: ["pending", "reconciling", "reviewing"].includes(state.status),
    isBlocked: ["pending", "reconciling", "reviewing", "unknown", "success"].includes(state.status),
    execute: (quantity: number) => controller.execute(quantity, state.slot),
    reconcile: () => controller.reconcile(state.slot),
    reviewSuccess: () => controller.reviewSuccess(state.slot),
  };
}
