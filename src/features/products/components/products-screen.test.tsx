import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary } from "@/features/auth/components/session-boundary";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { ApiError } from "@/lib/api/errors";
import { parsePrincipalId, parseStoreUuid } from "@/lib/query/keys";
import type { CategoryPage, MerchantProduct, ProductPage } from "../contracts";
import { normalizeProductCriteria } from "../model";
import { productKeys } from "../queries";
import { ProductsScreen } from "./products-screen";
import { ProductScreen } from "./product-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/stores/11111111-1111-4111-8111-111111111111/products",
}));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-09-01T12:00:00+00:00";
function context(storeUuid: string, permissions = ["products.view"]): MerchantStoreContext {
  return {
    store: {
      id: storeUuid,
      name: storeUuid === A ? "Store Alpha" : "Store Bravo",
      status: "active",
    },
    membership: { id: P, status: "active" },
    role: { id: Q, name: "Owner Administrator" },
    permissions,
  };
}
function product(id = P, name = "Private Alpha product"): MerchantProduct {
  return {
    id,
    name,
    slug: "private-product",
    description: "<script>private()</script>\nLiteral description",
    seo_title: null,
    seo_description: null,
    status: "draft",
    type: "simple",
    requires_shipping: true,
    published_at: null,
    price: { amount: 10500, currency: "LYD" },
    quantity: 7,
    availability: "in_stock",
    categories: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}
function page(products = [product()], next: string | null = null): ProductPage {
  return {
    products,
    pagination: { per_page: 25, next_cursor: next, previous_cursor: null },
    effectiveRange: {
      created_from: "2025-09-01T00:00:00.000001+00:00",
      created_to: "2026-09-01T00:00:00.000001+00:00",
    },
  };
}
function apiFixture(permissions = ["products.view"]): MerchantApi {
  return {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({
        principalId: "test-principal",
        displayName: "Synthetic Merchant",
      })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (uuid) => context(uuid, permissions)),
    listProducts: vi.fn(async () => page()),
    loadProduct: vi.fn(async () => product()),
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
    listCategories: vi.fn(async () => ({
      categories: [],
      pagination: { per_page: 100, next_cursor: null, previous_cursor: null },
      limit: 100,
    })),
  };
}
function Fixture({
  api,
  storeUuid = A,
  productUuid,
}: {
  api: MerchantApi;
  storeUuid?: string;
  productUuid?: string;
}) {
  return (
    <StrictMode>
      <MerchantApiProvider api={api}>
        <SessionBoundary adapter={api.authAdapter}>
          <StoreProvider>
            <StoreWorkspace storeUuid={storeUuid} title="Products">
              {productUuid ? <ProductScreen productUuid={productUuid} /> : <ProductsScreen />}
            </StoreWorkspace>
          </StoreProvider>
        </SessionBoundary>
      </MerchantApiProvider>
    </StrictMode>
  );
}
beforeEach(() => vi.clearAllMocks());
async function ready() {
  await screen.findAllByRole("link", { name: "Private Alpha product" });
}

describe("Product permission and privacy boundaries", () => {
  it("reads with products.view alone, never probes categories or fans out per row", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(api.loadProduct).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.getByText(/Default: previous 366 days/)).toBeVisible();
  });
  it("does not authorize using an Owner Administrator role label", async () => {
    const api = apiFixture([]);
    render(<Fixture api={api} />);
    await screen.findByRole("heading", { name: "Product access is unavailable" });
    expect(api.listProducts).not.toHaveBeenCalled();
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
  });
  it("conditionally loads categories once for an authorized filter", async () => {
    const api = apiFixture(["products.view", "categories.view"]);
    render(<Fixture api={api} />);
    await ready();
    await waitFor(() => expect(api.listCategories).toHaveBeenCalledTimes(1));
    expect(api.listCategories).toHaveBeenCalledWith(
      expect.objectContaining({ storeUuid: A }),
      expect.any(AbortSignal),
    );
  });
  it("hides selected Category data during loading, denial and retry when context refresh fails", async () => {
    const api = apiFixture(["products.view", "categories.view"]);
    const categories: CategoryPage = {
      categories: [
        {
          id: P,
          name: "Private Category selection",
          slug: "private-category",
          seo_title: null,
          seo_description: null,
          status: "visible",
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
      pagination: { per_page: 100, next_cursor: "opaque-category-next", previous_cursor: null },
      limit: 100,
    };
    vi.mocked(api.listCategories).mockResolvedValue(categories);
    render(<Fixture api={api} />);
    await ready();
    fireEvent.click(screen.getByText("Date and category filters"));
    await screen.findByRole("option", { name: "Private Category selection" });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: P } });
    let reject!: (error: ApiError) => void;
    vi.mocked(api.listCategories).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    vi.mocked(api.loadStoreContext).mockRejectedValue(new ApiError("network"));
    fireEvent.click(screen.getByRole("button", { name: "More categories" }));
    await waitFor(() => expect(reject).toBeDefined());
    expect(screen.queryByText("Private Category selection")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    await act(async () => reject(new ApiError("forbidden")));
    const failure = await screen.findByRole("heading", { name: "Categories couldn’t be loaded" });
    await screen.findByRole("heading", { name: "Store access couldn’t be refreshed" });
    expect(screen.queryByText("Private Category selection")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More categories" })).not.toBeInTheDocument();
    let resolve!: (value: CategoryPage) => void;
    vi.mocked(api.listCategories).mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    fireEvent.click(
      within(failure.closest('[role="alert"]')! as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() => expect(resolve).toBeDefined());
    expect(screen.queryByText("Private Category selection")).not.toBeInTheDocument();
    await act(async () =>
      resolve({
        ...categories,
        categories: [],
        pagination: {
          per_page: 100,
          next_cursor: null,
          previous_cursor: "opaque-category-previous",
        },
      }),
    );
    expect(await screen.findByLabelText("Category")).toHaveValue("");
    expect(screen.queryByText("Private Category selection")).not.toBeInTheDocument();
    vi.mocked(api.listCategories).mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    const calls = vi.mocked(api.listCategories).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Previous categories" }));
    await waitFor(() => expect(api.listCategories).toHaveBeenCalledTimes(calls + 1));
    expect(screen.queryByText("Private Category selection")).not.toBeInTheDocument();
    await act(async () => resolve({ ...categories, categories: [] }));
  });
  it("removes Product capability and private content after same-session context revocation", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    vi.mocked(api.loadStoreContext).mockResolvedValue(context(A, []));
    fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
    await screen.findByRole("heading", { name: "Product access is unavailable" });
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
  });
  it("clears a previously successful Product view when Laravel denies its next read", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    vi.mocked(api.listProducts).mockRejectedValue(new ApiError("forbidden"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh products" }));
    await screen.findByRole("heading", { name: "Product access is unavailable" });
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(api.authAdapter.logout).not.toHaveBeenCalled();
    let resolve!: (value: ProductPage) => void;
    vi.mocked(api.listProducts).mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh products" }));
    await waitFor(() => expect(resolve).toBeDefined());
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    await act(async () => resolve(page([product(P, "Reconfirmed product")])));
    await screen.findAllByRole("link", { name: "Reconfirmed product" });
  });
  it("cannot resurrect another cached Product criteria after 403 and failed context revalidation", async () => {
    const api = apiFixture();
    vi.mocked(api.listProducts).mockImplementation(async (input) =>
      input.criteria?.status ? page([product(Q, "Private filtered product")]) : page(),
    );
    render(<Fixture api={api} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findAllByRole("link", { name: "Private filtered product" });
    vi.mocked(api.listProducts).mockRejectedValue(new ApiError("forbidden"));
    vi.mocked(api.loadStoreContext).mockRejectedValue(new ApiError("network"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh products" }));
    await screen.findByRole("heading", { name: "Product access is unavailable" });
    await screen.findByRole("heading", { name: "Store access couldn’t be refreshed" });
    let resolve!: (value: ProductPage) => void;
    vi.mocked(api.listProducts).mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(resolve).toBeDefined());
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    expect(screen.queryByText("Private filtered product")).not.toBeInTheDocument();
    await act(async () => resolve(page([product(P, "Newly authorized result")])));
    await screen.findAllByRole("link", { name: "Newly authorized result" });
  });
  it("reports transient context refresh failure on Product pages while retaining confirmed access", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    vi.mocked(api.loadStoreContext).mockRejectedValue(new ApiError("network"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
    await screen.findByRole("heading", { name: "Store access couldn’t be refreshed" });
    expect(screen.getAllByRole("link", { name: "Private Alpha product" }).length).toBeGreaterThan(
      0,
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("cancels A and never publishes its delayed Product response beneath B", async () => {
    const api = apiFixture();
    let finish!: (value: ProductPage) => void;
    let signalA: AbortSignal | undefined;
    vi.mocked(api.listProducts).mockImplementation((input, signal) =>
      input.storeUuid === A
        ? ((signalA = signal),
          new Promise((resolve) => {
            finish = resolve;
          }))
        : Promise.resolve(page([product(Q, "Private Bravo product")])),
    );
    const view = render(<Fixture api={api} />);
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(<Fixture api={api} storeUuid={B} />);
    await screen.findAllByRole("link", { name: "Private Bravo product" });
    expect(signalA?.aborted).toBe(true);
    await act(async () => finish(page()));
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
  });
  it("returns safely from a foreign Product 404 without global logout or leaked detail", async () => {
    const api = apiFixture();
    vi.mocked(api.loadProduct).mockRejectedValue(new ApiError("not-found"));
    render(<Fixture api={api} productUuid={P} />);
    await screen.findByRole("heading", { name: "Product not found" });
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute(
      "href",
      `/stores/${A}/products`,
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(api.authAdapter.logout).not.toHaveBeenCalled();
  });
  it("rejects malformed Product syntax before dispatch without treating it as authority", async () => {
    const api = apiFixture();
    render(<Fixture api={api} productUuid="not-a-uuid" />);
    await screen.findByRole("heading", { name: "Product not found" });
    expect(api.loadProduct).not.toHaveBeenCalled();
  });
  it.each(["unauthenticated", "session-expired"] as const)(
    "preserves global %s handling",
    async (kind) => {
      const api = apiFixture();
      vi.mocked(api.authAdapter.loadIdentity)
        .mockResolvedValueOnce({ principalId: "test-principal", displayName: "Synthetic Merchant" })
        .mockRejectedValue(new ApiError("unauthenticated"));
      vi.mocked(api.listProducts).mockRejectedValue(new ApiError(kind));
      render(<Fixture api={api} />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
      expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
    },
  );
  it("removes Product content on pagehide", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByText("Private Alpha product")).not.toBeInTheDocument();
  });
});

describe("Product read presentation and navigation", () => {
  it("renders descriptions literally and uses exact LYD minor-unit formatting", async () => {
    const api = apiFixture();
    render(<Fixture api={api} productUuid={P} />);
    await screen.findByRole("heading", { name: "Private Alpha product", level: 1 });
    expect(screen.getByText(/<script>private\(\)<\/script>/)).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("10.500 LYD")).toBeVisible();
    expect(api.listProducts).not.toHaveBeenCalled();
    expect(api.listCategories).not.toHaveBeenCalled();
    for (const action of ["Edit", "Create", "Delete", "Publish", "Archive"])
      expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();
  });
  it("distinguishes Variant aggregates from exact Product quantity", async () => {
    const api = apiFixture();
    vi.mocked(api.loadProduct).mockResolvedValue({ ...product(), type: "variant", quantity: null });
    render(<Fixture api={api} productUuid={P} />);
    await screen.findByText("From 10.500 LYD");
    expect(screen.getByText("Managed per variant")).toBeVisible();
    expect(screen.getByText(/lowest-priced variant may not be in stock/)).toBeVisible();
  });
  it("distinguishes successful zero Products from failed discovery", async () => {
    const api = apiFixture();
    vi.mocked(api.listProducts).mockResolvedValue(page([]));
    render(<Fixture api={api} />);
    await screen.findByRole("heading", { name: "No products in this creation window" });
    vi.mocked(api.listProducts).mockRejectedValue(new ApiError("network"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh products" }));
    await screen.findByRole("heading", { name: "Products couldn’t be loaded" });
    expect(
      screen.queryByRole("heading", { name: "No products in this creation window" }),
    ).not.toBeInTheDocument();
  });
  it("submits filters explicitly, normalizes search, and resets cursor on criteria changes", async () => {
    const api = apiFixture();
    vi.mocked(api.listProducts).mockResolvedValue(page([product()], "opaque-next"));
    render(<Fixture api={api} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(api.listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "opaque-next" }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "  Ａｌ  " } });
    fireEvent.change(screen.getByLabelText("Status", { exact: true }), {
      target: { value: "draft" },
    });
    expect(api.listProducts).toHaveBeenCalledTimes(2);
    fireEvent.submit(screen.getByRole("form", { name: "Product filters" }));
    await waitFor(() =>
      expect(api.listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cursor: null,
          criteria: expect.objectContaining({ q: "Al", status: "draft" }),
        }),
        expect.any(AbortSignal),
      ),
    );
  });
  it("validates paired historical ranges without dispatching invalid input", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await ready();
    const form = screen.getByRole("form", { name: "Product filters" });
    fireEvent.change(screen.getByLabelText("Created from"), { target: { value: "2020-01-01" } });
    fireEvent.submit(form);
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Choose both dates for this range.")).toBeInTheDocument();
    expect(document.querySelector("details")?.open).toBe(true);
    expect(screen.getByLabelText("Created to")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Created to"), { target: { value: "2020-01-31" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api.listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({
          criteria: expect.objectContaining({
            created_from: "2020-01-01T00:00:00+00:00",
            created_to: "2020-01-31T23:59:59.999999+00:00",
          }),
        }),
        expect.any(AbortSignal),
      ),
    );
  });
  it("offers a safe restart for a rejected cursor", async () => {
    const api = apiFixture();
    vi.mocked(api.listProducts)
      .mockResolvedValueOnce(page([product()], "stale-cursor"))
      .mockRejectedValueOnce(new ApiError("validation"))
      .mockResolvedValue(page());
    render(<Fixture api={api} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("button", { name: "Restart discovery" });
    fireEvent.click(screen.getByRole("button", { name: "Restart discovery" }));
    await ready();
    expect(api.authAdapter.logout).not.toHaveBeenCalled();
  });
  it("separates every query by principal, Store, revision, criteria, cursor and Product UUID", () => {
    const scope = {
      principalId: parsePrincipalId("principal-a"),
      storeUuid: parseStoreUuid(A),
      revision: 1,
    };
    const criteria = normalizeProductCriteria();
    const key = productKeys.list(scope, criteria, null);
    expect(key).toEqual([
      "merchant",
      "principal-a",
      "store",
      A,
      1,
      "products",
      { criteria, cursor: null },
    ]);
    expect(
      productKeys.list({ ...scope, storeUuid: parseStoreUuid(B) }, criteria, null),
    ).not.toEqual(key);
    expect(productKeys.list({ ...scope, revision: 2 }, criteria, null)).not.toEqual(key);
    expect(
      productKeys.list({ ...scope, principalId: parsePrincipalId("principal-b") }, criteria, null),
    ).not.toEqual(key);
    expect(productKeys.list(scope, criteria, "opaque")).not.toEqual(key);
    expect(productKeys.detail(scope, P)).not.toEqual(productKeys.detail(scope, Q));
    expect(productKeys.categories(scope, { sort: "newest", per_page: 100 }, null)).not.toEqual(key);
  });
});
