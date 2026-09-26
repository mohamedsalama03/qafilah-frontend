// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMerchantApi } from "./client";
import { merchantContracts } from "./contracts";

const id = "11111111-1111-4111-8111-111111111111";
const store = { id, name: "Merchant Store", status: "active" };
const context = {
  store,
  membership: { id, status: "active" },
  role: { id, name: "Unrelated role label" },
  permissions: ["products.view"],
};
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: id },
  message: null,
});
const page = (entry: unknown) => ({
  ...envelope([entry]),
  meta: {
    request_id: id,
    pagination: { current_page: 1, per_page: 20, last_page: 1, total: 1 },
  },
});
const decodeContext = (data: unknown) => merchantContracts.context.decode(envelope(data));

describe("selected Store currency rollout compatibility", () => {
  it("accepts the published shape without inventing or defaulting currency", () => {
    const decoded = decodeContext(context);
    expect(decoded).toEqual(context);
    expect(Object.hasOwn(decoded.store, "currency")).toBe(false);
  });

  it.each(["LYD", "USD", "EUR", null])("preserves candidate currency %s", async (currency) => {
    const candidate = { ...context, store: { ...store, currency } };
    expect(decodeContext(candidate)).toEqual(candidate);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(envelope(candidate)), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = createMerchantApi({ apiOrigin: "https://api.example.test", fetch: fetcher });
    expect(await api.loadStoreContext(id)).toEqual(candidate);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      `https://api.example.test/api/v1/stores/${id}/context`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });

  it.each(["GBP", "", "lyd", " LYD ", "arbitrary", 1, true, {}, [], { code: "USD" }])(
    "rejects unsupported or malformed currency %j",
    (currency) =>
      expect(() => decodeContext({ ...context, store: { ...store, currency } })).toThrow(),
  );

  it.each([undefined, "LYD", "USD", "EUR", null])(
    "keeps selected context strict with currency %s",
    (currency) => {
      const selected = { ...store, ...(currency === undefined ? {} : { currency }) };
      expect(() => decodeContext({ ...context, store: { ...selected, owner_id: id } })).toThrow();
      for (const key of ["id", "name", "status"] as const) {
        const missing: Record<string, unknown> = { ...selected };
        delete missing[key];
        expect(() => decodeContext({ ...context, store: missing })).toThrow();
      }
      for (const key of ["store", "membership", "role", "permissions"] as const) {
        const missing: Record<string, unknown> = { ...context, store: selected };
        delete missing[key];
        expect(() => decodeContext(missing)).toThrow();
      }
    },
  );

  it("keeps discovery exactly id, name, status", () => {
    expect(merchantContracts.stores.decode(page(store)).stores).toEqual([store]);
    for (const currency of ["LYD", "USD", "EUR", null]) {
      expect(() => merchantContracts.stores.decode(page({ ...store, currency }))).toThrow();
    }
    expect(() => merchantContracts.stores.decode(page({ ...store, extra: true }))).toThrow();
    for (const key of ["id", "name", "status"] as const) {
      const missing: Record<string, unknown> = { ...store };
      delete missing[key];
      expect(() => merchantContracts.stores.decode(page(missing))).toThrow();
    }
  });
});
