import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as apiProvider from "@/features/auth/components/merchant-api-provider";
import * as sessionBoundary from "@/features/auth/components/session-boundary";
import * as storeProvider from "@/features/stores/components/store-provider";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import type { MerchantApi } from "@/lib/backend/client";
import { createQueryClient } from "@/lib/query/client";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantProduct } from "./contracts";
import {
  createProductMutationController,
  useProductMutation,
  type ProductMutationCommand,
} from "./mutations";

const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "33333333-3333-4333-8333-333333333333";
const data = { name: "Slot product", slug: "slot-product", description: "Plain slot description" };
const product: MerchantProduct = {
  id: productUuid,
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
const operations = [
  ["create", "createProduct", { action: "create", data }],
  ["update", "updateProduct", { action: "update", data: { name: "Changed slot product" } }],
  ["publish", "publishProduct", { action: "publish" }],
  ["unpublish", "unpublishProduct", { action: "unpublish" }],
  ["archive", "archiveProduct", { action: "archive" }],
] as const;
async function fixture(create = false) {
  const context = {
    store: { id: storeUuid, name: "Slot Store", status: "active" as const },
    membership: { id: productUuid, status: "active" as const },
    role: { id: productUuid, name: "Operator" },
    permissions: ["products.view", "products.create", "products.update", "products.publish"],
  };
  const api: MerchantApi = {
    listProductOptions: vi.fn(),
    createProductOption: vi.fn(),
    updateProductOption: vi.fn(),
    createProductOptionValue: vi.fn(),
    updateProductOptionValue: vi.fn(),
    listProductVariants: vi.fn(),
    createProductVariant: vi.fn(),
    loadVariantInventory: vi.fn(),
    updateVariantInventory: vi.fn(),
    loadProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
    loadProductInventory: vi.fn(),
    updateProductInventory: vi.fn(),
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "slot-reader" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context.store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
    })),
    loadStoreContext: vi.fn(async () => context),
    loadProduct: vi.fn(async () => product),
    listProducts: vi.fn(),
    listCategories: vi.fn(),
    createProduct: vi.fn(async () => product),
    updateProduct: vi.fn(async () => product),
    publishProduct: vi.fn(async () => ({ ...product, status: "published" as const })),
    unpublishProduct: vi.fn(async () => product),
    archiveProduct: vi.fn(async () => ({ ...product, status: "archived" as const })),
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
    principalId: "slot-reader",
    api,
    queryClient,
    scope,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(storeUuid);
  const controller = createProductMutationController({
    api,
    session,
    stores,
    scope: stores.getSnapshot().scope!,
    productUuid: create ? undefined : productUuid,
  });
  return { api, session, stores, controller };
}

describe("Product completed submission slot", () => {
  it.each(operations)(
    "terminal %s controller refuses a second write after confirmed success",
    async (action, method, command) => {
      const f = await fixture(action === "create");
      await f.controller.execute(command);
      expect(f.controller.getSnapshot().status).toBe("success");
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      const repeated = await f.controller.execute(command);
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      expect(repeated).toBeNull();
      const opposite: ProductMutationCommand =
        action === "publish"
          ? { action: "unpublish" }
          : action === "unpublish"
            ? { action: "publish" }
            : command;
      await f.controller.execute(opposite);
      expect(
        operations.reduce(
          (count, [, apiMethod]) => count + vi.mocked(f.api[apiMethod]).mock.calls.length,
          0,
        ),
      ).toBe(1);
    },
  );

  it.each(operations.filter(([action]) => action !== "archive"))(
    "retained %s hook handlers cannot dispatch into a deliberately renewed slot",
    async (action, method, command) => {
      const f = await fixture(action === "create");
      vi.spyOn(apiProvider, "useMerchantApi").mockReturnValue(f.api);
      vi.spyOn(sessionBoundary, "useMerchantSession").mockReturnValue(f.session);
      vi.spyOn(storeProvider, "useStores").mockReturnValue({
        controller: f.stores,
        state: f.stores.getSnapshot(),
      });
      const hook = renderHook(() =>
        useProductMutation(action === "create" ? undefined : productUuid),
      );
      const oldExecute = hook.result.current.execute;
      const oldSlot = hook.result.current.state.slot;
      await act(async () => {
        await oldExecute(command);
      });
      expect(hook.result.current.isBlocked).toBe(true);
      await act(async () => {
        if (action === "create") expect(hook.result.current.startAnotherCreate()).toBe(true);
        else await hook.result.current.reviewSuccess();
      });
      expect(hook.result.current.state.slot).toBe(oldSlot + 1);
      expect(hook.result.current.isBlocked).toBe(false);
      await act(async () => {
        await oldExecute(command);
      });
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      await act(async () => {
        await hook.result.current.execute(command);
      });
      expect(f.api[method]).toHaveBeenCalledTimes(2);
    },
  );

  it("a failed explicit review preserves known success and the completed slot", async () => {
    const f = await fixture();
    await f.controller.execute({ action: "publish" });
    const success = f.controller.getSnapshot();
    vi.mocked(f.api.loadProduct).mockRejectedValueOnce(new ApiError("network"));
    expect(await f.controller.reviewSuccess()).toBeNull();
    expect(f.controller.getSnapshot()).toMatchObject({
      status: "success",
      slot: success.slot,
      product: success.product,
    });
    expect(f.controller.getSnapshot().error?.kind).toBe("network");
    await f.controller.execute({ action: "unpublish" });
    expect(f.api.unpublishProduct).not.toHaveBeenCalled();
    await f.controller.reviewSuccess();
    expect(f.controller.getSnapshot()).toMatchObject({ status: "idle", slot: success.slot + 1 });
    expect(f.api.loadProduct).toHaveBeenCalledTimes(2);
    await f.controller.execute({ action: "unpublish" });
    expect(f.api.unpublishProduct).toHaveBeenCalledTimes(1);
  });

  it("an explicit review in flight cannot arm a write or a second review", async () => {
    const f = await fixture();
    await f.controller.execute({ action: "publish" });
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(f.api.loadProduct).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const review = f.controller.reviewSuccess();
    await vi.waitFor(() => expect(f.api.loadProduct).toHaveBeenCalledTimes(1));
    expect(f.controller.getSnapshot().status).toBe("reviewing");
    await f.controller.execute({ action: "unpublish" });
    await f.controller.reviewSuccess();
    expect(f.api.unpublishProduct).not.toHaveBeenCalled();
    expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
    resolve(product);
    await review;
    expect(f.controller.getSnapshot().status).toBe("idle");
  });
});
