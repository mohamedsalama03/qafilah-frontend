import type { QueryClient } from "@tanstack/react-query";
import { abortable } from "../api/cancellation";
import { ApiError, normalizeUnexpectedError } from "../api/errors";
import type { AccessibleStore, MerchantStoreContext, StorePage } from "../backend/contracts";
import {
  parsePrincipalId,
  parseStoreUuid,
  storeKeys,
  type QueryScope,
  type StoreUuid,
} from "../query/keys";
import type { createScopeController } from "../query/scope";

export interface StoreApi {
  listStoresPage(page: number, signal?: AbortSignal): Promise<StorePage>;
  loadStoreContext(uuid: string, signal?: AbortSignal): Promise<MerchantStoreContext>;
}

export interface StoreState {
  readonly stores: readonly AccessibleStore[];
  readonly discoveryStatus: "idle" | "loading" | "ready" | "error";
  readonly discoveryError: ApiError | null;
  /** Requested navigation UUID only; authority exists only with context and scope. */
  readonly selectedUuid: StoreUuid | null;
  readonly contextStatus: "idle" | "loading" | "ready" | "error";
  readonly context: MerchantStoreContext | null;
  readonly contextError: ApiError | null;
  readonly scope: QueryScope | null;
  readonly refreshing: boolean;
}

export interface StoreControllerOptions {
  principalId: unknown;
  api: StoreApi;
  queryClient: QueryClient;
  scope: ReturnType<typeof createScopeController>;
  onSessionError?: (error: ApiError) => void;
}

const emptyStores: readonly AccessibleStore[] = Object.freeze([]);
// A corrupt or ever-growing paginator must fail explicitly, never return a truncated list.
const maximumDiscoveryPages = 1_000;
const maximumDiscoveryAttempts = 2;

/** Successful pages disagree; this is distinct from a transport or parser failure. */
class DiscoveryInconsistency extends ApiError {
  constructor() {
    super("invalid-response");
  }
}

function initialState(): StoreState {
  return Object.freeze({
    stores: emptyStores,
    discoveryStatus: "idle",
    discoveryError: null,
    selectedUuid: null,
    contextStatus: "idle",
    context: null,
    contextError: null,
    scope: null,
    refreshing: false,
  });
}

function isSessionLoss(error: ApiError): boolean {
  return error.kind === "unauthenticated" || error.kind === "session-expired";
}

function isTransient(error: ApiError): boolean {
  return ["network", "timeout", "server", "rate-limited"].includes(error.kind);
}

function freezeContext(context: MerchantStoreContext): MerchantStoreContext {
  const copy = {
    store: Object.freeze({ ...context.store }),
    membership: Object.freeze({ ...context.membership }),
    role: Object.freeze({ ...context.role }),
    permissions: [...context.permissions],
  };
  Object.freeze(copy.permissions);
  return Object.freeze(copy);
}

/** One instance per authenticated principal, disposed synchronously on session authority loss. */
export function createStoreController(options: StoreControllerOptions) {
  const principalId = parsePrincipalId(options.principalId);
  const discoveryKey = ["merchant-discovery", principalId] as const;
  const listeners = new Set<() => void>();
  let state = initialState();
  let stopped = false;
  let discoveryGeneration = 0;
  let contextGeneration = 0;
  let discoveryAbort: AbortController | null = null;
  let contextAbort: AbortController | null = null;
  let pendingDiscovery: Promise<void> | null = null;
  let pendingContext: Promise<void> | null = null;

  function update(next: StoreState): void {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function cancelContext(): void {
    contextGeneration += 1;
    contextAbort?.abort();
    contextAbort = null;
    pendingContext = null;
  }

  function stopRequests(): void {
    stopped = true;
    discoveryGeneration += 1;
    discoveryAbort?.abort();
    discoveryAbort = null;
    pendingDiscovery = null;
    cancelContext();
  }

  function loseSession(error: ApiError): void {
    stopRequests();
    options.scope.clear();
    update({
      ...initialState(),
      discoveryStatus: "error",
      discoveryError: error,
      contextStatus: "error",
      contextError: error,
    });
    options.onSessionError?.(error);
  }

  async function discoverAttempt(
    signal: AbortSignal,
    assertCurrent: () => void,
  ): Promise<readonly AccessibleStore[]> {
    // Each attempt owns its paginator and aggregate. Nothing is published until complete.
    const stores = new Map<string, AccessibleStore>();
    let pinned: StorePage["pagination"] | null = null;
    for (let page = 1; page <= (pinned?.last_page ?? 1); page += 1) {
      assertCurrent();
      const result = await abortable(
        Promise.resolve().then(() => {
          assertCurrent();
          return options.api.listStoresPage(page, signal);
        }),
        signal,
      );
      assertCurrent();
      const pagination = result.pagination;
      if (
        !Number.isSafeInteger(pagination.current_page) ||
        pagination.current_page < 1 ||
        !Number.isSafeInteger(pagination.per_page) ||
        pagination.per_page < 1 ||
        !Number.isSafeInteger(pagination.last_page) ||
        pagination.last_page < 1 ||
        !Number.isSafeInteger(pagination.total) ||
        pagination.total < 0
      )
        throw new ApiError("invalid-response");
      if (
        pagination.current_page !== page ||
        (pinned &&
          (pagination.total !== pinned.total ||
            pagination.last_page !== pinned.last_page ||
            pagination.per_page !== pinned.per_page))
      )
        throw new DiscoveryInconsistency();
      // Reject an oversized first-page paginator before following it, without allocating by total.
      if (pagination.last_page > maximumDiscoveryPages) throw new ApiError("invalid-response");
      if (
        pagination.per_page !== 20 ||
        pagination.last_page !== Math.max(1, Math.ceil(pagination.total / pagination.per_page))
      )
        throw new ApiError("invalid-response");
      if (
        result.stores.length !==
        Math.max(
          0,
          Math.min(pagination.per_page, pagination.total - (page - 1) * pagination.per_page),
        )
      )
        throw new DiscoveryInconsistency();
      pinned ??= { ...pagination };
      for (const store of result.stores) {
        let id: StoreUuid;
        try {
          id = parseStoreUuid(store.id.toLowerCase());
        } catch {
          throw new ApiError("invalid-response");
        }
        const previous = stores.get(id);
        if (previous && (previous.name !== store.name || previous.status !== store.status))
          throw new DiscoveryInconsistency();
        // Even identical overlap can displace another Store across independently read pages.
        if (previous) throw new DiscoveryInconsistency();
        if (store.status !== "active") throw new ApiError("invalid-response");
        stores.set(id, Object.freeze({ ...store, id }));
      }
    }
    if (!pinned || stores.size !== pinned.total) throw new DiscoveryInconsistency();
    return Object.freeze([...stores.values()]);
  }

  function discover(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pendingDiscovery) return pendingDiscovery;
    const ticket = ++discoveryGeneration;
    const controller = new AbortController();
    discoveryAbort = controller;
    const assertCurrent = () => {
      if (stopped || ticket !== discoveryGeneration || controller.signal.aborted)
        throw new ApiError("cancelled");
    };
    const task = Promise.resolve().then(async () => {
      try {
        for (let attempt = 1; attempt <= maximumDiscoveryAttempts; attempt += 1) {
          assertCurrent();
          try {
            const result = await discoverAttempt(controller.signal, assertCurrent);
            assertCurrent();
            options.queryClient.setQueryData(discoveryKey, result);
            update({ ...state, stores: result, discoveryStatus: "ready", discoveryError: null });
            return;
          } catch (error) {
            assertCurrent();
            if (!(error instanceof DiscoveryInconsistency) || attempt === maximumDiscoveryAttempts)
              throw error;
          }
        }
      } catch (error) {
        if (stopped || ticket !== discoveryGeneration) return;
        const normalized = normalizeUnexpectedError(error);
        if (isSessionLoss(normalized)) {
          loseSession(normalized);
          return;
        }
        const retainVerified = isTransient(normalized) || error instanceof DiscoveryInconsistency;
        if (!retainVerified) options.queryClient.removeQueries({ queryKey: discoveryKey });
        update({
          ...state,
          stores: retainVerified ? state.stores : emptyStores,
          discoveryStatus: "error",
          discoveryError: normalized,
        });
      } finally {
        if (ticket === discoveryGeneration) {
          pendingDiscovery = null;
          discoveryAbort = null;
        }
      }
    });
    pendingDiscovery = task;
    update({ ...state, discoveryStatus: "loading", discoveryError: null });
    return task;
  }

  function loadContext(uuid: StoreUuid, preserve: boolean): Promise<void> {
    cancelContext();
    const ticket = contextGeneration;
    const controller = new AbortController();
    contextAbort = controller;
    const requestScope =
      preserve && state.scope
        ? state.scope
        : options.scope.setScope({ principalId, storeUuid: uuid });
    const previous = preserve ? state.context : null;
    const task = Promise.resolve().then(async () => {
      try {
        const context = await options.scope.run(
          requestScope,
          (signal) => options.api.loadStoreContext(uuid, signal),
          controller.signal,
        );
        if (stopped || ticket !== contextGeneration) return;
        let returnedUuid: StoreUuid;
        try {
          returnedUuid = parseStoreUuid(context.store.id.toLowerCase());
        } catch {
          throw new ApiError("invalid-response");
        }
        if (
          returnedUuid !== uuid ||
          context.store.status !== "active" ||
          context.membership.status !== "active"
        )
          throw new ApiError("invalid-response");
        const verified = freezeContext(context);
        options.queryClient.setQueryData(storeKeys.resource(requestScope, "context"), verified);
        update({
          ...state,
          selectedUuid: uuid,
          contextStatus: "ready",
          context: verified,
          contextError: null,
          scope: requestScope,
          refreshing: false,
        });
      } catch (error) {
        if (stopped || ticket !== contextGeneration) return;
        const normalized = normalizeUnexpectedError(error);
        if (isSessionLoss(normalized)) {
          loseSession(normalized);
          return;
        }
        if (previous && isTransient(normalized) && options.scope.getScope() === requestScope) {
          update({ ...state, contextStatus: "ready", contextError: normalized, refreshing: false });
          return;
        }
        options.scope.clearStore();
        update({
          ...state,
          contextStatus: "error",
          context: null,
          contextError: normalized,
          scope: null,
          refreshing: false,
        });
        if (normalized.kind === "forbidden" || normalized.kind === "not-found") {
          // A discovery started before the denial may contain older membership state.
          discoveryGeneration += 1;
          discoveryAbort?.abort();
          pendingDiscovery = null;
          await discover();
        }
      } finally {
        if (ticket === contextGeneration) {
          pendingContext = null;
          contextAbort = null;
        }
      }
    });
    pendingContext = task;
    update({
      ...state,
      selectedUuid: uuid,
      contextStatus: previous ? "ready" : "loading",
      context: previous,
      contextError: null,
      scope: requestScope,
      refreshing: !!previous,
    });
    return task;
  }

  function select(value: unknown): Promise<void> {
    if (stopped) return Promise.resolve();
    let uuid: StoreUuid;
    try {
      uuid = parseStoreUuid(typeof value === "string" ? value.toLowerCase() : value);
    } catch {
      cancelContext();
      options.scope.clearStore();
      update({
        ...state,
        selectedUuid: null,
        contextStatus: "error",
        context: null,
        contextError: new ApiError("not-found"),
        scope: null,
        refreshing: false,
      });
      return Promise.resolve();
    }
    if (state.selectedUuid === uuid) {
      if (pendingContext) return pendingContext;
      if (state.contextStatus === "ready" && state.scope === options.scope.getScope())
        return Promise.resolve();
    }
    return loadContext(uuid, false);
  }

  return {
    getSnapshot: (): StoreState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    discover,
    select,
    async revalidate(): Promise<void> {
      if (stopped) return;
      const contextTask = state.selectedUuid
        ? (pendingContext ??
          loadContext(
            state.selectedUuid,
            state.contextStatus === "ready" && state.scope === options.scope.getScope(),
          ))
        : Promise.resolve();
      await Promise.all([contextTask, discover()]);
    },
    leave(): void {
      if (stopped) return;
      cancelContext();
      options.scope.clearStore();
      update({
        ...state,
        selectedUuid: null,
        contextStatus: "idle",
        context: null,
        contextError: null,
        scope: null,
        refreshing: false,
      });
    },
    dispose(): void {
      // React can replay cleanup after synchronous authority loss already disposed this owner.
      // A second cleanup must not clear a replacement principal's newly established scope.
      if (stopped) {
        listeners.clear();
        return;
      }
      stopRequests();
      options.scope.clear();
      update(initialState());
      listeners.clear();
    },
  };
}

export type StoreController = ReturnType<typeof createStoreController>;
