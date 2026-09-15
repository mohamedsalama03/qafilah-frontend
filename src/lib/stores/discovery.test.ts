import { describe, expect, it, vi } from "vitest";
import { ApiError, kindForStatus } from "../api/errors";
import type { AccessibleStore, MerchantStoreContext, StorePage } from "../backend/contracts";
import { createQueryClient } from "../query/client";
import { createScopeController } from "../query/scope";
import { createStoreController, type StoreApi, type StoreState } from "./controller";

function stores(count: number, offset = 0): AccessibleStore[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `abcdef12-0000-4000-8000-${(offset + index).toString(16).padStart(12, "0")}`,
    name: `Store ${offset + index}`,
    status: "active",
  }));
}

function page(
  values: AccessibleStore[],
  current = 1,
  total = values.length,
  overrides: Partial<StorePage["pagination"]> = {},
): StorePage {
  return {
    stores: values,
    pagination: {
      current_page: current,
      per_page: 20,
      total,
      last_page: Math.max(1, Math.ceil(total / 20)),
      ...overrides,
    },
  };
}

function pages(values: AccessibleStore[]): StorePage[] {
  return Array.from({ length: Math.max(1, Math.ceil(values.length / 20)) }, (_, index) =>
    page(values.slice(index * 20, (index + 1) * 20), index + 1, values.length),
  );
}

function context(store: AccessibleStore): MerchantStoreContext {
  return {
    store,
    membership: { id: "e0ff205c-d9ad-4457-bec8-8ff2b6e0d186", status: "active" },
    role: { id: "e26cb097-de80-4a43-8cfe-f70f7dfd5fda", name: "Merchant Reader" },
    permissions: ["orders.view"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function responses(values: (StorePage | ApiError)[]) {
  let index = 0;
  return vi.fn<StoreApi["listStoresPage"]>(async () => {
    const result = values[index++];
    // A runaway retry mutant stops without making this fixture or test loop unbounded.
    if (!result) throw new ApiError("server");
    if (result instanceof ApiError) throw result;
    return result;
  });
}

function setup(listStoresPage: StoreApi["listStoresPage"]) {
  const queryClient = createQueryClient();
  const scope = createScopeController(queryClient);
  const onSessionError = vi.fn();
  const loadStoreContext = vi.fn<StoreApi["loadStoreContext"]>(async () => context(stores(1)[0]));
  const controller = createStoreController({
    principalId: "principal-a",
    api: { listStoresPage, loadStoreContext },
    queryClient,
    scope,
    onSessionError,
  });
  const snapshots: StoreState[] = [];
  controller.subscribe(() => snapshots.push(controller.getSnapshot()));
  return { controller, queryClient, scope, onSessionError, loadStoreContext, snapshots };
}

const discoveryKey = ["merchant-discovery", "principal-a"] as const;

const driftCases: [string, StorePage, StorePage][] = [
  [
    "reported total 41 to 40 and last page 3 to 2",
    page(stores(20), 1, 41),
    page(stores(20, 20), 2, 40),
  ],
  ["total decrease with unchanged last page", page(stores(20), 1, 40), page(stores(19, 20), 2, 39)],
  ["total increase with unchanged last page", page(stores(20), 1, 39), page(stores(20, 20), 2, 40)],
  [
    "total drift on a non-final page stops before page three",
    page(stores(20), 1, 41),
    page(stores(20, 20), 2, 42),
  ],
  ["last page increases", page(stores(20), 1, 23), page(stores(3, 20), 2, 23, { last_page: 3 })],
  ["last page decreases", page(stores(20), 1, 23), page(stores(3, 20), 2, 23, { last_page: 1 })],
  ["page size changes", page(stores(20), 1, 23), page(stores(3, 20), 2, 23, { per_page: 10 })],
  [
    "response page differs from requested page",
    page(stores(20), 1, 23),
    page(stores(3, 20), 2, 23, { current_page: 1 }),
  ],
];

describe("A2-F2-L1 bounded Store discovery reconstruction", () => {
  it("reproduces the 41-to-40 membership race without retaining revoked Store 5 or missing Store 21", async () => {
    const before = stores(41, 1);
    const after = before.filter((store) => store.id !== before[4].id);
    let attempt = 0;
    const listStoresPage = vi.fn<StoreApi["listStoresPage"]>(async (number) => {
      if (number === 1) attempt += 1;
      if (attempt > 2) throw new ApiError("server");
      if (attempt === 1 && number === 1) return page(before.slice(0, 20), 1, 41);
      return page(after.slice((number - 1) * 20, number * 20), number, 40);
    });
    const { controller, queryClient, snapshots } = setup(listStoresPage);
    await controller.discover();
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(controller.getSnapshot()).toMatchObject({ discoveryStatus: "ready", stores: after });
    expect(controller.getSnapshot().stores).toContainEqual(before[20]);
    expect(controller.getSnapshot().stores).not.toContainEqual(before[4]);
    expect(queryClient.getQueryData(discoveryKey)).toEqual(after);
    expect(
      snapshots.filter((state) => state.discoveryStatus === "ready").map((state) => state.stores),
    ).toEqual([after]);
    controller.dispose();
  });

  it.each([0, 1, 20, 23, 61])(
    "publishes all %i healthy Stores in backend order with one request per page",
    async (count) => {
      const verified = stores(count);
      const listStoresPage = responses(pages(verified));
      const { controller, queryClient, loadStoreContext } = setup(listStoresPage);
      const first = controller.discover();
      expect(controller.discover()).toBe(first);
      await first;
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual(
        pages(verified).map((_, index) => index + 1),
      );
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "ready",
        discoveryError: null,
        stores: verified,
        selectedUuid: null,
        context: null,
        scope: null,
      });
      expect(queryClient.getQueryData(discoveryKey)).toEqual(verified);
      expect(loadStoreContext).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each(driftCases)(
    "restarts at page one for %s and publishes only the fresh traversal",
    async (_label, first, inconsistent) => {
      const verified = stores(23, 100);
      const listStoresPage = responses([first, inconsistent, ...pages(verified)]);
      const { controller, queryClient, snapshots, loadStoreContext } = setup(listStoresPage);
      await controller.discover();
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "ready",
        discoveryError: null,
        stores: verified,
      });
      expect(queryClient.getQueryData(discoveryKey)).toEqual(verified);
      expect(snapshots.filter((state) => state.discoveryStatus === "ready")).toHaveLength(1);
      expect(
        snapshots.every(
          (state) => state.stores.length === 0 || state.stores === controller.getSnapshot().stores,
        ),
      ).toBe(true);
      expect(loadStoreContext).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each(["identical", "name conflict", "uppercase UUID"] as const)(
    "treats a cross-page %s duplicate as drift rather than silently deduplicating",
    async (kind) => {
      const first = stores(20);
      const duplicate = { ...first[19] };
      if (kind === "name conflict") duplicate.name = "Changed during traversal";
      if (kind === "uppercase UUID") duplicate.id = duplicate.id.toUpperCase();
      const verified = stores(23, 100);
      const listStoresPage = responses([
        page(first, 1, 23),
        page([duplicate, ...stores(2, 20)], 2, 23),
        ...pages(verified),
      ]);
      const { controller, queryClient, snapshots } = setup(listStoresPage);
      await controller.discover();
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "ready",
        stores: verified,
      });
      expect(queryClient.getQueryData(discoveryKey)).toEqual(verified);
      expect(
        snapshots.filter((state) => state.discoveryStatus === "ready").map((state) => state.stores),
      ).toEqual([verified]);
      controller.dispose();
    },
  );

  it("rejects conflicting status even if a custom adapter bypasses the active Store decoder", async () => {
    const first = stores(20);
    const invalid = { ...first[19], status: "suspended" } as unknown as AccessibleStore;
    const listStoresPage = responses([
      page(first, 1, 23),
      page([invalid, ...stores(2, 20)], 2, 23),
      page(first, 1, 23),
      page([invalid, ...stores(2, 20)], 2, 23),
    ]);
    const { controller, queryClient, snapshots } = setup(listStoresPage);
    await controller.discover();
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: { kind: "invalid-response" },
      stores: [],
    });
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(queryClient.getQueryData(discoveryKey)).toBeUndefined();
    expect(snapshots.every((state) => state.discoveryStatus !== "ready")).toBe(true);
    controller.dispose();
  });

  it.each([0, 1, 2, 4])(
    "never publishes an incomplete or oversized final page of %i Stores for pinned total 23",
    async (length) => {
      const malformed = [page(stores(20), 1, 23), page(stores(length, 20), 2, 23)];
      const listStoresPage = responses([...malformed, ...malformed]);
      const { controller, queryClient, snapshots } = setup(listStoresPage);
      await controller.discover();
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "error",
        discoveryError: { kind: "invalid-response" },
        stores: [],
      });
      expect(listStoresPage.mock.calls.length).toBeLessThanOrEqual(4);
      expect(queryClient.getQueryData(discoveryKey)).toBeUndefined();
      expect(
        snapshots.every((state) => state.stores.length === 0 && state.discoveryStatus !== "ready"),
      ).toBe(true);
      controller.dispose();
    },
  );

  it("stops after two inconsistent attempts with explicit initial failure and no third attempt", async () => {
    const first = page(stores(20), 1, 41);
    const inconsistent = page(stores(20, 20), 2, 40);
    const listStoresPage = responses([first, inconsistent, first, inconsistent]);
    const { controller, queryClient, snapshots } = setup(listStoresPage);
    await controller.discover();
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: {
        kind: "invalid-response",
        message: "The service returned an unexpected response.",
      },
      stores: [],
      selectedUuid: null,
      context: null,
      scope: null,
    });
    expect(
      snapshots.every((state) => state.discoveryStatus !== "ready" && state.stores.length === 0),
    ).toBe(true);
    expect(queryClient.getQueryData(discoveryKey)).toBeUndefined();
    controller.dispose();
  });

  it("preserves the exact previously verified list and selected context when both refresh attempts drift", async () => {
    const verified = stores(2, 100);
    const inconsistent = [page(stores(20), 1, 41), page(stores(20, 20), 2, 40)];
    const listStoresPage = responses([...pages(verified), ...inconsistent, ...inconsistent]);
    const { controller, queryClient, snapshots, loadStoreContext } = setup(listStoresPage);
    await controller.discover();
    loadStoreContext.mockResolvedValueOnce(context(verified[0]));
    await controller.select(verified[0].id);
    const previous = controller.getSnapshot();
    const start = snapshots.length;
    await controller.discover();
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 1, 2, 1, 2]);
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: { kind: "invalid-response" },
    });
    expect(controller.getSnapshot().stores).toBe(previous.stores);
    expect(controller.getSnapshot().context).toBe(previous.context);
    expect(controller.getSnapshot().scope).toBe(previous.scope);
    expect(queryClient.getQueryData(discoveryKey)).toBe(previous.stores);
    expect(
      snapshots
        .slice(start)
        .every((state) => state.stores === previous.stores && state.discoveryStatus !== "ready"),
    ).toBe(true);
    expect(loadStoreContext).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it.each(["network", "server", "timeout", "rate-limited"] as const)(
    "retains verified Store UUIDs and cache on transient %s discovery refresh failure",
    async (kind) => {
      const verified = stores(2, 100);
      const listStoresPage = responses([
        ...pages(verified),
        page(stores(20), 1, 23),
        new ApiError(kind),
      ]);
      const { controller, queryClient, snapshots, onSessionError } = setup(listStoresPage);
      await controller.discover();
      const previous = controller.getSnapshot().stores;
      const start = snapshots.length;
      await controller.discover();
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 1, 2]);
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "error",
        discoveryError: { kind },
        stores: verified,
      });
      expect(controller.getSnapshot().stores).toBe(previous);
      expect(queryClient.getQueryData(discoveryKey)).toBe(previous);
      expect(snapshots.slice(start).every((state) => state.stores === previous)).toBe(true);
      expect(onSessionError).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each([400, 401, 403, 404, 419, 422, 429, 500])(
    "does not classify HTTP %i on page two as pagination drift or replay it",
    async (status) => {
      const listStoresPage = responses([
        page(stores(20), 1, 23),
        new ApiError(kindForStatus(status), { status }),
      ]);
      const { controller, onSessionError } = setup(listStoresPage);
      await controller.discover();
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "error",
        stores: [],
        discoveryError: { status },
      });
      expect(onSessionError).toHaveBeenCalledTimes(status === 401 || status === 419 ? 1 : 0);
      controller.dispose();
    },
  );

  it.each(["network", "invalid-response", "cancelled"] as const)(
    "does not replay arbitrary adapter %s failure",
    async (kind) => {
      const listStoresPage = responses([page(stores(20), 1, 23), new ApiError(kind)]);
      const { controller } = setup(listStoresPage);
      await controller.discover();
      expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
      expect(controller.getSnapshot()).toMatchObject({
        discoveryStatus: "error",
        discoveryError: { kind },
        stores: [],
      });
      controller.dispose();
    },
  );

  it("stops at a network failure in the retry without a third traversal", async () => {
    const listStoresPage = responses([
      page(stores(20), 1, 41),
      page(stores(20, 20), 2, 40),
      page(stores(20, 100), 1, 23),
      new ApiError("network"),
    ]);
    const { controller } = setup(listStoresPage);
    await controller.discover();
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: { kind: "network" },
      stores: [],
    });
    controller.dispose();
  });

  it("rejects a valid first-page shape above the production 1000-page ceiling before requesting page two", async () => {
    const listStoresPage = responses([page(stores(20), 1, 20_001), new ApiError("server")]);
    const { controller, queryClient, snapshots } = setup(listStoresPage);
    await controller.discover();
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1]);
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: { kind: "invalid-response" },
      stores: [],
    });
    expect(queryClient.getQueryData(discoveryKey)).toBeUndefined();
    expect(snapshots.every((state) => state.discoveryStatus !== "ready")).toBe(true);
    controller.dispose();
  });

  it("keeps retry candidates invisible and concurrent discovery calls deduplicated until the final page resolves", async () => {
    const verified = stores(23, 100);
    const reached = deferred<AbortSignal | undefined>();
    const final = deferred<StorePage>();
    const listStoresPage = responses([
      page(stores(20), 1, 41),
      page(stores(20, 20), 2, 40),
      pages(verified)[0],
    ]);
    listStoresPage
      .mockImplementationOnce(async () => page(stores(20), 1, 41))
      .mockImplementationOnce(async () => page(stores(20, 20), 2, 40))
      .mockImplementationOnce(async () => pages(verified)[0])
      .mockImplementationOnce(async (_number, signal) => {
        reached.resolve(signal);
        return final.promise;
      });
    const { controller, queryClient, snapshots } = setup(listStoresPage);
    const task = controller.discover();
    await reached.promise;
    expect(controller.discover()).toBe(task);
    expect(controller.getSnapshot()).toMatchObject({
      discoveryStatus: "loading",
      discoveryError: null,
      stores: [],
    });
    expect(queryClient.getQueryData(discoveryKey)).toBeUndefined();
    expect(snapshots.every((state) => state.stores.length === 0)).toBe(true);
    final.resolve(pages(verified)[1]);
    await task;
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(controller.getSnapshot()).toMatchObject({ discoveryStatus: "ready", stores: verified });
    controller.dispose();
  });
});

describe("Store discovery retry ownership", () => {
  function pendingRetry() {
    const final = deferred<StorePage>();
    const reached = deferred<AbortSignal | undefined>();
    const verified = stores(23, 100);
    const listStoresPage = vi
      .fn<StoreApi["listStoresPage"]>()
      .mockResolvedValueOnce(page(stores(20), 1, 41))
      .mockResolvedValueOnce(page(stores(20, 20), 2, 40))
      .mockResolvedValueOnce(pages(verified)[0])
      .mockImplementationOnce(async (_number, signal) => {
        reached.resolve(signal);
        return final.promise;
      });
    return { ...setup(listStoresPage), listStoresPage, reached, final, verified };
  }

  it("logout disposal aborts a pending retry and prevents all late cache and list publication", async () => {
    const runtime = pendingRetry();
    const task = runtime.controller.discover();
    const signal = await runtime.reached.promise;
    runtime.controller.dispose();
    expect(signal?.aborted).toBe(true);
    await task;
    runtime.final.resolve(pages(runtime.verified)[1]);
    await Promise.resolve();
    await runtime.controller.discover();
    expect(runtime.listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    expect(runtime.controller.getSnapshot()).toMatchObject({
      discoveryStatus: "idle",
      stores: [],
      context: null,
      scope: null,
    });
    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each(["principal-a", "principal-b"])(
    "a replacement generation for %s cannot be overwritten by an old retry",
    async (principalId) => {
      const runtime = pendingRetry();
      const oldTask = runtime.controller.discover();
      const signal = await runtime.reached.promise;
      runtime.controller.dispose();
      const current = stores(2, 200);
      const replacement = createStoreController({
        principalId,
        queryClient: runtime.queryClient,
        scope: runtime.scope,
        api: {
          listStoresPage: responses(pages(current)),
          loadStoreContext: runtime.loadStoreContext,
        },
      });
      await replacement.discover();
      const expected = replacement.getSnapshot();
      runtime.final.resolve(pages(runtime.verified)[1]);
      await oldTask;
      runtime.controller.dispose();
      expect(signal?.aborted).toBe(true);
      expect(replacement.getSnapshot()).toBe(expected);
      expect(runtime.queryClient.getQueryData(["merchant-discovery", principalId])).toEqual(
        current,
      );
      expect(runtime.listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
      replacement.dispose();
    },
  );

  it("a newer discovery after Store denial supersedes an old retry in the same controller", async () => {
    const runtime = pendingRetry();
    const current = stores(2, 200);
    const oldTask = runtime.controller.discover();
    const signal = await runtime.reached.promise;
    runtime.listStoresPage.mockResolvedValueOnce(page(current));
    runtime.loadStoreContext.mockRejectedValueOnce(new ApiError("forbidden"));
    await runtime.controller.select(stores(1)[0].id);
    const expected = runtime.controller.getSnapshot();
    expect(expected).toMatchObject({
      discoveryStatus: "ready",
      stores: current,
      contextStatus: "error",
      context: null,
      scope: null,
    });
    expect(signal?.aborted).toBe(true);
    runtime.final.resolve(pages(runtime.verified)[1]);
    await oldTask;
    expect(runtime.controller.getSnapshot()).toBe(expected);
    expect(runtime.queryClient.getQueryData(discoveryKey)).toEqual(current);
    expect(runtime.listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2, 1]);
    runtime.controller.dispose();
  });

  it("global session loss during a retry aborts it and prevents late publication", async () => {
    const runtime = pendingRetry();
    const task = runtime.controller.discover();
    const signal = await runtime.reached.promise;
    runtime.loadStoreContext.mockRejectedValueOnce(
      new ApiError("unauthenticated", { status: 401 }),
    );
    await runtime.controller.select(stores(1)[0].id);
    expect(signal?.aborted).toBe(true);
    runtime.final.resolve(pages(runtime.verified)[1]);
    await task;
    expect(runtime.controller.getSnapshot()).toMatchObject({
      discoveryStatus: "error",
      discoveryError: { kind: "unauthenticated" },
      stores: [],
      context: null,
      scope: null,
    });
    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(runtime.onSessionError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "unauthenticated" }),
    );
    expect(runtime.listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1, 2]);
    runtime.controller.dispose();
  });

  it("disposal while attempt one is pending prevents a late drift response from starting any retry", async () => {
    const late = deferred<StorePage>();
    const reached = deferred<AbortSignal | undefined>();
    const listStoresPage = vi
      .fn<StoreApi["listStoresPage"]>()
      .mockResolvedValueOnce(page(stores(20), 1, 41))
      .mockImplementationOnce(async (_number, signal) => {
        reached.resolve(signal);
        return late.promise;
      });
    const { controller, queryClient } = setup(listStoresPage);
    const task = controller.discover();
    const signal = await reached.promise;
    controller.dispose();
    late.resolve(page(stores(20, 20), 2, 40));
    await task;
    expect(signal?.aborted).toBe(true);
    expect(listStoresPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
    expect(controller.getSnapshot()).toMatchObject({ discoveryStatus: "idle", stores: [] });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
