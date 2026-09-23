import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary } from "@/features/auth/components/session-boundary";
import { VariantsScreen } from "@/features/variants/components/variants-screen";
import type { MerchantVariant } from "@/features/variants/contracts";
import type { MerchantProduct } from "@/features/products/contracts";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { ApiError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import type { VariantInventory } from "../contracts";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () =>
    "/stores/11111111-1111-4111-8111-111111111111/products/33333333-3333-4333-8333-333333333333",
}));

const STORE = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const ROLE = "44444444-4444-4444-8444-444444444444";
const VARIANT = "55555555-5555-4555-8555-555555555555";
const quantityMessage = "The quantity must differ from the current quantity.";
const refreshWarning = /latest product and variant details could not be confirmed/;

function inventory(quantity: number | null = 3): VariantInventory {
  return {
    quantity,
    availability: quantity === null ? "unavailable" : quantity === 0 ? "out_of_stock" : "in_stock",
  };
}

function product(quantity: number | null = 3): MerchantProduct {
  return {
    id: PRODUCT,
    name: "Inventory feedback product",
    slug: "inventory-feedback-product",
    description: "Synthetic inventory feedback fixture",
    type: "variant",
    status: "draft",
    requires_shipping: true,
    price: null,
    ...inventory(quantity),
    quantity: null,
    categories: [],
    seo_title: null,
    seo_description: null,
    published_at: null,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
  };
}

function variant(quantity: number | null = 3): MerchantVariant {
  return {
    id: VARIANT,
    value_ids: [ROLE],
    sku: "STOCK-ONE",
    status: "active",
    price: null,
    ...inventory(quantity),
    created_at: product().created_at,
    updated_at: product().updated_at,
  };
}

function context(): MerchantStoreContext {
  return {
    store: { id: STORE, name: "Inventory feedback store", status: "active" },
    membership: { id: PRODUCT, status: "active" },
    role: { id: ROLE, name: "Inventory editor" },
    permissions: ["products.view", "products.variants.view", "products.variants.inventory.update"],
  };
}

function apiFixture(): MerchantApi {
  let currentQuantity = 3;
  return {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({
        principalId: "inventory-feedback-merchant",
        displayName: "Synthetic Merchant",
      })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [context().store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
    })),
    loadStoreContext: vi.fn(async () => context()),
    loadProduct: vi.fn(async () => product(currentQuantity)),
    listProductOptions: vi.fn(async () => []),
    createProductOption: vi.fn(),
    updateProductOption: vi.fn(),
    createProductOptionValue: vi.fn(),
    updateProductOptionValue: vi.fn(),
    listProductVariants: vi.fn(async () => [variant(currentQuantity)]),
    createProductVariant: vi.fn(),
    loadProductVariant: vi.fn(async () => variant(currentQuantity)),
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
    loadVariantInventory: vi.fn(async () => inventory(currentQuantity)),
    updateVariantInventory: vi.fn(async ({ data }) => {
      currentQuantity = data.quantity;
      return inventory(currentQuantity);
    }),
    listProducts: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
    listCategories: vi.fn(),
  };
}

function Fixture({ api }: { api: MerchantApi }) {
  return (
    <StrictMode>
      <MerchantApiProvider api={api}>
        <SessionBoundary adapter={api.authAdapter}>
          <StoreProvider>
            <StoreWorkspace storeUuid={STORE} title="Products">
              <VariantsScreen productUuid={PRODUCT} variantUuid={VARIANT} />
            </StoreWorkspace>
          </StoreProvider>
        </SessionBoundary>
      </MerchantApiProvider>
    </StrictMode>
  );
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

function panel() {
  return screen.getByRole("region", { name: "Inventory" });
}

function quantityInput() {
  return within(panel()).getByRole("textbox", { name: "Quantity" });
}

async function ready(api = apiFixture()) {
  render(<Fixture api={api} />);
  await waitFor(() => expect(quantityInput()).toBeEnabled());
  return api;
}

async function submit(quantity: number) {
  const input = quantityInput();
  fireEvent.change(input, { target: { value: String(quantity) } });
  await userEvent.setup().click(within(panel()).getByRole("button", { name: "Set quantity" }));
}

function quantityError() {
  return new ApiError("validation", {
    status: 422,
    details: { fieldErrors: { quantity: [quantityMessage] } },
  });
}

async function expectQuantityErrorFocus() {
  await within(panel()).findByText(quantityMessage);
  // Flush the complete child/parent passive-effect sequence before final focus assertions.
  await act(async () => {});
  const input = quantityInput();
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute(
    "aria-describedby",
    "variant-inventory-quantity-description variant-inventory-quantity-error",
  );
  expect(input).toHaveAccessibleDescription(new RegExp(quantityMessage));
  expect(within(panel()).getByRole("alert")).toHaveTextContent(
    "Check the highlighted fields and try again.",
  );
}

async function reviewUnknown(api: MerchantApi) {
  vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(
    new ApiError("network", { mutationOutcome: "unknown" }),
  );
  await submit(5);
  const review = await within(panel()).findByRole("button", { name: "Review current inventory" });
  expect(within(panel()).getByRole("alert")).toHaveTextContent(
    "We couldn’t confirm whether the quantity was saved.",
  );
  await userEvent.setup().click(review);
  await waitFor(() => expect(quantityInput()).toBeEnabled());
  expect(quantityInput()).toHaveValue("3");
  expect(within(panel()).getByRole("status")).toHaveTextContent(
    "This does not confirm whether the earlier change was saved.",
  );
  expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);
}

beforeEach(() => vi.clearAllMocks());

describe("Inventory feedback through VariantsScreen and real session controllers", () => {
  it("preserves initial Product loading without activating the inventory editor", async () => {
    const api = apiFixture();
    const initial = deferred<MerchantProduct>();
    vi.mocked(api.loadProduct).mockReturnValueOnce(initial.promise);
    render(<Fixture api={api} />);
    expect(await screen.findByText("Loading product…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
    expect(api.loadVariantInventory).not.toHaveBeenCalled();
    expect(screen.queryByText(refreshWarning)).not.toBeInTheDocument();
    await act(async () => initial.resolve(product()));
    await waitFor(() => expect(quantityInput()).toBeEnabled());
    expect(screen.queryByText("Loading product…")).not.toBeInTheDocument();
  });

  it("keeps confirmed inventory success truthful while Product projection refresh is pending and after it succeeds", async () => {
    const api = await ready();
    const refresh = deferred<MerchantProduct>();
    vi.mocked(api.loadProduct).mockReturnValueOnce(refresh.promise);
    await submit(8);
    await waitFor(() => expect(api.loadProduct).toHaveBeenCalledTimes(2));
    expect(within(panel()).getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(within(panel()).getByText("8")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(within(panel()).queryByText(refreshWarning)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);

    await act(async () => refresh.resolve(product(8)));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh product" })).toBeEnabled(),
    );
    expect(within(panel()).getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(within(panel()).queryByText(refreshWarning)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: "Review current inventory" })).toBeNull();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });

  it("reports actual Product projection failure while preserving confirmed inventory success", async () => {
    const api = await ready();
    const refresh = deferred<MerchantProduct>();
    vi.mocked(api.loadProduct).mockReturnValueOnce(refresh.promise);
    await submit(8);
    await waitFor(() => expect(api.loadProduct).toHaveBeenCalledTimes(2));
    expect(within(panel()).queryByText(refreshWarning)).not.toBeInTheDocument();
    await act(async () => refresh.reject(new ApiError("network")));
    expect(await within(panel()).findByText(refreshWarning)).toBeVisible();
    expect(within(panel()).getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(within(panel()).getByText("8")).toBeVisible();
    expect(
      within(panel()).queryByText(/couldn’t confirm whether the quantity was saved/),
    ).toBeNull();
    expect(within(panel()).getByRole("button", { name: "Change quantity" })).toBeEnabled();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing inventory editor disabled during a pending Product read without failure wording", async () => {
    const api = await ready();
    const refresh = deferred<MerchantProduct>();
    vi.mocked(api.loadProduct).mockReturnValueOnce(refresh.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh product" }));
    await waitFor(() => expect(quantityInput()).toBeDisabled());
    expect(within(panel()).getByRole("button", { name: "Set quantity" })).toBeDisabled();
    expect(within(panel()).queryByText(refreshWarning)).not.toBeInTheDocument();
    fireEvent.submit(within(panel()).getByRole("form", { name: "Set inventory quantity" }));
    expect(api.updateVariantInventory).not.toHaveBeenCalled();
    await act(async () => refresh.resolve(product()));
    await waitFor(() => expect(quantityInput()).toBeEnabled());
  });

  it("keeps fresh quantity 422 focus on the input after all effects settle", async () => {
    const api = await ready();
    vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(quantityError());
    await submit(3);
    await expectQuantityErrorFocus();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });

  it("refocuses quantity after consecutive deliberate submissions return the same 422 message", async () => {
    const api = await ready();
    vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(quantityError());
    await submit(3);
    await expectQuantityErrorFocus();

    const repeated = deferred<VariantInventory>();
    vi.mocked(api.updateVariantInventory).mockReturnValueOnce(repeated.promise);
    await submit(3);
    expect(quantityInput()).toBeDisabled();
    expect(within(panel()).queryByText(quantityMessage)).not.toBeInTheDocument();
    await act(async () => repeated.reject(quantityError()));
    await expectQuantityErrorFocus();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(2);
  });

  it("keeps post-review quantity 422 focus on the input after all effects settle", async () => {
    const api = await ready();
    await reviewUnknown(api);
    vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(quantityError());
    await submit(3);
    await expectQuantityErrorFocus();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(api.updateVariantInventory).mock.calls.map(([request]) => request.data),
    ).toEqual([{ quantity: 5 }, { quantity: 3 }]);
  });

  it("keeps quantity 422 focus after reviewing a previously confirmed save", async () => {
    const api = await ready();
    await submit(7);
    const change = await within(panel()).findByRole("button", { name: "Change quantity" });
    await userEvent.setup().click(change);
    await waitFor(() => expect(quantityInput()).toBeEnabled());
    expect(quantityInput()).toHaveValue("7");
    expect(within(panel()).getByRole("status")).toHaveTextContent("Current inventory was loaded.");
    vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(quantityError());
    await submit(7);
    await expectQuantityErrorFocus();
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "focuses generic non-field mutation feedback with review=%s while retaining its alert",
    async (reviewed) => {
      const api = await ready();
      if (reviewed) await reviewUnknown(api);
      vi.mocked(api.updateVariantInventory).mockRejectedValueOnce(
        new ApiError("rate-limited", { status: 429 }),
      );
      await submit(4);
      const alert = await within(panel()).findByRole("alert");
      await act(async () => {});
      expect(alert).toHaveTextContent("Too many requests. Wait before trying again.");
      expect(alert.parentElement).toHaveAttribute("tabindex", "-1");
      expect(alert.parentElement).toHaveFocus();
      expect(quantityInput()).not.toHaveAttribute("aria-invalid", "true");
      expect(api.updateVariantInventory).toHaveBeenCalledTimes(reviewed ? 2 : 1);
    },
  );

  it("preserves post-review keyboard client-validation focus and its error association", async () => {
    const api = await ready();
    await reviewUnknown(api);
    const user = userEvent.setup();
    await user.clear(quantityInput());
    await user.type(quantityInput(), "1.5");
    await user.keyboard("{Enter}");
    await act(async () => {});
    expect(quantityInput()).toHaveFocus();
    expect(quantityInput()).toHaveAttribute("aria-invalid", "true");
    expect(quantityInput()).toHaveAccessibleDescription(/Enter a whole number/);
    expect(api.updateVariantInventory).toHaveBeenCalledTimes(1);
  });
});
