import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantVariant } from "@/features/variants/contracts";
import type { MerchantProduct } from "@/features/products/contracts";
import { useStores } from "@/features/stores/components/store-provider";
import { usePricingMutation } from "../mutations";
import { usePricing } from "../queries";
import { PricingPanel } from "./pricing-panel";

vi.mock("@/features/stores/components/store-provider", () => ({ useStores: vi.fn() }));
vi.mock("../queries", () => ({ usePricing: vi.fn() }));
vi.mock("../mutations", () => ({ usePricingMutation: vi.fn() }));

const product: MerchantProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Pricing product",
  slug: "pricing-product",
  description: "Pricing testing",
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
  value: number | null = null,
  permissions = [
    "products.view",
    "products.variants.view",
    "products.variants.price.update",
    "products.price.update",
  ],
  status = "idle",
) {
  const pricing = { price: value === null ? null : { amount: value, currency: "LYD" } };
  const mutation = {
    state: {
      status,
      slot: 0,
      pricing: null,
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
    state: { context: { permissions, store: { id: product.id, currency: "LYD" } } },
  } as unknown as ReturnType<typeof useStores>);
  vi.mocked(usePricing).mockReturnValue({
    data: pricing,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof usePricing>);
  vi.mocked(usePricingMutation).mockReturnValue(
    mutation as unknown as ReturnType<typeof usePricingMutation>,
  );
  return mutation;
}

beforeEach(() => vi.clearAllMocks());

describe("Pricing presentation", () => {
  it("shows unconfigured pricing with a blank labeled amount", () => {
    setup();
    render(<PricingPanel product={product} variant={variant} />);
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Price (LYD)" })).toHaveValue("");
  });
  it("formats current minor units but never defaults a new amount", () => {
    setup(12345);
    render(<PricingPanel product={product} variant={variant} />);
    expect(screen.getByText("12.345 LYD")).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it.each(["0", "-1", "1e3", "1.0001", "999999999999999999", "bad"])(
    "rejects %s with input focus",
    (value) => {
      const mutation = setup();
      render(<PricingPanel product={product} variant={variant} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(screen.getByRole("form", { name: "Set price" }));
      expect(mutation.execute).not.toHaveBeenCalled();
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-invalid", "true");
    },
  );
  it("submits strict absolute minor units", () => {
    const mutation = setup();
    render(<PricingPanel product={product} variant={variant} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1.005" } });
    fireEvent.submit(screen.getByRole("form", { name: "Set price" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith(1005);
  });
  it.each([null, undefined])("blocks missing context currency %s", (currency) => {
    setup();
    vi.mocked(useStores).mockReturnValue({
      state: {
        context: {
          store: { currency },
          permissions: [
            "products.view",
            "products.variants.view",
            "products.variants.price.update",
          ],
        },
      },
    } as unknown as ReturnType<typeof useStores>);
    render(<PricingPanel product={product} variant={variant} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Store currency is not configured or unavailable/)).toBeVisible();
  });
  it("never activates direct Variant parent pricing", () => {
    setup();
    render(<PricingPanel product={product} />);
    expect(usePricing).not.toHaveBeenCalled();
    expect(usePricingMutation).not.toHaveBeenCalled();
  });
  it("write-only has no reads editor or reconciliation", () => {
    setup(null, ["products.variants.price.update"]);
    render(<PricingPanel product={product} variant={variant} />);
    expect(usePricing).not.toHaveBeenCalled();
    expect(usePricingMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("read-only and archived states expose no editor", () => {
    setup(1, ["products.view", "products.variants.view"]);
    const view = render(<PricingPanel product={product} variant={variant} />);
    expect(screen.getByText(/viewing prices only/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    setup(1);
    view.rerender(<PricingPanel product={{ ...product, status: "archived" }} variant={variant} />);
    expect(screen.getByText(/Archived product prices/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("pending guards native submission", () => {
    const mutation = setup(null, undefined, "pending");
    render(<PricingPanel product={product} variant={variant} />);
    fireEvent.submit(screen.getByRole("form", { name: "Set price" }));
    expect(mutation.execute).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
  it("unknown outcomes expose observational review without resubmission", () => {
    const mutation = setup(1, undefined, "unknown");
    render(<PricingPanel product={product} variant={variant} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/may already have changed/);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review current price" }));
    expect(mutation.reconcile).toHaveBeenCalledOnce();
    expect(mutation.execute).not.toHaveBeenCalled();
  });
  it("confirmed feedback survives projection pending and failure", () => {
    setup(1, undefined, "success");
    render(
      <PricingPanel product={product} variant={variant} productReadPending productReadFailed />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Price saved.");
    expect(screen.getByText(/latest product details could not be confirmed/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
