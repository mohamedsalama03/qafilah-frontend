import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as apiProvider from "@/features/auth/components/merchant-api-provider";
import * as sessionBoundary from "@/features/auth/components/session-boundary";
import * as storeProvider from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { parsePrincipalId, parseStoreUuid } from "@/lib/query/keys";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantProductOption, MerchantVariant } from "./contracts";
import {
  createVariantMutationController,
  getVariantMutationController,
  useVariantMutation,
  type VariantOperation,
  type VariantMutationResult,
} from "./mutations";
import {
  loadScopedProductOptions,
  loadScopedProductVariants,
  loadScopedProductVariant,
  variantKeys,
} from "./queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const O = "55555555-5555-4555-8555-555555555555";
const X = "66666666-6666-4666-8666-666666666666";
const Y = "77777777-7777-4777-8777-777777777777";
const V = "88888888-8888-4888-8888-888888888888";
const permissions = [
  "products.view",
  "products.variants.view",
  "products.variants.create",
  "products.variants.update",
];
const option = (overrides: Partial<MerchantProductOption> = {}): MerchantProductOption => ({
  id: O,
  name: "Size",
  position: 0,
  values: [
    { id: X, value: "Small", position: 0 },
    { id: Y, value: "Large", position: 1 },
  ],
  ...overrides,
});
const variant = (overrides: Partial<MerchantVariant> = {}): MerchantVariant => ({
  id: V,
  value_ids: [X],
  sku: null,
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
  ...overrides,
});
function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: P,
    name: "Variant product",
    slug: "variant-product",
    description: "Fixture",
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
const operations: VariantOperation[] = [
  { kind: "option.create", data: { name: "Color", position: 1 } },
  { kind: "option.update", optionUuid: O, data: { name: "Sizing", position: 1 } },
  { kind: "value.create", optionUuid: O, data: { value: "Medium", position: 2 } },
  { kind: "value.update", optionUuid: O, valueUuid: X, data: { value: "Smaller", position: 1 } },
  { kind: "variant.create", data: { value_ids: [Y], sku: "SKU" } },
  { kind: "variant.update", variantUuid: V, data: { sku: null, status: "inactive" } },
];
const methods = [
  "createProductOption",
  "updateProductOption",
  "createProductOptionValue",
  "updateProductOptionValue",
  "createProductVariant",
  "updateProductVariant",
] as const;

async function fixture(grants = permissions, target = product()) {
  const api = createMerchantApi({ apiOrigin: "https://api.example.test" });
  Object.assign(api, {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "merchant-a" })),
      logout: vi.fn(async () => {}),
    },
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (id: string) => context(id, grants)),
    loadProduct: vi.fn(async () => target),
    listProductOptions: vi.fn(async () => [option()]),
    listProductVariants: vi.fn(async () => [variant()]),
    loadProductVariant: vi.fn(async () => variant()),
    createProductOption: vi.fn(async () =>
      option({ id: Q, name: "Color", position: 1, values: [] }),
    ),
    updateProductOption: vi.fn(async () => option({ name: "Sizing", position: 1 })),
    createProductOptionValue: vi.fn(async () =>
      option({ values: [...option().values, { id: Q, value: "Medium", position: 2 }] }),
    ),
    updateProductOptionValue: vi.fn(async () =>
      option({ values: [{ id: X, value: "Smaller", position: 1 }, option().values[1]] }),
    ),
    createProductVariant: vi.fn(async () => variant({ value_ids: [Y], sku: "SKU" })),
    updateProductVariant: vi.fn(async () => variant({ status: "inactive" })),
  });
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
  queryClient.setQueryData(variantKeys.options(scope, target.id), [option()]);
  queryClient.setQueryData(variantKeys.list(scope, target.id), []);
  queryClient.setQueryData(productKeys.detail(scope, target.id), target);
  const authority = { api, session, stores, scope, product: target };
  const mutation = createVariantMutationController(authority);
  function existingVariants(values = [variant()]) {
    queryClient.setQueryData(variantKeys.list(scope, target.id), values);
  }
  return {
    ...authority,
    authority,
    queryClient,
    scopeController,
    auth,
    mutation,
    existingVariants,
  };
}

describe("variant authority and scoped reads", () => {
  it("scopes every structural key by principal Store revision Product and nested Variant", async () => {
    const f = await fixture();
    for (const key of [
      variantKeys.options(f.scope, P),
      variantKeys.list(f.scope, P),
      variantKeys.detail(f.scope, P, V),
    ])
      expect(key.slice(0, 5)).toEqual(["merchant", "merchant-a", "store", A, f.scope.revision]);
    for (const other of [
      variantKeys.detail({ ...f.scope, principalId: parsePrincipalId("merchant-b") }, P, V),
      variantKeys.detail({ ...f.scope, storeUuid: parseStoreUuid(B) }, P, V),
      variantKeys.detail({ ...f.scope, revision: f.scope.revision + 1 }, P, V),
      variantKeys.detail(f.scope, Q, V),
      variantKeys.detail(f.scope, P, Q),
    ])
      expect(other).not.toEqual(variantKeys.detail(f.scope, P, V));
  });
  it.each([
    [],
    ["products.view"],
    ["products.variants.view"],
    ["products.create", "products.update"],
  ])(
    "denies structural reads without independent read grants regardless of role: %j",
    async (...grants) => {
      const f = await fixture(grants);
      for (const read of [
        () => loadScopedProductOptions(f.authority, P),
        () => loadScopedProductVariants(f.authority, P),
        () => loadScopedProductVariant(f.authority, P, V),
      ])
        await expect(read()).rejects.toMatchObject({ kind: "forbidden" });
      expect(f.api.listProductOptions).not.toHaveBeenCalled();
      expect(f.api.listProductVariants).not.toHaveBeenCalled();
      expect(f.api.loadProductVariant).not.toHaveBeenCalled();
    },
  );
  it("read-only grants load all three reads without create or update", async () => {
    const f = await fixture(["products.view", "products.variants.view"]);
    expect(await loadScopedProductOptions(f.authority, P)).toEqual([option()]);
    expect(await loadScopedProductVariants(f.authority, P)).toEqual([variant()]);
    expect(await loadScopedProductVariant(f.authority, P, V)).toEqual(variant());
  });
  it.each(operations.map((operation, index) => ({ operation, method: methods[index] })))(
    "requires the exact independent grant for $operation.kind",
    async ({ operation, method }) => {
      const required = operation.kind.endsWith(".create")
        ? "products.variants.create"
        : "products.variants.update";
      const f = await fixture(permissions.filter((value) => value !== required));
      if (operation.kind === "variant.update") f.existingVariants();
      expect(await f.mutation.execute(operation)).toBeNull();
      expect(f.api[method]).not.toHaveBeenCalled();
      expect(f.mutation.getSnapshot().error?.kind).toBe("forbidden");
    },
  );
  it.each(operations.map((operation, index) => ({ operation, method: methods[index] })))(
    "allows $operation.kind without the other independent write grant",
    async ({ operation, method }) => {
      const irrelevant = operation.kind.endsWith(".create")
        ? "products.variants.update"
        : "products.variants.create";
      const f = await fixture(permissions.filter((value) => value !== irrelevant));
      if (operation.kind === "variant.update") f.existingVariants();
      expect(await f.mutation.execute(operation)).not.toBeNull();
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      expect(f.api[method]).toHaveBeenCalledWith(
        expect.objectContaining({ storeUuid: A, productUuid: P, data: operation.data }),
        expect.any(AbortSignal),
      );
    },
  );
  it.each([{ type: "simple" as const }, { status: "archived" as const }])(
    "blocks structural writes for Product boundary %j",
    async (overrides) => {
      const f = await fixture(permissions, product(overrides));
      await f.mutation.execute(operations[0]);
      expect(f.api.createProductOption).not.toHaveBeenCalled();
    },
  );
  it.each(permissions)(
    "revocation of %s immediately blocks its applicable operation",
    async (permission) => {
      const f = await fixture();
      vi.mocked(f.api.loadStoreContext).mockResolvedValue(
        context(
          A,
          permissions.filter((value) => value !== permission),
        ),
      );
      await f.stores.revalidate();
      const next = createVariantMutationController({
        ...f.authority,
        scope: f.stores.getSnapshot().scope!,
      });
      const operation = permission.endsWith("update") ? operations[1] : operations[0];
      await next.execute(operation);
      expect(
        methods.reduce((count, method) => count + vi.mocked(f.api[method]).mock.calls.length, 0),
      ).toBe(0);
    },
  );
  it.each(["read", "write", "review"])("discards delayed $0 after Store switch", async (mode) => {
    const f = await fixture();
    const delayed = deferred<MerchantProductOption[]>();
    let task: Promise<unknown>;
    if (mode === "write") {
      vi.mocked(f.api.createProductOption).mockImplementation(
        async () => (await delayed.promise)[0],
      );
      task = f.mutation.execute(operations[0]);
      await vi.waitFor(() => expect(f.api.createProductOption).toHaveBeenCalledTimes(1));
    } else {
      if (mode === "review") {
        await f.mutation.execute(operations[0]);
      }
      vi.mocked(f.api.listProductOptions).mockReturnValue(delayed.promise);
      task =
        mode === "review"
          ? f.mutation.review()
          : loadScopedProductOptions(f.authority, P).catch(() => null);
      await vi.waitFor(() => expect(f.api.listProductOptions).toHaveBeenCalledTimes(1));
    }
    await f.stores.select(B);
    const other = f.stores.getSnapshot().scope!;
    f.queryClient.setQueryData(variantKeys.options(other, P), [option({ name: "Other Store" })]);
    delayed.resolve([option()]);
    await task;
    expect(f.queryClient.getQueryData(variantKeys.options(other, P))).toEqual([
      option({ name: "Other Store" }),
    ]);
    expect(f.queryClient.getQueryData(variantKeys.options(f.scope, P))).toBeUndefined();
    expect(f.mutation.getSnapshot().slot).toBe(0);
  });
  it("discards delayed success after principal replacement", async () => {
    const f = await fixture();
    const response = deferred<MerchantProductOption>();
    vi.mocked(f.api.createProductOption).mockReturnValue(response.promise);
    const task = f.mutation.execute(operations[0]);
    await vi.waitFor(() => expect(f.api.createProductOption).toHaveBeenCalledTimes(1));
    await f.auth.logout();
    const other = f.scopeController.setScope({ principalId: "merchant-b", storeUuid: A });
    f.queryClient.setQueryData(variantKeys.options(other, P), [
      option({ name: "Other principal" }),
    ]);
    response.resolve(option({ id: Q }));
    await task;
    expect(f.queryClient.getQueryData(variantKeys.options(other, P))).toEqual([
      option({ name: "Other principal" }),
    ]);
    expect(f.mutation.getSnapshot().status).not.toBe("success");
  });
  it("late Product A response never publishes into Product B", async () => {
    const f = await fixture();
    const response = deferred<MerchantProductOption>();
    vi.mocked(f.api.createProductOption).mockReturnValue(response.promise);
    const task = f.mutation.execute(operations[0]);
    await vi.waitFor(() => expect(f.api.createProductOption).toHaveBeenCalledTimes(1));
    const other = getVariantMutationController({ ...f.authority, product: product({ id: Q }) });
    f.queryClient.setQueryData(variantKeys.options(f.scope, Q), [option({ name: "Product B" })]);
    response.resolve(option({ id: B, name: "Product A color" }));
    await task;
    expect(f.queryClient.getQueryData(variantKeys.options(f.scope, Q))).toEqual([
      option({ name: "Product B" }),
    ]);
    expect(other.getSnapshot().status).toBe("idle");
  });
});

describe("structural consumed interactions", () => {
  it("single-flight spans operation kind target and payload before subscribers", async () => {
    const f = await fixture();
    let duplicate: Promise<VariantMutationResult | null> | undefined;
    let reentered = false;
    f.mutation.subscribe(() => {
      if (f.mutation.getSnapshot().status === "pending" && !reentered) {
        reentered = true;
        duplicate = f.mutation.execute(operations[2]);
      }
    });
    const task = f.mutation.execute(operations[0]);
    expect(duplicate).toBe(task);
    expect(f.mutation.execute(operations[1])).toBe(task);
    await task;
    expect(f.api.createProductOption).toHaveBeenCalledTimes(1);
    expect(f.api.createProductOptionValue).not.toHaveBeenCalled();
    expect(f.api.updateProductOption).not.toHaveBeenCalled();
  });
  it("success consumes every operation across response boundary and remount until explicit review", async () => {
    const f = await fixture();
    const controller = getVariantMutationController(f.authority);
    await controller.execute(operations[0], 0);
    const remounted = getVariantMutationController(f.authority);
    expect(remounted).toBe(controller);
    for (const operation of operations) expect(await remounted.execute(operation, 0)).toBeNull();
    expect(f.api.createProductOption).toHaveBeenCalledTimes(1);
    expect(f.api.listProductOptions).not.toHaveBeenCalled();
    await remounted.review(0);
    expect(remounted.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      operation: null,
      result: null,
      reviewedUnknown: false,
      guidance: "current-configuration-reviewed",
    });
    expect(await controller.execute(operations[1], 0)).toBeNull();
    await controller.execute(operations[1], 1);
    expect(f.api.updateProductOption).toHaveBeenCalledTimes(1);
  });
  it("hook remount keeps consumed state and stale closure cannot use reviewed slot", async () => {
    const f = await fixture();
    vi.spyOn(apiProvider, "useMerchantApi").mockReturnValue(f.api);
    vi.spyOn(sessionBoundary, "useMerchantSession").mockReturnValue(f.session);
    vi.spyOn(storeProvider, "useStores").mockReturnValue({
      controller: f.stores,
      state: f.stores.getSnapshot(),
    });
    const first = renderHook(() => useVariantMutation(product()));
    const oldExecute = first.result.current.execute;
    await act(async () => {
      await oldExecute(operations[0]);
    });
    first.unmount();
    const second = renderHook(() => useVariantMutation(product()));
    expect(second.result.current.isBlocked).toBe(true);
    await act(async () => {
      await second.result.current.review();
    });
    expect(second.result.current.state.slot).toBe(1);
    expect(await oldExecute(operations[1])).toBeNull();
    expect(f.api.updateProductOption).not.toHaveBeenCalled();
  });
  it("snapshots payload before asynchronous dispatch", async () => {
    const f = await fixture();
    const data = { value_ids: [Y], sku: "Original" };
    const task = f.mutation.execute({ kind: "variant.create", data });
    data.sku = "Changed";
    data.value_ids[0] = X;
    await task;
    expect(f.api.createProductVariant).toHaveBeenCalledWith(
      expect.objectContaining({ data: { value_ids: [Y], sku: "Original" } }),
      expect.any(AbortSignal),
    );
  });
  it("never shares controllers across Product session or authority revision", async () => {
    const f = await fixture();
    const first = getVariantMutationController(f.authority);
    expect(getVariantMutationController({ ...f.authority, product: product({ id: Q }) })).not.toBe(
      first,
    );
    expect(getVariantMutationController({ ...f.authority, session: { ...f.session } })).not.toBe(
      first,
    );
    await f.stores.select(B);
    await f.stores.select(A);
    expect(
      getVariantMutationController({ ...f.authority, scope: f.stores.getSnapshot().scope! }),
    ).not.toBe(first);
  });
  it("cancels stale parent Option reads before publishing a Value response", async () => {
    const f = await fixture();
    const response = deferred<MerchantProductOption[]>();
    const key = variantKeys.options(f.scope, P);
    const oldRead = f.queryClient
      .fetchQuery({ queryKey: key, queryFn: () => response.promise })
      .catch(() => null);
    await f.mutation.execute(operations[3]);
    response.resolve([option()]);
    await oldRead;
    expect(f.queryClient.getQueryData<MerchantProductOption[]>(key)?.[0].values[0].value).toBe(
      "Smaller",
    );
  });
  it("keeps success while projections are pending and when they fail", async () => {
    const f = await fixture();
    const response = deferred<void>();
    vi.spyOn(f.queryClient, "invalidateQueries").mockReturnValue(response.promise);
    await f.mutation.execute(operations[0]);
    expect(f.mutation.getSnapshot()).toMatchObject({ status: "success", refreshError: null });
    expect(await f.mutation.execute(operations[1])).toBeNull();
    response.reject(new ApiError("network"));
    await vi.waitFor(() => expect(f.mutation.getSnapshot().refreshError?.kind).toBe("network"));
    expect(f.mutation.getSnapshot().status).toBe("success");
    expect(f.api.updateProductOption).not.toHaveBeenCalled();
  });
  it("failed review of success preserves confirmed earlier setup and its consumed slot", async () => {
    const f = await fixture();
    await f.mutation.execute(operations[0]);
    vi.mocked(f.api.listProductOptions).mockRejectedValue(new ApiError("network"));
    await f.mutation.review();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "success",
      slot: 0,
      result: { id: Q },
      refreshError: { kind: "network" },
    });
    expect(await f.mutation.execute(operations[1])).toBeNull();
    expect(
      f.queryClient
        .getQueryData<MerchantProductOption[]>(variantKeys.options(f.scope, P))
        ?.some((value) => value.id === Q),
    ).toBe(true);
  });
});

describe("unknown structural outcome and authoritative review", () => {
  it.each(["network", "timeout", "server", "invalid-response"] as const)(
    "unknown %s locks all operation forms without replay",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.createProductOption).mockRejectedValueOnce(
        new ApiError(kind, { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(operations[0]);
      for (const operation of operations) expect(await f.mutation.execute(operation)).toBeNull();
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      expect(f.api.createProductOption).toHaveBeenCalledTimes(1);
      expect(f.api.listProductOptions).not.toHaveBeenCalled();
      expect(
        methods.reduce((count, method) => count + vi.mocked(f.api[method]).mock.calls.length, 0),
      ).toBe(1);
    },
  );
  it.each([true, false])(
    "review after committed=%s observes current setup without receipt or old payload",
    async (committed) => {
      const f = await fixture();
      vi.mocked(f.api.createProductOptionValue).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(operations[2], 0);
      const currentOption = option({
        name: "Concurrent label",
        values: committed
          ? [...option().values, { id: Q, value: "Medium", position: 2 }]
          : option().values,
      });
      vi.mocked(f.api.listProductOptions).mockResolvedValue([currentOption]);
      await f.mutation.review(0);
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        options: [currentOption],
        operation: null,
        result: null,
        reviewedUnknown: true,
        guidance: "current-configuration-reviewed",
      });
      expect(f.api.createProductOptionValue).toHaveBeenCalledTimes(1);
      expect(await f.mutation.execute(operations[2], 0)).toBeNull();
      expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
      expect(f.api.listProductOptions).toHaveBeenCalledTimes(1);
      expect(f.api.listProductVariants).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["loadProduct", "listProductOptions", "listProductVariants"] as const)(
    "failed %s review retains unknown lock",
    async (method) => {
      const f = await fixture();
      vi.mocked(f.api.createProductOptionValue).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.mutation.execute(operations[2]);
      vi.mocked(f.api[method]).mockRejectedValue(new ApiError("network"));
      await f.mutation.review();
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        slot: 0,
        error: { kind: "network" },
      });
      expect(await f.mutation.execute(operations[1])).toBeNull();
      expect(f.api.updateProductOption).not.toHaveBeenCalled();
    },
  );
  it("review is single-flight and blocks every write until every read settles", async () => {
    const f = await fixture();
    await f.mutation.execute(operations[0]);
    const response = deferred<MerchantProduct>();
    vi.mocked(f.api.loadProduct).mockReturnValue(response.promise);
    const first = f.mutation.review();
    expect(f.mutation.review()).toBe(first);
    expect(await f.mutation.execute(operations[1])).toBeNull();
    await vi.waitFor(() => expect(f.api.listProductOptions).toHaveBeenCalledTimes(1));
    expect(f.mutation.getSnapshot().status).toBe("reviewing");
    response.resolve(product());
    await first;
    expect(f.api.updateProductOption).not.toHaveBeenCalled();
  });
  it("inconsistent options and combinations cannot release unknown review", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductOptionValue).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(operations[2]);
    vi.mocked(f.api.listProductVariants).mockResolvedValue([variant({ value_ids: [B] })]);
    await f.mutation.review();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "unknown",
      slot: 0,
      error: { kind: "invalid-response" },
    });
  });
  it("observed archive during review prevents subsequent structural dispatch", async () => {
    const f = await fixture();
    await f.mutation.execute(operations[0]);
    vi.mocked(f.api.loadProduct).mockResolvedValue(product({ status: "archived" }));
    await f.mutation.review();
    await f.mutation.execute(operations[1]);
    expect(f.mutation.getSnapshot().product?.status).toBe("archived");
    expect(f.api.updateProductOption).not.toHaveBeenCalled();
  });
  it.each(["validation", "forbidden", "not-found", "rate-limited"] as const)(
    "explicit %s remains a rejected operation without automatic retry",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.createProductOptionValue).mockRejectedValueOnce(new ApiError(kind));
      await f.mutation.execute(operations[2]);
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "error", error: { kind } });
      expect(f.api.createProductOptionValue).toHaveBeenCalledTimes(1);
    },
  );
  it("CSRF failure before dispatch does not create an unknown structural write", async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    f.api.createProductOption = createMerchantApi({
      apiOrigin: "https://api.example.test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=synthetic",
    }).createProductOption;
    await f.mutation.execute(operations[0]);
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "error",
      error: { mutationOutcome: "not-applicable" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { kind: "option.update", optionUuid: O, data: { name: "Sizing", position: 1 } },
    { kind: "value.update", optionUuid: O, valueUuid: X, data: { value: "Smaller", position: 1 } },
  ] satisfies VariantOperation[])(
    "foreign parent response makes $kind unknown and never poisons cache",
    async (operation) => {
      const f = await fixture();
      vi.mocked(
        operation.kind === "option.update"
          ? f.api.updateProductOption
          : f.api.updateProductOptionValue,
      ).mockResolvedValue(option({ id: B }));
      await f.mutation.execute(operation);
      expect(f.mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        error: { kind: "invalid-response" },
      });
      expect(f.queryClient.getQueryData(variantKeys.options(f.scope, P))).toEqual([option()]);
    },
  );
});

describe("structural local bounds preserve Laravel authority", () => {
  it("blocks fourth Option and all new Options after the first inactive Variant", async () => {
    for (const populated of [false, true]) {
      const f = await fixture();
      if (populated) f.existingVariants([variant({ status: "inactive" })]);
      else
        f.queryClient.setQueryData(variantKeys.options(f.scope, P), [
          option(),
          option({ id: Q }),
          option({ id: B }),
        ]);
      await f.mutation.execute(operations[0]);
      expect(f.api.createProductOption).not.toHaveBeenCalled();
    }
  });
  it("blocks twenty-first Value and hundred-first Variant including inactive", async () => {
    const f = await fixture();
    f.queryClient.setQueryData(variantKeys.options(f.scope, P), [
      option({
        values: Array.from({ length: 20 }, (_, index) => ({
          id: String(index),
          value: String(index),
          position: index,
        })),
      }),
    ]);
    await f.mutation.execute(operations[2]);
    expect(f.api.createProductOptionValue).not.toHaveBeenCalled();
    f.queryClient.setQueryData(variantKeys.options(f.scope, P), [option()]);
    f.existingVariants(
      Array.from({ length: 100 }, (_, index) => variant({ id: String(index), status: "inactive" })),
    );
    await f.mutation.execute(operations[4]);
    expect(f.api.createProductVariant).not.toHaveBeenCalled();
  });
  it.each([[], [X, Y], [B], [X, X]])(
    "blocks invalid or incomplete combination %j",
    async (...value_ids) => {
      const f = await fixture();
      await f.mutation.execute({ kind: "variant.create", data: { value_ids } });
      expect(f.api.createProductVariant).not.toHaveBeenCalled();
    },
  );
  it("blocks duplicate combination while allowing a new complete combination", async () => {
    const f = await fixture();
    f.existingVariants();
    await f.mutation.execute({ kind: "variant.create", data: { value_ids: [X] } });
    expect(f.api.createProductVariant).not.toHaveBeenCalled();
    await f.mutation.execute(operations[4]);
    expect(f.api.createProductVariant).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch immutable combination fields in Variant update", async () => {
    const f = await fixture();
    f.existingVariants();
    await f.mutation.execute({
      kind: "variant.update",
      variantUuid: V,
      data: { status: "inactive", value_ids: [Y] } as never,
    });
    expect(f.api.updateProductVariant).not.toHaveBeenCalled();
  });
  it("foreign Option Value and Variant targets never dispatch locally", async () => {
    for (const operation of [
      { ...operations[1], optionUuid: B },
      { ...operations[3], valueUuid: B },
      { ...operations[5], variantUuid: B },
    ] as VariantOperation[]) {
      const f = await fixture();
      f.existingVariants();
      await f.mutation.execute(operation);
      expect(
        methods.reduce((count, method) => count + vi.mocked(f.api[method]).mock.calls.length, 0),
      ).toBe(0);
    }
  });
  it("a Variant update response cannot change its immutable combination", async () => {
    const f = await fixture();
    f.existingVariants();
    vi.mocked(f.api.updateProductVariant).mockResolvedValue(variant({ value_ids: [Y] }));
    await f.mutation.execute(operations[5]);
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "unknown",
      error: { kind: "invalid-response" },
    });
    expect(f.queryClient.getQueryData(variantKeys.list(f.scope, P))).toEqual([variant()]);
  });
});
