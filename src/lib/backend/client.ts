import { createApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import type { AuthAdapter } from "../auth/controller";
import { parseStoreUuid } from "../query/keys";
import {
  csrfEvidence,
  merchantContracts,
  readRequestId,
  requestIdEvidence,
  type LoginCredentials,
  type MerchantIdentity,
} from "./contracts";

export interface MerchantApiOptions {
  apiOrigin: string;
  mode?: "production" | "development" | "test";
  fetch?: typeof globalThis.fetch;
  /** Test seam for the readable CSRF cookie only; no cookie value is persisted. */
  readCookie?: () => string;
}

function readCsrfCookie(readCookie: () => string): string {
  const cookies = readCookie()
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith("XSRF-TOKEN="));
  if (cookies.length !== 1) throw new ApiError("configuration");
  try {
    return decodeURIComponent(cookies[0]!.slice("XSRF-TOKEN=".length));
  } catch {
    throw new ApiError("configuration");
  }
}

export function createMerchantApi(options: MerchantApiOptions) {
  const readCookie =
    options.readCookie ?? (() => (typeof document === "undefined" ? "" : document.cookie));
  const api = createApiClient({
    apiOrigin: options.apiOrigin,
    mode: options.mode,
    fetch: options.fetch,
    requestIdFromBody: { evidence: requestIdEvidence, decode: readRequestId },
    csrf: {
      evidence: csrfEvidence,
      headerName: "X-XSRF-TOKEN",
      getToken: async () => readCsrfCookie(readCookie),
    },
  });
  let pendingLogin: Promise<void> | null = null;

  const identity = (signal?: AbortSignal) =>
    api.request(merchantContracts.identity, undefined, { signal });
  const prepareCsrf = (signal?: AbortSignal) =>
    api.request(merchantContracts.csrf, undefined, { signal });

  async function confirmLogin(
    credentials: LoginCredentials,
    signal?: AbortSignal,
    expected?: MerchantIdentity,
  ) {
    const current = await identity(signal);
    if (
      current.email !== credentials.email.trim().toLowerCase() ||
      (expected && current.id !== expected.id)
    )
      throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
  }

  const authAdapter: AuthAdapter = {
    async loadIdentity(signal) {
      try {
        const current = await identity(signal);
        return {
          principalId: current.id,
          displayName: current.name,
          emailVerified: current.email_verified_at !== null,
        };
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthenticated") return null;
        throw error;
      }
    },
    async logout(signal) {
      // Each explicit attempt gets fresh CSRF, including retry after a lost success response.
      await prepareCsrf(signal);
      try {
        await api.request(merchantContracts.logout, undefined, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthenticated") {
          try {
            await identity(signal);
          } catch (confirmation) {
            if (confirmation instanceof ApiError && confirmation.kind === "unauthenticated") return;
            throw confirmation;
          }
        }
        throw error;
      }
    },
  };

  return {
    authAdapter,
    login(credentials: LoginCredentials, signal?: AbortSignal): Promise<void> {
      if (pendingLogin) return pendingLogin;
      const input = { email: credentials.email, password: credentials.password };
      const task = (async () => {
        await prepareCsrf(signal);
        let expected: MerchantIdentity;
        try {
          expected = await api.request(merchantContracts.login, input, { signal });
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.mutationOutcome === "unknown" &&
            error.kind !== "cancelled"
          ) {
            // A lost response may already have established a session. Never replay credentials.
            try {
              await confirmLogin(input, signal);
              return;
            } catch {
              throw error;
            }
          }
          throw error;
        }
        await confirmLogin(input, signal, expected);
      })();
      pendingLogin = task;
      void task
        .finally(() => {
          if (pendingLogin === task) pendingLogin = null;
        })
        .catch(() => {});
      return task;
    },
    async listStoresPage(page: number, signal?: AbortSignal) {
      if (!Number.isSafeInteger(page) || page < 1) throw new ApiError("configuration");
      const result = await api.request(merchantContracts.stores, page, { signal });
      if (result.pagination.current_page !== page) throw new ApiError("invalid-response");
      return result;
    },
    async loadStoreContext(storeUuid: string, signal?: AbortSignal) {
      // UUID parsing only limits request syntax; the server must establish Membership authority.
      try {
        parseStoreUuid(storeUuid);
      } catch {
        throw new ApiError("configuration");
      }
      const result = await api.request(merchantContracts.context, storeUuid, { signal });
      if (result.store.id.toLowerCase() !== storeUuid.toLowerCase())
        throw new ApiError("invalid-response");
      return result;
    },
  };
}

export type MerchantApi = ReturnType<typeof createMerchantApi>;
