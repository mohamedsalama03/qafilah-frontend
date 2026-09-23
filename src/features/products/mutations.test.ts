import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as apiProvider from "@/features/auth/components/merchant-api-provider";
import * as sessionBoundary from "@/features/auth/components/session-boundary";
import * as storeProvider from "@/features/stores/components/store-provider";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { parsePrincipalId, parseStoreUuid, storeKeys } from "@/lib/query/keys";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantProduct, ProductPage } from "./contracts";
import { normalizeProductCriteria } from "./model";
import {
  createProductMutationController,
  getProductMutationController,
  useProductMutation,
  type ProductMutationCommand,
} from "./mutations";
import { productKeys } from "./queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const allPermissions = ["products.view", "products.create", "products.update", "products.publish"];
const created = {
  name: "Private product",
  slug: "private-product",
  description: "Plain text description",
  type: "simple" as const,
  requires_shipping: true,
};
const operations = [
  ["createProduct", { action: "create", data: created }, "products.create"],
  ["updateProduct", { action: "update", data: { name: "Updated product" } }, "products.update"],
  ["publishProduct", { action: "publish" }, "products.publish"],
  ["unpublishProduct", { action: "unpublish" }, "products.publish"],
  ["archiveProduct", { action: "archive" }, "products.update"],
] as const;

function product(id = P, name = "Authoritative Product"): MerchantProduct {
  return {
    id,
    ...created,
    name,
    seo_title: null,
    seo_description: null,
    status: "draft",
    published_at: null,
    price: null,
    quantity: null,
    availability: "unavailable",
    categories: [],
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
  };
}
function page(): ProductPage {
  return {
    products: [product()],
    pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
    effectiveRange: {
      created_from: "2025-09-01T00:00:00+00:00",
      created_to: "2026-09-01T00:00:00+00:00",
    },
  };
}
function context(uuid: string, permissions: string[]): MerchantStoreContext {
  return {
    store: { id: uuid, name: "Synthetic Store", status: "active" },
    membership: { id: P, status: "active" },
    role: { id: Q, name: "Owner Administrator" },
    permissions,
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

async function fixture(permissions = allPermissions, productUuid: string | undefined = P) {
  const api: MerchantApi = {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "merchant-a" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context(A, permissions).store, context(B, permissions).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (uuid) => context(uuid, permissions)),
    loadProduct: vi.fn(async () => product()),
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
    loadProductInventory: vi.fn(),
    updateProductInventory: vi.fn(),
    listProducts: vi.fn(async () => page()),
    listCategories: vi.fn(),
    createProduct: vi.fn(async () => product()),
    updateProduct: vi.fn(async () => product()),
    publishProduct: vi.fn(async () => ({ ...product(), status: "published" as const })),
    unpublishProduct: vi.fn(async () => product()),
    archiveProduct: vi.fn(async () => ({ ...product(), status: "archived" as const })),
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
  const mutation = createProductMutationController({
    api,
    session,
    stores,
    scope: current,
    productUuid,
  });
  return { api, queryClient, scope, auth, session, stores, current, mutation };
}

describe("Product mutation dispatch and reconciliation", () => {
  it("keeps the single-flight and unknown-outcome lock when controls unmount and remount", async () => {
    const f = await fixture();
    vi.spyOn(apiProvider, "useMerchantApi").mockReturnValue(f.api);
    vi.spyOn(sessionBoundary, "useMerchantSession").mockReturnValue(f.session);
    vi.spyOn(storeProvider, "useStores").mockReturnValue({
      controller: f.stores,
      state: f.stores.getSnapshot(),
    });
    const response = deferred<MerchantProduct>();
    vi.mocked(f.api.updateProduct).mockReturnValue(response.promise);
    const command = { action: "update", data: { name: "Uncertain edit" } } as const;
    const first = renderHook(() => useProductMutation(P));
    let pending!: Promise<MerchantProduct | null>;
    act(() => {
      pending = first.result.current.execute(command);
    });
    await vi.waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useProductMutation(P));
    expect(second.result.current.isPending).toBe(true);
    expect(second.result.current.execute(command)).toBe(pending);
    await act(async () => {
      response.reject(new ApiError("network", { mutationOutcome: "unknown" }));
      await pending;
    });
    second.unmount();
    const third = renderHook(() => useProductMutation(P));
    expect(third.result.current.state.status).toBe("unknown");
    expect(third.result.current.isBlocked).toBe(true);
    expect(await third.result.current.execute(command)).toBeNull();
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
    await act(async () => {
      await third.result.current.reconcile();
    });
    expect(third.result.current.isBlocked).toBe(false);
    expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("never shares a mutation slot with another Product, Store revision or session", async () => {
    const f = await fixture();
    const options = {
      api: f.api,
      session: f.session,
      stores: f.stores,
      scope: f.current,
      productUuid: P,
    };
    const first = getProductMutationController(options);
    expect(getProductMutationController(options)).toBe(first);
    expect(getProductMutationController({ ...options, productUuid: Q })).not.toBe(first);
    expect(getProductMutationController({ ...options, session: { ...f.session } })).not.toBe(first);
    await f.stores.select(B);
    expect(
      getProductMutationController({ ...options, scope: f.stores.getSnapshot().scope! }),
    ).not.toBe(first);
  });

  it.each(operations)(
    "sends one %s request for immediate duplicate actions",
    async (method, command) => {
      const f = await fixture(allPermissions, command.action === "create" ? undefined : P);
      // Explicit undefined selects creation, without depending on the fixture default.
      const mutation =
        command.action === "create"
          ? createProductMutationController({
              api: f.api,
              session: f.session,
              stores: f.stores,
              scope: f.current,
            })
          : f.mutation;
      const response = deferred<MerchantProduct>();
      vi.mocked(f.api[method]).mockReturnValue(response.promise);
      const first = mutation.execute(command);
      const duplicate = mutation.execute(command);
      expect(first).toBe(duplicate);
      expect(mutation.getSnapshot().status).toBe("pending");
      await vi.waitFor(() => expect(f.api[method]).toHaveBeenCalledTimes(1));
      response.resolve(product());
      expect(await first).toEqual(product());
      expect(mutation.getSnapshot().status).toBe("success");
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      expect(f.api[method]).toHaveBeenCalledWith(
        expect.objectContaining({ storeUuid: A }),
        expect.any(AbortSignal),
      );
    },
  );

  it.each(operations)(
    "does not grant %s from an Owner role when its permission is absent",
    async (method, command, permission) => {
      const f = await fixture(allPermissions.filter((item) => item !== permission));
      const mutation =
        command.action === "create"
          ? createProductMutationController({
              api: f.api,
              session: f.session,
              stores: f.stores,
              scope: f.current,
            })
          : f.mutation;
      expect(await mutation.execute(command)).toBeNull();
      expect(f.api[method]).not.toHaveBeenCalled();
      expect(mutation.getSnapshot().error?.kind).toBe("forbidden");
    },
  );

  it("respects independent create authority without Product reads or read cache publication", async () => {
    const f = await fixture(["products.create"]);
    const mutation = createProductMutationController({
      api: f.api,
      session: f.session,
      stores: f.stores,
      scope: f.current,
    });
    expect(await mutation.execute({ action: "create", data: created })).toEqual(product());
    expect(f.api.createProduct).toHaveBeenCalledTimes(1);
    expect(f.api.loadProduct).not.toHaveBeenCalled();
    expect(f.api.listProducts).not.toHaveBeenCalled();
    expect(f.queryClient.getQueryData(productKeys.detail(f.current, P))).toBeUndefined();
  });

  it("does not request a reconciliation list without products.view after uncertain creation", async () => {
    const f = await fixture(["products.create"]);
    const mutation = createProductMutationController({
      api: f.api,
      session: f.session,
      stores: f.stores,
      scope: f.current,
    });
    vi.mocked(f.api.createProduct).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await mutation.execute({ action: "create", data: created });
    expect(await mutation.reconcile()).toBeNull();
    expect(mutation.getSnapshot().status).toBe("unknown");
    expect(mutation.getSnapshot().error?.kind).toBe("forbidden");
    expect(f.api.listProducts).not.toHaveBeenCalled();
    expect(mutation.startSeparateCreate()).toBe(false);
  });

  it("does not call a pre-dispatch CSRF failure an unknown Product write", async () => {
    const f = await fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Connection unavailable"));
    f.api.updateProduct = createMerchantApi({
      apiOrigin: "http://localhost:8000",
      mode: "test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=synthetic",
    }).updateProduct;
    await f.mutation.execute({ action: "update", data: { name: "Edited" } });
    expect(f.mutation.getSnapshot()).toMatchObject({
      status: "error",
      error: { mutationOutcome: "not-applicable" },
    });
    expect(f.api.loadProduct).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe("http://localhost:8000/sanctum/csrf-cookie");
    expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
  });

  it("changes only the originating Product and Store Product lists", async () => {
    const f = await fixture();
    const criteria = normalizeProductCriteria();
    const otherStore = { ...f.current, storeUuid: parseStoreUuid(B) };
    const otherPrincipal = { ...f.current, principalId: parsePrincipalId("merchant-b") };
    const keys = {
      detail: productKeys.detail(f.current, P),
      list: productKeys.list(f.current, criteria, null),
      otherDetail: productKeys.detail(f.current, Q),
      otherStore: productKeys.list(otherStore, criteria, null),
      otherPrincipal: productKeys.list(otherPrincipal, criteria, null),
      category: storeKeys.resource(f.current, "product-categories"),
    };
    for (const key of Object.values(keys)) f.queryClient.setQueryData(key, { sentinel: true });
    await f.mutation.execute({ action: "update", data: { name: "Updated product" } });
    expect(f.queryClient.getQueryData(keys.detail)).toEqual(product());
    expect(f.queryClient.getQueryState(keys.list)?.isInvalidated).toBe(true);
    for (const key of [keys.otherDetail, keys.otherStore, keys.otherPrincipal, keys.category]) {
      expect(f.queryClient.getQueryData(key)).toEqual({ sentinel: true });
      expect(f.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });

  it.each(["network", "timeout", "server", "invalid-response"] as const)(
    "locks an unknown %s outcome until an explicit authoritative detail read",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.updateProduct).mockRejectedValueOnce(
        new ApiError(kind, { mutationOutcome: "unknown" }),
      );
      const command: ProductMutationCommand = {
        action: "update",
        data: { name: "Uncertain product" },
      };
      expect(await f.mutation.execute(command)).toBeNull();
      expect(f.mutation.getSnapshot().status).toBe("unknown");
      expect(await f.mutation.execute(command)).toBeNull();
      await Promise.resolve();
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      expect(f.api.loadProduct).not.toHaveBeenCalled();
      expect(await f.mutation.reconcile()).toEqual(product());
      expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "idle", product: product() });
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      await f.mutation.execute(command);
      expect(f.api.updateProduct).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps uncertain creation locked even after reviewing an authoritative list", async () => {
    const f = await fixture();
    const mutation = createProductMutationController({
      api: f.api,
      session: f.session,
      stores: f.stores,
      scope: f.current,
    });
    vi.mocked(f.api.createProduct).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    const command = { action: "create", data: created } as const;
    await mutation.execute(command);
    expect(mutation.startSeparateCreate()).toBe(false);
    expect(await mutation.reconcile()).toEqual(page());
    expect(mutation.getSnapshot().status).toBe("unknown");
    await mutation.execute(command);
    expect(f.api.createProduct).toHaveBeenCalledTimes(1);
    expect(f.api.listProducts).toHaveBeenCalledTimes(1);
    expect(f.api.loadProduct).not.toHaveBeenCalled();
    expect(mutation.startSeparateCreate()).toBe(true);
    expect(mutation.getSnapshot().status).toBe("idle");
    expect(f.api.createProduct).toHaveBeenCalledTimes(1);
    expect(mutation.startSeparateCreate()).toBe(false);
  });

  it("failed reconciliation and duplicate refresh clicks cannot release or replay an uncertain write", async () => {
    const f = await fixture();
    vi.mocked(f.api.archiveProduct).mockRejectedValue(
      new ApiError("timeout", { mutationOutcome: "unknown" }),
    );
    await f.mutation.execute({ action: "archive" });
    const response = deferred<MerchantProduct>();
    vi.mocked(f.api.loadProduct).mockReturnValue(response.promise);
    const first = f.mutation.reconcile();
    expect(f.mutation.reconcile()).toBe(first);
    expect(f.mutation.getSnapshot().status).toBe("reconciling");
    expect(await f.mutation.execute({ action: "archive" })).toBeNull();
    response.reject(new ApiError("network"));
    await first;
    expect(f.mutation.getSnapshot().status).toBe("unknown");
    expect(f.api.archiveProduct).toHaveBeenCalledTimes(1);
    expect(f.api.loadProduct).toHaveBeenCalledTimes(1);
  });

  it.each(["validation", "forbidden", "not-found", "rate-limited"] as const)(
    "retains normalized %s errors without a automatic write or raw server message",
    async (kind) => {
      const f = await fixture();
      const error = new ApiError(kind, {
        details: { fieldErrors: { name: ["Use at least two characters."] } },
      });
      vi.mocked(f.api.updateProduct).mockRejectedValue(error);
      await f.mutation.execute({ action: "update", data: { name: "Edited" } });
      expect(f.mutation.getSnapshot()).toMatchObject({ status: "error", error });
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      expect(f.api.loadProduct).not.toHaveBeenCalled();
    },
  );

  it.each(["unauthenticated", "session-expired"] as const)(
    "reconciles identity once after %s and never replays the write",
    async (kind) => {
      const f = await fixture();
      vi.mocked(f.api.updateProduct).mockRejectedValue(new ApiError(kind));
      await f.mutation.execute({ action: "update", data: { name: "Edited" } });
      await vi.waitFor(() => expect(f.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2));
      expect(f.auth.getSnapshot()).toMatchObject({
        status: "authenticated",
        scopedReadError: { kind },
      });
      expect(f.scope.getScope()).toBeNull();
      await vi.waitFor(() =>
        expect(f.auth.getSnapshot()).not.toMatchObject({ revalidation: { status: "pending" } }),
      );
      await f.auth.retryScopedRead();
      expect(f.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(3);
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves true identity loss after a scoped mutation denial", async () => {
    const f = await fixture();
    vi.mocked(f.api.authAdapter.loadIdentity).mockResolvedValueOnce(null);
    vi.mocked(f.api.updateProduct).mockRejectedValue(new ApiError("unauthenticated"));
    await f.mutation.execute({ action: "update", data: { name: "Edited" } });
    await vi.waitFor(() =>
      expect(f.auth.getSnapshot()).toMatchObject({ status: "unauthenticated" }),
    );
    expect(f.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("aborts Store A and cannot publish its late response into Store B", async () => {
    const f = await fixture();
    const response = deferred<MerchantProduct>();
    vi.mocked(f.api.updateProduct).mockReturnValue(response.promise);
    const pending = f.mutation.execute({ action: "update", data: { name: "Late Store A" } });
    await vi.waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(f.api.updateProduct).mock.calls[0]![1]!;
    await f.stores.select(B);
    const bScope = f.stores.getSnapshot().scope!;
    const bKey = productKeys.detail(bScope, Q);
    f.queryClient.setQueryData(bKey, product(Q, "Store B product"));
    expect(signal.aborted).toBe(true);
    response.resolve(product(P, "Late private Store A response"));
    expect(await pending).toBeNull();
    await Promise.resolve();
    expect(f.queryClient.getQueryData(bKey)).toEqual(product(Q, "Store B product"));
    expect(f.queryClient.getQueryData(productKeys.detail(f.current, P))).toBeUndefined();
    expect(f.stores.getSnapshot().context?.store.id).toBe(B);
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it.each(["logout", "principal", "pagehide"] as const)(
    "never restores private data after %s during a write",
    async (change) => {
      const f = await fixture();
      const response = deferred<MerchantProduct>();
      vi.mocked(f.api.publishProduct).mockReturnValue(response.promise);
      const pending = f.mutation.execute({ action: "publish" });
      await vi.waitFor(() => expect(f.api.publishProduct).toHaveBeenCalledTimes(1));
      if (change === "logout") await f.auth.logout();
      else if (change === "principal") {
        vi.mocked(f.api.authAdapter.loadIdentity).mockResolvedValueOnce({
          principalId: "merchant-b",
        });
        await f.auth.bootstrap();
      } else f.auth.suspend();
      response.resolve(product());
      expect(await pending).toBeNull();
      expect(f.queryClient.getQueryCache().getAll()).toHaveLength(0);
      expect(f.api.publishProduct).toHaveBeenCalledTimes(1);
      expect(f.mutation.getSnapshot().product).toBeNull();
    },
  );

  it.each(["products.create", "products.update", "products.publish"])(
    "revocation of %s invalidates pending authority before accepting a response",
    async (permission) => {
      const f = await fixture();
      const [method, command] = operations.find((entry) => entry[2] === permission)!;
      const mutation =
        command.action === "create"
          ? createProductMutationController({
              api: f.api,
              session: f.session,
              stores: f.stores,
              scope: f.current,
            })
          : f.mutation;
      const response = deferred<MerchantProduct>();
      vi.mocked(f.api[method]).mockReturnValue(response.promise);
      const pending = mutation.execute(command);
      await vi.waitFor(() => expect(f.api[method]).toHaveBeenCalledTimes(1));
      vi.mocked(f.api.loadStoreContext).mockResolvedValue(
        context(
          A,
          allPermissions.filter((item) => item !== permission),
        ),
      );
      await f.stores.revalidate();
      response.resolve(product());
      expect(await pending).toBeNull();
      expect(f.queryClient.getQueryData(productKeys.detail(f.current, P))).toBeUndefined();
      expect(f.stores.getSnapshot().context?.permissions).not.toContain(permission);
      expect(f.api[method]).toHaveBeenCalledTimes(1);
    },
  );
});
