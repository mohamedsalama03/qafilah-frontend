"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import type { MerchantVariant } from "@/features/variants/contracts";
import { variantKeys } from "@/features/variants/queries";
import { productKeys } from "@/features/products/queries";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { VariantInventory } from "./contracts";
import { variantInventoryQuantitySchema } from "./model";
import {
  assertVariantInventoryAccess,
  handleVariantInventoryAuthorityError,
  variantInventoryKeys,
  type VariantInventoryAuthority,
} from "./queries";

export interface VariantInventoryMutationState {
  readonly status:
    "idle" | "pending" | "success" | "error" | "unknown" | "reconciling" | "reviewing";
  /** Local interaction identity only; never an API concurrency token. */
  readonly slot: number;
  readonly inventory: VariantInventory | null;
  readonly product: MerchantProduct | null;
  readonly variant: MerchantVariant | null;
  readonly error: ApiError | null;
  readonly refreshError: ApiError | null;
  readonly guidance?: "current-inventory-reviewed";
  readonly reviewedUnknown?: boolean;
}

interface VariantInventoryMutationOptions extends VariantInventoryAuthority {
  product: MerchantProduct;
  variant: MerchantVariant;
}

const initialState: VariantInventoryMutationState = Object.freeze({
  status: "idle",
  slot: 0,
  inventory: null,
  product: null,
  variant: null,
  error: null,
  refreshError: null,
});

// A quantity-free safety barrier survives Store navigation and authority refresh. It carries
// no response, payload, permission, or executable request into the replacement scope.
const unresolvedOperations = new WeakMap<
  VariantInventoryMutationOptions["session"],
  Map<string, symbol>
>();

export function createVariantInventoryMutationController(options: VariantInventoryMutationOptions) {
  const { api, session, stores, scope } = options;
  const productUuid = options.product.id;
  const variantUuid = options.variant.id;
  const unresolvedIdentity = JSON.stringify([
    scope.principalId,
    scope.storeUuid,
    productUuid,
    variantUuid,
  ]);
  let operations = unresolvedOperations.get(session);
  if (!operations) {
    operations = new Map();
    unresolvedOperations.set(session, operations);
  }
  const unresolved = operations;
  const clearOperation = (operation: symbol | undefined) => {
    // An older completion/review must never clear a different, newer uncertain attempt.
    if (operation && unresolved.get(unresolvedIdentity) === operation)
      unresolved.delete(unresolvedIdentity);
  };
  let observedProduct = options.product;
  let state: VariantInventoryMutationState = unresolved.has(unresolvedIdentity)
    ? Object.freeze({ ...initialState, status: "unknown" })
    : initialState;
  let pending: Promise<VariantInventory | null> | null = null;
  let review: Promise<VariantInventory | null> | null = null;
  const listeners = new Set<() => void>();

  function update(next: VariantInventoryMutationState) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function isCurrent() {
    return session.scope.getScope() === scope && stores.getSnapshot().scope === scope;
  }

  function assertEditable() {
    assertVariantInventoryAccess(options, true);
    const currentProduct = session.queryClient.getQueryData<MerchantProduct>(
      productKeys.detail(scope, productUuid),
    );
    const currentVariant = session.queryClient.getQueryData<MerchantVariant>(
      variantKeys.detail(scope, productUuid, variantUuid),
    );
    if (currentVariant && currentVariant.id !== variantUuid) throw new ApiError("invalid-response");
    for (const product of [observedProduct, state.product, currentProduct]) {
      if (
        product &&
        (product.id !== productUuid || product.type !== "variant" || product.status === "archived")
      )
        throw new ApiError("validation");
    }
  }

  async function publishInventory(
    inventory: VariantInventory,
    product?: MerchantProduct,
    variant?: MerchantVariant,
  ) {
    const key = variantInventoryKeys.detail(scope, productUuid, variantUuid);
    // Cancel an older inventory read before publishing confirmed/current observed data.
    await session.queryClient.cancelQueries({ queryKey: key, exact: true });
    assertVariantInventoryAccess(options);
    if (product) {
      await session.queryClient.cancelQueries({
        queryKey: productKeys.detail(scope, productUuid),
        exact: true,
      });
      assertVariantInventoryAccess(options);
      session.queryClient.setQueryData(productKeys.detail(scope, productUuid), product);
    }
    if (variant) {
      await session.queryClient.cancelQueries({
        queryKey: variantKeys.detail(scope, productUuid, variantUuid),
        exact: true,
      });
      assertVariantInventoryAccess(options);
      session.queryClient.setQueryData(
        variantKeys.detail(scope, productUuid, variantUuid),
        variant,
      );
    }
    session.queryClient.setQueryData(key, inventory);
  }

  async function refreshProductProjections() {
    // These reads may fail independently of an already confirmed inventory mutation.
    await Promise.all([
      session.queryClient.invalidateQueries(
        { queryKey: variantKeys.detail(scope, productUuid, variantUuid), exact: true },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: variantKeys.list(scope, productUuid), exact: true },
        { throwOnError: true },
      ),
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
    const reviewedOperation = unresolved.get(unresolvedIdentity);
    const task = Promise.resolve().then(async () => {
      try {
        assertVariantInventoryAccess(options);
        const result = await session.scope.run(scope, async (signal) => {
          const [inventory, product, variant] = await Promise.all([
            api!.loadVariantInventory(
              { storeUuid: scope.storeUuid, productUuid, variantUuid },
              signal,
            ),
            api!.loadProduct({ storeUuid: scope.storeUuid, productUuid }, signal),
            api!.loadProductVariant(
              { storeUuid: scope.storeUuid, productUuid, variantUuid },
              signal,
            ),
          ]);
          return { inventory, product, variant };
        });
        assertVariantInventoryAccess(options);
        if (
          result.product.id !== productUuid ||
          result.product.type !== "variant" ||
          result.variant.id !== variantUuid
        )
          throw new ApiError("invalid-response");
        await publishInventory(result.inventory, result.product, result.variant);
        assertVariantInventoryAccess(options);
        observedProduct = result.product;
        clearOperation(reviewedOperation);
        // These reads show current observations, not an atomic snapshot or a receipt for
        // the uncertain write. A fresh slot never carries the old submitted quantity.
        update({
          ...initialState,
          slot: previous.slot + 1,
          inventory: result.inventory,
          product: result.product,
          variant: result.variant,
          // A concurrent later attempt has not been reviewed by these observations.
          status: unresolved.has(unresolvedIdentity) ? "unknown" : "idle",
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
        handleVariantInventoryAuthorityError(options, normalized);
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
    execute(quantity: number, expectedSlot = state.slot): Promise<VariantInventory | null> {
      if (expectedSlot !== state.slot) return Promise.resolve(null);
      if (pending) return pending;
      if (review || state.status === "unknown" || state.status === "success")
        return Promise.resolve(null);
      const previous = state;
      const task = Promise.resolve().then(async () => {
        let invoked = false;
        let operation: symbol | undefined;
        let inventory: VariantInventory;
        try {
          assertEditable();
          if (unresolved.has(unresolvedIdentity)) {
            update({ ...previous, status: "unknown", error: null, refreshError: null });
            return null;
          }
          if (!variantInventoryQuantitySchema.safeParse(quantity).success)
            throw new ApiError("configuration");
          inventory = await session.scope.run(scope, (signal) => {
            assertEditable();
            // Start conservatively before the adapter can yield during CSRF. A known current-
            // scope pre-dispatch failure clears this token; abandoning the scope retains it.
            operation = Symbol("variant-inventory-attempt");
            unresolved.set(unresolvedIdentity, operation);
            invoked = true;
            return api!.updateVariantInventory(
              { storeUuid: scope.storeUuid, productUuid, variantUuid, data: { quantity } },
              signal,
            );
          });
          assertVariantInventoryAccess(options, true);
        } catch (error) {
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          const unknown =
            normalized.mutationOutcome === "unknown" || (invoked && !(error instanceof ApiError));
          if (!unknown) clearOperation(operation);
          update({
            ...previous,
            status: unknown ? "unknown" : "error",
            error: normalized,
            refreshError: null,
          });
          handleVariantInventoryAuthorityError(options, normalized);
          return null;
        }
        clearOperation(operation);
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
        if (cacheError) handleVariantInventoryAuthorityError(options, cacheError);
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
            handleVariantInventoryAuthorityError(options, normalized);
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
  VariantInventoryMutationOptions["session"],
  WeakMap<QueryScope, Map<string, ReturnType<typeof createVariantInventoryMutationController>>>
>();

export function getVariantInventoryMutationController(options: VariantInventoryMutationOptions) {
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
  const identity = JSON.stringify([options.product.id, options.variant.id]);
  let controller = products.get(identity);
  if (!controller) {
    controller = createVariantInventoryMutationController(options);
    products.set(identity, controller);
  } else controller.observeProduct(options.product);
  return controller;
}

export function useVariantInventoryMutation(product: MerchantProduct, variant: MerchantVariant) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state: store } = useStores();
  const scope = store.scope!;
  const controller = useMemo(
    () => getVariantInventoryMutationController({ api, session, stores, scope, product, variant }),
    [api, session, stores, scope, product, variant],
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
