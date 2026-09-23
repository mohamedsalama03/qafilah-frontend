import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as apiProvider from "@/features/auth/components/merchant-api-provider";
import * as sessionBoundary from "@/features/auth/components/session-boundary";
import * as storeProvider from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { parsePrincipalId, parseStoreUuid, storeKeys } from "@/lib/query/keys";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { ProductInventory } from "./contracts";
import {
  createInventoryMutationController,
  getInventoryMutationController,
  useInventoryMutation,
} from "./mutations";
import { inventoryKeys, loadScopedProductInventory } from "./queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const permissions = ["products.inventory.update", "products.view"];
const inventory = (quantity: number | null = 5): ProductInventory => ({
  quantity,
  availability: quantity === null ? "unavailable" : quantity === 0 ? "out_of_stock" : "in_stock",
});
function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: P,
    name: "Inventory product",
    slug: "inventory-product",
    description: "Inventory fixture",
    type: "simple",
    status: "draft",
    requires_shipping: true,
    seo_title: null,
    seo_description: null,
    published_at: null,
    price: null,
    quantity: null,
    availability: "unavailable",
    categories: [],
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
    ...overrides,
  };
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
async function fixture(grants = permissions, target = product()) {
  const api: MerchantApi = {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "merchant-a" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (id) => context(id, grants)),
    loadProduct: vi.fn(async () => target),
    listProducts: vi.fn(),
    listCategories: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
    listProductOptions: vi.fn(),
    createProductOption: vi.fn(),
    updateProductOption: vi.fn(),
    createProductOptionValue: vi.fn(),
    updateProductOptionValue: vi.fn(),
    listProductVariants: vi.fn(),
    createProductVariant: vi.fn(),
    listProductMedia: vi.fn(),
    createProductMedia: vi.fn(),
    updateProductMedia: vi.fn(),
    deleteProductMedia: vi.fn(),
    listVariantMedia: vi.fn(),
    createVariantMedia: vi.fn(),
    updateVariantMedia: vi.fn(),
    deleteVariantMedia: vi.fn(),
    loadVariantInventory: vi.fn(),
    updateVariantInventory: vi.fn(),
    loadProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
    loadProductInventory: vi.fn(async () => inventory()),
    updateProductInventory: vi.fn(async (input) => inventory(input.data.quantity)),
  };
  const queryClient = createQueryClient();
  const scope = createScopeController(queryClient);
  const auth = createAuthController({
    adapter: api.authAdapter,
    onAuthorityLost: () => scope.clear(),
  });
  await auth.bootstrap();
  const session = { queryClient, scope, auth, onAuthorityLost: () => () => {} };
  const stores = createStoreController({
    principalId: "merchant-a",
    api,
    queryClient,
    scope,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(A);
  const current = stores.getSnapshot().scope!;
  const options = { api, session, stores, scope: current, product: target };
  const mutation = createInventoryMutationController(options);
  return { ...options, current, auth, scopeController: scope, queryClient, options, mutation };
}

describe("inventory scope and authorization", () => {
  it("keeps inventory cache keys scoped to principal Store revision and Product", async () => {
    const f = await fixture();
    const key = inventoryKeys.detail(f.current, P);
    expect(key).toEqual([
      "merchant",
      "merchant-a",
      "store",
      A,
      f.current.revision,
      "product-inventory",
      { productUuid: P },
    ]);
    for (const other of [
      inventoryKeys.detail({ ...f.current, principalId: parsePrincipalId("merchant-b") }, P),
      inventoryKeys.detail({ ...f.current, storeUuid: parseStoreUuid(B) }, P),
      inventoryKeys.detail({ ...f.current, revision: f.current.revision + 1 }, P),
      inventoryKeys.detail(f.current, Q),
    ])
      expect(other).not.toEqual(key);
  });

  it.each([{ grants: [] }, { grants: ["products.inventory.update"] }])(
    "denies inventory reads without products.view regardless of Owner role: %j",
    async ({ grants }) => {
      const f = await fixture(grants);
      await expect(loadScopedProductInventory(f.options, P)).rejects.toMatchObject({
        kind: "forbidden",
      });
      expect(f.api.loadProductInventory).not.toHaveBeenCalled();
    },
  );

  it.each([
    { grants: [] },
    { grants: ["products.view"] },
    { grants: ["products.inventory.update"] },
  ])("requires both read and write grants before dispatch: %j", async ({ grants }) => {
    const f = await fixture(grants);
    expect(await f.mutation.execute(5)).toBeNull();
    expect(f.api.updateProductInventory).not.toHaveBeenCalled();
    expect(f.mutation.getSnapshot().error?.kind).toBe("forbidden");
  });

  it("supports independent read-only inventory", async () => {
    const f = await fixture(["products.view"]);
    expect(await loadScopedProductInventory(f.options, P)).toEqual(inventory());
    expect(f.api.loadProductInventory).toHaveBeenCalledWith(
      { storeUuid: A, productUuid: P },
      expect.any(AbortSignal),
    );
  });

  it.each([{ type: "variant" as const }, { status: "archived" as const }])(
    "blocks noneditable Product %j",
    async (change) => {
      const f = await fixture(permissions, product(change));
      expect(await f.mutation.execute(5)).toBeNull();
      expect(f.api.updateProductInventory).not.toHaveBeenCalled();
    },
  );

  it("blocks newly observed archived Products even after a prior review", async () => {
    const f = await fixture();
    await f.mutation.execute(5);
    await f.mutation.reviewSuccess();
    f.mutation.observeProduct(product({ status: "archived" }));
    await f.mutation.execute(6);
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });

  it.each(["products.view", "products.inventory.update"])(
    "revoked %s changes capability after authoritative context refresh",
    async (permission) => {
      const f = await fixture();
      vi.mocked(f.api.loadStoreContext).mockResolvedValue(
        context(
          A,
          permissions.filter((entry) => entry !== permission),
        ),
      );
      await f.stores.revalidate();
      const next = createInventoryMutationController({
        ...f.options,
        scope: f.stores.getSnapshot().scope!,
      });
      await next.execute(5);
      expect(f.api.updateProductInventory).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "PATCH"])(
    "discards delayed Store A %s after switching to Store B",
    async (method) => {
      const f = await fixture();
      const delayed = deferred<ProductInventory>();
      vi.mocked(
        method === "GET" ? f.api.loadProductInventory : f.api.updateProductInventory,
      ).mockReturnValue(delayed.promise);
      const task =
        method === "GET"
          ? loadScopedProductInventory(f.options, P).catch((error: unknown) => error)
          : f.mutation.execute(5);
      await vi.waitFor(() =>
        expect(
          method === "GET" ? f.api.loadProductInventory : f.api.updateProductInventory,
        ).toHaveBeenCalledTimes(1),
      );
      await f.stores.select(B);
      const other = f.stores.getSnapshot().scope!;
      f.queryClient.setQueryData(inventoryKeys.detail(other, Q), inventory(10));
      delayed.resolve(inventory(5));
      await task;
      expect(f.queryClient.getQueryData(inventoryKeys.detail(other, Q))).toEqual(inventory(10));
      expect(f.queryClient.getQueryData(inventoryKeys.detail(other, P))).toBeUndefined();
      expect(f.queryClient.getQueryData(inventoryKeys.detail(f.current, P))).toBeUndefined();
      expect(f.mutation.getSnapshot().status).not.toBe("success");
    },
  );

  it.each(["GET", "PATCH"])(
    "discards delayed %s after logout and principal replacement",
    async (method) => {
      const f = await fixture();
      const delayed = deferred<ProductInventory>();
      vi.mocked(
        method === "GET" ? f.api.loadProductInventory : f.api.updateProductInventory,
      ).mockReturnValue(delayed.promise);
      const task =
        method === "GET"
          ? loadScopedProductInventory(f.options, P).catch((error: unknown) => error)
          : f.mutation.execute(5);
      await vi.waitFor(() =>
        expect(
          method === "GET" ? f.api.loadProductInventory : f.api.updateProductInventory,
        ).toHaveBeenCalledTimes(1),
      );
      await f.auth.logout();
      const other = f.scopeController.setScope({ principalId: "merchant-b", storeUuid: A });
      f.queryClient.setQueryData(inventoryKeys.detail(other, P), inventory(10));
      delayed.resolve(inventory(5));
      await task;
      expect(f.queryClient.getQueryData(inventoryKeys.detail(other, P))).toEqual(inventory(10));
      expect(f.mutation.getSnapshot().status).not.toBe("success");
    },
  );
});

describe("inventory single-flight and confirmed success", () => {
  it("consumes success across the response boundary and remount until explicit review", async () => {
    const f = await fixture();
    const controller = getInventoryMutationController(f.options);
    const response = deferred<ProductInventory>();
    vi.mocked(f.api.updateProductInventory).mockReturnValue(response.promise);
    const first = controller.execute(5, 0);
    expect(controller.execute(5, 0)).toBe(first);
    await vi.waitFor(() => expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1));
    response.resolve(inventory(5));
    await first;
    expect(controller.getSnapshot().status).toBe("success");
    const remounted = getInventoryMutationController(f.options);
    expect(remounted).toBe(controller);
    expect(await remounted.execute(5, 0)).toBeNull();
    expect(await remounted.execute(6, 0)).toBeNull();
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    expect(f.api.loadProductInventory).not.toHaveBeenCalled();
    await remounted.reviewSuccess(0);
    expect(remounted.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      inventory: inventory(5),
      reviewedUnknown: false,
    });
    expect(await remounted.execute(7, 0)).toBeNull();
    vi.mocked(f.api.updateProductInventory).mockResolvedValue(inventory(6));
    await remounted.execute(6, 1);
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(2);
  });

  it("installs its latch before notifying synchronous subscribers", async () => {
    const f = await fixture();
    let duplicate: Promise<ProductInventory | null> | undefined;
    f.mutation.subscribe(() => {
      if (f.mutation.getSnapshot().status === "pending") duplicate = f.mutation.execute(5);
    });
    const first = f.mutation.execute(5);
    expect(duplicate).toBe(first);
    await first;
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });

  it("keeps hook operation slots through pending, success, and reviewed form remounts", async () => {
    const f = await fixture();
    vi.spyOn(apiProvider, "useMerchantApi").mockReturnValue(f.api);
    vi.spyOn(sessionBoundary, "useMerchantSession").mockReturnValue(f.session);
    vi.spyOn(storeProvider, "useStores").mockReturnValue({
      controller: f.stores,
      state: f.stores.getSnapshot(),
    });
    const response = deferred<ProductInventory>();
    vi.mocked(f.api.updateProductInventory).mockReturnValue(response.promise);
    const first = renderHook(() => useInventoryMutation(product()));
    const oldExecute = first.result.current.execute;
    let task!: Promise<ProductInventory | null>;
    act(() => {
      task = oldExecute(5);
    });
    first.unmount();
    const second = renderHook(() => useInventoryMutation(product()));
    expect(second.result.current.isPending).toBe(true);
    expect(second.result.current.execute(5)).toBe(task);
    await act(async () => {
      response.resolve(inventory());
      await task;
    });
    expect(second.result.current.isBlocked).toBe(true);
    expect(await second.result.current.execute(5)).toBeNull();
    await act(async () => {
      await second.result.current.reviewSuccess();
    });
    expect(second.result.current.state.slot).toBe(1);
    expect(await oldExecute(5)).toBeNull();
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });

  it("never shares a controller between Products, authority revisions or sessions", async () => {
    const f = await fixture();
    const first = getInventoryMutationController(f.options);
    expect(getInventoryMutationController({ ...f.options, product: product({ id: Q }) })).not.toBe(
      first,
    );
    expect(getInventoryMutationController({ ...f.options, session: { ...f.session } })).not.toBe(
      first,
    );
    await f.stores.select(B);
    expect(
      getInventoryMutationController({ ...f.options, scope: f.stores.getSnapshot().scope! }),
    ).not.toBe(first);
  });

  it("publishes only originating inventory and invalidates its Product projections without constructing a Product", async () => {
    const f = await fixture();
    const other = { ...f.current, storeUuid: parseStoreUuid(B) };
    const keys = {
      inventory: inventoryKeys.detail(f.current, P),
      product: productKeys.detail(f.current, P),
      list: storeKeys.resource(f.current, "products"),
      other: inventoryKeys.detail(other, P),
      otherProduct: inventoryKeys.detail(f.current, Q),
    };
    f.queryClient.setQueryData(keys.product, product());
    for (const key of [keys.list, keys.other, keys.otherProduct])
      f.queryClient.setQueryData(key, { sentinel: true });
    await f.mutation.execute(5);
    expect(f.queryClient.getQueryData(keys.inventory)).toEqual(inventory());
    expect(f.queryClient.getQueryData(keys.product)).toEqual(product());
    expect(f.queryClient.getQueryState(keys.product)?.isInvalidated).toBe(true);
    expect(f.queryClient.getQueryState(keys.list)?.isInvalidated).toBe(true);
    for (const key of [keys.other, keys.otherProduct]) {
      expect(f.queryClient.getQueryData(key)).toEqual({ sentinel: true });
      expect(f.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });

  it("cancels a pre-write inventory GET so it cannot overwrite the confirmed response", async () => {
    const f = await fixture();
    const response = deferred<ProductInventory>();
    const key = inventoryKeys.detail(f.current, P);
    const oldRead = f.queryClient
      .fetchQuery({ queryKey: key, queryFn: () => response.promise })
      .catch(() => null);
    await f.mutation.execute(5);
    response.resolve(inventory(2));
    await oldRead;
    expect(f.queryClient.getQueryData(key)).toEqual(inventory(5));
  });

  it("preserves confirmed success and the consumed attempt if later Product refresh fails", async () => {
    const f = await fixture();
    vi.spyOn(f.queryClient, "invalidateQueries").mockRejectedValueOnce(new ApiError("network"));
    expect(await f.mutation.execute(5)).toEqual(inventory());
    await vi.waitFor(() => expect(f.mutation.getSnapshot().refreshError?.kind).toBe("network"));
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "success",
      inventory: inventory(),
      error: null,
      refreshError: { kind: "network" },
    });
    expect(await f.mutation.execute(5)).toBeNull();
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    expect(f.queryClient.getQueryData(inventoryKeys.detail(f.current, P))).toEqual(inventory());
  });

  it("preserves known success when a subsequent explicit review fails", async () => {
    const f = await fixture();
    await f.mutation.execute(5);
    vi.mocked(f.api.loadProduct).mockRejectedValue(new ApiError("network"));
    await f.mutation.reviewSuccess();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "success",
      slot: 0,
      inventory: inventory(),
      refreshError: { kind: "network" },
    });
    expect(await f.mutation.execute(5)).toBeNull();
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });
});

describe("inventory unknown outcome and explicit review", () => {
  it("never automatically retries a dispatched unknown inventory update", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProductInventory).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(5);
    expect(f.mutation.getSnapshot().status).toBe("unknown");
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    expect(await f.mutation.execute(5)).toBeNull();
    expect(f.api.loadProductInventory).not.toHaveBeenCalled();
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });
  it.each(["network", "timeout", "server", "invalid-response"] as const)(
    "locks unknown %s until both authoritative reads succeed",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.updateProductInventory).mockRejectedValueOnce(
        new ApiError(kind, { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(5);
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      expect(await f.mutation.execute(5)).toBeNull();
      expect(f.api.loadProductInventory).not.toHaveBeenCalled();
      expect(f.api.loadProduct).not.toHaveBeenCalled();
      await f.mutation.reconcile();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        inventory: inventory(),
        guidance: "current-inventory-reviewed",
        reviewedUnknown: true,
      });
      expect(f.api.loadProductInventory).toHaveBeenCalledTimes(1);
      expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
      expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    },
  );

  it("shows intervening stock change and never replays the old submitted quantity", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProductInventory).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(5, 0);
    vi.mocked(f.api.loadProductInventory).mockResolvedValue(inventory(4));
    vi.mocked(f.api.loadProduct).mockResolvedValue(
      product({ quantity: 4, availability: "in_stock" }),
    );
    await f.mutation.reconcile(0);
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      inventory: inventory(4),
      reviewedUnknown: true,
    });
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    expect(await f.mutation.execute(5, 0)).toBeNull();
    await f.mutation.execute(3, 1);
    expect(
      vi.mocked(f.api.updateProductInventory).mock.calls.map(([value]) => value.data.quantity),
    ).toEqual([5, 3]);
  });

  it.each(["loadProductInventory", "loadProduct"] as const)(
    "retains unknown lock when %s review fails",
    async (method) => {
      const f = await fixture();
      vi.mocked(f.api.updateProductInventory).mockRejectedValue(
        new ApiError("timeout", { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(5);
      vi.mocked(f.api[method]).mockRejectedValue(new ApiError("network"));
      await f.mutation.reconcile();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        slot: 0,
        error: { kind: "network" },
      });
      expect(await f.mutation.execute(5)).toBeNull();
      expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    },
  );

  it("review is single-flight and cannot allow a write while either read remains pending", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProductInventory).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(5);
    const response = deferred<MerchantProduct>();
    vi.mocked(f.api.loadProduct).mockReturnValue(response.promise);
    const review = f.mutation.reconcile();
    expect(f.mutation.reconcile()).toBe(review);
    expect(await f.mutation.execute(5)).toBeNull();
    await vi.waitFor(() => expect(f.api.loadProductInventory).toHaveBeenCalledTimes(1));
    expect(f.mutation.getSnapshot().status).toBe("reconciling");
    response.resolve(product());
    await review;
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });

  it("does not publish or renew an obsolete review after switching Stores", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProductInventory).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(5);
    const response = deferred<ProductInventory>();
    vi.mocked(f.api.loadProductInventory).mockReturnValue(response.promise);
    const review = f.mutation.reconcile();
    await vi.waitFor(() => expect(f.api.loadProductInventory).toHaveBeenCalledTimes(1));
    await f.stores.select(B);
    response.resolve(inventory());
    await review;
    expect(f.mutation.getSnapshot().slot).toBe(0);
    expect(
      f.queryClient.getQueryData(inventoryKeys.detail(f.stores.getSnapshot().scope!, P)),
    ).toBeUndefined();
  });

  it("reveals archived state during review and never grants another write", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProductInventory).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(5);
    vi.mocked(f.api.loadProduct).mockResolvedValue(product({ status: "archived" }));
    await f.mutation.reconcile();
    expect(f.mutation.getSnapshot().product?.status).toBe("archived");
    await f.mutation.execute(4);
    expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
  });

  it.each(["validation", "forbidden", "not-found", "rate-limited"] as const)(
    "preserves explicit %s rejection without automatic retry",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.updateProductInventory).mockRejectedValue(new ApiError(kind));
      await f.mutation.execute(5);
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "error", error: { kind } });
      expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
      expect(f.api.loadProductInventory).not.toHaveBeenCalled();
    },
  );

  it.each(["unauthenticated", "session-expired"] as const)(
    "bounds identity reconciliation after %s without mutation replay",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.updateProductInventory).mockRejectedValue(new ApiError(kind));
      await f.mutation.execute(5);
      await vi.waitFor(() => expect(f.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2));
      expect(f.scopeController.getScope()).toBeNull();
      expect(f.api.updateProductInventory).toHaveBeenCalledTimes(1);
    },
  );

  it("does not consume an unknown write when CSRF fails before PATCH", async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    f.api.updateProductInventory = createMerchantApi({
      apiOrigin: "https://api.example.test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=synthetic",
    }).updateProductInventory;
    await f.mutation.execute(5);
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "error",
      error: { mutationOutcome: "not-applicable" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
