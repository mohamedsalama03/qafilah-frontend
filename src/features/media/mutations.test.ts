import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as apiProvider from "@/features/auth/components/merchant-api-provider";
import * as sessionBoundary from "@/features/auth/components/session-boundary";
import * as storeProvider from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import type { MerchantVariant } from "@/features/variants/contracts";
import { variantKeys } from "@/features/variants/queries";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { parsePrincipalId, parseStoreUuid } from "@/lib/query/keys";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantMedia, ProductMedia, VariantMedia, MediaTarget } from "./contracts";
import {
  createMediaMutationController,
  getMediaMutationController,
  useMediaMutation,
  type MediaIntent,
  type MediaMutationResult,
} from "./mutations";
import { mediaKeys, loadScopedMedia } from "./queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const V = "55555555-5555-4555-8555-555555555555";
const W = "66666666-6666-4666-8666-666666666666";
const M = "77777777-7777-4777-8777-777777777777";
const N = "88888888-8888-4888-8888-888888888888";
const permissions = [
  "products.view",
  "products.variants.view",
  "products.media.view",
  "products.media.create",
  "products.media.update",
  "products.media.delete",
];
const stamp = "2026-09-01T00:00:00+00:00";
function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: P,
    name: "Media product",
    slug: "media-product",
    description: "Media lifecycle fixture",
    type: "variant",
    status: "draft",
    requires_shipping: true,
    seo_title: null,
    seo_description: null,
    published_at: null,
    price: null,
    quantity: null,
    availability: "unavailable",
    categories: [],
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  };
}
function variant(overrides: Partial<MerchantVariant> = {}): MerchantVariant {
  return {
    id: V,
    value_ids: [Q],
    sku: null,
    status: "inactive",
    price: null,
    quantity: null,
    availability: "unavailable",
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  };
}
function media(kind: "product", id?: string): ProductMedia;
function media(kind: "variant", id?: string): VariantMedia;
function media(kind: MediaTarget["kind"], id?: string): MerchantMedia;
function media(kind: MediaTarget["kind"], id = M): MerchantMedia {
  const shared = {
    id,
    url: `/storage/catalog/${id}`,
    mime_type: "image/png" as const,
    byte_size: 10,
    width: 1,
    height: 1,
    alt_text: null,
    position: 0,
    created_at: stamp,
    updated_at: stamp,
  };
  return kind === "product" ? { ...shared, is_primary: true } : shared;
}
function context(id: string, grants = permissions): MerchantStoreContext {
  return {
    store: { id, name: "Store", status: "active" },
    membership: { id: P, status: "active" },
    role: { id: Q, name: "Owner Administrator" },
    permissions: grants,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const file = () => new File(["synthetic"], "safe.png", { type: "image/png" });
const createIntent = (): MediaIntent => ({ operation: "create", data: { image: file() } });
const updateIntent = (): MediaIntent => ({
  operation: "update",
  mediaUuid: M,
  data: { alt_text: "Front view" },
});
const deleteIntent = (): MediaIntent => ({ operation: "delete", mediaUuid: M });
const intents = { create: createIntent, update: updateIntent, delete: deleteIntent };
const cases = (["product", "variant"] as const).flatMap((kind) =>
  (["create", "update", "delete"] as const).map((operation) => ({ kind, operation })),
);

async function fixture(
  kind: MediaTarget["kind"] = "product",
  grants = permissions,
  selectedProduct = product(),
) {
  const api: MerchantApi = {
    ...createMerchantApi({ apiOrigin: "https://api.example.test", fetch: vi.fn<typeof fetch>() }),
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "merchant-a" })),
      logout: vi.fn(async () => {}),
    },
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (id) => context(id, grants)),
    loadProduct: vi.fn(async () => selectedProduct),
    loadProductVariant: vi.fn(async () => variant()),
    listProductMedia: vi.fn(async () => [media("product")]),
    listVariantMedia: vi.fn(async () => [media("variant")]),
    createProductMedia: vi.fn(async () => media("product", N)),
    createVariantMedia: vi.fn(async () => media("variant", N)),
    updateProductMedia: vi.fn(async () => media("product")),
    updateVariantMedia: vi.fn(async () => media("variant")),
    deleteProductMedia: vi.fn(async () => {}),
    deleteVariantMedia: vi.fn(async () => {}),
  };
  const queryClient = createQueryClient();
  const scopeController = createScopeController(queryClient);
  const auth = createAuthController({
    adapter: api.authAdapter,
    onAuthorityLost: () => scopeController.clear(),
  });
  await auth.bootstrap();
  const session = { queryClient, scope: scopeController, auth, onAuthorityLost: () => () => {} };
  const stores = createStoreController({
    principalId: "merchant-a",
    api,
    queryClient,
    scope: scopeController,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(A);
  const scope = stores.getSnapshot().scope!;
  const target: MediaTarget =
    kind === "product" ? { kind, productUuid: P } : { kind, productUuid: P, variantUuid: V };
  const options = {
    api,
    session,
    stores,
    scope,
    product: selectedProduct,
    ...(kind === "variant" ? { variant: variant() } : {}),
  };
  const key = mediaKeys.list(scope, target);
  queryClient.setQueryData(key, [media(kind)]);
  const mutation = getMediaMutationController(options);
  const method = (operation: MediaIntent["operation"]) =>
    kind === "product"
      ? operation === "create"
        ? api.createProductMedia
        : operation === "update"
          ? api.updateProductMedia
          : api.deleteProductMedia
      : operation === "create"
        ? api.createVariantMedia
        : operation === "update"
          ? api.updateVariantMedia
          : api.deleteVariantMedia;
  const list = kind === "product" ? api.listProductMedia : api.listVariantMedia;
  return {
    api,
    session,
    auth,
    stores,
    scope,
    scopeController,
    options,
    mutation,
    key,
    queryClient,
    target,
    kind,
    method,
    list,
  };
}

describe("Media scope and permissions", () => {
  it("separates principal Store revision Product Variant and media kind", async () => {
    const f = await fixture();
    const base = mediaKeys.list(f.scope, f.target);
    for (const candidate of [
      mediaKeys.list({ ...f.scope, principalId: parsePrincipalId("other") }, f.target),
      mediaKeys.list({ ...f.scope, storeUuid: parseStoreUuid(B) }, f.target),
      mediaKeys.list({ ...f.scope, revision: f.scope.revision + 1 }, f.target),
      mediaKeys.list(f.scope, { kind: "product", productUuid: Q }),
      mediaKeys.list(f.scope, { kind: "variant", productUuid: P, variantUuid: V }),
      mediaKeys.list(f.scope, { kind: "variant", productUuid: P, variantUuid: W }),
    ])
      expect(candidate).not.toEqual(base);
  });
  it.each(cases)(
    "requires independent $kind $operation grant without Owner-role substitutes",
    async ({ kind, operation }) => {
      const f = await fixture(
        kind,
        permissions.filter((grant) => grant !== `products.media.${operation}`),
      );
      await f.mutation.execute(intents[operation]());
      expect(f.method(operation)).not.toHaveBeenCalled();
      expect(f.mutation.getSnapshot().error?.kind).toBe("forbidden");
    },
  );
  it.each(cases)(
    "allows $kind $operation without unrelated media mutation grants",
    async ({ kind, operation }) => {
      const f = await fixture(kind, [
        "products.view",
        "products.variants.view",
        "products.media.view",
        `products.media.${operation}`,
      ]);
      expect(await f.mutation.execute(intents[operation]())).toMatchObject({ operation });
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["products.view", "products.variants.view", "products.media.view"])(
    "Variant writes require context read grant %s",
    async (denied) => {
      const f = await fixture(
        "variant",
        permissions.filter((grant) => grant !== denied),
      );
      await f.mutation.execute(createIntent());
      expect(f.api.createVariantMedia).not.toHaveBeenCalled();
      await expect(loadScopedMedia(f.options, f.target)).rejects.toMatchObject({
        kind: "forbidden",
      });
    },
  );
  it("Product media does not require Variant read permission", async () => {
    const f = await fixture(
      "product",
      permissions.filter((grant) => grant !== "products.variants.view"),
      product({ type: "simple" }),
    );
    expect(await f.mutation.execute(createIntent())).toMatchObject({ operation: "create" });
  });
  it.each(cases)("archived Product blocks $kind $operation", async ({ kind, operation }) => {
    const f = await fixture(kind, permissions, product({ status: "archived" }));
    await f.mutation.execute(intents[operation]());
    expect(f.method(operation)).not.toHaveBeenCalled();
  });
  it("blocks a newly observed archived Product", async () => {
    const f = await fixture();
    f.mutation.observeProduct(product({ status: "archived" }));
    await f.mutation.execute(createIntent());
    expect(f.api.createProductMedia).not.toHaveBeenCalled();
  });
  it("fails closed if collection context has not loaded", async () => {
    const f = await fixture();
    f.queryClient.removeQueries({ queryKey: f.key });
    await f.mutation.execute(createIntent());
    expect(f.api.createProductMedia).not.toHaveBeenCalled();
  });
  it.each(["product", "variant"] as const)(
    "enforces %s collection cap before upload",
    async (kind) => {
      const f = await fixture(kind);
      f.queryClient.setQueryData(
        f.key,
        Array.from({ length: kind === "product" ? 10 : 5 }, () => media(kind)),
      );
      await f.mutation.execute(createIntent());
      expect(f.method("create")).not.toHaveBeenCalled();
    },
  );
  it.each(["update", "delete"] as const)(
    "binds %s to an asset from the originating collection",
    async (operation) => {
      const f = await fixture();
      await f.mutation.execute({ ...intents[operation](), mediaUuid: N } as MediaIntent);
      expect(f.method(operation)).not.toHaveBeenCalled();
    },
  );
  it("rejects a cross-kind cached collection", async () => {
    const f = await fixture("variant");
    f.queryClient.setQueryData(f.key, [media("product")]);
    await f.mutation.execute(deleteIntent());
    expect(f.api.deleteVariantMedia).not.toHaveBeenCalled();
  });
});

describe("Media single flight, response boundaries and authoritative ordering", () => {
  it.each(cases)(
    "consumes $kind $operation until fresh review and forbids other collection writes",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      const response = deferred<MerchantMedia | void>();
      vi.mocked(f.method(operation)).mockReturnValue(response.promise as never);
      const first = f.mutation.execute(intents[operation](), 0);
      for (const candidate of [createIntent(), updateIntent(), deleteIntent()])
        expect(f.mutation.execute(candidate, 0)).toBe(first);
      await vi.waitFor(() => expect(f.method(operation)).toHaveBeenCalledTimes(1));
      response.resolve(
        operation === "delete" ? undefined : media(kind, operation === "create" ? N : M),
      );
      await first;
      expect(f.mutation.getSnapshot().status).toBe("success");
      expect(getMediaMutationController(f.options)).toBe(f.mutation);
      for (const candidate of [createIntent(), updateIntent(), deleteIntent()])
        expect(await f.mutation.execute(candidate, 0)).toBeNull();
      await f.mutation.reviewSuccess(0);
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        operation: null,
        result: null,
        reviewedUnknown: false,
      });
      expect(await f.mutation.execute(intents[operation](), 0)).toBeNull();
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
    },
  );
  it("installs the collection latch before synchronous subscribers can submit", async () => {
    const f = await fixture();
    let duplicate: Promise<MediaMutationResult | null> | undefined;
    f.mutation.subscribe(() => {
      if (f.mutation.getSnapshot().status === "pending")
        duplicate = f.mutation.execute(deleteIntent());
    });
    const first = f.mutation.execute(createIntent());
    expect(duplicate).toBe(first);
    await first;
    expect(f.api.createProductMedia).toHaveBeenCalledTimes(1);
    expect(f.api.deleteProductMedia).not.toHaveBeenCalled();
  });
  it("snapshots caller metadata and target before the dispatch microtask", async () => {
    const f = await fixture();
    const data = { alt_text: "Original" };
    const input = { operation: "update" as const, mediaUuid: M, data };
    const task = f.mutation.execute(input);
    input.mediaUuid = N;
    data.alt_text = "Changed";
    await task;
    expect(f.api.updateProductMedia).toHaveBeenCalledWith(
      { storeUuid: A, productUuid: P, mediaUuid: M, data: { alt_text: "Original" } },
      expect.any(AbortSignal),
    );
  });
  it("preserves the complete server order and primary flags without splicing mutation responses", async () => {
    const f = await fixture();
    const authoritative = [
      { ...media("product", N), position: 8, is_primary: false },
      { ...media("product", M), position: 8, is_primary: true },
    ];
    const response = deferred<ProductMedia[]>();
    vi.mocked(f.api.listProductMedia).mockReturnValue(response.promise);
    await f.mutation.execute(createIntent());
    expect(f.queryClient.getQueryData(f.key)).toEqual([media("product")]);
    response.resolve(authoritative);
    await vi.waitFor(() => expect(f.queryClient.getQueryData(f.key)).toEqual(authoritative));
    expect(f.mutation.getSnapshot().collection).toEqual(authoritative);
  });
  it("cancels a pre-write collection read before publishing the fresh authoritative collection", async () => {
    const f = await fixture();
    const stale = deferred<ProductMedia[]>();
    const reading = f.queryClient
      .fetchQuery({ queryKey: f.key, queryFn: () => stale.promise })
      .catch(() => null);
    const current = [media("product", N)];
    vi.mocked(f.api.listProductMedia).mockResolvedValue(current);
    await f.mutation.execute(createIntent());
    await vi.waitFor(() => expect(f.queryClient.getQueryData(f.key)).toEqual(current));
    stale.resolve([media("product")]);
    await reading;
    expect(f.queryClient.getQueryData(f.key)).toEqual(current);
  });
  it.each(cases)(
    "retains confirmed $kind $operation on secondary collection failure",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      vi.mocked(f.list).mockRejectedValue(new ApiError("network"));
      expect(await f.mutation.execute(intents[operation]())).toMatchObject({ operation });
      await vi.waitFor(() => expect(f.mutation.getSnapshot().refreshError?.kind).toBe("network"));
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "success", error: null });
      expect(await f.mutation.execute(intents[operation]())).toBeNull();
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
    },
  );
  it("retains confirmed success on Product projection failure", async () => {
    const f = await fixture("variant");
    vi.spyOn(f.queryClient, "invalidateQueries").mockRejectedValueOnce(new ApiError("server"));
    await f.mutation.execute(updateIntent());
    await vi.waitFor(() => expect(f.mutation.getSnapshot().refreshError?.kind).toBe("server"));
    expect(f.mutation.getSnapshot().status).toBe("success");
  });
  it("an older automatic read cannot overwrite a newer explicit review", async () => {
    const f = await fixture();
    const stale = deferred<ProductMedia[]>();
    vi.mocked(f.api.listProductMedia).mockReturnValueOnce(stale.promise).mockResolvedValueOnce([]);
    await f.mutation.execute(deleteIntent());
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(1));
    await f.mutation.reviewSuccess();
    stale.resolve([media("product")]);
    await Promise.resolve();
    expect(f.queryClient.getQueryData(f.key)).toEqual([]);
    expect(f.mutation.getSnapshot()).toMatchObject({ status: "idle", collection: [] });
  });
  it("preserves known success if a subsequent complete-context review fails", async () => {
    const f = await fixture();
    await f.mutation.execute(deleteIntent());
    vi.mocked(f.api.loadProduct).mockRejectedValue(new ApiError("network"));
    await f.mutation.reviewSuccess();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "success",
      slot: 0,
      refreshError: { kind: "network" },
    });
    expect(await f.mutation.execute(createIntent())).toBeNull();
  });
  it("hook remount retains pending identity and consumed callbacks", async () => {
    const f = await fixture();
    vi.spyOn(apiProvider, "useMerchantApi").mockReturnValue(f.api);
    vi.spyOn(sessionBoundary, "useMerchantSession").mockReturnValue(f.session);
    vi.spyOn(storeProvider, "useStores").mockReturnValue({
      controller: f.stores,
      state: f.stores.getSnapshot(),
    });
    const response = deferred<ProductMedia>();
    vi.mocked(f.api.createProductMedia).mockReturnValue(response.promise);
    const first = renderHook(() => useMediaMutation(product()));
    const oldExecute = first.result.current.execute;
    let task!: Promise<MediaMutationResult | null>;
    act(() => {
      task = oldExecute(createIntent());
    });
    first.unmount();
    const second = renderHook(() => useMediaMutation(product()));
    expect(second.result.current.isPending).toBe(true);
    expect(second.result.current.execute(deleteIntent())).toBe(task);
    await act(async () => {
      response.resolve(media("product", N));
      await task;
    });
    expect(second.result.current.isBlocked).toBe(true);
    await act(async () => {
      await second.result.current.reviewSuccess();
    });
    expect(await oldExecute(createIntent())).toBeNull();
    second.unmount();
  });
});

describe("Media unknown outcomes never replay", () => {
  it.each(
    cases.flatMap((entry) =>
      (["network", "timeout", "server", "invalid-response"] as const).map((kind) => ({
        ...entry,
        errorKind: kind,
      })),
    ),
  )(
    "consumes $kind $operation after unknown $errorKind",
    async ({ kind, operation, errorKind }) => {
      const f = await fixture(kind);
      vi.mocked(f.method(operation)).mockRejectedValueOnce(
        new ApiError(errorKind, { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(intents[operation]());
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      for (const intent of [createIntent(), updateIntent(), deleteIntent()])
        expect(await f.mutation.execute(intent)).toBeNull();
      expect(f.list).not.toHaveBeenCalled();
      await f.mutation.reconcile();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        operation: null,
        result: null,
        guidance: "current-media-reviewed",
        reviewedUnknown: true,
      });
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
      expect(f.list).toHaveBeenCalledTimes(1);
      expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
      expect(f.api.loadProductVariant).toHaveBeenCalledTimes(kind === "variant" ? 1 : 0);
    },
  );
  it.each(["create", "update", "delete"] as const)(
    "consumes unexpected thrown exceptions after %s invocation",
    async (operation) => {
      const f = await fixture();
      vi.mocked(f.method(operation)).mockRejectedValueOnce(new TypeError("connection lost"));
      await f.mutation.execute(intents[operation]());
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      expect(await f.mutation.execute(intents[operation]())).toBeNull();
    },
  );
  it.each(["listVariantMedia", "loadProduct", "loadProductVariant"] as const)(
    "keeps unknown lock when %s review fails",
    async (method) => {
      const f = await fixture("variant");
      vi.mocked(f.api.createVariantMedia).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(createIntent());
      vi.mocked(f.api[method]).mockRejectedValue(new ApiError("network"));
      await f.mutation.reconcile();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        slot: 0,
        error: { kind: "network" },
      });
      expect(await f.mutation.execute(createIntent())).toBeNull();
      expect(f.api.createVariantMedia).toHaveBeenCalledTimes(1);
    },
  );
  it("review single flight is latched before notification and never dispatches a mutation", async () => {
    const f = await fixture();
    vi.mocked(f.api.deleteProductMedia).mockRejectedValueOnce(
      new ApiError("timeout", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(deleteIntent());
    const read = deferred<MerchantProduct>();
    vi.mocked(f.api.loadProduct).mockReturnValue(read.promise);
    let duplicate: Promise<readonly MerchantMedia[] | null> | undefined;
    f.mutation.subscribe(() => {
      if (f.mutation.getSnapshot().status === "reconciling") duplicate = f.mutation.reconcile();
    });
    const task = f.mutation.reconcile();
    expect(duplicate).toBe(task);
    expect(await f.mutation.execute(createIntent())).toBeNull();
    read.resolve(product());
    await task;
    expect(f.api.deleteProductMedia).toHaveBeenCalledTimes(1);
    expect(f.api.createProductMedia).not.toHaveBeenCalled();
  });
  it("current absence after uncertain DELETE grants only a new slot, never attribution or replay", async () => {
    const f = await fixture();
    vi.mocked(f.api.deleteProductMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(deleteIntent(), 0);
    vi.mocked(f.api.listProductMedia).mockResolvedValue([]);
    await f.mutation.reconcile(0);
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "idle",
      collection: [],
      result: null,
      operation: null,
      reviewedUnknown: true,
    });
    expect(await f.mutation.execute(deleteIntent(), 0)).toBeNull();
    expect(f.api.deleteProductMedia).toHaveBeenCalledTimes(1);
  });
  it.each(["product", "variant"] as const)(
    "wrong %s context in review never unlocks",
    async (wrong) => {
      const f = await fixture("variant");
      vi.mocked(f.api.updateVariantMedia).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(updateIntent());
      if (wrong === "product") vi.mocked(f.api.loadProduct).mockResolvedValue(product({ id: Q }));
      else vi.mocked(f.api.loadProductVariant).mockResolvedValue(variant({ id: W }));
      await f.mutation.reconcile();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        slot: 0,
        error: { kind: "invalid-response" },
      });
    },
  );
  it("fresh review of archived Product never authorizes another write", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(createIntent());
    vi.mocked(f.api.loadProduct).mockResolvedValue(product({ status: "archived" }));
    await f.mutation.reconcile();
    expect(f.mutation.getSnapshot().product?.status).toBe("archived");
    await f.mutation.execute(deleteIntent());
    expect(f.api.deleteProductMedia).not.toHaveBeenCalled();
  });
  it.each(["validation", "forbidden", "not-found", "rate-limited"] as const)(
    "known %s stays an error without automatic retry",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(new ApiError(kind));
      await f.mutation.execute(createIntent());
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "error", error: { kind } });
      expect(f.api.createProductMedia).toHaveBeenCalledTimes(1);
      expect(f.api.listProductMedia).not.toHaveBeenCalled();
    },
  );
  it.each(["unauthenticated", "session-expired"] as const)(
    "reconciles identity once after %s and never repeats POST",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(new ApiError(kind));
      await f.mutation.execute(createIntent());
      await vi.waitFor(() => expect(f.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2));
      expect(f.api.createProductMedia).toHaveBeenCalledTimes(1);
      expect(f.scopeController.getScope()).toBeNull();
    },
  );
});

describe("Media response identity and destination isolation", () => {
  it.each(["product", "variant"] as const)(
    "consumes duplicate existing UUID returned by %s POST as unknown",
    async (kind) => {
      const f = await fixture(kind);
      vi.mocked(f.method("create")).mockResolvedValueOnce(media(kind) as never);
      await f.mutation.execute(createIntent());
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        error: { kind: "invalid-response" },
      });
      expect(f.list).not.toHaveBeenCalled();
    },
  );
  it.each(["product", "variant"] as const)(
    "consumes wrong UUID returned by %s PATCH as unknown",
    async (kind) => {
      const f = await fixture(kind);
      vi.mocked(f.method("update")).mockResolvedValueOnce(media(kind, N) as never);
      await f.mutation.execute(updateIntent());
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        error: { kind: "invalid-response" },
      });
      expect(f.list).not.toHaveBeenCalled();
    },
  );
  it.each(["product", "variant"] as const)(
    "never accepts opposite-kind %s mutation resource",
    async (kind) => {
      const f = await fixture(kind);
      vi.mocked(f.method("create")).mockResolvedValueOnce(
        media(kind === "product" ? "variant" : "product", N) as never,
      );
      await f.mutation.execute(createIntent());
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      expect(f.queryClient.getQueryData(f.key)).toEqual([media(kind)]);
    },
  );
  it.each(cases)(
    "discards delayed $kind $operation after Store switch",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      const response = deferred<MerchantMedia | void>();
      vi.mocked(f.method(operation)).mockReturnValueOnce(response.promise as never);
      const task = f.mutation.execute(intents[operation]());
      await vi.waitFor(() => expect(f.method(operation)).toHaveBeenCalledTimes(1));
      await f.stores.select(B);
      const destination = mediaKeys.list(f.stores.getSnapshot().scope!, f.target);
      f.queryClient.setQueryData(destination, []);
      response.resolve(
        operation === "delete" ? undefined : media(kind, operation === "create" ? N : M),
      );
      await task;
      expect(f.queryClient.getQueryData(destination)).toEqual([]);
      expect(f.queryClient.getQueryData(f.key)).toBeUndefined();
      expect(f.mutation.getSnapshot().status).not.toBe("success");
    },
  );
  it.each(cases)(
    "discards delayed $kind $operation after principal replacement",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      const response = deferred<MerchantMedia | void>();
      vi.mocked(f.method(operation)).mockReturnValueOnce(response.promise as never);
      const task = f.mutation.execute(intents[operation]());
      await vi.waitFor(() => expect(f.method(operation)).toHaveBeenCalledTimes(1));
      await f.auth.logout();
      const other = f.scopeController.setScope({ principalId: "merchant-b", storeUuid: A });
      const destination = mediaKeys.list(other, f.target);
      f.queryClient.setQueryData(destination, []);
      response.resolve(
        operation === "delete" ? undefined : media(kind, operation === "create" ? N : M),
      );
      await task;
      expect(f.queryClient.getQueryData(destination)).toEqual([]);
      expect(f.mutation.getSnapshot().status).not.toBe("success");
    },
  );
  it("late Product/Variant response only refreshes the captured collection, never another detail", async () => {
    const f = await fixture("variant");
    const destination = mediaKeys.list(f.scope, {
      kind: "variant",
      productUuid: Q,
      variantUuid: W,
    });
    const productCollection = mediaKeys.list(f.scope, { kind: "product", productUuid: P });
    f.queryClient.setQueryData(destination, []);
    f.queryClient.setQueryData(productCollection, []);
    await f.mutation.execute(updateIntent());
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(1));
    expect(f.queryClient.getQueryData(destination)).toEqual([]);
    expect(f.queryClient.getQueryData(productCollection)).toEqual([]);
    expect(f.api.updateVariantMedia).toHaveBeenCalledWith(
      {
        storeUuid: A,
        productUuid: P,
        variantUuid: V,
        mediaUuid: M,
        data: { alt_text: "Front view" },
      },
      expect.any(AbortSignal),
    );
  });
  it("never publishes an obsolete explicit review after authority refresh", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(createIntent());
    const response = deferred<ProductMedia[]>();
    vi.mocked(f.api.listProductMedia).mockReturnValueOnce(response.promise);
    const reviewing = f.mutation.reconcile();
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(1));
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(
      context(A, [...permissions, "products.update"]),
    );
    await f.stores.revalidate();
    response.resolve([media("product", N)]);
    await reviewing;
    expect(f.mutation.getSnapshot().slot).toBe(0);
    expect(
      f.queryClient.getQueryData(mediaKeys.list(f.stores.getSnapshot().scope!, f.target)),
    ).toBeUndefined();
  });
  it("checks current cached Product and Variant identities before dispatch", async () => {
    const f = await fixture("variant");
    f.queryClient.setQueryData(variantKeys.detail(f.scope, P, V), variant({ id: W }));
    await f.mutation.execute(createIntent());
    expect(f.api.createVariantMedia).not.toHaveBeenCalled();
    f.queryClient.setQueryData(variantKeys.detail(f.scope, P, V), variant());
    f.queryClient.setQueryData(productKeys.detail(f.scope, P), product({ id: Q }));
    await f.mutation.execute(createIntent());
    expect(f.api.createVariantMedia).not.toHaveBeenCalled();
  });
  it("does not share controllers across sessions, kinds, Products, Variants, or revisions", async () => {
    const f = await fixture("variant");
    for (const options of [
      { ...f.options, session: { ...f.session } },
      { ...f.options, product: product({ id: Q }) },
      { ...f.options, variant: variant({ id: W }) },
      { ...f.options, variant: undefined },
      { ...f.options, scope: { ...f.scope, revision: f.scope.revision + 1 } },
    ])
      expect(getMediaMutationController(options)).not.toBe(f.mutation);
    expect(createMediaMutationController(f.options)).not.toBe(f.mutation);
  });
});
