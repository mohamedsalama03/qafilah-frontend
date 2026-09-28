import { describe, expect, it, vi } from "vitest";
import type { MerchantVariant } from "@/features/variants/contracts";
import { variantKeys } from "@/features/variants/queries";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { parsePrincipalId, parseStoreUuid } from "@/lib/query/keys";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { Pricing } from "./contracts";
import { createPricingMutationController, getPricingMutationController } from "./mutations";
import { pricingKeys, loadScopedPricing } from "./queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const V = "55555555-5555-4555-8555-555555555555";
const W = "66666666-6666-4666-8666-666666666666";
const permissions = [
  "products.variants.price.update",
  "products.price.update",
  "products.view",
  "products.variants.view",
];
function variant(overrides: Partial<MerchantVariant> = {}): MerchantVariant {
  return {
    id: V,
    value_ids: [Q],
    sku: "VARIANT-ONE",
    status: "active",
    price: null,
    quantity: null,
    availability: "unavailable",
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
    ...overrides,
  };
}

describe.each(["product", "variant"] as const)("%s pricing lifecycle", (kind) => {
  const setup = (grants = permissions, overrides: Partial<MerchantProduct> = {}) =>
    fixture(
      grants,
      product({ type: kind === "product" ? "simple" : "variant", ...overrides }),
      kind,
    );
  it("scopes keys to principal Store authority Product and Variant", async () => {
    const f = await setup();
    const key = pricingKeys.detail(f.current, P, f.variant?.id);
    expect(key).toEqual([
      "merchant",
      "merchant-a",
      "store",
      A,
      f.current.revision,
      "pricing",
      { productUuid: P, variantUuid: f.variant?.id },
    ]);
    for (const other of [
      pricingKeys.detail({ ...f.current, principalId: parsePrincipalId("merchant-b") }, P, V),
      pricingKeys.detail({ ...f.current, storeUuid: parseStoreUuid(B) }, P, V),
      pricingKeys.detail({ ...f.current, revision: f.current.revision + 1 }, P, V),
      pricingKeys.detail(f.current, Q, V),
      pricingKeys.detail(f.current, P, W),
    ])
      expect(other).not.toEqual(key);
  });
  it("reads configured and unconfigured prices without write authority", async () => {
    const f = await setup(["products.view", "products.variants.view"]);
    vi.mocked(f.read).mockResolvedValueOnce(pricing(null));
    expect(await loadScopedPricing(f.options, P, f.variant?.id)).toEqual(pricing(null));
    expect(await f.mutation.execute(100)).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each([
    "products.view",
    "products.variants.view",
    "products.price.update",
    "products.variants.price.update",
  ])("checks independent grant %s", async (grant) => {
    const f = await setup(permissions.filter((p) => p !== grant));
    const needed =
      grant === "products.view" ||
      grant === (kind === "variant" ? "products.variants.view" : "products.view") ||
      grant === (kind === "variant" ? "products.variants.price.update" : "products.price.update");
    await f.mutation.execute(100);
    expect(f.write).toHaveBeenCalledTimes(needed ? 0 : 1);
  });
  it("denies write-only reads and editor dispatch", async () => {
    const f = await setup(["products.price.update", "products.variants.price.update"]);
    await expect(loadScopedPricing(f.options, P, f.variant?.id)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await f.mutation.execute(100);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each([null, undefined])("blocks currency %s without fallback", async (currency) => {
    const f = await setup();
    vi.mocked(f.api.loadStoreContext).mockResolvedValue({
      ...context(A),
      store: { ...context(A).store, currency },
    });
    await f.stores.revalidate();
    const next = getPricingMutationController({
      ...f.options,
      scope: f.stores.getSnapshot().scope!,
    });
    await next.execute(100);
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 1000000000000, NaN, Infinity])(
    "rejects invalid minor units %s before dispatch",
    async (amount) => {
      const f = await setup();
      await f.mutation.execute(amount);
      expect(f.write).not.toHaveBeenCalled();
    },
  );
  it("rejects archived Products and invalid parent types", async () => {
    for (const overrides of [
      { status: "archived" as const },
      { type: kind === "variant" ? ("simple" as const) : ("variant" as const) },
    ]) {
      const f = await setup(permissions, overrides);
      await f.mutation.execute(100);
      expect(f.write).not.toHaveBeenCalled();
    }
  });
  it("allows inactive Variant pricing", async () => {
    const f = await setup();
    const controller = createPricingMutationController({
      ...f.options,
      variant: f.variant ? variant({ status: "inactive" }) : undefined,
    });
    expect(await controller.execute(1)).toEqual(pricing(1));
  });
  it("single flights reentrant submissions and consumes success across remount", async () => {
    const f = await setup();
    const response = deferred<Pricing>();
    vi.mocked(f.write).mockReturnValue(response.promise);
    const controller = getPricingMutationController(f.options);
    const stop = controller.subscribe(() => {
      if (controller.getSnapshot().status === "pending") void controller.execute(200);
    });
    const first = controller.execute(100);
    expect(controller.execute(300)).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    response.resolve(pricing(100));
    await first;
    stop();
    await controller.execute(400);
    await getPricingMutationController(f.options).execute(500);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe("success");
  });
  it("never replays unknown writes; review observes only and requires a fresh slot", async () => {
    const f = await setup();
    vi.mocked(f.write).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(100);
    await f.mutation.execute(100);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.mutation.getSnapshot().status).toBe("unknown");
    vi.mocked(f.read).mockResolvedValueOnce(pricing(100));
    await f.mutation.reconcile();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      reviewedUnknown: true,
      pricing: pricing(100),
    });
    expect(f.write).toHaveBeenCalledTimes(1);
    await f.mutation.execute(100, 0);
    expect(f.write).toHaveBeenCalledTimes(1);
    await f.mutation.execute(200, 1);
    expect(f.write).toHaveBeenCalledTimes(2);
  });
  it("failed review retains the unknown lock", async () => {
    const f = await setup();
    vi.mocked(f.write).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(100);
    vi.mocked(f.read).mockRejectedValueOnce(new ApiError("network"));
    await f.mutation.reconcile();
    expect(f.mutation.getSnapshot().status).toBe("unknown");
    await f.mutation.execute(200);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("preserves confirmed success when projection refresh fails", async () => {
    const f = await setup();
    vi.spyOn(f.queryClient, "invalidateQueries").mockRejectedValue(new ApiError("network"));
    await f.mutation.execute(100);
    await Promise.resolve();
    expect(f.mutation.getSnapshot()).toMatchObject({ status: "success", pricing: pricing(100) });
    await f.mutation.execute(200);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("refreshes parent and Variant projections after success", async () => {
    const f = await setup();
    const invalidate = vi.spyOn(f.queryClient, "invalidateQueries");
    await f.mutation.execute(100);
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: productKeys.detail(f.current, P), exact: true },
      { throwOnError: true },
    );
    if (f.variant)
      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: variantKeys.detail(f.current, P, V), exact: true },
        { throwOnError: true },
      );
  });
  it.each(["store", "principal", "authority"])(
    "rejects stale read/write completion after %s replacement",
    async (change) => {
      const f = await setup();
      const response = deferred<Pricing>();
      vi.mocked(f.write).mockReturnValue(response.promise);
      const pending = f.mutation.execute(100);
      await Promise.resolve();
      await Promise.resolve();
      if (change === "store") await f.stores.select(B);
      else if (change === "principal") await f.auth.logout();
      else {
        vi.mocked(f.api.loadStoreContext).mockResolvedValue(
          context(A, [...permissions, "orders.view"]),
        );
        await f.stores.revalidate();
      }
      response.resolve(pricing(100));
      expect(await pending).toBeNull();
      expect(f.mutation.getSnapshot().status).not.toBe("success");
      expect(
        f.queryClient.getQueryData(pricingKeys.detail(f.current, P, f.variant?.id)),
      ).toBeUndefined();
    },
  );
  it("keeps uncertainty across Store navigation and read-permission loss", async () => {
    const f = await setup();
    vi.mocked(f.write).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute(100);
    await f.stores.select(B);
    await f.stores.select(A);
    const restored = getPricingMutationController({
      ...f.options,
      scope: f.stores.getSnapshot().scope!,
    });
    expect(restored.getSnapshot().status).toBe("unknown");
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(
      context(A, ["products.price.update", "products.variants.price.update"]),
    );
    await f.stores.revalidate();
    const denied = getPricingMutationController({
      ...f.options,
      scope: f.stores.getSnapshot().scope!,
    });
    await denied.reconcile();
    expect(f.read).not.toHaveBeenCalled();
    expect(denied.getSnapshot().status).toBe("unknown");
    await f.stores.revalidate();
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(context(A));
    await f.stores.revalidate();
    const renewed = getPricingMutationController({
      ...f.options,
      scope: f.stores.getSnapshot().scope!,
    });
    await renewed.reconcile();
    expect(renewed.getSnapshot().status).toBe("idle");
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("does not share controllers or responses across Products or Variants", async () => {
    const f = await setup();
    const one = getPricingMutationController(f.options);
    expect(getPricingMutationController({ ...f.options, product: product({ id: Q }) })).not.toBe(
      one,
    );
    if (f.variant)
      expect(getPricingMutationController({ ...f.options, variant: variant({ id: W }) })).not.toBe(
        one,
      );
  });
  it("requires a deliberate new review after confirmed success", async () => {
    const f = await setup();
    await f.mutation.execute(100);
    await f.mutation.reviewSuccess();
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      reviewedUnknown: false,
    });
    await f.mutation.execute(200, 0);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});
const pricing = (amount: number | null = 5): Pricing => ({
  price: amount === null ? null : { amount, currency: "LYD" },
});
function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: P,
    name: "Pricing product",
    slug: "pricing-product",
    description: "Pricing fixture",
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
    store: { id, name: "Store", status: "active", currency: "LYD" },
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
async function fixture(
  grants = permissions,
  target = product(),
  kind: "product" | "variant" = "variant",
) {
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
    loadProductVariant: vi.fn(async () => variant()),
    loadProductInventory: vi.fn(),
    updateProductInventory: vi.fn(),
    updateProductVariant: vi.fn(),
    listProductMedia: vi.fn(),
    createProductMedia: vi.fn(),
    updateProductMedia: vi.fn(),
    deleteProductMedia: vi.fn(),
    listVariantMedia: vi.fn(),
    createVariantMedia: vi.fn(),
    updateVariantMedia: vi.fn(),
    deleteVariantMedia: vi.fn(),
    loadProductPricing: vi.fn(async () => pricing()),
    updateProductPricing: vi.fn(async (input) => pricing(input.data.amount)),
    loadVariantPricing: vi.fn(async () => pricing()),
    updateVariantPricing: vi.fn(async (input) => pricing(input.data.amount)),
    loadVariantInventory: vi.fn(),
    updateVariantInventory: vi.fn(),
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
  const options = {
    api,
    session,
    stores,
    scope: current,
    product: target,
    variant: kind === "variant" ? variant() : undefined,
  };
  const mutation = createPricingMutationController(options);
  return {
    ...options,
    read: kind === "variant" ? api.loadVariantPricing : api.loadProductPricing,
    write: kind === "variant" ? api.updateVariantPricing : api.updateProductPricing,
    current,
    auth,
    scopeController: scope,
    queryClient,
    options,
    mutation,
  };
}
