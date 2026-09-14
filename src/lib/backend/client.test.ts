// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createAuthController } from "../auth/controller";
import { createMerchantApi } from "./client";

const principal = "8f4f4b30-e590-4a6c-b29f-081cfef0d046";
const storeId = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
const requestId = "c2a725d8-bbc4-4258-9164-f3f16f07a14f";
const credentials = { email: "MERCHANT@example.test", password: "Synthetic!Only123" };
const user = {
  id: principal,
  name: "Merchant",
  email: "merchant@example.test",
  status: "active",
  email_verified_at: null,
  created_at: "2026-09-14T01:02:03+00:00",
  updated_at: null,
};
const store = { id: storeId, name: "Merchant Store", status: "active" };
const context = {
  store,
  membership: { id: principal, status: "active" },
  role: { id: requestId, name: "Merchant role" },
  permissions: ["orders.view", "products.view"],
};
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: requestId },
  message: null,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const failure = (status: number, errors: unknown = {}) =>
  json(
    {
      success: false,
      data: null,
      meta: { request_id: requestId },
      message: "Private server error must never be displayed",
      errors,
    },
    status,
  );
const csrf = () => new Response(null, { status: 204 });
const logout = () => json({ ...envelope([]), message: "Logged out successfully." });
const page = (
  data: unknown[] = [store],
  pagination = { current_page: 1, per_page: 20, last_page: 1, total: data.length },
) => ({
  ...envelope(data),
  meta: { request_id: requestId, pagination },
});
const setup = (fetcher = vi.fn<typeof fetch>()) => ({
  fetcher,
  api: createMerchantApi({
    apiOrigin: "https://api.example.test",
    fetch: fetcher,
    readCookie: () => "preference=safe; XSRF-TOKEN=encrypted%2Bcookie%3D",
  }),
});
const paths = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname);

describe("six verified Merchant contracts", () => {
  it("logs in once after CSRF and confirms actual identity with cookie credentials", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(json(envelope(user)))
      .mockResolvedValueOnce(json(envelope(user)));
    const first = api.login(credentials);
    expect(api.login(credentials)).toBe(first);
    await first;
    expect(paths(fetcher)).toEqual(["/sanctum/csrf-cookie", "/api/v1/auth/login", "/api/v1/me"]);
    const loginRequest = fetcher.mock.calls[1]![1]!;
    expect(JSON.parse(String(loginRequest.body))).toEqual(credentials);
    expect(new Headers(loginRequest.headers).get("X-XSRF-TOKEN")).toBe("encrypted+cookie=");
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        mode: "cors",
      });
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    }
    expect(fetcher.mock.calls[2]![1]?.body).toBeUndefined();
  });
  it("maps only minimized current identity metadata and permits unverified active identity", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(envelope(user)));
    expect(await api.authAdapter.loadIdentity(new AbortController().signal)).toEqual({
      principalId: principal,
      displayName: "Merchant",
      emailVerified: false,
    });
  });
  it("uses authoritative401 for anonymous identity", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(failure(401));
    expect(await api.authAdapter.loadIdentity(new AbortController().signal)).toBeNull();
  });
  it("maps only reviewed login validation fields with body request ID despite unexposed headers", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(
      failure(422, {
        email: ["The provided credentials are incorrect."],
        password: ["SQLSTATE secret"],
        other: ["not reviewed"],
      }),
    );
    await expect(api.login(credentials)).rejects.toMatchObject({
      kind: "validation",
      status: 422,
      requestId,
      fieldErrors: { email: ["The provided credentials are incorrect."], password: [] },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([419, 429])("does not replay a login rejected with%s", async (status) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure(status));
    await expect(api.login(credentials)).rejects.toMatchObject({
      status,
      requestId,
      retryAfterSeconds: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reconciles a lost login response without resending credentials", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(csrf())
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(json(envelope(user)));
    await api.login(credentials);
    expect(paths(fetcher)).toEqual(["/sanctum/csrf-cookie", "/api/v1/auth/login", "/api/v1/me"]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it.each(["anonymous", "different-identity", "network"])(
    "does not claim login after unknown result and%s reconciliation",
    async (outcome) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(csrf()).mockRejectedValueOnce(new TypeError("lost"));
      if (outcome === "network") fetcher.mockRejectedValueOnce(new TypeError("offline"));
      else
        fetcher.mockResolvedValueOnce(
          outcome === "anonymous"
            ? failure(401)
            : json(envelope({ ...user, email: "other@example.test" })),
        );
      await expect(api.login(credentials)).rejects.toMatchObject({
        kind: "network",
        mutationOutcome: "unknown",
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );
  it("rejects a success login whose current principal differs", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(json(envelope(user)))
      .mockResolvedValueOnce(json(envelope({ ...user, id: storeId })));
    await expect(api.login(credentials)).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("does not reconcile cancelled login or begin requests after cancellation", async () => {
    const { api, fetcher } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(api.login(credentials, controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["", "XSRF-TOKEN=%ZZ", "XSRF-TOKEN=a; XSRF-TOKEN=b", "XSRF-TOKEN=%0D%0A"])(
    "refuses missing or ambiguous CSRF cookie%s",
    async (cookie) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(csrf());
      const api = createMerchantApi({
        apiOrigin: "https://api.example.test",
        fetch: fetcher,
        readCookie: () => cookie,
      });
      await expect(api.login(credentials)).rejects.toMatchObject({ kind: "configuration" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("performs fresh CSRF and one logout mutation on successful remote termination", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(logout());
    await api.authAdapter.logout(new AbortController().signal);
    expect(paths(fetcher)).toEqual(["/sanctum/csrf-cookie", "/api/v1/auth/logout"]);
    expect(fetcher.mock.calls[1]![1]?.body).toBeUndefined();
  });
  it("recognizes already-ended logout only after a second authoritative401", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(failure(401))
      .mockResolvedValueOnce(failure(401));
    await api.authAdapter.logout(new AbortController().signal);
    expect(paths(fetcher)).toEqual(["/sanctum/csrf-cookie", "/api/v1/auth/logout", "/api/v1/me"]);
  });
  it("preserves failed logout through focus when401 confirmation is lost and retries logout explicitly", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(json(envelope(user)))
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(failure(401))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(logout());
    const purge = vi.fn();
    const auth = createAuthController({ adapter: api.authAdapter, onAuthorityLost: purge });
    await auth.bootstrap();
    await auth.logout();
    expect(auth.getSnapshot()).toMatchObject({
      status: "logout-failed",
      error: { kind: "network" },
    });
    expect(purge).toHaveBeenCalledTimes(1);
    await auth.bootstrap();
    expect(fetcher).toHaveBeenCalledTimes(4);
    await auth.logout();
    expect(auth.getSnapshot()).toEqual({ status: "unauthenticated", reason: "signed-out" });
  });
  it("does not disguise failed server logout as local success", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure(500));
    await expect(api.authAdapter.logout(new AbortController().signal)).rejects.toMatchObject({
      kind: "server",
      requestId,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("consumes a bodyless paginated discovery and bodyless context request", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(
        json(page([], { current_page: 3, per_page: 20, last_page: 2, total: 21 })),
      )
      .mockResolvedValueOnce(json(envelope(context)));
    expect(await api.listStoresPage(3)).toMatchObject({
      stores: [],
      pagination: { total: 21, current_page: 3 },
    });
    expect(await api.loadStoreContext(storeId)).toEqual(context);
    expect(new URL(String(fetcher.mock.calls[0]![0])).search).toBe("?page=3");
    for (const [, init] of fetcher.mock.calls) expect(init?.body).toBeUndefined();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid page%s before request",
    async (value) => {
      const { api, fetcher } = setup();
      await expect(api.listStoresPage(value)).rejects.toMatchObject({ kind: "configuration" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["../me", "not-uuid", "//attacker.test", "00000000-0000-9000-0000-000000000000"])(
    "rejects invalid Store route%s before request",
    async (value) => {
      const { api, fetcher } = setup();
      await expect(api.loadStoreContext(value)).rejects.toMatchObject({ kind: "configuration" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects response context for another Store", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      json(envelope({ ...context, store: { ...store, id: principal } })),
    );
    await expect(api.loadStoreContext(storeId)).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it.each([403, 404])(
    "preserves context-specific%s without affecting global authenticated identity",
    async (status) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(json(envelope(user))).mockResolvedValueOnce(failure(status));
      const auth = createAuthController({ adapter: api.authAdapter });
      await auth.bootstrap();
      const current = auth.getSnapshot();
      await expect(api.loadStoreContext(storeId)).rejects.toMatchObject({ status, requestId });
      expect(auth.getSnapshot()).toBe(current);
    },
  );
  it("never prints raw errors from an unrecognized envelope", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      json({ message: "SQLSTATE /var/www/private", meta: { request_id: "<private>" } }, 500),
    );
    const error = await api.listStoresPage(1).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).not.toMatch(/SQLSTATE|private/);
    expect(error).toMatchObject({ requestId: undefined });
  });
});

describe("strict authority decoding", () => {
  it.each([
    { ...user, status: "suspended" },
    { ...user, id: "123" },
    { ...user, name: "" },
    { ...user, email_verified_at: "yesterday" },
    { ...user, extra: "authority" },
  ])("rejects malformed or expanded User authority%j", async (data) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(envelope(data)));
    await expect(api.authAdapter.loadIdentity(new AbortController().signal)).rejects.toMatchObject({
      kind: "invalid-response",
      requestId,
    });
  });
  it.each([
    { ...context, permissions: ["*"] },
    { ...context, permissions: ["orders.view", "orders.view"] },
    { ...context, permissions: ["products.view", "orders.view"] },
    { ...context, role: { ...context.role, admin: true } },
    { ...context, membership: { ...context.membership, status: "suspended" } },
  ])("rejects unsafe context%j", async (data) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(envelope(data)));
    await expect(api.loadStoreContext(storeId)).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("accepts zero explicit grants without inventing authority from an Owner label", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      json(envelope({ ...context, role: { ...context.role, name: "Owner" }, permissions: [] })),
    );
    expect((await api.loadStoreContext(storeId)).permissions).toEqual([]);
  });
  it.each([
    page([store, store]),
    page([], { current_page: 1, per_page: 20, last_page: 3, total: 0 }),
    page([], { current_page: 2, per_page: 20, last_page: 1, total: 0 }),
    page([], { current_page: 1, per_page: 21, last_page: 1, total: 0 }),
  ])("rejects duplicate or contradictory discovery pagination%j", async (data) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(data));
    await expect(api.listStoresPage(1)).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
