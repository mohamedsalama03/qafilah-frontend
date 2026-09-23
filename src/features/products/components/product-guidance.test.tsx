import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary } from "@/features/auth/components/session-boundary";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { ApiError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantProduct } from "../contracts";
import { useProductMutation } from "../mutations";
import { CreateProductScreen, EditProductScreen } from "./product-form-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/stores/11111111-1111-4111-8111-111111111111/products",
}));
const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "33333333-3333-4333-8333-333333333333";
const A = "Authoritative guidance product A";
const B = "Uncertain typed product B";
const C = "Deliberate later product C";
function product(name = A): MerchantProduct {
  return {
    id: productUuid,
    name,
    slug: "guidance-product",
    description: "Server guidance description",
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
}
function fixture(mode: "edit" | "create" = "edit") {
  let current = product();
  let mutation: ReturnType<typeof useProductMutation> | undefined;
  const api: MerchantApi = {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "guidance-reader" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [{ id: storeUuid, name: "Guidance Store", status: "active" as const }],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
    })),
    loadStoreContext: vi.fn(async () => ({
      store: { id: storeUuid, name: "Guidance Store", status: "active" as const },
      membership: { id: productUuid, status: "active" as const },
      role: { id: productUuid, name: "Operator" },
      permissions: ["products.view", "products.create", "products.update", "products.publish"],
    })),
    loadProduct: vi.fn(async () => current),
    listProducts: vi.fn(async () => ({
      products: [current],
      pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
      effectiveRange: {
        created_from: "2025-09-01T00:00:00+00:00",
        created_to: "2026-09-01T00:00:00+00:00",
      },
    })),
    listCategories: vi.fn(),
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
    createProduct: vi.fn(async () => current),
    updateProduct: vi.fn(async () => current),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
  };
  function StateObserver() {
    const observed = useProductMutation(mode === "create" ? undefined : productUuid);
    useEffect(() => {
      mutation = observed;
    });
    return null;
  }
  function Fixture({ revision = 0 }: { revision?: number }) {
    return (
      <StrictMode>
        <MerchantApiProvider api={api}>
          <SessionBoundary adapter={api.authAdapter}>
            <StoreProvider>
              <StoreWorkspace storeUuid={storeUuid} title="Products">
                <StateObserver />
                <button type="button">Workspace focus target</button>
                <div key={revision}>
                  {mode === "create" ? (
                    <CreateProductScreen />
                  ) : (
                    <EditProductScreen productUuid={productUuid} />
                  )}
                </div>
              </StoreWorkspace>
            </StoreProvider>
          </SessionBoundary>
        </MerchantApiProvider>
      </StrictMode>
    );
  }
  return {
    api,
    Fixture,
    server: (name: string, status: MerchantProduct["status"] = "draft") => {
      current = { ...product(name), status };
    },
    mutation: () => {
      if (!mutation) throw new Error("Product controls have not mounted");
      return mutation;
    },
  };
}
async function enterButton(name: string) {
  const button = await screen.findByRole("button", { name });
  button.focus();
  await userEvent.setup().keyboard("{Enter}");
}
function nameInput() {
  return screen.getByLabelText("Product name", { exact: false }) as HTMLInputElement;
}
function notice(kind: "product" | "blank" = "product") {
  const pattern =
    kind === "product"
      ? /latest product.*loaded[\s\S]*review[\s\S]*another change/i
      : /new blank product form.*ready/i;
  return screen.queryAllByRole("status").find((element) => pattern.test(element.textContent ?? ""));
}
function expectNotice(kind: "product" | "blank" = "product") {
  const status = notice(kind);
  expect(Boolean(status)).toBe(true);
  expect(status).toBeVisible();
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveAttribute("aria-atomic", "true");
  expect(status).not.toHaveFocus();
}
async function typeName(name: string) {
  fireEvent.change(await screen.findByLabelText("Product name", { exact: false }), {
    target: { value: name },
  });
}
async function fillCreate() {
  await typeName(B);
  fireEvent.change(screen.getByLabelText("Slug", { exact: false }), {
    target: { value: "typed-guidance-product" },
  });
  fireEvent.change(screen.getByLabelText(/^Description/), {
    target: { value: "Typed create description" },
  });
}
async function uncertainUpdate(f: ReturnType<typeof fixture>, committed: boolean) {
  vi.mocked(f.api.updateProduct).mockRejectedValueOnce(
    new ApiError("network", { mutationOutcome: "unknown" }),
  );
  await typeName(B);
  await enterButton("Save changes");
  await screen.findByText("We couldn’t confirm whether the change was completed.");
  expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  expect(f.mutation().state.status).toBe("unknown");
  expect(f.mutation().isBlocked).toBe(true);
  f.server(committed ? B : A);
}
async function refresh(f: ReturnType<typeof fixture>, expected: string) {
  const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
  const slot = f.mutation().state.slot;
  await enterButton("Refresh product");
  await waitFor(() => expect(f.mutation().state.status).toBe("idle"));
  expect(nameInput().value).toBe(expected);
  expect(f.mutation().state.slot).toBe(slot + 1);
  expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1);
  expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(false);
});

describe("Product reconciliation guidance", () => {
  // The original external Agent 2 probe was not present in this workspace. These
  // five permanent repetitions reproduce its stated uncommitted-update notice loss.
  it.each([1, 2, 3, 4, 5])(
    "notice probe %i preserves server A and guidance after uncertain B did not commit",
    async () => {
      const f = fixture();
      render(<f.Fixture />);
      await uncertainUpdate(f, false);
      await refresh(f, A);
      expectNotice();
    },
  );

  it("preserves committed B and guidance without inferring commit from matching values", async () => {
    const f = fixture();
    render(<f.Fixture />);
    await uncertainUpdate(f, true);
    await refresh(f, B);
    expectNotice();
    expect(f.mutation().state.action).toBeNull();
    expect(f.mutation().isBlocked).toBe(false);
  });

  it.each([false, true])(
    "guidance survives immediate form remount and allows a later deliberate save (committed=%s)",
    async (committed) => {
      const f = fixture();
      const view = render(<f.Fixture />);
      await uncertainUpdate(f, committed);
      await refresh(f, committed ? B : A);
      expectNotice();
      const slot = f.mutation().state.slot;
      view.rerender(<f.Fixture revision={1} />);
      await waitFor(() => expect(nameInput().value).toBe(committed ? B : A));
      expectNotice();
      expect(f.mutation().state.slot).toBe(slot);
      await typeName(C);
      expectNotice();
      await enterButton("Save changes");
      await waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(2));
      expect(vi.mocked(f.api.updateProduct).mock.calls[1][0].data).toEqual({ name: C });
    },
  );

  it("Start a new edit loads newer server values and keeps guidance in its fresh slot", async () => {
    const f = fixture();
    const view = render(<f.Fixture />);
    await typeName(B);
    f.server(B);
    await enterButton("Save changes");
    await screen.findByRole("button", { name: "Start a new edit" });
    f.server(C);
    await enterButton("Start a new edit");
    await waitFor(() => expect(f.mutation().state.status).toBe("idle"));
    expect(nameInput().value).toBe(C);
    expectNotice();
    view.rerender(<f.Fixture revision={1} />);
    await waitFor(() => expect(nameInput().value).toBe(C));
    expectNotice();
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("an authoritative archived reconciliation still announces the loaded server product", async () => {
    const f = fixture();
    render(<f.Fixture />);
    await uncertainUpdate(f, false);
    f.server(A, "archived");
    await enterButton("Refresh product");
    await waitFor(() => expect(f.mutation().state.status).toBe("idle"));
    await screen.findByText("This product is archived");
    expectNotice();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("keyboard reconciliation guidance never steals a merchant's newer focus choice", async () => {
    const f = fixture();
    render(<f.Fixture />);
    await uncertainUpdate(f, false);
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(f.api.loadProduct).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await enterButton("Refresh product");
    await waitFor(() => expect(f.mutation().state.status).toBe("reconciling"));
    const target = screen.getByRole("button", { name: "Workspace focus target" });
    target.focus();
    await act(async () => {
      resolve(product());
    });
    expectNotice();
    expect(target).toHaveFocus();
    expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
  });

  it.each(["confirmed", "unknown"] as const)(
    "%s separate creation keeps blank-form guidance through remount and never reuses the payload",
    async (outcome) => {
      const f = fixture("create");
      const view = render(<f.Fixture />);
      if (outcome === "unknown")
        vi.mocked(f.api.createProduct).mockRejectedValueOnce(
          new ApiError("network", { mutationOutcome: "unknown" }),
        );
      await fillCreate();
      await enterButton("Create product");
      if (outcome === "unknown") {
        await enterButton("Review products");
        await screen.findByRole("button", { name: "Start a separate product" });
        expect(f.mutation().state.status).toBe("unknown");
        expect(f.mutation().isBlocked).toBe(true);
        await enterButton("Start a separate product");
      } else await enterButton("Create another product");
      await waitFor(() => expect(f.mutation().state.status).toBe("idle"));
      expect(nameInput().value).toBe("");
      expect(screen.getByLabelText("Slug", { exact: false })).toHaveValue("");
      expect(screen.getByLabelText(/^Description/)).toHaveValue("");
      expectNotice("blank");
      view.rerender(<f.Fixture revision={1} />);
      await waitFor(() => expect(nameInput().value).toBe(""));
      expectNotice("blank");
      expect(f.api.createProduct).toHaveBeenCalledTimes(1);
      await fillCreate();
      fireEvent.change(screen.getByLabelText("Slug", { exact: false }), {
        target: { value: "separate-guidance-product" },
      });
      await enterButton("Create product");
      await waitFor(() => expect(f.api.createProduct).toHaveBeenCalledTimes(2));
      expect(vi.mocked(f.api.createProduct).mock.calls[1][0].data.slug).toBe(
        "separate-guidance-product",
      );
    },
  );

  it.each(["unknown", "known"] as const)(
    "failed %s review retains its outcome and emits no successful-load guidance",
    async (outcome) => {
      const f = fixture();
      render(<f.Fixture />);
      if (outcome === "unknown") await uncertainUpdate(f, false);
      else {
        await typeName(B);
        f.server(B);
        await enterButton("Save changes");
        await screen.findByRole("button", { name: "Start a new edit" });
      }
      const slot = f.mutation().state.slot;
      vi.mocked(f.api.loadProduct).mockRejectedValueOnce(new ApiError("network"));
      await enterButton(outcome === "unknown" ? "Refresh product" : "Start a new edit");
      await waitFor(() =>
        expect(f.mutation().state.status).toBe(outcome === "unknown" ? "unknown" : "success"),
      );
      expect(f.mutation().state.slot).toBe(slot);
      expect(f.mutation().isBlocked).toBe(true);
      expect(notice()).toBeUndefined();
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      await act(async () => {
        await f.mutation().execute({ action: "update", data: { name: C } });
      });
      expect(f.api.updateProduct).toHaveBeenCalledTimes(1);
      await enterButton(outcome === "unknown" ? "Refresh product" : "Start a new edit");
      await waitFor(() => expect(f.mutation().state.status).toBe("idle"));
      expectNotice();
    },
  );
});
