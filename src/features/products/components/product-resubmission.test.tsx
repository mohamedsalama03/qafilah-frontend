import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary, useMerchantSession } from "@/features/auth/components/session-boundary";
import { StoreProvider } from "@/features/stores/components/store-provider";
import { StoreWorkspace } from "@/features/stores/components/store-workspace";
import { ApiError } from "@/lib/api/errors";
import { confirmUnsavedNavigation } from "@/lib/forms/unsaved-changes";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantProduct } from "../contracts";
import { CreateProductScreen, EditProductScreen } from "./product-form-screen";
import { ProductScreen } from "./product-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/stores/11111111-1111-4111-8111-111111111111/products",
}));
const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-01T00:00:00+00:00";
const operations = ["publish", "unpublish", "create", "save", "archive"] as const;
type Operation = (typeof operations)[number];
const methods = {
  publish: "publishProduct",
  unpublish: "unpublishProduct",
  create: "createProduct",
  save: "updateProduct",
  archive: "archiveProduct",
} as const;
const labels = {
  publish: "Publish",
  unpublish: "Unpublish",
  create: "Create product",
  save: "Save changes",
  archive: "Archive product",
};

function product(status: MerchantProduct["status"] = "draft"): MerchantProduct {
  return {
    id: productUuid,
    name: "Response boundary product",
    slug: "response-boundary-product",
    description: "Plain text response boundary fixture",
    seo_title: null,
    seo_description: null,
    status,
    type: "simple",
    requires_shipping: true,
    published_at: status === "published" ? at : null,
    price: null,
    quantity: null,
    availability: "unavailable",
    categories: [],
    created_at: at,
    updated_at: at,
  };
}
function fixture(operation: Operation) {
  let current = product(operation === "unpublish" ? "published" : "draft");
  let expireReads: () => Promise<void> = async () => {};
  function CacheAccess() {
    const session = useMerchantSession();
    useEffect(() => {
      expireReads = () => session.queryClient.invalidateQueries({ refetchType: "none" });
    }, [session]);
    return null;
  }
  const api: MerchantApi = {
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId: "response-boundary-reader" })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores: [{ id: storeUuid, name: "Boundary Store", status: "active" as const }],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
    })),
    loadStoreContext: vi.fn(async () => ({
      store: { id: storeUuid, name: "Boundary Store", status: "active" as const },
      membership: { id: productUuid, status: "active" as const },
      role: { id: productUuid, name: "Operator" },
      permissions: ["products.view", "products.create", "products.update", "products.publish"],
    })),
    loadProduct: vi.fn(async () => current),
    listProducts: vi.fn(async () => ({
      products: [current],
      pagination: { per_page: 25, next_cursor: null, previous_cursor: null },
      effectiveRange: { created_from: "2025-09-01T00:00:00+00:00", created_to: at },
    })),
    listCategories: vi.fn(),
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
    createProduct: vi.fn(async () => current),
    updateProduct: vi.fn(async () => current),
    publishProduct: vi.fn(async () => ({ ...current, status: "published" as const })),
    unpublishProduct: vi.fn(async () => ({ ...current, status: "draft" as const })),
    archiveProduct: vi.fn(async () => ({ ...current, status: "archived" as const })),
  };
  let resolve!: (value: MerchantProduct) => void;
  const response = new Promise<MerchantProduct>((done) => {
    resolve = done;
  });
  vi.mocked(api[methods[operation]]).mockReturnValueOnce(response);
  function complete() {
    current = {
      ...current,
      ...(operation === "publish" ? { status: "published" as const, published_at: at } : {}),
      ...(operation === "unpublish" ? { status: "draft" as const, published_at: null } : {}),
      ...(operation === "archive" ? { status: "archived" as const } : {}),
      ...(["create", "save"].includes(operation) ? { name: "Changed boundary product" } : {}),
    };
    resolve(current);
  }
  function Fixture({
    revision = 0,
    view = "original",
  }: {
    revision?: number;
    view?: "original" | "away" | "edit";
  }) {
    return (
      <StrictMode>
        <MerchantApiProvider api={api}>
          <SessionBoundary adapter={api.authAdapter}>
            <CacheAccess />
            <StoreProvider>
              <StoreWorkspace storeUuid={storeUuid} title="Products">
                <div key={revision}>
                  {view === "away" ? (
                    <p>Another workspace screen</p>
                  ) : view === "edit" ? (
                    <EditProductScreen productUuid={productUuid} />
                  ) : operation === "create" ? (
                    <CreateProductScreen />
                  ) : operation === "save" ? (
                    <EditProductScreen productUuid={productUuid} />
                  ) : (
                    <ProductScreen productUuid={productUuid} />
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
    complete,
    Fixture,
    changeBackend: (value: MerchantProduct) => {
      current = value;
    },
    expireReads: () => expireReads(),
  };
}
async function activate(element: HTMLElement, input: "click" | "Enter") {
  if (input === "click") fireEvent.click(element);
  else {
    element.focus();
    await userEvent.setup().keyboard("{Enter}");
  }
}
async function prepare(operation: Operation) {
  if (operation === "create" || operation === "save") {
    fireEvent.change(await screen.findByLabelText("Product name", { exact: false }), {
      target: { value: "Changed boundary product" },
    });
    if (operation === "create") {
      fireEvent.change(screen.getByLabelText("Slug", { exact: false }), {
        target: { value: "changed-boundary-product" },
      });
      fireEvent.change(screen.getByLabelText(/^Description/), {
        target: { value: "Plain description" },
      });
    }
  }
  const trigger = await screen.findByRole("button", { name: labels[operation] });
  if (operation !== "archive") return trigger;
  fireEvent.click(trigger);
  return within(await screen.findByRole("alertdialog", { name: "Archive product" })).getByRole(
    "button",
    { name: "Archive product" },
  );
}
async function pause(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
}
function writeCount(api: MerchantApi) {
  return Object.values(methods).reduce(
    (total, method) => total + vi.mocked(api[method]).mock.calls.length,
    0,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(false);
});

describe("Product response-boundary resubmission", () => {
  for (const operation of operations)
    for (const input of ["click", "Enter"] as const)
      it.each([0, 50, 120, 200, 300, 450])(
        `${operation} ${input} at %i ms dispatches exactly one mutation`,
        async (interval) => {
          const f = fixture(operation);
          render(<f.Fixture />);
          const first = await prepare(operation);
          await activate(first, input);
          await waitFor(() => expect(f.api[methods[operation]]).toHaveBeenCalledTimes(1));
          if (interval === 0) await activate(first, input);
          await act(async () => f.complete());
          await pause(interval);
          // Retarget the same action area after the server response. On the rejected
          // baseline Publish becomes Unpublish there; navigation is deliberately pending.
          const nextLabel =
            operation === "publish"
              ? "Unpublish"
              : operation === "unpublish"
                ? "Publish"
                : labels[operation];
          const second = screen.queryByRole("button", { name: nextLabel });
          if (second) await activate(second, input);
          await act(async () => {
            await Promise.resolve();
          });
          expect(writeCount(f.api)).toBe(1);
          expect(f.api[methods[operation]]).toHaveBeenCalledTimes(1);
          if (operation === "publish") expect(f.api.unpublishProduct).not.toHaveBeenCalled();
          if (operation === "unpublish") expect(f.api.publishProduct).not.toHaveBeenCalled();
          if (operation !== "archive") {
            const oppositeOrSubmit =
              operation === "publish"
                ? "Unpublish"
                : operation === "unpublish"
                  ? "Publish"
                  : labels[operation];
            const available = screen.queryByRole("button", { name: oppositeOrSubmit });
            expect(!available || available.hasAttribute("disabled")).toBe(true);
          }
        },
      );

  it.each(["publish", "create", "save"] as const)(
    "retains confirmed %s protection when the controls remount",
    async (operation) => {
      const f = fixture(operation);
      const view = render(<f.Fixture />);
      await activate(await prepare(operation), "click");
      await waitFor(() => expect(writeCount(f.api)).toBe(1));
      await act(async () => f.complete());
      view.rerender(<f.Fixture revision={1} />);
      await pause(0);
      const label = operation === "publish" ? "Unpublish" : labels[operation];
      const target = screen.queryByRole("button", { name: label });
      expect(!target || target.hasAttribute("disabled")).toBe(true);
      if (target) await activate(target, "Enter");
      expect(writeCount(f.api)).toBe(1);
    },
  );

  it("allows deliberate unpublish only after a separate authoritative review", async () => {
    const f = fixture("publish");
    render(<f.Fixture />);
    await activate(await prepare("publish"), "click");
    await waitFor(() => expect(f.api.publishProduct).toHaveBeenCalledTimes(1));
    await act(async () => f.complete());
    const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
    await activate(await screen.findByRole("button", { name: "Review product actions" }), "Enter");
    const unpublish = await screen.findByRole("button", { name: "Unpublish" });
    expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1);
    expect(writeCount(f.api)).toBe(1);
    // Review moves focus to the action group; another Enter cannot become a write.
    await userEvent.setup().keyboard("{Enter}");
    expect(writeCount(f.api)).toBe(1);
    await activate(unpublish, "click");
    await waitFor(() => expect(f.api.unpublishProduct).toHaveBeenCalledTimes(1));
    expect(f.api.publishProduct).toHaveBeenCalledTimes(1);
    expect(writeCount(f.api)).toBe(2);
  });

  it("starts a new edit from an authoritative GET and supersedes pending navigation", async () => {
    const f = fixture("save");
    render(<f.Fixture />);
    await activate(await prepare("save"), "click");
    await waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(1));
    await act(async () => f.complete());
    expect(router.push).toHaveBeenCalledWith(`/stores/${storeUuid}/products/${productUuid}`);
    const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
    vi.mocked(f.api.loadProduct).mockResolvedValueOnce({
      ...product(),
      name: "Newer reviewed product",
      description: "Newer reviewed description",
    });
    await activate(await screen.findByRole("button", { name: "Start a new edit" }), "click");
    const name = await screen.findByLabelText("Product name", { exact: false });
    expect(name).toHaveValue("Newer reviewed product");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Newer reviewed description");
    expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1);
    expect(router.replace).toHaveBeenCalledWith(
      `/stores/${storeUuid}/products/${productUuid}/edit`,
    );
    expect(writeCount(f.api)).toBe(1);
    fireEvent.change(name, { target: { value: "A deliberate second edit" } });
    await activate(screen.getByRole("button", { name: "Save changes" }), "Enter");
    await waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.api.updateProduct).mock.calls[1][0].data).toEqual({
      name: "A deliberate second edit",
    });
  });

  it.each(["publish", "save"] as const)(
    "reopening edit after confirmed %s and review uses the later authoritative GET",
    async (operation) => {
      const f = fixture(operation);
      const view = render(<f.Fixture />);
      await activate(await prepare(operation), "click");
      await waitFor(() => expect(writeCount(f.api)).toBe(1));
      await act(async () => f.complete());
      await activate(
        await screen.findByRole("button", {
          name: operation === "publish" ? "Review product actions" : "Start a new edit",
        }),
        "click",
      );
      await screen.findByRole("button", {
        name: operation === "publish" ? "Unpublish" : "Save changes",
      });
      view.rerender(<f.Fixture view="away" />);
      await screen.findByText("Another workspace screen");
      const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
      f.changeBackend({
        ...product(),
        name: "Later authoritative product",
        description: "Later authoritative description",
        seo_title: "Later authoritative title",
      });
      await act(async () => {
        await f.expireReads();
      });
      view.rerender(<f.Fixture view="edit" revision={1} />);
      const name = await screen.findByLabelText("Product name", { exact: false });
      expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1);
      expect(name).toHaveValue("Later authoritative product");
      expect(screen.getByLabelText(/^Description/)).toHaveValue("Later authoritative description");
      expect(screen.getByLabelText("SEO title", { exact: false })).toHaveValue(
        "Later authoritative title",
      );
      const writes = vi.mocked(f.api.updateProduct).mock.calls.length;
      fireEvent.change(name, { target: { value: "Only the deliberate latest edit" } });
      await activate(screen.getByRole("button", { name: "Save changes" }), "click");
      await waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(writes + 1));
      expect(vi.mocked(f.api.updateProduct).mock.calls[writes][0].data).toEqual({
        name: "Only the deliberate latest edit",
      });
    },
  );

  it("a remounted confirmed edit can leave during a review without a sending warning", async () => {
    const f = fixture("save");
    const view = render(<f.Fixture />);
    await activate(await prepare("save"), "click");
    await waitFor(() => expect(writeCount(f.api)).toBe(1));
    await act(async () => f.complete());
    view.rerender(<f.Fixture revision={1} />);
    let resolve!: (value: MerchantProduct) => void;
    vi.mocked(f.api.loadProduct).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
    await activate(await screen.findByRole("button", { name: "Start a new edit" }), "click");
    await waitFor(() => expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1));
    expect(confirmUnsavedNavigation()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    const leaving = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(leaving)).toBe(true);
    expect(leaving.defaultPrevented).toBe(false);
    expect(writeCount(f.api)).toBe(1);
    await act(async () => {
      resolve(product());
    });
  });

  it("starts another create with blank values and supersedes pending navigation", async () => {
    const f = fixture("create");
    render(<f.Fixture />);
    await activate(await prepare("create"), "click");
    await waitFor(() => expect(f.api.createProduct).toHaveBeenCalledTimes(1));
    await act(async () => f.complete());
    expect(router.push).toHaveBeenCalledWith(`/stores/${storeUuid}/products/${productUuid}`);
    await activate(await screen.findByRole("button", { name: "Create another product" }), "click");
    expect(await screen.findByLabelText("Product name", { exact: false })).toHaveValue("");
    expect(screen.getByLabelText("Slug", { exact: false })).toHaveValue("");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("");
    expect(router.replace).toHaveBeenCalledWith(`/stores/${storeUuid}/products/new`);
    expect(writeCount(f.api)).toBe(1);
    // Even a deliberate new form cannot replay the completed values on Enter.
    await activate(screen.getByRole("button", { name: "Create product" }), "Enter");
    expect(writeCount(f.api)).toBe(1);
    await prepare("create");
    fireEvent.change(screen.getByLabelText("Slug", { exact: false }), {
      target: { value: "separate-boundary-product" },
    });
    await activate(screen.getByRole("button", { name: "Create product" }), "click");
    await waitFor(() => expect(f.api.createProduct).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.api.createProduct).mock.calls[1][0].data.slug).toBe(
      "separate-boundary-product",
    );
  });

  it.each(["success", "failure"] as const)(
    "new edit navigation happens before the review and never repeats after %s",
    async (outcome) => {
      const f = fixture("save");
      render(<f.Fixture />);
      await activate(await prepare("save"), "click");
      await waitFor(() => expect(f.api.updateProduct).toHaveBeenCalledTimes(1));
      await act(async () => f.complete());
      let resolve!: (value: MerchantProduct) => void;
      let reject!: (error: unknown) => void;
      vi.mocked(f.api.loadProduct).mockReturnValueOnce(
        new Promise((accept, fail) => {
          resolve = accept;
          reject = fail;
        }),
      );
      await activate(await screen.findByRole("button", { name: "Start a new edit" }), "click");
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith(
        `/stores/${storeUuid}/products/${productUuid}/edit`,
      );
      // A newer navigation can happen while the review is pending. Its settlement
      // must never issue a late replace that would take the merchant back to editing.
      router.push(`/stores/${storeUuid}`);
      await act(async () => {
        if (outcome === "success") resolve(product());
        else reject(new ApiError("network"));
      });
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(writeCount(f.api)).toBe(1);
    },
  );

  it.each(["publish", "save"] as const)(
    "keeps confirmed %s controls locked when the explicit review fails",
    async (operation) => {
      const f = fixture(operation);
      render(<f.Fixture />);
      await activate(await prepare(operation), "click");
      await waitFor(() => expect(writeCount(f.api)).toBe(1));
      await act(async () => f.complete());
      const reads = vi.mocked(f.api.loadProduct).mock.calls.length;
      vi.mocked(f.api.loadProduct).mockRejectedValueOnce(new ApiError("network"));
      const reviewLabel = operation === "publish" ? "Review product actions" : "Start a new edit";
      await activate(await screen.findByRole("button", { name: reviewLabel }), "Enter");
      await screen.findByText(/The service could not be reached\. Check your connection\./);
      expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 1);
      expect(
        screen.queryByRole("button", {
          name: operation === "publish" ? "Unpublish" : "Save changes",
        }),
      ).toBeNull();
      expect(writeCount(f.api)).toBe(1);
      await activate(screen.getByRole("button", { name: reviewLabel }), "click");
      await screen.findByRole("button", {
        name: operation === "publish" ? "Unpublish" : "Save changes",
      });
      expect(f.api.loadProduct).toHaveBeenCalledTimes(reads + 2);
      expect(writeCount(f.api)).toBe(1);
    },
  );
});
