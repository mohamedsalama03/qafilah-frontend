import { validateApiOrigin } from "../env";
import { abortable } from "./cancellation";
import { hasAsciiControlCharacters } from "./control-characters";
import { ApiError, kindForStatus } from "./errors";
import type {
  ApiClientOptions,
  ContractEvidence,
  EndpointContract,
  RequestOptions,
  SafeErrorDetails,
} from "./types";

function requireEvidence(evidence: ContractEvidence | undefined): void {
  if (!evidence?.source.trim()) throw new ApiError("configuration");
}

function validateHeader(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(name)) throw new ApiError("configuration");
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new ApiError("configuration");
}

export function resolveApiUrl(apiOrigin: string, path: string): URL {
  // Never resolve arbitrary absolute/protocol-relative input with credentialed fetch.
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    hasAsciiControlCharacters(path, true)
  )
    throw new ApiError("configuration");
  const url = new URL(path, apiOrigin);
  if (url.origin !== apiOrigin || url.username || url.password || url.hash)
    throw new ApiError("configuration");
  return url;
}

export function createApiClient(options: ApiClientOptions) {
  const apiOrigin = validateApiOrigin(options.apiOrigin, options.mode);
  const fetcher = options.fetch ?? globalThis.fetch;
  const defaultTimeout = options.timeoutMs ?? 15_000;
  validateTimeout(defaultTimeout);
  if (options.csrf) {
    requireEvidence(options.csrf.evidence);
    validateHeader(options.csrf.headerName);
    if (
      !/^x-/i.test(options.csrf.headerName) ||
      /authorization|cookie|forwarded|host|origin/i.test(options.csrf.headerName)
    )
      throw new ApiError("configuration");
  }
  for (const header of [options.requestId, options.retryAfter]) {
    if (header) {
      requireEvidence(header.evidence);
      validateHeader(header.headerName);
    }
  }

  return {
    async request<Input, Output>(
      contract: EndpointContract<Input, Output>,
      input: Input,
      request: RequestOptions = {},
    ): Promise<Output> {
      requireEvidence(contract.evidence);
      const url = resolveApiUrl(apiOrigin, contract.path(input));
      const mutation = !["GET", "HEAD"].includes(contract.method);
      if (mutation && !options.csrf) throw new ApiError("configuration");
      if (!mutation && contract.body) throw new ApiError("configuration");
      const timeoutMs = request.timeoutMs ?? defaultTimeout;
      validateTimeout(timeoutMs);
      const controller = new AbortController();
      let timedOut = false;
      let sent = false;
      const abort = () => controller.abort();
      if (request.signal?.aborted) controller.abort();
      request.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        if (controller.signal.aborted) throw new ApiError("cancelled");
        const headers = new Headers({ Accept: "application/json" });
        if (mutation && options.csrf) {
          const token = await abortable(
            options.csrf.getToken(controller.signal),
            controller.signal,
          );
          if (
            typeof token !== "string" ||
            !token ||
            token.length > 8192 ||
            hasAsciiControlCharacters(token)
          )
            throw new ApiError("configuration");
          headers.set(options.csrf.headerName, token);
        }
        const body = contract.body ? JSON.stringify(contract.body(input)) : undefined;
        if (body !== undefined) headers.set("Content-Type", "application/json");
        if (controller.signal.aborted) throw new ApiError("cancelled");
        sent = true;
        const response = await abortable(
          fetcher(url, {
            method: contract.method,
            headers,
            body,
            credentials: "include",
            mode: "cors",
            redirect: "error",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          }),
          controller.signal,
        );
        const requestId = options.requestId
          ? (response.headers.get(options.requestId.headerName) ?? undefined)
          : undefined;
        let payload: unknown = undefined;
        const contentType = response.headers.get("content-type") ?? "";
        if (
          response.status !== 204 &&
          contract.method !== "HEAD" &&
          /\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType)
        ) {
          try {
            payload = await abortable(response.json(), controller.signal);
          } catch {
            if (controller.signal.aborted) throw new ApiError("cancelled");
            if (response.ok)
              throw new ApiError("invalid-response", {
                requestId,
                mutationOutcome: mutation ? "unknown" : "not-applicable",
              });
          }
        } else if (response.ok && response.status !== 204 && contract.method !== "HEAD") {
          throw new ApiError("invalid-response", {
            requestId,
            mutationOutcome: mutation ? "unknown" : "not-applicable",
          });
        }
        if (!response.ok) {
          let details: SafeErrorDetails = {};
          // Never expose arbitrary response.message, exception, SQL, paths, or stack traces.
          if ([409, 422].includes(response.status) && contract.decodeError) {
            try {
              details = contract.decodeError(payload, response.status);
            } catch {
              details = {};
            }
          }
          const retryHeader = options.retryAfter
            ? response.headers.get(options.retryAfter.headerName)
            : null;
          const retryAfterSeconds =
            retryHeader && /^\d{1,6}$/.test(retryHeader) ? Number(retryHeader) : undefined;
          throw new ApiError(kindForStatus(response.status), {
            status: response.status,
            details,
            requestId,
            retryAfterSeconds,
            mutationOutcome: mutation && response.status >= 500 ? "unknown" : "not-applicable",
          });
        }
        if (controller.signal.aborted) throw new ApiError("cancelled");
        try {
          return contract.decode(payload);
        } catch {
          throw new ApiError("invalid-response", {
            requestId,
            mutationOutcome: mutation ? "unknown" : "not-applicable",
          });
        }
      } catch (error) {
        if (controller.signal.aborted)
          throw new ApiError(timedOut ? "timeout" : "cancelled", {
            mutationOutcome: sent && mutation ? "unknown" : "not-applicable",
          });
        if (error instanceof ApiError) throw error;
        throw new ApiError("network", {
          mutationOutcome: sent && mutation ? "unknown" : "not-applicable",
        });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
      }
    },
  };
}
