import { abortable } from "../api/cancellation";
import { ApiError, normalizeUnexpectedError } from "../api/errors";
import { parsePrincipalId, type PrincipalId } from "../query/keys";
import { hasAsciiControlCharacters } from "../api/control-characters";

/** Minimized identity metadata; only principalId determines cache isolation. */
export interface AuthPrincipal {
  readonly principalId: PrincipalId;
  readonly displayName?: string;
  readonly emailVerified?: boolean;
}

export type AuthState =
  | { readonly status: "unavailable" }
  | { readonly status: "bootstrapping" }
  | {
      readonly status: "unauthenticated";
      readonly reason: "signed-out" | "expired" | "not-signed-in";
    }
  | {
      readonly status: "authenticated";
      readonly principal: AuthPrincipal;
      readonly revalidation?:
        { readonly status: "pending" } | { readonly status: "error"; readonly error: ApiError };
    }
  | { readonly status: "logging-out" }
  | { readonly status: "logout-failed"; readonly error: ApiError }
  | { readonly status: "error"; readonly error: ApiError };

export interface AuthAdapter {
  /** All implementations must call reviewed contracts through the central transport. */
  loadIdentity: (signal: AbortSignal) => Promise<{
    principalId: unknown;
    displayName?: string;
    emailVerified?: boolean;
  } | null>;
  logout: (signal: AbortSignal) => Promise<void>;
}

export interface AuthControllerOptions {
  adapter?: AuthAdapter;
  /** Must synchronously hide/purge identity and tenant cache when authority is lost. */
  onAuthorityLost?: () => void;
}

export function createAuthController(options: AuthControllerOptions = {}) {
  let state: AuthState = Object.freeze({
    status: options.adapter ? "bootstrapping" : "unavailable",
  });
  let generation = 0;
  let requestController: AbortController | null = null;
  let pendingBootstrap: Promise<void> | null = null;
  let pendingLogout: Promise<void> | null = null;
  // This intent is deliberately memory-only. A new document must verify remote identity afresh.
  let logoutRequested = false;
  const listeners = new Set<() => void>();

  function update(next: AuthState): void {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function revoke(): number {
    generation += 1;
    requestController?.abort();
    requestController = null;
    pendingBootstrap = null;
    options.onAuthorityLost?.();
    return generation;
  }

  return {
    getSnapshot: (): AuthState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bootstrap(): Promise<void> {
      if (!options.adapter) {
        update({ status: "unavailable" });
        return Promise.resolve();
      }
      if (pendingLogout) return pendingLogout;
      if (logoutRequested) return Promise.resolve();
      if (pendingBootstrap) return pendingBootstrap;
      const previous = state.status === "authenticated" ? state : undefined;
      const ticket = ++generation;
      const controller = new AbortController();
      requestController = controller;
      update(
        previous
          ? {
              status: "authenticated",
              principal: previous.principal,
              revalidation: { status: "pending" },
            }
          : { status: "bootstrapping" },
      );
      const adapter = options.adapter;
      const task = (async () => {
        try {
          const identity = await abortable(
            Promise.resolve().then(() => adapter.loadIdentity(controller.signal)),
            controller.signal,
          );
          if (ticket !== generation) return;
          let principalId: PrincipalId | undefined;
          let principal: AuthPrincipal | undefined;
          if (identity) {
            try {
              principalId = parsePrincipalId(identity.principalId);
              if (
                (identity.displayName !== undefined &&
                  (typeof identity.displayName !== "string" ||
                    !identity.displayName.trim() ||
                    identity.displayName.length > 255 ||
                    hasAsciiControlCharacters(identity.displayName))) ||
                (identity.emailVerified !== undefined &&
                  typeof identity.emailVerified !== "boolean")
              )
                throw new ApiError("invalid-response");
              const nextPrincipal = Object.freeze({
                principalId,
                ...(identity.displayName === undefined
                  ? {}
                  : { displayName: identity.displayName }),
                ...(identity.emailVerified === undefined
                  ? {}
                  : { emailVerified: identity.emailVerified }),
              });
              principal =
                previous?.principal.principalId === principalId &&
                previous.principal.displayName === nextPrincipal.displayName &&
                previous.principal.emailVerified === nextPrincipal.emailVerified
                  ? previous.principal
                  : nextPrincipal;
            } catch {
              throw new ApiError("invalid-response");
            }
          }
          if (!principalId || (previous && principalId !== previous.principal.principalId))
            revoke();
          update(
            principal
              ? {
                  status: "authenticated",
                  principal,
                }
              : { status: "unauthenticated", reason: previous ? "expired" : "not-signed-in" },
          );
        } catch (error) {
          if (ticket !== generation) return;
          const normalized = normalizeUnexpectedError(error);
          if (
            previous &&
            ["network", "server", "timeout", "rate-limited"].includes(normalized.kind)
          ) {
            update({
              status: "authenticated",
              principal: previous.principal,
              revalidation: { status: "error", error: normalized },
            });
            return;
          }
          revoke();
          if (["unauthenticated", "session-expired"].includes(normalized.kind))
            update({ status: "unauthenticated", reason: "expired" });
          else update({ status: "error", error: normalized });
        } finally {
          if (ticket === generation) {
            pendingBootstrap = null;
            requestController = null;
          }
        }
      })();
      pendingBootstrap = task;
      return task;
    },
    logout(): Promise<void> {
      if (pendingLogout) return pendingLogout;
      logoutRequested = true;
      const ticket = revoke();
      if (!options.adapter) {
        update({ status: "unavailable" });
        return Promise.resolve();
      }
      const controller = new AbortController();
      requestController = controller;
      update({ status: "logging-out" });
      const adapter = options.adapter;
      const task = (async () => {
        try {
          await abortable(
            Promise.resolve().then(() => adapter.logout(controller.signal)),
            controller.signal,
          );
          if (ticket === generation) update({ status: "unauthenticated", reason: "signed-out" });
        } catch (error) {
          if (ticket === generation)
            update({ status: "logout-failed", error: normalizeUnexpectedError(error) });
        } finally {
          if (ticket === generation) requestController = null;
          pendingLogout = null;
        }
      })();
      pendingLogout = task;
      return task;
    },
    handleApiError(error: ApiError): void {
      if (!["unauthenticated", "session-expired", "forbidden"].includes(error.kind)) return;
      // A stale request must not replace the explicit, unconfirmed logout state.
      if (logoutRequested) return;
      revoke();
      // Permissions are never retained after a 403. A verified adapter must refresh authority.
      update(
        error.kind === "forbidden"
          ? { status: "error", error }
          : { status: "unauthenticated", reason: "expired" },
      );
    },
    /** Pagehide/external invalidation only: ordinary tab visibility is not authority loss. */
    suspend(): void {
      // Page suspension must not abort remote logout or erase its unconfirmed result.
      if (logoutRequested) {
        options.onAuthorityLost?.();
        return;
      }
      revoke();
      update({ status: options.adapter ? "bootstrapping" : "unavailable" });
    },
    dispose(): void {
      revoke();
      listeners.clear();
    },
  };
}
