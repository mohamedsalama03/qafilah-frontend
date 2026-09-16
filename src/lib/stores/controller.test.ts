import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { AccessibleStore, MerchantStoreContext, StorePage } from "../backend/contracts";
import { createQueryClient } from "../query/client";
import { storeKeys } from "../query/keys";
import { createScopeController } from "../query/scope";
import { createStoreController, type StoreApi } from "./controller";

const storeA = "d2cfd6a8-b5aa-4df0-a8bf-2d15d90bb2e1";
const storeB = "ef1f37c7-f515-452a-b598-ccdafad4902d";

function store(id = storeA, name = "Merchant Store"): AccessibleStore {
  return { id, name, status: "active" };
}

function page(
  stores: AccessibleStore[] = [store()],
  current = 1,
  total = stores.length,
): StorePage {
  return {
    stores,
    pagination: {
      current_page: current,
      per_page: 20,
      last_page: Math.max(1, Math.ceil(total / 20)),
      total,
    },
  };
}

function context(id = storeA, permissions = ["orders.view"]): MerchantStoreContext {
  return {
    store: store(id),
    membership: { id: "e0ff205c-d9ad-4457-bec8-8ff2b6e0d186", status: "active" },
    role: { id: "e26cb097-de80-4a43-8cfe-f70f7dfd5fda", name: "Merchant Reader" },
    permissions,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<StoreApi> = {}) {
  const queryClient = createQueryClient();
  const scope = createScopeController(queryClient);
  const api = {
    listStoresPage: vi.fn<StoreApi["listStoresPage"]>(async () => page()),
    loadStoreContext: vi.fn<StoreApi["loadStoreContext"]>(async (uuid) => context(uuid)),
    ...overrides,
  };
  const onSessionError = vi.fn();
  const controller = createStoreController({
    principalId: "principal-a",
    api,
    queryClient,
    scope,
    onSessionError,
  });
  return { controller, queryClient, scope, api, onSessionError };
}

describe("principal-owned Merchant Store lifecycle", () => {
  it("discovers zero, one and multiple eligible Stores without inferring or auto-selecting authority", async () => {
    for (const stores of [[], [store()], [store(), store(storeB)]]) {
      const runtime = setup({ listStoresPage: async () => page(stores) });
      await runtime.controller.discover();
      expect(runtime.controller.getSnapshot()).toMatchObject({
        stores,
        discoveryStatus: "ready",
        selectedUuid: null,
        context: null,
        scope: null,
      });
      expect(runtime.api.loadStoreContext).not.toHaveBeenCalled();
      runtime.controller.dispose();
    }
  });

  it("fetches all 23 memberships through two pages with no context N+1", async () => {
    const stores = Array.from({ length: 23 }, (_, index) =>
      store(`10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, `Store ${index}`),
    );
    const listStoresPage = vi.fn(async (number: number) =>
      page(stores.slice((number - 1) * 20, number * 20), number, 23),
    );
    const { controller, api } = setup({ listStoresPage });
    const first = controller.discover();
    expect(controller.discover()).toBe(first);
    await first;
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
    expect(controller.getSnapshot().stores).toEqual(stores);
    expect(api.loadStoreContext).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("rejects repeated offset-page overlap instead of publishing an incomplete deduplicated list", async () => {
    const stores = Array.from({ length: 20 }, (_, index) =>
      store(`10000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const { controller } = setup({
      listStoresPage: async (number) =>
        page(number === 1 ? stores : [stores[19], store(storeB)], number, 22),
    });
    await controller.discover();
    expect(controller.getSnapshot()).toMatchObject({
      stores: [],
      discoveryStatus: "error",
      discoveryError: { kind: "invalid-response" },
    });
    controller.dispose();
  });

  it.each([
    { current_page: 2 },
    { per_page: 50 },
    { last_page: 1_001, total: 20_001 },
    { last_page: 2, total: 1 },
    { total: -1 },
    { last_page: Infinity },
  ])(
    "fails explicitly on corrupt/unbounded pagination %j without partial discovery",
    async (change) => {
      const result = page();
      Object.assign(result.pagination, change);
      const { controller } = setup({ listStoresPage: async () => result });
      await controller.discover();
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "error",
        discoveryError: { kind: "invalid-response" },
        stores: [],
      });
      controller.dispose();
    },
  );

  it("does not silently report a partial list when a later page fails", async () => {
    const stores = Array.from({ length: 20 }, (_, index) =>
      store(`10000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const { controller } = setup({
      listStoresPage: async (number) => {
        if (number === 2) throw new ApiError("network");
        return page(stores, number, 21);
      },
    });
    await controller.discover();
    expect(controller.getSnapshot()).toMatchObject({ discoveryStatus: "error", stores: [] });
    controller.dispose();
  });

  it("synchronously removes A context, cache and mutations before starting B", async () => {
    const b = deferred<MerchantStoreContext>();
    const { controller, queryClient, scope } = setup({
      loadStoreContext: async (uuid) => (uuid === storeA ? context() : b.promise),
    });
    await controller.discover();
    await controller.select(storeA);
    const aScope = controller.getSnapshot().scope!;
    const key = storeKeys.resource(aScope, "private-test-data");
    queryClient.setQueryData(key, { private: "A only" });
    queryClient.getMutationCache().build(queryClient, { mutationFn: async () => "A mutation" });
    const pending = controller.select(storeB);
    expect(controller.getSnapshot()).toMatchObject({
      selectedUuid: storeB,
      context: null,
      contextStatus: "loading",
    });
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(scope.getScope()).not.toBe(aScope);
    expect(queryClient.getQueryData(["merchant-discovery", "principal-a"])).toEqual([store()]);
    b.resolve(context(storeB));
    await pending;
    expect(controller.getSnapshot().context?.store.id).toBe(storeB);
    controller.dispose();
  });

  it("rejects late A completion even if its adapter ignores the aborted signal", async () => {
    const a = deferred<MerchantStoreContext>();
    let aSignal: AbortSignal | undefined;
    const { controller, queryClient } = setup({
      loadStoreContext: async (uuid, signal) => {
        if (uuid === storeA) {
          aSignal = signal;
          return a.promise;
        }
        return context(storeB);
      },
    });
    const pendingA = controller.select(storeA);
    await vi.waitFor(() => expect(aSignal).toBeDefined());
    await controller.select(storeB);
    expect(aSignal?.aborted).toBe(true);
    a.resolve(context(storeA));
    await pendingA;
    expect(controller.getSnapshot().context?.store.id).toBe(storeB);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((query) => !query.queryKey.includes(storeA)),
    ).toBe(true);
    controller.dispose();
  });

  it("deduplicates same-Store selection and preserves exact scope on background refresh", async () => {
    const refresh = deferred<MerchantStoreContext>();
    const loadStoreContext = vi
      .fn<StoreApi["loadStoreContext"]>()
      .mockResolvedValueOnce(context())
      .mockReturnValueOnce(refresh.promise);
    const { controller, queryClient, scope } = setup({ loadStoreContext });
    const first = controller.select(storeA);
    expect(controller.select(storeA)).toBe(first);
    await first;
    const previous = controller.getSnapshot();
    const key = storeKeys.resource(previous.scope!, "draft-test-data");
    queryClient.setQueryData(key, "unsaved note");
    const work = deferred<string>();
    const running = scope.run(previous.scope!, () => work.promise);
    await controller.select(storeA);
    expect(loadStoreContext).toHaveBeenCalledTimes(1);
    const recheck = controller.revalidate();
    expect(controller.getSnapshot()).toMatchObject({ contextStatus: "ready", refreshing: true });
    expect(controller.getSnapshot().scope).toBe(previous.scope);
    expect(controller.getSnapshot().context).toBe(previous.context);
    refresh.resolve(context());
    await recheck;
    expect(controller.getSnapshot().context?.permissions).toEqual(previous.context?.permissions);
    expect(controller.getSnapshot().scope).toBe(previous.scope);
    expect(queryClient.getQueryData(key)).toBe("unsaved note");
    work.resolve("still current");
    await expect(running).resolves.toBe("still current");
    controller.dispose();
  });

  it("revokes operational caches and pending reads before publishing changed permissions", async () => {
    const loadStoreContext = vi
      .fn<StoreApi["loadStoreContext"]>()
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(context(storeA, []));
    const { controller, queryClient, scope } = setup({ loadStoreContext });
    await controller.select(storeA);
    const previous = controller.getSnapshot().scope!;
    const key = storeKeys.resource(previous, "products");
    queryClient.setQueryData(key, "private Product state");
    const work = deferred<string>();
    const running = scope.run(previous, () => work.promise);
    const cancelled = expect(running).rejects.toMatchObject({ kind: "cancelled" });
    await controller.revalidate();
    await cancelled;
    expect(controller.getSnapshot().scope).not.toBe(previous);
    expect(controller.getSnapshot().context?.permissions).toEqual([]);
    expect(queryClient.getQueryData(key)).toBeUndefined();
    work.resolve("late private response");
    controller.dispose();
  });

  it.each(["network", "server", "timeout", "rate-limited"] as const)(
    "preserves verified same-Store work on transient %s revalidation",
    async (kind) => {
      const loadStoreContext = vi
        .fn<StoreApi["loadStoreContext"]>()
        .mockResolvedValueOnce(context())
        .mockRejectedValueOnce(new ApiError(kind));
      const { controller, onSessionError } = setup({ loadStoreContext });
      await controller.select(storeA);
      const previous = controller.getSnapshot();
      await controller.revalidate();
      expect(controller.getSnapshot()).toMatchObject({
        contextStatus: "ready",
        contextError: { kind },
        refreshing: false,
      });
      expect(controller.getSnapshot().scope).toBe(previous.scope);
      expect(controller.getSnapshot().context).toBe(previous.context);
      expect(onSessionError).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each(["forbidden", "not-found"] as const)(
    "purges selected Store on %s and refreshes discovery without global logout",
    async (kind) => {
      const loadStoreContext = vi
        .fn<StoreApi["loadStoreContext"]>()
        .mockResolvedValueOnce(context())
        .mockRejectedValueOnce(new ApiError(kind));
      const { controller, queryClient, scope, onSessionError, api } = setup({ loadStoreContext });
      await controller.select(storeA);
      const aScope = controller.getSnapshot().scope!;
      queryClient.setQueryData(storeKeys.resource(aScope, "private-test-data"), "sensitive");
      await controller.revalidate();
      expect(controller.getSnapshot()).toMatchObject({
        selectedUuid: storeA,
        context: null,
        scope: null,
        contextStatus: "error",
        contextError: { kind },
      });
      expect(scope.getScope()).toBeNull();
      expect(queryClient.getQueriesData({ queryKey: ["merchant"] })).toEqual([]);
      expect(api.listStoresPage).toHaveBeenCalled();
      expect(onSessionError).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each(["unauthenticated", "session-expired"] as const)(
    "globally clears and reports %s from a Store endpoint",
    async (kind) => {
      const { controller, queryClient, onSessionError } = setup({
        loadStoreContext: async () => {
          throw new ApiError(kind);
        },
      });
      await controller.discover();
      queryClient.setQueryData(["identity-private-data"], "principal");
      await controller.select(storeA);
      expect(controller.getSnapshot()).toMatchObject({
        stores: [],
        context: null,
        scope: null,
        selectedUuid: null,
      });
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
      expect(onSessionError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind }));
      controller.dispose();
    },
  );

  it("routes discovery401 through global session loss too", async () => {
    const { controller, onSessionError } = setup({
      listStoresPage: async () => {
        throw new ApiError("unauthenticated");
      },
    });
    await controller.discover();
    expect(onSessionError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "unauthenticated" }),
    );
    controller.dispose();
  });

  it("permits direct foreign UUID requests but rejects malformed navigation locally", async () => {
    const loadStoreContext = vi
      .fn<StoreApi["loadStoreContext"]>()
      .mockRejectedValue(new ApiError("not-found"));
    const { controller } = setup({ loadStoreContext });
    await controller.select("not-a-uuid");
    expect(loadStoreContext).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      contextError: { kind: "not-found" },
      scope: null,
    });
    await controller.select(storeB);
    expect(loadStoreContext).toHaveBeenCalledWith(storeB, expect.any(AbortSignal));
    expect(controller.getSnapshot()).toMatchObject({
      selectedUuid: storeB,
      context: null,
      scope: null,
    });
    controller.dispose();
  });

  it("rejects a response for a different Store even if navigation UUID shape was valid", async () => {
    const { controller, queryClient } = setup({ loadStoreContext: async () => context(storeB) });
    await controller.select(storeA);
    expect(controller.getSnapshot()).toMatchObject({
      context: null,
      scope: null,
      contextError: { kind: "invalid-response" },
    });
    expect(queryClient.getQueriesData({ queryKey: ["merchant"] })).toEqual([]);
    controller.dispose();
  });

  it("copies and freezes authority so adapter callers cannot mutate verified grants", async () => {
    const source = context();
    const { controller } = setup({ loadStoreContext: async () => source });
    await controller.select(storeA);
    source.permissions.push("products.view");
    source.role.name = "Owner";
    expect(controller.getSnapshot().context?.permissions).toEqual(["orders.view"]);
    expect(controller.getSnapshot().context?.role.name).toBe("Merchant Reader");
    expect(Object.isFrozen(controller.getSnapshot().context?.permissions)).toBe(true);
    controller.dispose();
  });

  it("leaves a Store synchronously, preserves principal discovery, and rejects pending work", async () => {
    const result = deferred<MerchantStoreContext>();
    let signal: AbortSignal | undefined;
    const { controller, queryClient } = setup({
      loadStoreContext: async (_uuid, received) => {
        signal = received;
        return result.promise;
      },
    });
    await controller.discover();
    const pending = controller.select(storeA);
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.leave();
    expect(signal?.aborted).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      selectedUuid: null,
      context: null,
      scope: null,
      stores: [store()],
    });
    result.resolve(context());
    await pending;
    expect(queryClient.getQueriesData({ queryKey: ["merchant"] })).toEqual([]);
    expect(controller.getSnapshot().context).toBeNull();
    controller.dispose();
  });

  it("disposal aborts discovery and blocks late responses and future old-principal requests", async () => {
    const result = deferred<StorePage>();
    let signal: AbortSignal | undefined;
    const listStoresPage = vi.fn<StoreApi["listStoresPage"]>(async (_page, received) => {
      signal = received;
      return result.promise;
    });
    const { controller, queryClient, api } = setup({ listStoresPage });
    const pending = controller.discover();
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.dispose();
    expect(signal?.aborted).toBe(true);
    result.resolve(page());
    await pending;
    await controller.discover();
    await controller.select(storeA);
    await controller.revalidate();
    expect(listStoresPage).toHaveBeenCalledTimes(1);
    expect(api.loadStoreContext).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(controller.getSnapshot().stores).toEqual([]);
  });

  it("disposal before scheduled discovery starts prevents even the first HTTP request", async () => {
    const { controller, api } = setup();
    const task = controller.discover();
    controller.dispose();
    await task;
    expect(api.listStoresPage).not.toHaveBeenCalled();
  });

  it("replayed old-principal disposal cannot clear or abort a replacement principal", async () => {
    const old = setup();
    await old.controller.select(storeA);
    old.controller.dispose();
    const response = deferred<MerchantStoreContext>();
    let signal: AbortSignal | undefined;
    const replacement = createStoreController({
      principalId: "principal-b",
      queryClient: old.queryClient,
      scope: old.scope,
      api: {
        listStoresPage: async () => page([store(storeB)]),
        loadStoreContext: async (_uuid, received) => {
          signal = received;
          return response.promise;
        },
      },
    });
    const pending = replacement.select(storeB);
    await vi.waitFor(() => expect(signal).toBeDefined());
    const replacementScope = replacement.getSnapshot().scope;
    old.controller.dispose();
    expect(old.scope.getScope()).toBe(replacementScope);
    expect(signal?.aborted).toBe(false);
    response.resolve(context(storeB));
    await pending;
    expect(replacement.getSnapshot().context?.store.id).toBe(storeB);
    expect(
      old.queryClient.getQueryData(storeKeys.resource(replacementScope!, "context")),
    ).toMatchObject({ store: { id: storeB } });
    replacement.dispose();
  });
});
