// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMerchantApi } from "@/lib/backend/client";
import { merchantContracts } from "@/lib/backend/contracts";
import { decodeVariantInventory, type UpdateVariantInventoryInput } from "./contracts";

const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "22222222-2222-4222-8222-222222222222";
const variantUuid = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const input = { storeUuid, productUuid, variantUuid, data: { quantity: 5 } };
const inventory = { quantity: 5, availability: "in_stock" };
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: requestId },
  message: null,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const csrf = () => new Response(null, { status: 204 });
const expectedPath = `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}/variants/${variantUuid}/inventory`;
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  const api = createMerchantApi({
    apiOrigin: "https://api.example.test",
    fetch: fetcher,
    readCookie: () => "XSRF-TOKEN=synthetic",
  });
  return { api, fetcher };
}

describe("published Variant inventory contracts", () => {
  it("registers only the two confirmed nested inventory contracts", () => {
    expect(Object.keys(merchantContracts)).toHaveLength(35);
    expect(Object.keys(merchantContracts).filter((key) => /variantinventory/i.test(key))).toEqual([
      "variantInventory",
      "updateVariantInventory",
    ]);
    expect(merchantContracts.variantInventory.method).toBe("GET");
    expect(merchantContracts.updateVariantInventory.method).toBe("PATCH");
    for (const key of ["variantInventory", "updateVariantInventory"] as const) {
      expect(merchantContracts[key].path(input)).toBe(expectedPath);
      expect(merchantContracts[key].evidence.source).toContain(
        "7cd52e549c2a657dc66643b36701356d1d024de5",
      );
    }
    expect(merchantContracts.variantInventory).not.toHaveProperty("body");
    expect(merchantContracts.updateVariantInventory.body(input)).toEqual({ quantity: 5 });
  });

  it.each([
    { quantity: null, availability: "unavailable" },
    { quantity: 0, availability: "out_of_stock" },
    { quantity: 1, availability: "in_stock" },
    { quantity: 2_000_000_000, availability: "in_stock" },
  ])("decodes quantity and availability %j", (value) => {
    expect(decodeVariantInventory(envelope(value))).toEqual(value);
  });

  it.each([
    { quantity: null, availability: "out_of_stock" },
    { quantity: null, availability: "in_stock" },
    { quantity: 0, availability: "unavailable" },
    { quantity: 0, availability: "in_stock" },
    { quantity: 5, availability: "out_of_stock" },
    { quantity: 5, availability: "unavailable" },
    { quantity: "5", availability: "in_stock" },
    { quantity: -1, availability: "in_stock" },
    { quantity: 1.5, availability: "in_stock" },
    { quantity: 2_000_000_001, availability: "in_stock" },
    { quantity: 5, availability: "available" },
    { ...inventory, variant_id: variantUuid },
    { ...inventory, product_id: productUuid },
    { ...inventory, version: 1 },
    { quantity: 5 },
  ])("rejects inconsistent, malformed, or expanded resources %j", (value) => {
    expect(() => decodeVariantInventory(envelope(value))).toThrow();
  });

  it.each([
    inventory,
    { ...envelope(inventory), success: false },
    { ...envelope(inventory), message: "Saved" },
    { ...envelope(inventory), receipt: requestId },
    { ...envelope(inventory), meta: { request_id: "invalid" } },
    { ...envelope(inventory), meta: { request_id: requestId, version: 1 } },
  ])("rejects malformed or expanded envelopes %j", (value) => {
    expect(() => decodeVariantInventory(value)).toThrow();
  });

  it("GET uses the central cookie transport and complete Store/Product/Variant route", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(envelope(inventory)));
    expect(await api.loadVariantInventory(input)).toEqual(inventory);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://api.example.test${expectedPath}`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      body: undefined,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2_000_000_000])("PATCH sends absolute numeric quantity %i", async (quantity) => {
    const { api, fetcher } = setup();
    const data = { quantity, availability: quantity === 0 ? "out_of_stock" : "in_stock" };
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response(envelope(data)));
    expect(await api.updateVariantInventory({ ...input, data: { quantity } })).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.example.test/sanctum/csrf-cookie");
    expect(String(fetcher.mock.calls[1]![0])).toBe(`https://api.example.test${expectedPath}`);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ quantity }),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    });
    const headers = new Headers(fetcher.mock.calls[1]![1]?.headers);
    expect(headers.get("X-XSRF-TOKEN")).toBe("synthetic");
    for (const header of ["Authorization", "Idempotency-Key", "If-Match"])
      expect(headers.has(header)).toBe(false);
  });

  it.each([null, -1, 1.5, "5", true, 2_000_000_001, NaN, Infinity])(
    "rejects invalid JSON quantity %s before CSRF or PATCH",
    async (quantity) => {
      const { api, fetcher } = setup();
      await expect(
        api.updateVariantInventory({ ...input, data: { quantity } } as UpdateVariantInventoryInput),
      ).rejects.toMatchObject({ kind: "configuration", mutationOutcome: "not-applicable" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    "store_id",
    "product_id",
    "variant_id",
    "quantity_delta",
    "expected_quantity",
    "version",
  ])("rejects unsupported body field %s before any request", async (field) => {
    const { api, fetcher } = setup();
    await expect(
      api.updateVariantInventory({ ...input, data: { quantity: 5, [field]: variantUuid } }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["storeUuid", "productUuid", "variantUuid"] as const)(
    "validates %s for GET and PATCH before transport",
    async (field) => {
      const { api, fetcher } = setup();
      for (const value of ["", "../other", "not-a-uuid"])
        for (const execute of [api.loadVariantInventory, api.updateVariantInventory])
          await expect(execute({ ...input, [field]: value })).rejects.toMatchObject({
            kind: "configuration",
          });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("snapshots all route identities and quantity before asynchronous CSRF", async () => {
    const { api, fetcher } = setup();
    const mutable = { ...input, data: { quantity: 5 } };
    let completeCsrf!: (value: Response) => void;
    fetcher
      .mockImplementationOnce(() => new Promise((resolve) => (completeCsrf = resolve)))
      .mockResolvedValueOnce(response(envelope(inventory)));
    const pending = api.updateVariantInventory(mutable);
    mutable.storeUuid = requestId;
    mutable.productUuid = requestId;
    mutable.variantUuid = requestId;
    mutable.data.quantity = 99;
    completeCsrf(csrf());
    expect(await pending).toEqual(inventory);
    expect(String(fetcher.mock.calls[1]![0])).toBe(`https://api.example.test${expectedPath}`);
    expect(fetcher.mock.calls[1]![1]?.body).toBe(JSON.stringify({ quantity: 5 }));
  });

  it.each([
    { quantity: null, availability: "unavailable" },
    { quantity: 4, availability: "in_stock" },
    { quantity: 5, availability: "out_of_stock" },
  ])("treats unexpected PATCH result %j as unknown without retry", async (value) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response(envelope(value)));
    await expect(api.updateVariantInventory(input)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 419, 422, 429, 500, 502, 503])(
    "preserves safe %i errors and never replays PATCH",
    async (status) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(
        response(
          {
            success: false,
            data: null,
            meta: { request_id: requestId },
            message: "SQLSTATE private internals",
            errors: {
              quantity: ["The inventory quantity has not changed."],
              product: ["SQLSTATE private"],
              variant: ["The selected Variant is unavailable."],
              tenant_id: ["Internal tenant information"],
            },
          },
          status,
        ),
      );
      const failure = await api.updateVariantInventory(input).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        status,
        requestId,
        mutationOutcome: status >= 500 ? "unknown" : "not-applicable",
      });
      expect(String(failure)).not.toContain("SQLSTATE");
      if (status === 422)
        expect(failure).toMatchObject({
          kind: "validation",
          fieldErrors: {
            quantity: ["The inventory quantity has not changed."],
            product: [],
            variant: ["The selected Variant is unavailable."],
          },
        });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps lost-response uncertainty after a later GET observes the requested quantity", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(csrf())
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(response(envelope(inventory)));
    const failure = await api.updateVariantInventory(input).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "network", mutationOutcome: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await api.loadVariantInventory(input)).toEqual(inventory);
    expect(failure).toMatchObject({ mutationOutcome: "unknown" });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("classifies failed CSRF as not dispatched and performs no inventory PATCH", async () => {
    const { api, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    await expect(api.updateVariantInventory(input)).rejects.toMatchObject({
      kind: "network",
      mutationOutcome: "not-applicable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch with an already cancelled signal", async () => {
    const { api, fetcher } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(api.updateVariantInventory(input, controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
      mutationOutcome: "not-applicable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
