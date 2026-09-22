import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantProduct } from "@/features/products/contracts";
import { useProduct } from "@/features/products/queries";
import { useStores } from "@/features/stores/components/store-provider";
import { useVariantInventory } from "@/features/variant-inventory/queries";
import { useVariantInventoryMutation } from "@/features/variant-inventory/mutations";
import { ApiError } from "@/lib/api/errors";
import type { MerchantProductOption, MerchantVariant } from "../contracts";
import { useVariantMutation, type VariantMutationState } from "../mutations";
import { useProductOptions, useProductVariant, useProductVariants } from "../queries";
import { VariantsScreen } from "./variants-screen";

vi.mock("@/features/stores/components/store-provider", () => ({ useStores: vi.fn() }));
vi.mock("@/features/products/queries", () => ({ useProduct: vi.fn() }));
vi.mock("../queries", () => ({
  useProductOptions: vi.fn(),
  useProductVariants: vi.fn(),
  useProductVariant: vi.fn(),
}));
vi.mock("../mutations", () => ({ useVariantMutation: vi.fn() }));
vi.mock("@/features/variant-inventory/queries", () => ({ useVariantInventory: vi.fn() }));
vi.mock("@/features/variant-inventory/mutations", () => ({ useVariantInventoryMutation: vi.fn() }));

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const product: MerchantProduct = {
  id: id(2),
  name: "Merchant T-shirt",
  slug: "merchant-t-shirt",
  description: "A variant product",
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
  created_at: "2026-09-22T00:00:00+00:00",
  updated_at: "2026-09-22T00:00:00+00:00",
};
const option: MerchantProductOption = {
  id: id(3),
  name: "Size",
  position: 0,
  values: [{ id: id(4), value: "Large", position: 0 }],
};
const variant: MerchantVariant = {
  id: id(5),
  value_ids: [id(4)],
  sku: "SKU-A",
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: "2026-09-22T00:00:00+00:00",
  updated_at: "2026-09-22T00:00:00+00:00",
};
const allPermissions = [
  "products.view",
  "products.variants.view",
  "products.variants.create",
  "products.variants.update",
];

function setup({
  permissions = allPermissions,
  options = [option],
  variants = [] as MerchantVariant[],
  currentProduct = product,
}: {
  permissions?: string[];
  options?: MerchantProductOption[];
  variants?: MerchantVariant[];
  currentProduct?: MerchantProduct;
} = {}) {
  const store = {
    state: {
      scope: { principalId: id(10), storeUuid: id(1), revision: 1 },
      context: { permissions, role: { name: "Owner" } },
      refreshing: false,
    },
    controller: { revalidate: vi.fn() },
  };
  vi.mocked(useStores).mockReturnValue(store as unknown as ReturnType<typeof useStores>);
  const productQuery = {
    data: currentProduct,
    error: null as ApiError | null,
    isFetching: false,
    refetch: vi.fn(),
  };
  const optionsQuery = {
    data: options,
    error: null as ApiError | null,
    isFetching: false,
    refetch: vi.fn(),
  };
  const variantsQuery = {
    data: variants,
    error: null as ApiError | null,
    isFetching: false,
    refetch: vi.fn(),
  };
  vi.mocked(useProduct).mockReturnValue(productQuery as unknown as ReturnType<typeof useProduct>);
  vi.mocked(useProductOptions).mockReturnValue(
    optionsQuery as unknown as ReturnType<typeof useProductOptions>,
  );
  vi.mocked(useProductVariants).mockReturnValue(
    variantsQuery as unknown as ReturnType<typeof useProductVariants>,
  );
  vi.mocked(useProductVariant).mockImplementation(
    (_productUuid, variantUuid) =>
      ({
        data: variants.find(({ id }) => id === variantUuid) ?? variant,
        error: null,
        isFetching: false,
        refetch: vi.fn(),
      }) as unknown as ReturnType<typeof useProductVariant>,
  );
  vi.mocked(useVariantInventory).mockImplementation((_productUuid, variantUuid) => {
    const item = variants.find(({ id }) => id === variantUuid) ?? variant;
    return {
      data: { quantity: item.quantity, availability: item.availability },
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVariantInventory>;
  });
  vi.mocked(useVariantInventoryMutation).mockReturnValue({
    state: {
      status: "idle",
      slot: 0,
      inventory: null,
      product: null,
      variant: null,
      error: null,
      refreshError: null,
    },
    isBlocked: false,
    isPending: false,
    execute: vi.fn(),
    reconcile: vi.fn(),
    reviewSuccess: vi.fn(),
  });
  const mutation: ReturnType<typeof useVariantMutation> = {
    state: {
      status: "idle",
      slot: 0,
      operation: null,
      result: null,
      product: null,
      options: null,
      variants: null,
      error: null,
      refreshError: null,
    },
    isPending: false,
    isBlocked: false,
    execute: vi.fn().mockResolvedValue(null),
    review: vi.fn().mockResolvedValue(null),
  };
  const setMutation = (state: Partial<VariantMutationState>) => {
    mutation.state = { ...mutation.state, ...state };
    mutation.isPending = ["pending", "reviewing", "reconciling"].includes(mutation.state.status);
    mutation.isBlocked = ["pending", "success", "unknown", "reviewing", "reconciling"].includes(
      mutation.state.status,
    );
    vi.mocked(useVariantMutation).mockReturnValue({ ...mutation });
  };
  setMutation({});
  return { store, productQuery, optionsQuery, variantsQuery, mutation, setMutation };
}

beforeEach(() => vi.clearAllMocks());

describe("Variants and Options UI authority and structure", () => {
  it.each([
    ["view only", ["products.view", "products.variants.view"], false, false],
    [
      "create only",
      ["products.view", "products.variants.view", "products.variants.create"],
      true,
      false,
    ],
    [
      "update only",
      ["products.view", "products.variants.view", "products.variants.update"],
      false,
      true,
    ],
    [
      "Product CRUD only",
      ["products.view", "products.variants.view", "products.create", "products.update"],
      false,
      false,
    ],
  ])("uses independent grants for %s", (_name, permissions, creates, updates) => {
    setup({ permissions: permissions as string[] });
    render(<VariantsScreen productUuid={product.id} />);
    expect(!!screen.queryByRole("button", { name: "Add option" })).toBe(creates);
    expect(!!screen.queryByRole("button", { name: "Add value" })).toBe(creates);
    expect(!!screen.queryByRole("button", { name: "Create variant" })).toBe(creates);
    expect(!!screen.queryByRole("button", { name: "Edit option" })).toBe(updates);
    expect(!!screen.queryByRole("button", { name: "Edit value" })).toBe(updates);
  });
  it.each([
    ["products.view", "products.variants.create", "products.variants.update"],
    ["products.variants.view", "products.variants.create", "products.variants.update"],
  ])(
    "does not activate reads without both Product and structural viewing permission %j",
    (...permissions) => {
      setup({ permissions });
      render(<VariantsScreen productUuid={product.id} />);
      expect(useProduct).not.toHaveBeenCalled();
      expect(useProductOptions).not.toHaveBeenCalled();
      expect(useProductVariants).not.toHaveBeenCalled();
      expect(useVariantMutation).not.toHaveBeenCalled();
      expect(screen.queryByRole("region", { name: "Options" })).not.toBeInTheDocument();
    },
  );
  it("warns before the first Variant and preserves label/value editing after the Option boundary", () => {
    const controls = setup();
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(
      screen.getByText(/Finish adding options before creating your first variant/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add option" })).toBeEnabled();
    controls.variantsQuery.data = [variant];
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Add option" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit option" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit value" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add value" })).toBeEnabled();
    expect(screen.getByText(/Options are fixed because variants exist/)).toBeVisible();
    expect(screen.getByText(/does not make it ready to purchase/)).toBeVisible();
  });
  it("enforces three Options, twenty Values, and one hundred Variants including inactive", () => {
    const options = Array.from({ length: 3 }, (_, index) => ({
      ...option,
      id: id(20 + index),
      name: `Option ${index}`,
      values: Array.from({ length: index === 0 ? 20 : 1 }, (_, value) => ({
        id: id(100 + index * 20 + value),
        value: `Value ${value}`,
        position: value,
      })),
    }));
    const controls = setup({ options });
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Add option" })).toBeDisabled();
    expect(
      within(screen.getByRole("article", { name: "Option 0" })).getByRole("button", {
        name: "Add value",
      }),
    ).toBeDisabled();
    expect(
      within(screen.getByRole("article", { name: "Option 1" })).getByRole("button", {
        name: "Add value",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create variant" })).toBeEnabled();
    controls.variantsQuery.data = Array.from({ length: 100 }, (_, index) => ({
      ...variant,
      id: id(500 + index),
      status: "inactive",
    }));
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Create variant" })).toBeDisabled();
    expect(screen.getByText(/100 \/ 100 variants, including inactive/)).toBeVisible();
  });
  it("requires configured Options and at least one Value in each before creation", () => {
    const controls = setup({ options: [] });
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Create variant" })).toBeDisabled();
    controls.optionsQuery.data = [{ ...option, values: [] }];
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Create variant" })).toBeDisabled();
  });
  it("keeps archived Products read-only and never activates structural queries for simple Products", () => {
    setup({ currentProduct: { ...product, status: "archived" } });
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByText(/This product is archived/)).toBeVisible();
    for (const button of ["Add option", "Add value", "Edit option", "Edit value", "Create variant"])
      expect(screen.getByRole("button", { name: button })).toBeDisabled();
    vi.clearAllMocks();
    setup({ currentProduct: { ...product, type: "simple" } });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByText(/available only for variant products/)).toBeVisible();
    expect(useProductOptions).not.toHaveBeenCalled();
    expect(useProductVariants).not.toHaveBeenCalled();
    expect(useVariantMutation).not.toHaveBeenCalled();
  });
  it("keeps variant commercial projections read-only and distinguishes null from zero", () => {
    setup({
      variants: [
        {
          ...variant,
          quantity: 0,
          availability: "out_of_stock",
          price: { amount: 1000, currency: "LYD" },
        },
      ],
    });
    render(<VariantsScreen productUuid={product.id} variantUuid={variant.id} />);
    expect(screen.getByText("0", { selector: "dd" })).toBeVisible();
    expect(screen.getByText("Out of stock")).toBeVisible();
    expect(screen.getByText(/Active status alone does not mean/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /price|quantity/i })).not.toBeInTheDocument();
  });
  it("resets an unsaved editor when navigating from Variant A to Variant B", () => {
    const second = { ...variant, id: id(6), sku: "SKU-B" };
    const controls = setup({ variants: [variant, second] });
    const view = render(<VariantsScreen productUuid={product.id} variantUuid={variant.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit variant" }));
    fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), {
      target: { value: "UNSAVED-A" },
    });
    view.rerender(<VariantsScreen productUuid={product.id} variantUuid={second.id} />);
    expect(screen.queryByRole("form", { name: "Edit variant" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit variant" }));
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("SKU-B");
    expect(controls.mutation.execute).not.toHaveBeenCalled();
  });
});

describe("structural feedback and focus priority", () => {
  it("retries all authoritative reads after a Product refresh failure with cached configuration", () => {
    const controls = setup();
    controls.productQuery.error = new ApiError("network");
    render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("article", { name: "Size" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit option" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(controls.productQuery.refetch).toHaveBeenCalledOnce();
    expect(controls.optionsQuery.refetch).toHaveBeenCalledOnce();
    expect(controls.variantsQuery.refetch).toHaveBeenCalledOnce();
    expect(controls.mutation.execute).not.toHaveBeenCalled();
  });
  it("preserves confirmed success through pending Product refresh and truthfully reports a later failure", () => {
    const controls = setup();
    controls.productQuery.isFetching = true;
    controls.setMutation({ status: "success", result: option });
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Changes saved.");
    expect(
      screen.queryByText(/latest configuration could not be refreshed/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add option" })).toBeDisabled();
    controls.productQuery.isFetching = false;
    controls.setMutation({ refreshError: new ApiError("network") });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Changes saved.");
    expect(screen.getByText(/latest configuration could not be refreshed/)).toBeVisible();
    expect(screen.queryByText(/result of this change is unknown/)).not.toBeInTheDocument();
  });
  it("locks unknown outcomes, preserves previous setup, and offers only explicit review", () => {
    const controls = setup({ variants: [variant] });
    controls.setMutation({
      status: "unknown",
      error: new ApiError("network", { mutationOutcome: "unknown" }),
    });
    const view = render(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByText(/result of this change is unknown/)).toBeVisible();
    expect(screen.getByRole("article", { name: "Size" })).toBeVisible();
    expect(screen.getByText("SKU: SKU-A")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit option" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review current configuration" }));
    expect(controls.mutation.review).toHaveBeenCalledOnce();
    expect(controls.mutation.execute).not.toHaveBeenCalled();
    controls.setMutation({ status: "reconciling", error: null });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("button", { name: "Reviewing configuration…" })).toBeDisabled();
    controls.setMutation({ status: "unknown", error: new ApiError("server") });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByText(/result of this change is unknown/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit option" })).toBeDisabled();
  });
  it.each([false, true])(
    "retains field error focus and aria associations after server validation, reviewed=%s",
    (reviewed) => {
      const controls = setup();
      if (reviewed)
        controls.setMutation({
          slot: 1,
          guidance: "current-configuration-reviewed",
          reviewedUnknown: true,
        });
      const view = render(<VariantsScreen productUuid={product.id} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit option" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Option name" }), {
        target: { value: "Duplicate" },
      });
      controls.setMutation({ status: "pending" });
      view.rerender(<VariantsScreen productUuid={product.id} />);
      controls.setMutation({
        status: "error",
        operation: {
          kind: "option.update",
          optionUuid: option.id,
          data: { name: "Duplicate", position: 0 },
        },
        error: new ApiError("validation", {
          details: { fieldErrors: { name: ["This Option name already exists."] } },
        }),
      });
      view.rerender(<VariantsScreen productUuid={product.id} />);
      const input = screen.getByRole("textbox", { name: "Option name" });
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(/This Option name already exists/);
      expect(screen.getByRole("alert")).toHaveTextContent("Check the highlighted fields");
    },
  );
  it("focuses generic feedback when no actionable field error exists", () => {
    const controls = setup();
    const view = render(<VariantsScreen productUuid={product.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit option" }));
    controls.setMutation({
      status: "error",
      operation: {
        kind: "option.update",
        optionUuid: option.id,
        data: { name: "Size 2", position: 0 },
      },
      error: new ApiError("rate-limited"),
    });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too many requests");
    expect(alert.parentElement).toHaveFocus();
  });
  it("starts a reviewed interaction with a blank new editor and no causal confirmation claim", () => {
    const controls = setup();
    const view = render(<VariantsScreen productUuid={product.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Option name" }), {
      target: { value: "Old attempted name" },
    });
    controls.setMutation({ status: "unknown" });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    controls.setMutation({
      status: "idle",
      slot: 1,
      guidance: "current-configuration-reviewed",
      reviewedUnknown: true,
    });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByText(/does not confirm whether the earlier change caused it/)).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    expect(screen.getByRole("textbox", { name: "Option name" })).toHaveValue("");
    expect(controls.mutation.execute).not.toHaveBeenCalled();
  });
  it("does not carry a previous target's field error into another Option editor", () => {
    const second = { ...option, id: id(8), name: "Colour", values: [] };
    const controls = setup({ options: [option, second] });
    const view = render(<VariantsScreen productUuid={product.id} />);
    fireEvent.click(
      within(screen.getByRole("article", { name: "Size" })).getByRole("button", {
        name: "Edit option",
      }),
    );
    controls.setMutation({
      status: "error",
      operation: {
        kind: "option.update",
        optionUuid: option.id,
        data: { name: "Duplicate", position: 0 },
      },
      error: new ApiError("validation", {
        details: { fieldErrors: { name: ["This Option name already exists."] } },
      }),
    });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("textbox", { name: "Option name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.click(
      within(screen.getByRole("article", { name: "Colour" })).getByRole("button", {
        name: "Edit option",
      }),
    );
    expect(screen.getByRole("textbox", { name: "Option name" })).toHaveValue("Colour");
    expect(screen.getByRole("textbox", { name: "Option name" })).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.queryByText("This Option name already exists.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows safe entity validation guidance without exposing unreviewed internals", () => {
    const controls = setup();
    const view = render(<VariantsScreen productUuid={product.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    controls.setMutation({
      status: "error",
      operation: { kind: "option.create", data: { name: "Colour", position: 1 } },
      error: new ApiError("validation", {
        details: {
          fieldErrors: {
            option: ["New Options cannot be added after Variants exist.", "SQLSTATE secret"],
          },
        },
      }),
    });
    view.rerender(<VariantsScreen productUuid={product.id} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New Options cannot be added after Variants exist.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("SQLSTATE");
    expect(screen.getByRole("alert").parentElement).toHaveFocus();
  });
});

describe("Variant inventory detail integration", () => {
  it("retains confirmed inventory feedback but disables structural edits when Variant refresh fails", () => {
    setup({
      permissions: [...allPermissions, "products.variants.inventory.update"],
      variants: [variant],
    });
    vi.mocked(useProductVariant).mockReturnValue({
      data: variant,
      error: new ApiError("network"),
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProductVariant>);
    vi.mocked(useVariantInventoryMutation).mockReturnValue({
      state: {
        status: "success",
        slot: 0,
        inventory: { quantity: 7, availability: "in_stock" },
        product: null,
        variant: null,
        error: null,
        refreshError: new ApiError("network"),
      },
      isBlocked: true,
      isPending: false,
      execute: vi.fn(),
      reconcile: vi.fn(),
      reviewSuccess: vi.fn(),
    });
    render(<VariantsScreen productUuid={product.id} variantUuid={variant.id} />);
    expect(screen.getByText("Quantity saved.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit variant" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "Quantity" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/latest product and variant details could not be confirmed/),
    ).toBeVisible();
  });
  it.each(["not-found", "forbidden", "invalid-response"] as const)(
    "hides cached detail on %s",
    (kind) => {
      setup({ variants: [variant] });
      vi.mocked(useProductVariant).mockReturnValue({
        data: variant,
        error: new ApiError(kind),
        isFetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useProductVariant>);
      render(<VariantsScreen productUuid={product.id} variantUuid={variant.id} />);
      expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
      expect(useVariantInventory).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Edit variant" })).not.toBeInTheDocument();
    },
  );
});
