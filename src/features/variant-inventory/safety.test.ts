import { describe, expect, it, vi } from "vitest";
import type { MerchantProduct } from "@/features/products/contracts";
import { productKeys } from "@/features/products/queries";
import type { MerchantVariant } from "@/features/variants/contracts";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { VariantInventory } from "./contracts";
import { getVariantInventoryMutationController } from "./mutations";
import { variantInventoryKeys } from "./queries";

const STORE = "a1111111-1111-4111-8111-111111111111";
const OTHER_STORE = "a2222222-2222-4222-8222-222222222222";
const PRODUCT = "b1111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT = "b2222222-2222-4222-8222-222222222222";
const VARIANT = "c1111111-1111-4111-8111-111111111111";
const OTHER_VARIANT = "c2222222-2222-4222-8222-222222222222";
const grants = ["products.view", "products.variants.view", "products.variants.inventory.update"];
const stock = (quantity: number | null): VariantInventory => ({
  quantity,
  availability: quantity === null ? "unavailable" : quantity === 0 ? "out_of_stock" : "in_stock",
});
const product: MerchantProduct = {
  id: PRODUCT,
  name: "Variant inventory safety product",
  slug: "variant-inventory-safety-product",
  description: "Independent inventory safety fixture",
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
};
const variant: MerchantVariant = {
  id: VARIANT,
  value_ids: [OTHER_VARIANT],
  sku: null,
  status: "inactive",
  price: null,
  ...stock(null),
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
};
const context = (id: string): MerchantStoreContext => ({
  store: { id, name: "Safety store", status: "active" },
  membership: { id: PRODUCT, status: "active" },
  role: { id: OTHER_PRODUCT, name: "Read and inventory only" },
  permissions: grants,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}
async function fixture(principalId = "inventory-principal") {
  const api: MerchantApi = {
    ...createMerchantApi({ apiOrigin: "https://api.example.test", fetch: vi.fn<typeof fetch>() }),
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId })),
      logout: vi.fn(async () => {}),
    },
    listStoresPage: vi.fn(async () => ({
      stores: [context(STORE).store, context(OTHER_STORE).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (id) => context(id)),
    loadProduct: vi.fn(async () => product),
    loadProductVariant: vi.fn(async () => variant),
    loadVariantInventory: vi.fn(async () => stock(7)),
    updateVariantInventory: vi.fn(async (input) => stock(input.data.quantity)),
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
    principalId,
    api,
    queryClient,
    scope,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(STORE);
  const controller = (target = product, targetVariant = variant) =>
    getVariantInventoryMutationController({
      api,
      session,
      stores,
      scope: stores.getSnapshot().scope!,
      product: target,
      variant: targetVariant,
    });
  return { api, queryClient, scope, session, stores, controller };
}

describe("Variant inventory independent safety probes", () => {
  it("preserves unresolved intent through Store navigation and requires explicit review on return", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateVariantInventory).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    const original = f.controller();
    await original.execute(7);
    expect(original.getSnapshot().status).toBe("unknown");
    await f.stores.select(OTHER_STORE);
    expect(f.controller().getSnapshot().status).toBe("idle");
    await f.stores.select(STORE);
    const returned = f.controller();
    expect(returned.getSnapshot().status).toBe("unknown");
    await returned.execute(7);
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
    const consumedSlot = returned.getSnapshot().slot;
    await returned.reconcile(consumedSlot);
    expect(returned.getSnapshot()).toMatchObject({ status: "idle", reviewedUnknown: true });
    expect(f.api.loadVariantInventory).toHaveBeenCalledTimes(1);
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
    await returned.execute(7, consumedSlot);
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
    await returned.execute(9, returned.getSnapshot().slot);
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(2);
  });

  it("retains unresolved state through access refresh without lending it to other Products or Variants", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateVariantInventory).mockRejectedValueOnce(
      new ApiError("timeout", { mutationOutcome: "unknown" }),
    );
    await f.controller().execute(7);
    await f.stores.revalidate();
    expect(f.controller().getSnapshot().status).toBe("unknown");
    expect(f.controller({ ...product, id: OTHER_PRODUCT }).getSnapshot().status).toBe("idle");
    expect(f.controller(product, { ...variant, id: OTHER_VARIANT }).getSnapshot().status).toBe(
      "idle",
    );
    const otherPrincipal = await fixture("different-principal");
    expect(otherPrincipal.controller().getSnapshot().status).toBe("idle");
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });

  it("retains an unresolved dispatch after leaving its scope and ignores a late response", async () => {
    const f = await fixture();
    const delayed = deferred<VariantInventory>();
    vi.mocked(f.api.updateVariantInventory).mockReturnValueOnce(delayed.promise);
    const originalScope = f.stores.getSnapshot().scope!;
    const pending = f.controller().execute(7);
    await vi.waitFor(() => expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1));
    await f.stores.select(OTHER_STORE);
    await pending;
    delayed.resolve(stock(7));
    await Promise.resolve();
    expect(
      f.queryClient.getQueryData(variantInventoryKeys.detail(originalScope, PRODUCT, VARIANT)),
    ).toBeUndefined();
    await f.stores.select(STORE);
    expect(f.controller().getSnapshot().status).toBe("unknown");
    await f.controller().execute(7);
    expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });

  it("allows inventory for an inactive unpriced Variant without copying quantity into its parent", async () => {
    const f = await fixture();
    const current = f.stores.getSnapshot().scope!;
    f.queryClient.setQueryData(productKeys.detail(current, PRODUCT), product);
    await f.controller().execute(2_000_000_000);
    expect(f.controller().getSnapshot().status).toBe("success");
    expect(
      f.queryClient.getQueryData<MerchantProduct>(productKeys.detail(current, PRODUCT))?.quantity,
    ).toBeNull();
    expect(f.api.updateVariantInventory).toHaveBeenCalledWith(
      {
        storeUuid: STORE,
        productUuid: PRODUCT,
        variantUuid: VARIANT,
        data: { quantity: 2_000_000_000 },
      },
      expect.any(AbortSignal),
    );
  });

  it.each(["Product", "Variant"])(
    "rejects a wrong %s identity during explicit reconciliation",
    async (target) => {
      const f = await fixture();
      vi.mocked(f.api.updateVariantInventory).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      const mutation = f.controller();
      await mutation.execute(7);
      if (target === "Product")
        vi.mocked(f.api.loadProduct).mockResolvedValue({ ...product, id: OTHER_PRODUCT });
      else vi.mocked(f.api.loadProductVariant).mockResolvedValue({ ...variant, id: OTHER_VARIANT });
      await mutation.reconcile();
      expect(mutation.getSnapshot()).toMatchObject({
        status: "unknown",
        error: { kind: "invalid-response" },
      });
      const current = f.stores.getSnapshot().scope!;
      expect(
        f.queryClient.getQueryData(variantInventoryKeys.detail(current, PRODUCT, VARIANT)),
      ).toBeUndefined();
      await mutation.execute(7);
      expect(f.api.updateVariantInventory).toHaveBeenCalledTimes(1);
    },
  );
});
