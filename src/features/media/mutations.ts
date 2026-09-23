"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import type { MerchantVariant } from "@/features/variants/contracts";
import { variantKeys } from "@/features/variants/queries";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { storeKeys, type QueryScope } from "@/lib/query/keys";
import type { MerchantMedia, MediaTarget } from "./contracts";
import {
  productMediaUploadSchema,
  variantMediaUploadSchema,
  productMediaUpdateSchema,
  variantMediaUpdateSchema,
  maximumProductMedia,
  maximumVariantMedia,
  type CreateProductMediaPayload,
  type CreateVariantMediaPayload,
  type UpdateProductMediaPayload,
  type UpdateVariantMediaPayload,
} from "./model";
import {
  assertMediaAccess,
  handleMediaAuthorityError,
  mediaKeys,
  type MediaAuthority,
} from "./queries";

export type MediaIntent =
  | {
      readonly operation: "create";
      readonly data: CreateProductMediaPayload | CreateVariantMediaPayload;
    }
  | {
      readonly operation: "update";
      readonly mediaUuid: string;
      readonly data: UpdateProductMediaPayload | UpdateVariantMediaPayload;
    }
  | { readonly operation: "delete"; readonly mediaUuid: string };

export interface MediaMutationResult {
  readonly operation: MediaIntent["operation"];
  readonly media: MerchantMedia | null;
}

export interface MediaMutationState {
  readonly status:
    "idle" | "pending" | "success" | "error" | "unknown" | "reconciling" | "reviewing";
  /** A local consumed interaction; never an API receipt or concurrency token. */
  readonly slot: number;
  readonly operation: MediaIntent["operation"] | null;
  readonly result: MediaMutationResult | null;
  readonly collection: readonly MerchantMedia[] | null;
  readonly product: MerchantProduct | null;
  readonly variant: MerchantVariant | null;
  readonly error: ApiError | null;
  readonly refreshError: ApiError | null;
  readonly guidance?: "current-media-reviewed";
  readonly reviewedUnknown?: boolean;
}

interface MediaMutationOptions extends MediaAuthority {
  product: MerchantProduct;
  variant?: MerchantVariant;
}

const initialState: MediaMutationState = Object.freeze({
  status: "idle",
  slot: 0,
  operation: null,
  result: null,
  collection: null,
  product: null,
  variant: null,
  error: null,
  refreshError: null,
});

// A payload-free token survives Store navigation and authority refresh. In particular,
// no File, metadata, response or executable request crosses an authority revision here.
const unresolvedOperations = new WeakMap<MediaMutationOptions["session"], Map<string, symbol>>();

function targetFor(product: MerchantProduct, variant?: MerchantVariant): MediaTarget {
  return variant
    ? { kind: "variant", productUuid: product.id, variantUuid: variant.id }
    : { kind: "product", productUuid: product.id };
}

function snapshotIntent(intent: MediaIntent): MediaIntent {
  if (intent.operation === "delete") return Object.freeze({ ...intent });
  if (intent.operation === "create")
    return Object.freeze({ ...intent, data: Object.freeze({ ...intent.data }) });
  return Object.freeze({ ...intent, data: Object.freeze({ ...intent.data }) });
}

export function createMediaMutationController(options: MediaMutationOptions) {
  const { api, session, stores, scope } = options;
  const target = targetFor(options.product, options.variant);
  const { productUuid } = target;
  const collectionKey = mediaKeys.list(scope, target);
  const unresolvedIdentity = JSON.stringify([
    scope.principalId,
    scope.storeUuid,
    target.kind,
    productUuid,
    target.kind === "variant" ? target.variantUuid : null,
  ]);
  let operations = unresolvedOperations.get(session);
  if (!operations) {
    operations = new Map();
    unresolvedOperations.set(session, operations);
  }
  const unresolved = operations;
  const clearOperation = (operation: symbol | undefined) => {
    if (operation && unresolved.get(unresolvedIdentity) === operation)
      unresolved.delete(unresolvedIdentity);
  };
  let observedProduct = options.product;
  let state: MediaMutationState = unresolved.has(unresolvedIdentity)
    ? Object.freeze({ ...initialState, status: "unknown" })
    : initialState;
  let pending: Promise<MediaMutationResult | null> | null = null;
  let review: Promise<readonly MerchantMedia[] | null> | null = null;
  let readGeneration = 0;
  const listeners = new Set<() => void>();

  function update(next: MediaMutationState) {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }
  function isCurrent() {
    return session.scope.getScope() === scope && stores.getSnapshot().scope === scope;
  }
  function assertEditable(intent: MediaIntent) {
    assertMediaAccess(options, target, intent.operation);
    const cachedProduct = session.queryClient.getQueryData<MerchantProduct>(
      productKeys.detail(scope, productUuid),
    );
    for (const product of [observedProduct, state.product, cachedProduct]) {
      if (
        product &&
        (product.id !== productUuid ||
          product.status === "archived" ||
          (target.kind === "variant" && product.type !== "variant"))
      )
        throw new ApiError("validation");
    }
    if (target.kind === "variant") {
      const variant = session.queryClient.getQueryData<MerchantVariant>(
        variantKeys.detail(scope, productUuid, target.variantUuid),
      );
      if (variant && variant.id !== target.variantUuid) throw new ApiError("invalid-response");
    }
    const collection = session.queryClient.getQueryData<readonly MerchantMedia[]>(collectionKey);
    if (!collection) throw new ApiError("configuration");
    if (collection.some((media) => "is_primary" in media !== (target.kind === "product")))
      throw new ApiError("invalid-response");
    if (intent.operation === "create") {
      const schema =
        target.kind === "product" ? productMediaUploadSchema : variantMediaUploadSchema;
      if (
        !schema.safeParse(intent.data).success ||
        collection.length >= (target.kind === "product" ? maximumProductMedia : maximumVariantMedia)
      )
        throw new ApiError("validation");
    } else {
      if (!collection.some((media) => media.id === intent.mediaUuid))
        throw new ApiError("validation");
      if (intent.operation === "update") {
        const schema =
          target.kind === "product" ? productMediaUpdateSchema : variantMediaUpdateSchema;
        if (!schema.safeParse(intent.data).success) throw new ApiError("validation");
      }
    }
    return collection;
  }
  function loadCollection(signal: AbortSignal) {
    return target.kind === "product"
      ? api!.listProductMedia({ storeUuid: scope.storeUuid, productUuid }, signal)
      : api!.listVariantMedia(
          { storeUuid: scope.storeUuid, productUuid, variantUuid: target.variantUuid },
          signal,
        );
  }
  function assertReadCurrent(generation: number) {
    assertMediaAccess(options, target);
    if (generation !== readGeneration) throw new ApiError("cancelled");
  }
  async function publishCollection(
    collection: readonly MerchantMedia[],
    generation: number,
    product?: MerchantProduct,
    variant?: MerchantVariant,
  ) {
    await session.queryClient.cancelQueries({ queryKey: collectionKey, exact: true });
    assertReadCurrent(generation);
    if (product) {
      await session.queryClient.cancelQueries({
        queryKey: productKeys.detail(scope, productUuid),
        exact: true,
      });
      assertReadCurrent(generation);
      session.queryClient.setQueryData(productKeys.detail(scope, productUuid), product);
    }
    if (variant && target.kind === "variant") {
      await session.queryClient.cancelQueries({
        queryKey: variantKeys.detail(scope, productUuid, target.variantUuid),
        exact: true,
      });
      assertReadCurrent(generation);
      session.queryClient.setQueryData(
        variantKeys.detail(scope, productUuid, target.variantUuid),
        variant,
      );
    }
    // Preserve the server's complete ordering/primary decisions. A POST/PATCH result
    // cannot reconstruct Laravel's private association-ID tie-breaker.
    session.queryClient.setQueryData(collectionKey, collection);
  }
  async function refreshAfterSuccess(slot: number, generation: number) {
    try {
      assertReadCurrent(generation);
      const collection = await session.scope.run(scope, loadCollection);
      assertReadCurrent(generation);
      await publishCollection(collection, generation);
      if (state.slot === slot && state.status === "success") update({ ...state, collection });
      await Promise.all([
        session.queryClient.invalidateQueries(
          { queryKey: productKeys.detail(scope, productUuid), exact: true },
          { throwOnError: true },
        ),
        session.queryClient.invalidateQueries(
          { queryKey: storeKeys.resource(scope, "products") },
          { throwOnError: true },
        ),
        ...(target.kind === "variant"
          ? [
              session.queryClient.invalidateQueries(
                {
                  queryKey: variantKeys.detail(scope, productUuid, target.variantUuid),
                  exact: true,
                },
                { throwOnError: true },
              ),
              session.queryClient.invalidateQueries(
                { queryKey: variantKeys.list(scope, productUuid), exact: true },
                { throwOnError: true },
              ),
            ]
          : []),
      ]);
    } catch (error) {
      if (
        !isCurrent() ||
        generation !== readGeneration ||
        state.slot !== slot ||
        state.status !== "success"
      )
        return;
      const normalized = normalizeUnexpectedError(error);
      update({ ...state, refreshError: normalized });
      handleMediaAuthorityError(options, normalized);
    }
  }
  function dispatch(intent: MediaIntent, signal: AbortSignal): Promise<MerchantMedia | null> {
    const base = { storeUuid: scope.storeUuid, productUuid };
    if (target.kind === "product") {
      if (intent.operation === "create")
        return api!.createProductMedia({ ...base, data: intent.data }, signal);
      if (intent.operation === "update")
        return api!.updateProductMedia(
          { ...base, mediaUuid: intent.mediaUuid, data: intent.data },
          signal,
        );
      return api!
        .deleteProductMedia({ ...base, mediaUuid: intent.mediaUuid }, signal)
        .then(() => null);
    }
    const nested = { ...base, variantUuid: target.variantUuid };
    if (intent.operation === "create")
      return api!.createVariantMedia({ ...nested, data: intent.data }, signal);
    if (intent.operation === "update")
      return api!.updateVariantMedia(
        { ...nested, mediaUuid: intent.mediaUuid, data: intent.data },
        signal,
      );
    return api!
      .deleteVariantMedia({ ...nested, mediaUuid: intent.mediaUuid }, signal)
      .then(() => null);
  }
  function reviewCurrent(expectedSlot: number, requiredStatus: "unknown" | "success") {
    if (expectedSlot !== state.slot) return Promise.resolve(null);
    if (review) return review;
    if (pending || state.status !== requiredStatus) return Promise.resolve(null);
    const previous = state;
    const reviewedOperation = unresolved.get(unresolvedIdentity);
    const generation = ++readGeneration;
    const task = Promise.resolve().then(async () => {
      try {
        assertReadCurrent(generation);
        const result = await session.scope.run(scope, async (signal) => {
          const [collection, product, variant] = await Promise.all([
            loadCollection(signal),
            api!.loadProduct({ storeUuid: scope.storeUuid, productUuid }, signal),
            target.kind === "variant"
              ? api!.loadProductVariant(
                  { storeUuid: scope.storeUuid, productUuid, variantUuid: target.variantUuid },
                  signal,
                )
              : Promise.resolve(null),
          ]);
          return { collection, product, variant };
        });
        assertReadCurrent(generation);
        if (
          result.product.id !== productUuid ||
          (target.kind === "variant" &&
            (result.product.type !== "variant" || result.variant?.id !== target.variantUuid))
        )
          throw new ApiError("invalid-response");
        await publishCollection(
          result.collection,
          generation,
          result.product,
          result.variant ?? undefined,
        );
        assertReadCurrent(generation);
        observedProduct = result.product;
        clearOperation(reviewedOperation);
        // A fresh slot contains current observations, not attribution of an uncertain
        // upload/update/deletion. It carries no previous File or submitted metadata.
        update({
          ...initialState,
          slot: previous.slot + 1,
          collection: result.collection,
          product: result.product,
          variant: result.variant,
          status: unresolved.has(unresolvedIdentity) ? "unknown" : "idle",
          guidance: "current-media-reviewed",
          reviewedUnknown: requiredStatus === "unknown",
        });
        return result.collection;
      } catch (error) {
        if (!isCurrent()) return null;
        const normalized = normalizeUnexpectedError(error);
        update(
          requiredStatus === "success"
            ? { ...previous, refreshError: normalized }
            : { ...previous, error: normalized },
        );
        handleMediaAuthorityError(options, normalized);
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
    execute(input: MediaIntent, expectedSlot = state.slot): Promise<MediaMutationResult | null> {
      if (expectedSlot !== state.slot) return Promise.resolve(null);
      if (pending) return pending;
      if (review || state.status === "unknown" || state.status === "success")
        return Promise.resolve(null);
      const intent = snapshotIntent(input);
      const previous = state;
      const task = Promise.resolve().then(async () => {
        let invoked = false;
        let operation: symbol | undefined;
        let media: MerchantMedia | null;
        try {
          assertEditable(intent);
          if (unresolved.has(unresolvedIdentity)) {
            update({ ...previous, status: "unknown", error: null, refreshError: null });
            return null;
          }
          media = await session.scope.run(scope, (signal) => {
            const collection = assertEditable(intent);
            operation = Symbol("media-attempt");
            unresolved.set(unresolvedIdentity, operation);
            invoked = true;
            return dispatch(intent, signal).then((result) => {
              if (
                intent.operation !== "delete" &&
                (!result ||
                  "is_primary" in result !== (target.kind === "product") ||
                  (intent.operation === "update"
                    ? result.id !== intent.mediaUuid
                    : collection.some((asset) => asset.id === result.id)))
              )
                throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
              return result;
            });
          });
          assertMediaAccess(options, target, intent.operation);
        } catch (error) {
          if (!isCurrent()) return null;
          const normalized = normalizeUnexpectedError(error);
          const unknown =
            normalized.mutationOutcome === "unknown" || (invoked && !(error instanceof ApiError));
          if (!unknown) clearOperation(operation);
          update({
            ...previous,
            status: unknown ? "unknown" : "error",
            operation: intent.operation,
            error: normalized,
            refreshError: null,
          });
          handleMediaAuthorityError(options, normalized);
          return null;
        }
        clearOperation(operation);
        if (!isCurrent()) return null;
        const result = Object.freeze({ operation: intent.operation, media });
        // This success is final even if collection/projection reads fail. It remains
        // consumed until an explicit complete-context review creates a new slot.
        if (pending === task) pending = null;
        const generation = ++readGeneration;
        update({
          ...previous,
          status: "success",
          operation: intent.operation,
          result,
          error: null,
          refreshError: null,
        });
        void refreshAfterSuccess(previous.slot, generation);
        return result;
      });
      // Install single flight before notification, including synchronous subscribers.
      pending = task;
      update({
        ...previous,
        status: "pending",
        operation: intent.operation,
        error: null,
        refreshError: null,
      });
      void task.finally(() => {
        if (pending === task) pending = null;
      });
      return task;
    },
    reconcile: (expectedSlot = state.slot) => reviewCurrent(expectedSlot, "unknown"),
    reviewSuccess: (expectedSlot = state.slot) => reviewCurrent(expectedSlot, "success"),
  };
}

// Session-owned memory only. Product/Variant and media kind have separate slots;
// all assets and operation types within one collection share a single flight.
const mutationControllers = new WeakMap<
  MediaMutationOptions["session"],
  WeakMap<QueryScope, Map<string, ReturnType<typeof createMediaMutationController>>>
>();

export function getMediaMutationController(options: MediaMutationOptions) {
  let scopes = mutationControllers.get(options.session);
  if (!scopes) {
    scopes = new WeakMap();
    mutationControllers.set(options.session, scopes);
  }
  let collections = scopes.get(options.scope);
  if (!collections) {
    collections = new Map();
    scopes.set(options.scope, collections);
  }
  const target = targetFor(options.product, options.variant);
  const identity = JSON.stringify([
    target.kind,
    target.productUuid,
    target.kind === "variant" ? target.variantUuid : null,
  ]);
  let controller = collections.get(identity);
  if (!controller) {
    controller = createMediaMutationController(options);
    collections.set(identity, controller);
  } else controller.observeProduct(options.product);
  return controller;
}

export function useMediaMutation(product: MerchantProduct, variant?: MerchantVariant) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const { controller: stores, state: store } = useStores();
  const scope = store.scope!;
  const controller = useMemo(
    () => getMediaMutationController({ api, session, stores, scope, product, variant }),
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
    execute: (intent: MediaIntent) => controller.execute(intent, state.slot),
    reconcile: () => controller.reconcile(state.slot),
    reviewSuccess: () => controller.reviewSuccess(state.slot),
  };
}
