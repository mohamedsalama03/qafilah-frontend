import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext, StorePage } from "@/lib/backend/contracts";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import { SessionBoundary } from "@/features/auth/components/session-boundary";
import { StoreProvider } from "./store-provider";
import { StoreSelection } from "./store-selection";
import { StoreWorkspace } from "./store-workspace";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const storeA = { id: uuidA, name: "Store Alpha", status: "active" as const };
const storeB = { id: uuidB, name: "Store Bravo", status: "active" as const };
function context(uuid = uuidA, permissions = ["products.view"]): MerchantStoreContext {
  return {
    store: uuid === uuidA ? storeA : storeB,
    membership: { id: "33333333-3333-4333-8333-333333333333", status: "active" },
    role: { id: "44444444-4444-4444-8444-444444444444", name: "Administrator" },
    permissions,
  };
}
function apiFixture(stores = [storeA, storeB]): MerchantApi {
  return {
    listProducts: vi.fn(),
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
    authAdapter: {
      loadIdentity: vi.fn(async () => ({
        principalId: "principal-a",
        displayName: "Synthetic Merchant",
        emailVerified: true,
      })),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(),
    listStoresPage: vi.fn(async () => ({
      stores,
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: stores.length },
    })),
    loadStoreContext: vi.fn(async (uuid) => context(uuid)),
  };
}
function Fixture({ api, children }: { api: MerchantApi; children: React.ReactNode }) {
  return (
    <StrictMode>
      <MerchantApiProvider api={api}>
        <SessionBoundary adapter={api.authAdapter}>
          <StoreProvider>{children}</StoreProvider>
        </SessionBoundary>
      </MerchantApiProvider>
    </StrictMode>
  );
}
beforeEach(() => vi.clearAllMocks());

function driftingDiscovery() {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    id: `abcdef12-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    name: `Unverified candidate ${index}`,
    status: "active" as const,
  }));
  let requests = 0;
  return async (number: number): Promise<StorePage> => {
    if (++requests > 4) throw new ApiError("server");
    return {
      stores: candidates.slice((number - 1) * 20, number * 20),
      pagination: {
        current_page: number,
        per_page: 20,
        total: number === 1 ? 41 : 40,
        last_page: number === 1 ? 3 : 2,
      },
    };
  };
}

describe("Store UI authority", () => {
  it.each(["inconsistent pagination", "network failure"])(
    "shows a refresh error and the previously verified chooser on %s instead of zero Stores",
    async (failure) => {
      const api = apiFixture();
      render(
        <Fixture api={api}>
          <StoreSelection />
        </Fixture>,
      );
      await screen.findByRole("button", { name: "Open Store Alpha" });
      expect(screen.getByRole("button", { name: "Open Store Bravo" })).toBeVisible();
      if (failure === "inconsistent pagination") {
        vi.mocked(api.listStoresPage).mockImplementation(driftingDiscovery());
      } else {
        vi.mocked(api.listStoresPage).mockRejectedValue(new ApiError("network"));
      }
      fireEvent(window, new Event("focus"));
      expect(
        await screen.findByRole("heading", { name: "Your stores couldn’t be loaded" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Open Store Alpha" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Open Store Bravo" })).toBeVisible();
      expect(screen.getByText("2 stores available")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "No stores are available" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("0 stores available")).not.toBeInTheDocument();
      expect(screen.queryByText(/Unverified candidate/)).not.toBeInTheDocument();
      expect(api.listStoresPage).toHaveBeenCalledTimes(
        failure === "inconsistent pagination" ? 5 : 2,
      );
      expect(api.loadStoreContext).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it.each(["cross-page drift", "incomplete single candidate"])(
    "initial %s shows failure without zero-Store copy or single-Store auto-entry",
    async (failure) => {
      const api = apiFixture();
      if (failure === "cross-page drift") {
        vi.mocked(api.listStoresPage).mockImplementation(driftingDiscovery());
      } else {
        vi.mocked(api.listStoresPage).mockResolvedValue({
          stores: [storeA],
          pagination: { current_page: 1, per_page: 20, total: 2, last_page: 1 },
        });
      }
      render(
        <Fixture api={api}>
          <StoreSelection />
        </Fixture>,
      );
      expect(
        await screen.findByRole("heading", { name: "Your stores couldn’t be loaded" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "No stores are available" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("0 stores available")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Open / })).not.toBeInTheDocument();
      expect(screen.queryByText(/Unverified candidate/)).not.toBeInTheDocument();
      expect(api.listStoresPage).toHaveBeenCalledTimes(failure === "cross-page drift" ? 4 : 2);
      expect(api.loadStoreContext).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("normalizes a valid uppercase UUID before selecting and comparing returned authority", async () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const api = apiFixture([{ ...storeA, id: uuid }]);
    vi.mocked(api.loadStoreContext).mockResolvedValue({
      ...context(),
      store: { ...storeA, id: uuid },
    });
    render(
      <Fixture api={api}>
        <StoreWorkspace storeUuid={uuid.toUpperCase()} />
      </Fixture>,
    );
    expect(await screen.findByRole("region", { name: "Current store" })).toHaveAttribute(
      "data-store-uuid",
      uuid,
    );
    expect(api.loadStoreContext).toHaveBeenCalledWith(uuid, expect.any(AbortSignal));
  });

  it.each(["Account menu", "Switch store", "Open navigation"])(
    "hides owned %s portals synchronously before the pagehide snapshot",
    async (trigger) => {
      const api = apiFixture();
      render(
        <Fixture api={api}>
          <StoreWorkspace storeUuid={uuidA} />
        </Fixture>,
      );
      await screen.findByRole("region", { name: "Current store" });
      await userEvent.click(screen.getAllByRole("button", { name: trigger })[0]!);
      const portals = [
        ...document.querySelectorAll<HTMLElement>("[data-merchant-private-overlay]"),
      ];
      expect(portals.length).toBeGreaterThan(0);
      let synchronousSnapshot: boolean[] = [];
      window.addEventListener(
        "pagehide",
        () => {
          synchronousSnapshot = portals.map(
            (element) =>
              element.hidden &&
              element.style.getPropertyValue("display") === "none" &&
              element.style.getPropertyPriority("display") === "important",
          );
        },
        { once: true },
      );
      fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));
      expect(synchronousSnapshot).toEqual(portals.map(() => true));
      expect(screen.queryByRole("region", { name: "Current store" })).not.toBeInTheDocument();
    },
  );

  it("shows zero eligible Stores truthfully without inventing creation or no ownership", async () => {
    const api = apiFixture([]);
    render(
      <Fixture api={api}>
        <StoreSelection />
      </Fixture>,
    );
    expect(await screen.findByRole("heading", { name: "No stores are available" })).toBeVisible();
    expect(screen.getByText(/no eligible store access right now/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /create/i })).not.toBeInTheDocument();
    expect(api.authAdapter.loadIdentity).toHaveBeenCalledTimes(1);
    expect(api.listStoresPage).toHaveBeenCalledTimes(1);
  });

  it("verifies the only Store before automatic navigation", async () => {
    const api = apiFixture([storeA]);
    let finish!: (value: MerchantStoreContext) => void;
    vi.mocked(api.loadStoreContext).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <Fixture api={api}>
        <StoreSelection />
      </Fixture>,
    );
    await waitFor(() => expect(api.loadStoreContext).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => finish(context()));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/stores/${uuidA}`));
  });

  it("hides A immediately on a B route and only renders B after its matching context", async () => {
    const api = apiFixture();
    const view = render(
      <Fixture api={api}>
        <StoreWorkspace storeUuid={uuidA} />
      </Fixture>,
    );
    await screen.findByRole("region", { name: "Current store" });
    let finish!: (value: MerchantStoreContext) => void;
    vi.mocked(api.loadStoreContext).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    view.rerender(
      <Fixture api={api}>
        <StoreWorkspace storeUuid={uuidB} />
      </Fixture>,
    );
    expect(screen.queryByRole("region", { name: "Current store" })).not.toBeInTheDocument();
    expect(screen.queryByText("Store Alpha")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.loadStoreContext).toHaveBeenLastCalledWith(uuidB, expect.any(AbortSignal)),
    );
    await act(async () => finish(context(uuidB)));
    expect(await screen.findByRole("region", { name: "Current store" })).toHaveAttribute(
      "data-store-uuid",
      uuidB,
    );
    expect(screen.queryByText("Store Alpha")).not.toBeInTheDocument();
  });

  it("preserves the open switcher search and workspace node through same-principal focus revalidation", async () => {
    const api = apiFixture();
    render(
      <Fixture api={api}>
        <StoreWorkspace storeUuid={uuidA} />
      </Fixture>,
    );
    const workspace = await screen.findByRole("region", { name: "Current store" });
    await userEvent.click(screen.getAllByRole("button", { name: "Switch store" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Switch store" });
    const search = within(dialog).getByRole("searchbox", { name: "Find a store" });
    await userEvent.type(search, "Bravo");
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(api.loadStoreContext).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByRole("searchbox", { name: "Find a store" })).toBe(search);
    expect(search).toHaveValue("Bravo");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Current store" })).toBe(workspace);
    expect(api.authAdapter.loadIdentity).toHaveBeenCalledTimes(2);
  });

  it("uses explicit grants independently of role name and applies permission removal without logout", async () => {
    const api = apiFixture();
    render(
      <Fixture api={api}>
        <StoreWorkspace storeUuid={uuidA} />
      </Fixture>,
    );
    await screen.findByRole("region", { name: "Current store" });
    expect(screen.getByRole("list", { name: "Current permissions" })).toHaveTextContent(
      "Products View",
    );
    vi.mocked(api.loadStoreContext).mockResolvedValue(context(uuidA, []));
    await userEvent.click(screen.getByRole("button", { name: "Refresh access" }));
    expect(
      await screen.findByText("No operational permissions are assigned to your current role."),
    ).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Current permissions" })).not.toBeInTheDocument();
    expect(api.authAdapter.logout).not.toHaveBeenCalled();
  });

  it.each(["forbidden", "not-found"] as const)(
    "removes inaccessible Store context on %s while retaining the account menu",
    async (kind) => {
      const api = apiFixture();
      render(
        <Fixture api={api}>
          <StoreWorkspace storeUuid={uuidA} />
        </Fixture>,
      );
      await screen.findByRole("region", { name: "Current store" });
      vi.mocked(api.loadStoreContext).mockRejectedValue(new ApiError(kind));
      await userEvent.click(screen.getByRole("button", { name: "Refresh access" }));
      expect(
        await screen.findByRole("heading", { name: "Store access is unavailable" }),
      ).toBeVisible();
      expect(screen.queryByRole("region", { name: "Current store" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Account menu" })).toBeVisible();
      expect(screen.getByRole("link", { name: "Choose another store" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(api.authAdapter.logout).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    },
  );
});
