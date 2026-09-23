import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import type { ProductPage } from "@/features/products/contracts";
import { ProductsScreen } from "@/features/products/components/products-screen";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { MerchantApiProvider } from "./merchant-api-provider";
import { SessionBoundary, useMerchantSession } from "./session-boundary";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/stores/11111111-1111-4111-8111-111111111111/products",
}));
const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "22222222-2222-4222-8222-222222222222";
const identity = { principalId: "scoped-reader", displayName: "Synthetic reader" };
const context: MerchantStoreContext = {
  store: { id: storeUuid, name: "Private Store", status: "active" },
  membership: { id: productUuid, status: "active" },
  role: { id: productUuid, name: "Reader" },
  permissions: ["products.view"],
};
const page: ProductPage = {
  products: [
    {
      id: productUuid,
      name: "Private scoped product",
      slug: "private-scoped-product",
      description: "Private plain text",
      seo_title: null,
      seo_description: null,
      status: "draft",
      type: "simple",
      requires_shipping: true,
      published_at: null,
      price: { amount: 12345, currency: "LYD" },
      quantity: 2,
      availability: "in_stock",
      categories: [],
      created_at: "2026-09-01T00:00:00+00:00",
      updated_at: "2026-09-01T00:00:00+00:00",
    },
  ],
  pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
  effectiveRange: {
    created_from: "2025-09-01T00:00:00+00:00",
    created_to: "2026-09-01T00:00:00+00:00",
  },
};
type Session = ReturnType<typeof useMerchantSession>;
function Expose({ capture }: { capture: (session: Session) => void }) {
  const session = useMerchantSession();
  useEffect(() => capture(session), [capture, session]);
  return null;
}
function fixture() {
  const api: MerchantApi = {
    authAdapter: { loadIdentity: vi.fn(async () => identity), logout: vi.fn(async () => {}) },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context.store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
    })),
    loadStoreContext: vi.fn(async () => context),
    listProducts: vi.fn(async () => page),
    loadProduct: vi.fn(),
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
    loadProductInventory: vi.fn(async () => ({
      quantity: null,
      availability: "unavailable" as const,
    })),
    updateProductInventory: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
    listCategories: vi.fn(),
  };
  let session!: Session;
  const capture = (value: Session) => {
    session = value;
  };
  return {
    api,
    session: () => session,
    render: () =>
      render(
        <StrictMode>
          <MerchantApiProvider api={api}>
            <SessionBoundary adapter={api.authAdapter}>
              <Expose capture={capture} />
              <StoreProvider>
                <StoreWorkspace storeUuid={storeUuid} title="Products">
                  <ProductsScreen />
                </StoreWorkspace>
              </StoreProvider>
            </SessionBoundary>
          </MerchantApiProvider>
        </StrictMode>,
      ),
  };
}
// A finite synthetic transport budget makes an operative unlimited-retry mutant fail
// on exact counts without allowing the test process itself to produce a request storm.
function persistentFailure(kind: "unauthenticated" | "session-expired") {
  let attempts = 0;
  return async () => {
    throw new ApiError(++attempts <= 3 ? kind : "network");
  };
}
async function settledFailure() {
  // Both the correct stable boundary and the finite transport safety stop can settle.
  // Assert exact request counts afterwards so operative mutants fail assertions, not timeouts.
  await screen.findByRole("alert");
  await act(async () => {
    await Promise.resolve();
  });
}
function assertPrivateCleared(value: ReturnType<typeof fixture>) {
  expect(screen.queryByText("Private scoped product")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Current store" })).not.toBeInTheDocument();
  expect(value.session().scope.getScope()).toBeNull();
  expect(value.session().queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(value.api.login).not.toHaveBeenCalled();
  expect(value.api.authAdapter.logout).not.toHaveBeenCalled();
}
beforeEach(() => vi.clearAllMocks());

describe("bounded shared scoped-read identity reconciliation", () => {
  it.each(["unauthenticated", "session-expired"] as const)(
    "settles persistent Product %s plus successful identity at exactly one read and one reconciliation",
    async (kind) => {
      const value = fixture();
      vi.mocked(value.api.listProducts).mockImplementation(persistentFailure(kind));
      value.render();
      await settledFailure();
      expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2);
      expect(value.api.listStoresPage).toHaveBeenCalledTimes(1);
      expect(value.api.loadStoreContext).toHaveBeenCalledTimes(1);
      expect(value.api.listProducts).toHaveBeenCalledTimes(1);
      expect(value.session().auth.getSnapshot()).toMatchObject({
        status: "authenticated",
        principal: identity,
        scopedReadError: { kind },
      });
      expect(router.replace).not.toHaveBeenCalled();
      assertPrivateCleared(value);
    },
  );
  it.each(["unauthenticated", "session-expired"] as const)(
    "also bounds non-Product Store-context %s with identity success",
    async (kind) => {
      const value = fixture();
      vi.mocked(value.api.loadStoreContext).mockImplementation(persistentFailure(kind));
      value.render();
      await settledFailure();
      expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2);
      expect(value.api.listStoresPage).toHaveBeenCalledTimes(1);
      expect(value.api.loadStoreContext).toHaveBeenCalledTimes(1);
      expect(value.api.listProducts).not.toHaveBeenCalled();
      expect(value.session().auth.getSnapshot().status).toBe("authenticated");
      expect(router.replace).not.toHaveBeenCalled();
      assertPrivateCleared(value);
    },
  );
  it.each(["unauthenticated", "session-expired"] as const)(
    "preserves actual identity 401 loss after scoped %s",
    async (kind) => {
      const value = fixture();
      vi.mocked(value.api.listProducts).mockImplementation(persistentFailure(kind));
      vi.mocked(value.api.authAdapter.loadIdentity)
        .mockResolvedValueOnce(identity)
        .mockRejectedValue(new ApiError("unauthenticated"));
      value.render();
      await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login"));
      expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2);
      expect(value.api.listProducts).toHaveBeenCalledTimes(1);
      expect(value.session().auth.getSnapshot()).toEqual({
        status: "unauthenticated",
        reason: "expired",
      });
      assertPrivateCleared(value);
    },
  );
  it.each(["unauthenticated", "session-expired"] as const)(
    "recovers from scoped %s only after an explicit retry and fresh identity confirmation",
    async (kind) => {
      const value = fixture();
      vi.mocked(value.api.listProducts)
        .mockRejectedValueOnce(new ApiError(kind))
        .mockResolvedValue(page);
      value.render();
      await settledFailure();
      expect(value.api.listProducts).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));
      await screen.findAllByRole("link", { name: "Private scoped product" });
      expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(3);
      expect(value.api.listStoresPage).toHaveBeenCalledTimes(2);
      expect(value.api.loadStoreContext).toHaveBeenCalledTimes(2);
      expect(value.api.listProducts).toHaveBeenCalledTimes(2);
      expect(value.session().auth.getSnapshot()).toEqual({
        status: "authenticated",
        principal: identity,
      });
      expect(router.replace).not.toHaveBeenCalled();
      expect(value.api.login).not.toHaveBeenCalled();
      expect(value.api.authAdapter.logout).not.toHaveBeenCalled();
    },
  );
  it("does not release a persistent error on focus or successful ordinary identity rechecks", async () => {
    const value = fixture();
    vi.mocked(value.api.listProducts).mockImplementation(persistentFailure("session-expired"));
    value.render();
    await settledFailure();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settledFailure();
    expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(3);
    expect(value.api.listProducts).toHaveBeenCalledTimes(1);
    expect(value.api.loadStoreContext).toHaveBeenCalledTimes(1);
    assertPrivateCleared(value);
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));
    await settledFailure();
    expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(5);
    expect(value.api.listProducts).toHaveBeenCalledTimes(2);
    expect(value.api.loadStoreContext).toHaveBeenCalledTimes(2);
    assertPrivateCleared(value);
  });
  it("purges previously visible private data while the authoritative check is pending", async () => {
    const value = fixture();
    value.render();
    await screen.findAllByRole("link", { name: "Private scoped product" });
    let confirm!: (value: typeof identity) => void;
    vi.mocked(value.api.authAdapter.loadIdentity).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    vi.mocked(value.api.listProducts).mockRejectedValue(new ApiError("session-expired"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh products" }));
    await waitFor(() => expect(confirm).toBeDefined());
    assertPrivateCleared(value);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    await act(async () => confirm(identity));
    await settledFailure();
    expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2);
    expect(value.api.listProducts).toHaveBeenCalledTimes(2);
    assertPrivateCleared(value);
  });
  it("keeps failed reconciliation recoverable without remounting private reads", async () => {
    const value = fixture();
    vi.mocked(value.api.listProducts)
      .mockRejectedValueOnce(new ApiError("unauthenticated"))
      .mockResolvedValue(page);
    vi.mocked(value.api.authAdapter.loadIdentity)
      .mockResolvedValueOnce(identity)
      .mockRejectedValueOnce(new ApiError("network"))
      .mockResolvedValue(identity);
    value.render();
    await settledFailure();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session couldn’t be rechecked");
    expect(value.api.listProducts).toHaveBeenCalledTimes(1);
    assertPrivateCleared(value);
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));
    await screen.findAllByRole("link", { name: "Private scoped product" });
    expect(value.api.authAdapter.loadIdentity).toHaveBeenCalledTimes(3);
    expect(value.api.listProducts).toHaveBeenCalledTimes(2);
  });
});
