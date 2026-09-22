"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { MerchantProductOption, MerchantVariant } from "./contracts";
import {
  optionPayloadSchema,
  valuePayloadSchema,
  createVariantPayloadSchema,
  updateVariantPayloadSchema,
  isCompleteVariantCombination,
  maximumProductOptions,
  maximumOptionValues,
  maximumProductVariants,
  type OptionPayload,
  type ValuePayload,
  type CreateVariantPayload,
  type UpdateVariantPayload,
} from "./model";
import {
  assertVariantAccess,
  handleVariantAuthorityError,
  variantKeys,
  type VariantAuthority,
} from "./queries";

export type VariantOperation =
  | { readonly kind: "option.create"; readonly data: OptionPayload }
  | { readonly kind: "option.update"; readonly optionUuid: string; readonly data: OptionPayload }
  | { readonly kind: "value.create"; readonly optionUuid: string; readonly data: ValuePayload }
  | {
      readonly kind: "value.update";
      readonly optionUuid: string;
      readonly valueUuid: string;
      readonly data: ValuePayload;
    }
  | { readonly kind: "variant.create"; readonly data: CreateVariantPayload }
  | {
      readonly kind: "variant.update";
      readonly variantUuid: string;
      readonly data: UpdateVariantPayload;
    };

export type VariantMutationResult = MerchantProductOption | MerchantVariant;

export interface VariantMutationState {
  readonly status:
    "idle" | "pending" | "success" | "error" | "unknown" | "reconciling" | "reviewing";
  /** A local consumed interaction, never a backend idempotency or concurrency token. */
  readonly slot: number;
  readonly operation: VariantOperation | null;
  readonly result: VariantMutationResult | null;
  readonly product: MerchantProduct | null;
  readonly options: readonly MerchantProductOption[] | null;
  readonly variants: readonly MerchantVariant[] | null;
  readonly error: ApiError | null;
  readonly refreshError: ApiError | null;
  readonly guidance?: "current-configuration-reviewed";
  readonly reviewedUnknown?: boolean;
}

interface VariantMutationOptions extends VariantAuthority {
  product: MerchantProduct;
}

const initialState: VariantMutationState = Object.freeze({
  status: "idle",
  slot: 0,
  operation: null,
  result: null,
  product: null,
  options: null,
  variants: null,
  error: null,
  refreshError: null,
});

function snapshotOperation(operation: VariantOperation): VariantOperation {
  // Copy the submitted data before the asynchronous dispatch boundary. A caller
  // changing a form object cannot change an already consumed transaction.
  if (operation.kind === "variant.create")
    return Object.freeze({
      ...operation,
      data: Object.freeze({
        ...operation.data,
        value_ids: Object.freeze([...operation.data.value_ids]) as unknown as string[],
      }),
    });
  return Object.freeze({
    ...operation,
    data: Object.freeze({ ...operation.data }),
  }) as VariantOperation;
}

function sameCombination(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((id) => right.some((value) => value.toLowerCase() === id.toLowerCase()))
  );
}

export function createVariantMutationController(authority: VariantMutationOptions) {
  const { api, session, stores, scope } = authority;
  const productUuid = authority.product.id;
  let observedProduct = authority.product;
  let state = initialState;
  let pending: Promise<VariantMutationResult | null> | null = null;
  let reviewing: Promise<VariantMutationState | null> | null = null;
  const listeners = new Set<() => void>();
  const optionsKey = variantKeys.options(scope, productUuid);
  const listKey = variantKeys.list(scope, productUuid);
  const productKey = productKeys.detail(scope, productUuid);

  function update(next: VariantMutationState) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }
  function isCurrent() {
    return session.scope.getScope() === scope && stores.getSnapshot().scope === scope;
  }
  function assertEditable(operation: VariantOperation) {
    assertVariantAccess(authority, operation.kind.endsWith(".create") ? "create" : "update");
    const current = session.queryClient.getQueryData<MerchantProduct>(productKey);
    for (const product of [observedProduct, state.product, current])
      if (
        product &&
        (product.id !== productUuid || product.type !== "variant" || product.status === "archived")
      )
        throw new ApiError("validation");
    const options = session.queryClient.getQueryData<readonly MerchantProductOption[]>(optionsKey);
    const variants = session.queryClient.getQueryData<readonly MerchantVariant[]>(listKey);
    // The UI loads both collections before editing; Laravel remains the final
    // authority for races, uniqueness and limits after these observations.
    if (!options || !variants) throw new ApiError("configuration");
    if (operation.kind === "option.create") {
      if (
        !optionPayloadSchema.safeParse(operation.data).success ||
        options.length >= maximumProductOptions ||
        variants.length > 0
      )
        throw new ApiError("validation");
    } else if (operation.kind === "option.update") {
      if (
        !optionPayloadSchema.safeParse(operation.data).success ||
        !options.some((option) => option.id === operation.optionUuid)
      )
        throw new ApiError("validation");
    } else if (operation.kind === "value.create" || operation.kind === "value.update") {
      const option = options.find((option) => option.id === operation.optionUuid);
      if (
        !valuePayloadSchema.safeParse(operation.data).success ||
        !option ||
        (operation.kind === "value.create"
          ? option.values.length >= maximumOptionValues
          : !option.values.some((value) => value.id === operation.valueUuid))
      )
        throw new ApiError("validation");
    } else if (operation.kind === "variant.create") {
      if (
        !createVariantPayloadSchema.safeParse(operation.data).success ||
        variants.length >= maximumProductVariants ||
        !isCompleteVariantCombination(options, operation.data.value_ids) ||
        variants.some((variant) => sameCombination(variant.value_ids, operation.data.value_ids))
      )
        throw new ApiError("validation");
    } else if (
      !updateVariantPayloadSchema.safeParse(operation.data).success ||
      !variants.some((variant) => variant.id === operation.variantUuid)
    )
      throw new ApiError("validation");
  }
  function dispatch(
    operation: VariantOperation,
    signal: AbortSignal,
  ): Promise<VariantMutationResult> {
    const target = { storeUuid: scope.storeUuid, productUuid };
    switch (operation.kind) {
      case "option.create":
        return api!.createProductOption({ ...target, data: operation.data }, signal);
      case "option.update":
        return api!.updateProductOption(
          { ...target, optionUuid: operation.optionUuid, data: operation.data },
          signal,
        );
      case "value.create":
        return api!.createProductOptionValue(
          { ...target, optionUuid: operation.optionUuid, data: operation.data },
          signal,
        );
      case "value.update":
        return api!.updateProductOptionValue(
          {
            ...target,
            optionUuid: operation.optionUuid,
            valueUuid: operation.valueUuid,
            data: operation.data,
          },
          signal,
        );
      case "variant.create":
        return api!.createProductVariant({ ...target, data: operation.data }, signal);
      case "variant.update":
        return api!.updateProductVariant(
          { ...target, variantUuid: operation.variantUuid, data: operation.data },
          signal,
        );
    }
  }
  function assertResult(operation: VariantOperation, result: VariantMutationResult) {
    if (operation.kind.startsWith("variant.")) {
      if (
        !("value_ids" in result) ||
        (operation.kind === "variant.update" &&
          (result.id !== operation.variantUuid ||
            !sameCombination(
              result.value_ids,
              session.queryClient
                .getQueryData<readonly MerchantVariant[]>(listKey)
                ?.find((variant) => variant.id === operation.variantUuid)?.value_ids ?? [],
            ))) ||
        (operation.kind === "variant.create" &&
          !sameCombination(result.value_ids, operation.data.value_ids))
      )
        throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
    } else if (
      !("values" in result) ||
      ("optionUuid" in operation && result.id !== operation.optionUuid) ||
      (operation.kind === "value.update" &&
        !result.values.some((value) => value.id === operation.valueUuid))
    )
      throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
  }
  const isProductDetail = (query: { queryKey: readonly unknown[] }) => {
    const target = query.queryKey[query.queryKey.length - 1];
    return (
      typeof target === "object" &&
      target !== null &&
      "productUuid" in target &&
      target.productUuid === productUuid
    );
  };
  async function cancelReads() {
    await Promise.all([
      session.queryClient.cancelQueries({ queryKey: optionsKey, exact: true }),
      session.queryClient.cancelQueries({ queryKey: listKey, exact: true }),
      session.queryClient.cancelQueries({ queryKey: productKey, exact: true }),
      session.queryClient.cancelQueries({
        queryKey: storeKeys.resource(scope, "product-variant"),
        predicate: isProductDetail,
      }),
    ]);
    assertVariantAccess(authority);
  }
  async function publishResult(result: VariantMutationResult) {
    await cancelReads();
    if ("values" in result) {
      session.queryClient.setQueryData<MerchantProductOption[]>(optionsKey, (current) =>
        current
          ? [...current.filter((option) => option.id !== result.id), result].sort(
              (a, b) => a.position - b.position,
            )
          : undefined,
      );
    } else {
      session.queryClient.setQueryData(variantKeys.detail(scope, productUuid, result.id), result);
      session.queryClient.setQueryData<MerchantVariant[]>(listKey, (current) =>
        current ? [...current.filter((variant) => variant.id !== result.id), result] : undefined,
      );
    }
  }
  async function refreshProjections() {
    await Promise.all([
      session.queryClient.invalidateQueries(
        { queryKey: optionsKey, exact: true },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: listKey, exact: true },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: productKey, exact: true },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: storeKeys.resource(scope, "product-variant"), predicate: isProductDetail },
        { throwOnError: true },
      ),
      session.queryClient.invalidateQueries(
        { queryKey: storeKeys.resource(scope, "products") },
        { throwOnError: true },
      ),
    ]);
  }

  function reviewCurrent(expectedSlot = state.slot): Promise<VariantMutationState | null> {
    if (expectedSlot !== state.slot) return Promise.resolve(null);
    if (reviewing) return reviewing;
    if (pending || (state.status !== "success" && state.status !== "unknown"))
      return Promise.resolve(null);
    const previous = state;
    const task = Promise.resolve().then(async () => {
      try {
        assertVariantAccess(authority);
        const target = { storeUuid: scope.storeUuid, productUuid };
        const result = await session.scope.run(scope, async (signal) => {
          const [product, options, variants] = await Promise.all([
            api!.loadProduct(target, signal),
            api!.listProductOptions(target, signal),
            api!.listProductVariants(target, signal),
          ]);
          return { product, options, variants };
        });
        assertVariantAccess(authority);
        if (
          result.product.id !== productUuid ||
          result.product.type !== "variant" ||
          result.variants.some(
            (variant) => !isCompleteVariantCombination(result.options, variant.value_ids),
          )
        )
          throw new ApiError("invalid-response");
        await cancelReads();
        session.queryClient.setQueryData(productKey, result.product);
        session.queryClient.setQueryData(optionsKey, result.options);
        session.queryClient.setQueryData(listKey, result.variants);
        for (const variant of result.variants)
          session.queryClient.setQueryData(
            variantKeys.detail(scope, productUuid, variant.id),
            variant,
          );
        observedProduct = result.product;
        // Separate GETs describe current observations, not an atomic snapshot or
        // a receipt. A fresh interaction never carries the old submitted payload.
        update({
          ...initialState,
          slot: previous.slot + 1,
          ...result,
          guidance: "current-configuration-reviewed",
          reviewedUnknown: previous.status === "unknown",
        });
        return state;
      } catch (error) {
        if (!isCurrent()) return null;
        const normalized = normalizeUnexpectedError(error);
        update(
          previous.status === "success"
            ? { ...previous, refreshError: normalized }
            : { ...previous, error: normalized },
        );
        handleVariantAuthorityError(authority, normalized);
        return null;
      }
    });
    reviewing = task;
    update({
      ...previous,
      status: previous.status === "unknown" ? "reconciling" : "reviewing",
      error: null,
    });
    void task.finally(() => {
      if (reviewing === task) reviewing = null;
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
    execute(
      input: VariantOperation,
      expectedSlot = state.slot,
    ): Promise<VariantMutationResult | null> {
      if (expectedSlot !== state.slot) return Promise.resolve(null);
      if (pending) return pending;
      if (reviewing || state.status === "unknown" || state.status === "success")
        return Promise.resolve(null);
      const operation = snapshotOperation(input);
      const previous = state;
      const task = Promise.resolve().then(async () => {
        let invoked = false;
        let result: VariantMutationResult;
        try {
          assertEditable(operation);
          result = await session.scope.run(scope, (signal) => {
            assertEditable(operation);
            invoked = true;
            return dispatch(operation, signal);
          });
          assertVariantAccess(authority, operation.kind.endsWith(".create") ? "create" : "update");
          assertResult(operation, result);
        } catch (error) {
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          const unknown =
            normalized.mutationOutcome === "unknown" || (invoked && !(error instanceof ApiError));
          update({
            ...previous,
            operation,
            result: null,
            status: unknown ? "unknown" : "error",
            error: normalized,
            refreshError: null,
          });
          handleVariantAuthorityError(authority, normalized);
          return null;
        }
        let cacheError: ApiError | null = null;
        try {
          await publishResult(result);
        } catch (error) {
          cacheError = normalizeUnexpectedError(error);
        }
        if (!isCurrent()) return null;
        // Confirmation consumes the interaction even if secondary reads fail.
        if (pending === task) pending = null;
        update({
          ...previous,
          operation,
          result,
          status: "success",
          error: null,
          refreshError: cacheError,
        });
        if (cacheError) handleVariantAuthorityError(authority, cacheError);
        else
          void refreshProjections().catch((error: unknown) => {
            if (
              !isCurrent() ||
              state.slot !== previous.slot ||
              !["success", "reviewing"].includes(state.status)
            )
              return;
            const normalized = normalizeUnexpectedError(error);
            update({ ...state, refreshError: normalized });
            handleVariantAuthorityError(authority, normalized);
          });
        return result;
      });
      // Latch before synchronous subscribers can submit another operation.
      pending = task;
      update({
        ...previous,
        operation,
        result: null,
        status: "pending",
        error: null,
        refreshError: null,
      });
      void task.finally(() => {
        if (pending === task) pending = null;
      });
      return task;
    },
    review: reviewCurrent,
  };
}

const controllers = new WeakMap<
  VariantMutationOptions["session"],
  WeakMap<QueryScope, Map<string, ReturnType<typeof createVariantMutationController>>>
>();

export function getVariantMutationController(options: VariantMutationOptions) {
  let scopes = controllers.get(options.session);
  if (!scopes) {
    scopes = new WeakMap();
    controllers.set(options.session, scopes);
  }
  let products = scopes.get(options.scope);
  if (!products) {
    products = new Map();
    scopes.set(options.scope, products);
  }
  let controller = products.get(options.product.id);
  if (!controller) {
    controller = createVariantMutationController(options);
    products.set(options.product.id, controller);
  } else controller.observeProduct(options.product);
  return controller;
}

export function useVariantMutation(product: MerchantProduct) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state: store } = useStores();
  const scope = store.scope!;
  const controller = useMemo(
    () => getVariantMutationController({ api, session, stores, scope, product }),
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
    execute: (operation: VariantOperation) => controller.execute(operation, state.slot),
    review: () => controller.review(state.slot),
  };
}
