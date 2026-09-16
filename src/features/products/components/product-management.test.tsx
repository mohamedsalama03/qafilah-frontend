import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary } from "@/features/auth/components/session-boundary";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { ApiError } from "@/lib/api/errors";
import type { MerchantProduct } from "../contracts";
import { CreateProductScreen, EditProductScreen } from "./product-form-screen";
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
const timestamp = "2026-09-01T00:00:00+00:00";
const allPermissions = [
  "products.view",
  "products.create",
  "products.update",
  "products.publish",
  "categories.view",
];
const category = {
  id: Q,
  name: "Store category",
  slug: "store-category",
  status: "visible" as const,
  seo_title: null,
  seo_description: null,
  created_at: timestamp,
  updated_at: timestamp,
};
function product(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: P,
    name: "Existing Product",
    slug: "existing-product",
    description: "Existing description",
    seo_title: "Existing SEO title",
    seo_description: "Existing SEO description",
    status: "draft",
    type: "simple",
    requires_shipping: true,
    published_at: null,
    price: null,
    quantity: null,
    availability: "unavailable",
    categories: [category],
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}
function context(uuid: string, permissions = allPermissions): MerchantStoreContext {
  return {
    store: { id: uuid, name: uuid === A ? "Store Alpha" : "Store Bravo", status: "active" },
    membership: { id: P, status: "active" },
    role: { id: Q, name: "Owner Administrator" },
    permissions,
  };
}
function apiFixture(permissions = allPermissions, current = product()): MerchantApi {
  return {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "synthetic-principal" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context(A).store, context(B).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (uuid) => context(uuid, permissions)),
    listProducts: vi.fn(async () => ({
      products: [current],
      pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
      effectiveRange: { created_from: "2025-09-01T00:00:00+00:00", created_to: timestamp },
    })),
    loadProduct: vi.fn(async () => current),
    listCategories: vi.fn(async () => ({
      categories: [category],
      pagination: { per_page: 100, next_cursor: null, previous_cursor: null },
      limit: 100,
    })),
    createProduct: vi.fn(async () => current),
    updateProduct: vi.fn(async () => current),
    publishProduct: vi.fn(async () => product({ status: "published", published_at: timestamp })),
    unpublishProduct: vi.fn(async () => product()),
    archiveProduct: vi.fn(async () => product({ status: "archived" })),
  };
}
function Fixture({
  api,
  mode = "create",
}: {
  api: MerchantApi;
  mode?: "create" | "edit" | "detail";
}) {
  return (
    <StrictMode>
      <MerchantApiProvider api={api}>
        <SessionBoundary adapter={api.authAdapter}>
          <StoreProvider>
            <StoreWorkspace storeUuid={A} title="Products">
              {mode === "create" ? (
                <CreateProductScreen />
              ) : mode === "edit" ? (
                <EditProductScreen productUuid={P} />
              ) : (
                <ProductScreen productUuid={P} />
              )}
            </StoreWorkspace>
          </StoreProvider>
        </SessionBoundary>
      </MerchantApiProvider>
    </StrictMode>
  );
}
async function fillCreate() {
  fireEvent.change(await screen.findByLabelText("Product name", { exact: false }), {
    target: { value: "New product" },
  });
  fireEvent.change(screen.getByLabelText("Slug", { exact: false }), {
    target: { value: "new-product" },
  });
  fireEvent.change(screen.getByLabelText(/^Description/), {
    target: { value: "Plain text\nSecond line" },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(false);
});

describe("Product create and edit workflows", () => {
  it("focuses the first invalid create field without dispatching", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    const name = await screen.findByLabelText("Product name", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("keeps typing focus on the current field after a validation attempt", async () => {
    const user = userEvent.setup();
    const api = apiFixture();
    render(<Fixture api={api} />);
    const name = await screen.findByLabelText("Product name", { exact: false });
    await user.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(name).toHaveFocus());
    await user.type(name, "Whole product name");
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Whole product name");
    expect(screen.getByLabelText("Slug", { exact: false })).toHaveValue("");
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("confirms creation with create-only authority without opening or reading Products", async () => {
    const api = apiFixture(["products.create"]);
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByRole("heading", { name: "Product created" });
    expect(
      screen.getByText(/Viewing or editing this product requires additional access/),
    ).toBeVisible();
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(api.listProducts).not.toHaveBeenCalled();
    expect(api.loadProduct).not.toHaveBeenCalled();
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to overview" })).toHaveAttribute(
      "href",
      `/stores/${A}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create another product" }));
    expect(screen.getByLabelText("Product name", { exact: false })).toHaveValue("");
    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("allows Category lookup using its own capability when the creator cannot read Products", async () => {
    const api = apiFixture(["products.create", "categories.view"]);
    render(<Fixture api={api} />);
    const choice = await screen.findByRole("checkbox", { name: "Store category" });
    await fillCreate();
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByRole("heading", { name: "Product created" });
    expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category_ids: [Q] }) }),
      expect.any(AbortSignal),
    );
    expect(api.listCategories).toHaveBeenCalledTimes(1);
    expect(api.loadProduct).not.toHaveBeenCalled();
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it("creates with exact permitted fields and coalesces rapid form submissions", async () => {
    const api = apiFixture();
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(api.createProduct).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Store category" }));
    const form = screen.getByRole("button", { name: "Create product" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    expect(api.createProduct).toHaveBeenCalledWith(
      {
        storeUuid: A,
        data: {
          name: "New product",
          slug: "new-product",
          description: "Plain text\nSecond line",
          seo_title: null,
          seo_description: null,
          type: "simple",
          requires_shipping: true,
          category_ids: [Q],
        },
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => resolve(product()));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/stores/${A}/products/${P}`));
    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("is truthful about Variant creation without configuration controls", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.change(screen.getByLabelText("Product type"), { target: { value: "variant" } });
    expect(screen.getByText(/Variant configuration is not available/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /add variant/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() =>
      expect(api.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "variant" }) }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("maps backend field validation to its labeled field and focuses it", async () => {
    const api = apiFixture();
    vi.mocked(api.createProduct).mockRejectedValue(
      new ApiError("validation", {
        details: { fieldErrors: { slug: ["This slug is already in use."] } },
      }),
    );
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByText("This slug is already in use.");
    expect(screen.getByLabelText("Slug", { exact: false })).toHaveFocus();
    expect(screen.getByLabelText("Slug", { exact: false })).toHaveAttribute("aria-invalid", "true");
    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("sends a sparse edit, clears nullable SEO and omits categories without lookup permission", async () => {
    const api = apiFixture(allPermissions.filter((permission) => permission !== "categories.view"));
    render(<Fixture api={api} mode="edit" />);
    fireEvent.change(await screen.findByLabelText("Product name", { exact: false }), {
      target: { value: "Edited name" },
    });
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "" } });
    expect(screen.queryByRole("combobox", { name: "Product type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Categories" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.updateProduct).toHaveBeenCalledWith(
        { storeUuid: A, productUuid: P, data: { name: "Edited name", seo_title: null } },
        expect.any(AbortSignal),
      ),
    );
    expect(api.listCategories).not.toHaveBeenCalled();
  });

  it("omits unchanged fields and prevents empty edit submissions", async () => {
    const api = apiFixture();
    render(<Fixture api={api} mode="edit" />);
    await screen.findByLabelText("Product name", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("There are no changes to save.")).toBeVisible();
    expect(api.updateProduct).not.toHaveBeenCalled();
  });

  it("removes the entire category assignment using an explicit empty array", async () => {
    const api = apiFixture();
    render(<Fixture api={api} mode="edit" />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear categories" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.updateProduct).toHaveBeenCalledWith(
        { storeUuid: A, productUuid: P, data: { category_ids: [] } },
        expect.any(AbortSignal),
      ),
    );
  });

  it("locks uncertain edit controls and replaces unsaved values only after deliberate refresh", async () => {
    const api = apiFixture();
    vi.mocked(api.updateProduct).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    render(<Fixture api={api} mode="edit" />);
    fireEvent.change(await screen.findByLabelText("Product name", { exact: false }), {
      target: { value: "Uncertain edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("We couldn’t confirm whether the change was completed.");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByLabelText("Product name", { exact: false })).toBeDisabled();
    expect(api.updateProduct).toHaveBeenCalledTimes(1);
    expect(api.loadProduct).toHaveBeenCalledTimes(1);
    vi.mocked(api.loadProduct).mockResolvedValue(product({ name: "Latest server product" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh product" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Product name", { exact: false })).toHaveValue(
        "Latest server product",
      ),
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(api.updateProduct).toHaveBeenCalledTimes(1);
    expect(api.loadProduct).toHaveBeenCalledTimes(2);
  });

  it("reviews uncertain creation without replaying it or claiming it failed", async () => {
    const api = apiFixture();
    vi.mocked(api.createProduct).mockRejectedValue(
      new ApiError("server", { mutationOutcome: "unknown" }),
    );
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByText("We couldn’t confirm whether the change was completed.");
    expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
    expect(screen.getByText(/does not prove it was not created/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review products" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/stores/${A}/products`));
    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start a separate product" }));
    expect(screen.getByLabelText("Product name", { exact: false })).toHaveValue("");
    expect(screen.getByLabelText("Slug", { exact: false })).toHaveValue("");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create product" })).toBeEnabled();
    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("blocks archived edits without offering restore or sending a write", async () => {
    const api = apiFixture(allPermissions, product({ status: "archived" }));
    render(<Fixture api={api} mode="edit" />);
    await screen.findByRole("heading", { name: "This product is archived" });
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Product name", { exact: false })).not.toBeInTheDocument();
    expect(api.updateProduct).not.toHaveBeenCalled();
  });

  it.each(["create", "edit"] as const)(
    "requires the exact management permission for the %s route",
    async (mode) => {
      const api = apiFixture(["products.view"]);
      render(<Fixture api={api} mode={mode} />);
      await screen.findByRole("heading", { name: "Product management is unavailable" });
      expect(api.loadProduct).not.toHaveBeenCalled();
      expect(api.createProduct).not.toHaveBeenCalled();
      expect(api.updateProduct).not.toHaveBeenCalled();
    },
  );

  it("vetoes a Store switch with dirty fields without accidentally saving", async () => {
    const api = apiFixture();
    render(<Fixture api={api} />);
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Switch store" }));
    const dialog = await screen.findByRole("dialog", { name: "Switch store" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Store Bravo/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("Product lifecycle actions", () => {
  it.each([
    ["draft", ["products.view"], false, false, false, false],
    ["draft", ["products.view", "products.update"], true, false, false, true],
    ["draft", ["products.view", "products.publish"], false, true, false, false],
    ["published", allPermissions, true, false, true, true],
    ["archived", allPermissions, false, false, false, false],
  ] as const)(
    "renders only valid %s actions for %j",
    async (status, permissions, edit, publish, unpublish, archive) => {
      const api = apiFixture([...permissions], product({ status }));
      render(<Fixture api={api} mode="detail" />);
      await screen.findByRole("heading", { name: "Existing Product" });
      expect(!!screen.queryByRole("link", { name: "Edit" })).toBe(edit);
      expect(!!screen.queryByRole("button", { name: "Publish" })).toBe(publish);
      expect(!!screen.queryByRole("button", { name: "Unpublish" })).toBe(unpublish);
      expect(!!screen.queryByRole("button", { name: "Archive product" })).toBe(archive);
      expect(screen.queryByRole("button", { name: /delete|restore/i })).not.toBeInTheDocument();
    },
  );

  it("confirms archive accessibly and sends one request despite rapid confirmation", async () => {
    const api = apiFixture();
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(api.archiveProduct).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Fixture api={api} mode="detail" />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive product" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Archive product" });
    expect(within(dialog).getByText(/no way to restore/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    const confirm = within(dialog).getByRole("button", { name: "Archive product" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.archiveProduct).toHaveBeenCalledTimes(1));
    await act(async () => resolve(product({ status: "archived" })));
    await screen.findByText(/This product is archived\. Editing/);
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive product" })).not.toBeInTheDocument();
  });

  it("hides update and publish actions after same-session context revocation", async () => {
    const api = apiFixture();
    render(<Fixture api={api} mode="detail" />);
    await screen.findByRole("button", { name: "Publish" });
    vi.mocked(api.loadStoreContext).mockResolvedValue(context(A, ["products.view"]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive product" })).not.toBeInTheDocument();
    expect(api.publishProduct).not.toHaveBeenCalled();
  });
});
