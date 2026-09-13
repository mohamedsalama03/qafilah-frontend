// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, resolveApiUrl } from "./client";
import { ApiError, readLaravelValidationErrors } from "./errors";
import type { EndpointContract, HttpMethod } from "./types";

const origin = "https://api.example.test";
const evidence = { source: "Unit test contract fixture; no production endpoint" };
const endpoint = (method: HttpMethod = "GET"): EndpointContract<void, unknown> => ({
  evidence,
  method,
  path: () => "/test-contract",
  decode: (value) => value,
});
const csrf = { evidence, headerName: "X-Test-CSRF", getToken: async () => "test-csrf-value" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("credentialed transport boundary", () => {
  it.each([
    "https://attacker.test/path",
    "//attacker.test/path",
    "/\\attacker.test",
    "/\n/attacker.test",
    "/path#fragment",
    "relative-path",
  ])("refuses unsafe paths %s before fetch", async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher });
    await expect(api.request({ ...endpoint(), path: () => path }, undefined)).rejects.toMatchObject(
      { kind: "configuration" },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("resolves only an exact-origin relative request", () => {
    expect(resolveApiUrl(origin, "/test-contract?page=2").href).toBe(
      `${origin}/test-contract?page=2`,
    );
  });
  it("sends cookies with explicit no-redirect/no-cache policy and no auth header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher });
    await api.request(endpoint(), undefined);
    const options = fetcher.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
      referrerPolicy: "no-referrer",
    });
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires reviewed contract evidence and explicit CSRF configuration before mutation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher });
    await expect(api.request(endpoint("POST"), undefined)).rejects.toMatchObject({
      kind: "configuration",
    });
    await expect(
      api.request({ ...endpoint(), evidence: { source: "" } }, undefined),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("acquires only the explicitly configured CSRF token for writes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ accepted: true }));
    const getToken = vi.fn(csrf.getToken);
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher, csrf: { ...csrf, getToken } });
    await api.request({ ...endpoint("POST"), body: () => ({ label: "Example" }) }, undefined);
    const options = fetcher.mock.calls[0]?.[1];
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(new Headers(options?.headers).get("X-Test-CSRF")).toBe("test-csrf-value");
    expect(options?.body).toBe('{"label":"Example"}');
  });
  it.each<HttpMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])(
    "never emits Authorization or Bearer credentials for configured %s requests",
    async (method) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
      const api = createApiClient({ apiOrigin: origin, fetch: fetcher, csrf });
      await api.request(endpoint(method), undefined);
      const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
      expect(headers.has("Authorization")).toBe(false);
      for (const [name, value] of headers) {
        expect(name.toLowerCase()).not.toBe("authorization");
        expect(value).not.toMatch(/^Bearer\s/i);
      }
      if (!["GET", "HEAD"].includes(method))
        expect(headers.get(csrf.headerName)).toBe("test-csrf-value");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["Authorization", "Cookie", "X-Forwarded-Host", "Origin", "Bad\r\nHeader"])(
    "rejects unsafe CSRF header %s",
    (headerName) => {
      expect(() => createApiClient({ apiOrigin: origin, csrf: { ...csrf, headerName } })).toThrow(
        ApiError,
      );
    },
  );
});

describe("safe response normalization", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [419, "session-expired"],
    [422, "validation"],
    [429, "rate-limited"],
    [500, "server"],
    [503, "server"],
  ])("distinguishes %i without disclosing error payloads", async (status, kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json(
          { message: "SQLSTATE secret", exception: "/var/www/secrets", trace: "private" },
          Number(status),
          { "X-Test-Request": "req-123" },
        ),
      );
    const api = createApiClient({
      apiOrigin: origin,
      fetch: fetcher,
      requestId: { evidence, headerName: "X-Test-Request" },
    });
    try {
      await api.request(endpoint(), undefined);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toMatchObject({ kind, status, requestId: "req-123" });
      expect(String(error)).not.toMatch(/SQLSTATE|secrets|private/);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("maps only reviewed validation fields and drops unsafe messages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          errors: {
            title: ["The title is required."],
            unknown: ["secret"],
            internal: ["SQLSTATE private"],
          },
          message: "private",
        },
        422,
      ),
    );
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher, csrf });
    await expect(
      api.request(
        {
          ...endpoint("POST"),
          decodeError: (value) => readLaravelValidationErrors(value, ["title", "internal"]),
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      kind: "validation",
      fieldErrors: { title: ["The title is required."], internal: [] },
      formErrors: [],
    });
  });
  it("retains a bounded reviewed rate-limit hint without retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 429, { "Retry-After": "60" }));
    const api = createApiClient({
      apiOrigin: origin,
      fetch: fetcher,
      retryAfter: { evidence, headerName: "Retry-After" },
    });
    await expect(api.request(endpoint(), undefined)).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 60,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not read undeclared request-ID headers", async () => {
    const api = createApiClient({
      apiOrigin: origin,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({}, 500, { "X-Request-ID": "private" })),
    });
    await expect(api.request(endpoint(), undefined)).rejects.toMatchObject({
      requestId: undefined,
    });
  });
  it("does not expose HTML error pages and rejects HTML success envelopes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<pre>secrets</pre>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html>login</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher });
    await expect(api.request(endpoint(), undefined)).rejects.toMatchObject({ kind: "server" });
    await expect(api.request(endpoint(), undefined)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });
  it("normalizes schema failure without leaking rejected data", async () => {
    const api = createApiClient({
      apiOrigin: origin,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ private: "data" })),
    });
    await expect(
      api.request(
        {
          ...endpoint(),
          decode: () => {
            throw new Error("private data");
          },
        },
        undefined,
      ),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("supports reviewed domain validation without exposing a raw backend message", async () => {
    const api = createApiClient({
      apiOrigin: origin,
      csrf,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ message: "private backend detail" }, 422)),
    });
    await expect(
      api.request(
        {
          ...endpoint("POST"),
          decodeError: () => ({ formErrors: ["Refresh this resource before submitting."] }),
        },
        undefined,
      ),
    ).rejects.toMatchObject({ formErrors: ["Refresh this resource before submitting."] });
  });
  it("treats an undecodable mutation response as unknown outcome and retains safe support ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not JSON", {
        headers: { "Content-Type": "application/json", "X-Test-Request": "req-123" },
      }),
    );
    const api = createApiClient({
      apiOrigin: origin,
      csrf,
      fetch: fetcher,
      requestId: { evidence, headerName: "X-Test-Request" },
    });
    await expect(api.request(endpoint("POST"), undefined)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "unknown",
      requestId: "req-123",
    });
  });
});

describe("cancellation and unknown mutation outcome", () => {
  it("never automatically retries a lost mutation response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network details"));
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher, csrf });
    await expect(api.request(endpoint("POST"), undefined)).rejects.toMatchObject({
      kind: "network",
      mutationOutcome: "unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a timeout even when fetch ignores abort and returns late", async () => {
    vi.useFakeTimers();
    let finish: (value: Response) => void = () => {
      throw new Error("No fetch");
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher, csrf, timeoutMs: 10 });
    const pending = api.request(endpoint("POST"), undefined);
    const result = expect(pending).rejects.toMatchObject({
      kind: "timeout",
      mutationOutcome: "unknown",
    });
    await vi.advanceTimersByTimeAsync(11);
    await result;
    finish(json({ stale: true }));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not send a request with an already-aborted signal", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const signal = AbortSignal.abort();
    const api = createApiClient({ apiOrigin: origin, fetch: fetcher });
    await expect(api.request(endpoint(), undefined, { signal })).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels CSRF acquisition without submitting a mutation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const api = createApiClient({
      apiOrigin: origin,
      fetch: fetcher,
      csrf: { ...csrf, getToken: () => new Promise<string>(() => {}) },
    });
    const pending = api.request(endpoint("POST"), undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      kind: "cancelled",
      mutationOutcome: "not-applicable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
