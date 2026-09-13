import { abortable } from "../api/cancellation";
import { ApiError, normalizeUnexpectedError } from "../api/errors";
import { parsePrincipalId, type PrincipalId } from "../query/keys";

/** Internal view of identity. An eventual adapter maps a reviewed DTO into this shape. */
export interface AuthPrincipal {
  readonly principalId: PrincipalId;
}

export type AuthState =
  | { readonly status: "unavailable" }
  | { readonly status: "bootstrapping" }
  | {
      readonly status: "unauthenticated";
      readonly reason: "signed-out" | "expired" | "not-signed-in";
    }
  | { readonly status: "authenticated"; readonly principal: AuthPrincipal }
  | { readonly status: "error"; readonly error: ApiError };

export interface AuthAdapter {
  /** All implementations must call reviewed contracts through the central transport. */
  loadIdentity: (signal: AbortSignal) => Promise<{ principalId: unknown } | null>;
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
      if (pendingBootstrap) return pendingBootstrap;
      const ticket = revoke();
      const controller = new AbortController();
      requestController = controller;
      update({ status: "bootstrapping" });
      const adapter = options.adapter;
      const task = (async () => {
        try {
          const identity = await abortable(
            Promise.resolve().then(() => adapter.loadIdentity(controller.signal)),
            controller.signal,
          );
          if (ticket !== generation) return;
          let principalId: PrincipalId | undefined;
          if (identity) {
            try {
              principalId = parsePrincipalId(identity.principalId);
            } catch {
              throw new ApiError("invalid-response");
            }
          }
          update(
            principalId
              ? { status: "authenticated", principal: Object.freeze({ principalId }) }
              : { status: "unauthenticated", reason: "not-signed-in" },
          );
        } catch (error) {
          if (ticket !== generation) return;
          const normalized = normalizeUnexpectedError(error);
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
      const ticket = revoke();
      if (!options.adapter) {
        update({ status: "unavailable" });
        return Promise.resolve();
      }
      const controller = new AbortController();
      requestController = controller;
      update({ status: "bootstrapping" });
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
            update({ status: "error", error: normalizeUnexpectedError(error) });
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
      revoke();
      // Permissions are never retained after a 403. A verified adapter must refresh authority.
      update(
        error.kind === "forbidden"
          ? { status: "error", error }
          : { status: "unauthenticated", reason: "expired" },
      );
    },
    /** Hide private UI during page suspension without claiming that the server signed out. */
    suspend(): void {
      // Hiding a tab must not abort an in-progress server logout.
      if (pendingLogout) {
        options.onAuthorityLost?.();
        update({ status: "bootstrapping" });
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
