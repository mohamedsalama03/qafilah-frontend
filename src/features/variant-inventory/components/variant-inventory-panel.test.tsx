import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantVariant } from "@/features/variants/contracts";
import type { MerchantProduct } from "@/features/products/contracts";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError } from "@/lib/api/errors";
import { useVariantInventoryMutation } from "../mutations";
import { useVariantInventory } from "../queries";
import { VariantInventoryPanel } from "./variant-inventory-panel";

vi.mock("@/features/stores/components/store-provider", () => ({ useStores: vi.fn() }));
vi.mock("../queries", () => ({ useVariantInventory: vi.fn() }));
vi.mock("../mutations", () => ({ useVariantInventoryMutation: vi.fn() }));

const product: MerchantProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Inventory product",
  slug: "inventory-product",
  description: "Inventory testing",
  type: "variant",
  status: "draft",
  requires_shipping: true,
  price: null,
  quantity: null,
  availability: "unavailable",
  categories: [],
  seo_title: null,
  seo_description: null,
  published_at: null,
  created_at: "2026-09-01T12:00:00+00:00",
  updated_at: "2026-09-01T12:00:00+00:00",
};

const variant: MerchantVariant = {
  id: "55555555-5555-4555-8555-555555555555",
  value_ids: [],
  sku: null,
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: product.created_at,
  updated_at: product.updated_at,
};

function setup(
  quantity: number | null = null,
  permissions = ["products.view", "products.variants.view", "products.variants.inventory.update"],
  status = "idle",
) {
  const inventory = {
    quantity,
    availability: quantity === null ? "unavailable" : quantity === 0 ? "out_of_stock" : "in_stock",
  };
  const mutation = {
    state: {
      status,
      slot: 0,
      inventory: null,
      product: null,
      error: null,
      refreshError: null,
      guidance: undefined,
    },
    isBlocked: ["pending", "success", "unknown", "reconciling", "reviewing"].includes(status),
    isPending: ["pending", "reconciling", "reviewing"].includes(status),
    execute: vi.fn(),
    reconcile: vi.fn(),
    reviewSuccess: vi.fn(),
  };
  vi.mocked(useStores).mockReturnValue({
    state: { context: { permissions } },
  } as unknown as ReturnType<typeof useStores>);
  vi.mocked(useVariantInventory).mockReturnValue({
    data: inventory,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useVariantInventory>);
  vi.mocked(useVariantInventoryMutation).mockReturnValue(
    mutation as unknown as ReturnType<typeof useVariantInventoryMutation>,
  );
  return mutation;
}

beforeEach(() => vi.clearAllMocks());

describe("Product inventory presentation", () => {
  it("distinguishes unconfigured inventory from zero and uses a labeled blank input", () => {
    setup();
    render(<VariantInventoryPanel variant={variant} product={product} />);
    const panel = screen.getByRole("region", { name: "Inventory" });
    expect(within(panel).getAllByText("Not configured")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Quantity" })).toHaveValue("");
    expect(screen.getByText(/Set quantity replaces the current stock count/)).toBeVisible();
  });

  it.each([0, 7])("shows configured quantity %i and its truthful availability", (quantity) => {
    setup(quantity);
    render(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.getByRole("textbox", { name: "Quantity" })).toHaveValue(String(quantity));
    expect(screen.getByText(quantity === 0 ? "Out of stock" : "In stock")).toBeVisible();
  });

  it.each(["", "-1", "1.5", "2e2", "2000000001", "words"])(
    "rejects invalid quantity %s and focuses its labeled error",
    (value) => {
      const mutation = setup();
      render(<VariantInventoryPanel variant={variant} product={product} />);
      const input = screen.getByRole("textbox", { name: "Quantity" });
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(screen.getByRole("form", { name: "Set inventory quantity" }));
      expect(mutation.execute).not.toHaveBeenCalled();
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(/Enter a whole number/);
    },
  );

  it("submits an absolute JSON number including zero", () => {
    const mutation = setup(7);
    render(<VariantInventoryPanel variant={variant} product={product} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("form", { name: "Set inventory quantity" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("keeps viewing-only and archived inventory read-only", () => {
    setup(0, ["products.view", "products.variants.view"]);
    const view = render(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.queryByRole("button", { name: "Set quantity" })).not.toBeInTheDocument();
    expect(screen.getByText(/viewing inventory only/)).toBeVisible();
    setup(0);
    view.rerender(
      <VariantInventoryPanel variant={variant} product={{ ...product, status: "archived" }} />,
    );
    expect(screen.queryByRole("button", { name: "Set quantity" })).not.toBeInTheDocument();
    expect(screen.getByText(/Archived product inventory cannot be changed/)).toBeVisible();
  });

  it.each(["simple", "write-only"])("does not activate inventory for %s access", (kind) => {
    setup(
      0,
      kind === "write-only"
        ? ["products.variants.inventory.update"]
        : ["products.view", "products.variants.view"],
    );
    render(
      <VariantInventoryPanel
        variant={variant}
        product={{ ...product, type: kind === "simple" ? "simple" : "variant" }}
      />,
    );
    expect(useVariantInventory).not.toHaveBeenCalled();
    expect(useVariantInventoryMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
  });

  it("locks pending submissions including native form submission", () => {
    const mutation = setup(4, undefined, "pending");
    render(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.getByRole("button", { name: "Setting quantity…" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Set inventory quantity" }));
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it("unknown outcomes offer explicit review without another submission", () => {
    const mutation = setup(4, undefined, "unknown");
    render(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/may already have changed/);
    expect(screen.getByText("Last known quantity")).toBeVisible();
    expect(screen.getByText("Last known availability")).toBeVisible();
    expect(screen.queryByText("Current quantity")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review current inventory" }));
    expect(mutation.reconcile).toHaveBeenCalledOnce();
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it("preserves confirmed success when the Product refresh fails", () => {
    const mutation = setup(4, undefined, "success");
    render(<VariantInventoryPanel variant={variant} product={product} productReadFailed />);
    expect(screen.getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(
      screen.getByText(/latest product and variant details could not be confirmed/),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change quantity" }));
    expect(mutation.reviewSuccess).toHaveBeenCalledOnce();
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it("keeps confirmed success truthful while Product refresh is pending and then completes", () => {
    setup(4, undefined, "success");
    const view = render(
      <VariantInventoryPanel variant={variant} product={product} productReadPending />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(
      screen.queryByText(/latest product and variant details could not be confirmed/),
    ).toBeNull();
    view.rerender(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.getByRole("status")).toHaveTextContent("Quantity saved.");
    expect(
      screen.queryByText(/latest product and variant details could not be confirmed/),
    ).toBeNull();
  });

  it("keeps an ordinary quantity editor disabled while the Product read is pending", () => {
    const mutation = setup(4);
    render(<VariantInventoryPanel variant={variant} product={product} productReadPending />);
    expect(screen.getByRole("textbox", { name: "Quantity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set quantity" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Set inventory quantity" }));
    expect(mutation.execute).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/latest product and variant details could not be confirmed/),
    ).toBeNull();
  });

  it("renders normalized query errors without backend internals", () => {
    setup();
    vi.mocked(useVariantInventory).mockReturnValue({
      data: undefined,
      error: new ApiError("server"),
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVariantInventory>);
    render(<VariantInventoryPanel variant={variant} product={product} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The service could not complete this request.",
    );
    expect(screen.getByRole("button", { name: "Refresh inventory" })).toBeEnabled();
  });
});
