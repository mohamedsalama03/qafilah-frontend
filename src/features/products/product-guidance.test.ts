import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import type { MerchantApi } from "@/lib/backend/client";
import { createQueryClient } from "@/lib/query/client";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantProduct } from "./contracts";
import { createProductMutationController } from "./mutations";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const data = {
  name: "Guidance controller A",
  slug: "guidance-controller",
  description: "Authoritative controller description",
};
const product: MerchantProduct = {
  id: P,
  ...data,
  seo_title: null,
  seo_description: null,
  status: "draft",
  type: "simple",
  requires_shipping: true,
  published_at: null,
  price: null,
  quantity: null,
  availability: "unavailable",
  categories: [],
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
};
function context(id: string) {
  return {
    store: { id, name: "Guidance Store", status: "active" as const },
    membership: { id: P, status: "active" as const },
    role: { id: P, name: "Operator" },
    permissions: ["products.view", "products.create", "products.update", "products.publish"],
  };
}
async function fixture(create = false) {
  const api: MerchantApi = {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "guidance-controller-reader" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (uuid) => context(uuid)),
    loadProduct: vi.fn(async () => product),
    listProducts: vi.fn(async () => ({
      products: [product],
      pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
      effectiveRange: {
        created_from: "2025-09-01T00:00:00+00:00",
        created_to: "2026-09-01T00:00:00+00:00",
      },
    })),
    listCategories: vi.fn(),
    createProduct: vi.fn(async () => product),
    updateProduct: vi.fn(async () => product),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
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
    principalId: "guidance-controller-reader",
    api,
    queryClient,
    scope,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(A);
  const controller = createProductMutationController({
    api,
    session,
    stores,
    scope: stores.getSnapshot().scope!,
    productUuid: create ? undefined : P,
  });
  return { api, session, stores, controller };
}
describe("Product slot guidance lifecycle", () => {
  it.each([false, true])(
    "unknown update creates guidance only after explicit successful GET (committed=%s)",
    async (committed) => {
      const f = await fixture();
      vi.mocked(f.api.updateProduct).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.controller.execute({ action: "update", data: { name: "Typed B" } });
      expect(f.controller.getSnapshot()).toMatchObject({ status: "unknown", slot: 0 });
      expect(f.controller.getSnapshot().guidance).toBeUndefined();
      expect(f.api.loadProduct).not.toHaveBeenCalled();
      vi.mocked(f.api.loadProduct).mockResolvedValueOnce({
        ...product,
        name: committed ? "Typed B" : data.name,
      });
      await f.controller.reconcile();
      expect(f.controller.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        guidance: "product-loaded",
        product: { name: committed ? "Typed B" : data.name },
      });
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      let resolve!: (value: MerchantProduct) => void;
      vi.mocked(f.api.updateProduct).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const save = f.controller.execute({ action: "update", data: { name: "Deliberate C" } });
      expect(f.controller.getSnapshot().status).toBe("pending");
      expect(f.controller.getSnapshot().guidance).toBeUndefined();
      await vi.waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(2));
      resolve({ ...product, name: "Deliberate C" });
      await save;
      expect(f.controller.getSnapshot().status).toBe("success");
      expect(f.controller.getSnapshot().guidance).toBeUndefined();
    },
  );

  it("known review failure stays confirmed and adds guidance only on a later successful review", async () => {
    const f = await fixture();
    await f.controller.execute({ action: "update", data: { name: "Confirmed B" } });
    vi.mocked(f.api.loadProduct).mockRejectedValueOnce(new ApiError("network"));
    await f.controller.reviewSuccess();
    expect(f.controller.getSnapshot()).toMatchObject({ status: "success", slot: 0 });
    expect(f.controller.getSnapshot().guidance).toBeUndefined();
    await f.controller.reviewSuccess();
    expect(f.controller.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      guidance: "product-loaded",
    });
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("unknown creation stays locked through failed and successful list reads until explicit separate creation", async () => {
    const f = await fixture(true);
    vi.mocked(f.api.createProduct).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.controller.execute({ action: "create", data });
    vi.mocked(f.api.listProducts).mockRejectedValueOnce(new ApiError("network"));
    await f.controller.reconcile();
    expect(f.controller.startSeparateCreate()).toBe(false);
    expect(f.controller.getSnapshot()).toMatchObject({ status: "unknown", slot: 0 });
    expect(f.controller.getSnapshot().guidance).toBeUndefined();
    await f.controller.reconcile();
    expect(f.controller.getSnapshot()).toMatchObject({
      status: "unknown",
      slot: 0,
      creationReviewed: true,
    });
    expect(f.controller.getSnapshot().guidance).toBeUndefined();
    expect(f.controller.startSeparateCreate()).toBe(true);
    expect(f.controller.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      guidance: "blank-product",
      product: null,
    });
    expect(f.api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("confirmed create renews blank guidance without issuing a read or another write", async () => {
    const f = await fixture(true);
    await f.controller.execute({ action: "create", data });
    expect(f.controller.startAnotherCreate()).toBe(true);
    expect(f.controller.getSnapshot()).toMatchObject({
      status: "idle",
      slot: 1,
      guidance: "blank-product",
      product: null,
    });
    expect(f.controller.startAnotherCreate()).toBe(false);
    expect(f.api.createProduct).toHaveBeenCalledTimes(1);
    expect(f.api.listProducts).not.toHaveBeenCalled();
    expect(f.api.loadProduct).not.toHaveBeenCalled();
  });

  it("a review that finishes after Store authority changed cannot publish guidance or server data", async () => {
    const f = await fixture();
    vi.mocked(f.api.updateProduct).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.controller.execute({ action: "update", data: { name: "Typed B" } });
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(f.api.loadProduct).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const review = f.controller.reconcile();
    await vi.waitFor(() => expect(f.api.loadProduct).toHaveBeenCalledTimes(1));
    await f.stores.select(B);
    resolve(product);
    expect(await review).toBeNull();
    expect(f.controller.getSnapshot().guidance).toBeUndefined();
    expect(f.controller.getSnapshot().product).toBeNull();
    const other = createProductMutationController({
      api: f.api,
      session: f.session,
      stores: f.stores,
      scope: f.stores.getSnapshot().scope!,
      productUuid: P,
    });
    expect(other.getSnapshot()).toMatchObject({ status: "idle", slot: 0 });
    expect(other.getSnapshot().guidance).toBeUndefined();
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });
});
