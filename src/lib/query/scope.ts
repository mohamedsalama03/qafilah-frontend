import type { QueryClient } from "@tanstack/react-query";
import { abortable } from "../api/cancellation";
import { ApiError } from "../api/errors";
import { merchantKeys, parsePrincipalId, parseStoreUuid, type QueryScope } from "./keys";

/** A rendering/cache boundary only. Laravel must independently authorize every resource. */
export function createScopeController(queryClient: QueryClient) {
  let current: QueryScope | null = null;
  let generation = 0;
  let authority = new AbortController();

  function revoke(clearAll: boolean): void {
    generation += 1;
    authority.abort();
    authority = new AbortController();
    current = null;
    // Query cancellation marks requests cancelled synchronously; removal prevents old observers
    // from finding cached merchant data while cancellation settles.
    void queryClient.cancelQueries(clearAll ? {} : { queryKey: merchantKeys.all }, {
      silent: true,
    });
    if (clearAll) queryClient.clear();
    else {
      queryClient.removeQueries({ queryKey: merchantKeys.all });
      queryClient.getMutationCache().clear();
    }
  }

  function assertCurrent(scope: QueryScope): void {
    if (current !== scope || scope.revision !== generation) throw new ApiError("cancelled");
  }

  return {
    getScope: (): QueryScope | null => current,
    setScope(input: { principalId: unknown; storeUuid: unknown }): QueryScope {
      // An invalid destination must also stop the previous Store from remaining usable.
      revoke(false);
      const principalId = parsePrincipalId(input.principalId);
      const storeUuid = parseStoreUuid(input.storeUuid);
      current = Object.freeze({ principalId, storeUuid, revision: generation });
      return current;
    },
    /** Call synchronously at logout/session loss, before rendering another identity. */
    clear(): void {
      revoke(true);
    },
    assertCurrent,
    async run<T>(
      scope: QueryScope,
      operation: (signal: AbortSignal) => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      assertCurrent(scope);
      const controller = new AbortController();
      const authoritySignal = authority.signal;
      const abort = () => controller.abort();
      authoritySignal.addEventListener("abort", abort, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || authoritySignal.aborted) controller.abort();
      try {
        if (controller.signal.aborted) throw new ApiError("cancelled");
        const result = await abortable(operation(controller.signal), controller.signal);
        assertCurrent(scope);
        return result;
      } finally {
        authoritySignal.removeEventListener("abort", abort);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
