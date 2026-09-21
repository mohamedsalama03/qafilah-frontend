// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMerchantApi } from "@/lib/backend/client";
import { merchantContracts } from "@/lib/backend/contracts";
import { decodeProductInventory, type UpdateProductInventoryInput } from "./contracts";
import { inventoryQuantityLabel, parseInventoryQuantity } from "./model";

const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const input = { storeUuid, productUuid, data: { quantity: 5 } };
const inventory = { quantity: 5, availability: "in_stock" };
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: requestId },
  message: null,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  const api = createMerchantApi({
    apiOrigin: "https://api.example.test",
    fetch: fetcher,
    readCookie: () => "XSRF-TOKEN=synthetic",
  });
  return { api, fetcher };
}

describe("published simple Product inventory contracts", () => {
  it("activates exactly the verified Product inventory GET and PATCH", () => {
    expect(Object.keys(merchantContracts)).toHaveLength(16);
    expect(merchantContracts.productInventory.method).toBe("GET");
    expect(merchantContracts.updateProductInventory.method).toBe("PATCH");
    for (const key of ["productInventory", "updateProductInventory"] as const) {
      expect(merchantContracts[key].path(input)).toBe(
        `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}/inventory`,
      );
      expect(merchantContracts[key].evidence.source).toContain(
        "6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf",
      );
    }
    expect(merchantContracts.productInventory).not.toHaveProperty("body");
    expect(merchantContracts.updateProductInventory.body(input)).toEqual({ quantity: 5 });
  });

  it("distinguishes null from zero without numeric coercion", () => {
    expect(
      decodeProductInventory(envelope({ quantity: null, availability: "unavailable" })),
    ).toEqual({ quantity: null, availability: "unavailable" });
    expect(decodeProductInventory(envelope({ quantity: 0, availability: "out_of_stock" }))).toEqual(
      { quantity: 0, availability: "out_of_stock" },
    );
    expect(inventoryQuantityLabel(null)).toBe("Not configured");
    expect(inventoryQuantityLabel(0)).toBe("0");
    expect(inventoryQuantityLabel(2_000_000_000)).toBe("2,000,000,000");
  });

  it.each([
    { quantity: null, availability: "out_of_stock" },
    { quantity: 0, availability: "unavailable" },
    { quantity: 0, availability: "in_stock" },
    { quantity: 5, availability: "out_of_stock" },
    { quantity: 5, availability: "unavailable" },
  ])("rejects inconsistent quantity and availability: %j", (value) => {
    expect(() => decodeProductInventory(envelope(value))).toThrow();
  });

  it.each([
    { quantity: "5", availability: "in_stock" },
    { quantity: -1, availability: "in_stock" },
    { quantity: 2_000_000_001, availability: "in_stock" },
    { quantity: 1.5, availability: "in_stock" },
    { quantity: 5, availability: "available" },
    { ...inventory, product_id: productUuid },
  ])("rejects malformed or expanded inventory responses: %j", (value) => {
    expect(() => decodeProductInventory(envelope(value))).toThrow();
  });

  it.each([0, 1, 2_000_000_000])(
    "sends strict absolute integer quantity %i after fresh CSRF",
    async (quantity) => {
      const { api, fetcher } = setup();
      const data = { quantity, availability: quantity === 0 ? "out_of_stock" : "in_stock" };
      fetcher
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(response(envelope(data)));
      expect(await api.updateProductInventory({ ...input, data: { quantity } })).toEqual(data);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[0]![0])).toBe(
        "https://api.example.test/sanctum/csrf-cookie",
      );
      expect(fetcher.mock.calls[1]![1]).toMatchObject({
        method: "PATCH",
        body: JSON.stringify({ quantity }),
        credentials: "include",
        cache: "no-store",
        redirect: "error",
      });
      expect(new Headers(fetcher.mock.calls[1]![1]?.headers).has("Authorization")).toBe(false);
    },
  );

  it("loads only the identity-free inventory resource through the central GET transport", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(envelope(inventory)));
    expect(await api.loadProductInventory(input)).toEqual(inventory);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      body: undefined,
      credentials: "include",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, -1, 1.5, "5", 2_000_000_001, NaN, Infinity])(
    "rejects invalid JSON quantity %s before any request",
    async (quantity) => {
      const { api, fetcher } = setup();
      await expect(
        api.updateProductInventory({ ...input, data: { quantity } } as UpdateProductInventoryInput),
      ).rejects.toMatchObject({ kind: "configuration", mutationOutcome: "not-applicable" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["store_id", "tenant_id", "product_id", "unknown"])(
    "rejects body authority or unknown field %s",
    async (field) => {
      const { api, fetcher } = setup();
      await expect(
        api.updateProductInventory({ ...input, data: { quantity: 5, [field]: productUuid } }),
      ).rejects.toMatchObject({ kind: "configuration" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["", "../other", "not-a-uuid"])(
    "rejects malformed route input %s before GET or PATCH",
    async (uuid) => {
      const { api, fetcher } = setup();
      await expect(api.loadProductInventory({ ...input, productUuid: uuid })).rejects.toMatchObject(
        { kind: "configuration" },
      );
      await expect(api.updateProductInventory({ ...input, storeUuid: uuid })).rejects.toMatchObject(
        { kind: "configuration" },
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    inventory,
    { quantity: 4, availability: "in_stock" },
    { quantity: 5, availability: "out_of_stock" },
  ])("requires consistent and submitted quantity in PATCH response %j", async (value) => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response(envelope(value)));
    if (value === inventory) expect(await api.updateProductInventory(input)).toEqual(inventory);
    else
      await expect(api.updateProductInventory(input)).rejects.toMatchObject({
        kind: "invalid-response",
        mutationOutcome: "unknown",
      });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 419, 422, 429, 500, 502, 503])(
    "preserves normalized %i errors without replay or raw internals",
    async (status) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(
        response(
          {
            success: false,
            data: null,
            meta: { request_id: requestId },
            message: "SQLSTATE private internals",
            errors: {
              quantity: ["Enter a whole quantity."],
              product: ["SQLSTATE private"],
              secret: ["internal"],
            },
          },
          status,
        ),
      );
      const error = await api.updateProductInventory(input).catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        status,
        mutationOutcome: status >= 500 ? "unknown" : "not-applicable",
      });
      expect(String(error)).not.toContain("SQLSTATE");
      if (status === 422)
        expect(error).toMatchObject({
          fieldErrors: { quantity: ["Enter a whole quantity."], product: [] },
        });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("never automatically retries a dispatched unknown inventory update", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new TypeError("lost response"));
    await expect(api.updateProductInventory(input)).rejects.toMatchObject({
      kind: "network",
      mutationOutcome: "unknown",
    });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("keeps pre-dispatch CSRF failure separate from unknown inventory writes", async () => {
    const { api, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    await expect(api.updateProductInventory(input)).rejects.toMatchObject({
      kind: "network",
      mutationOutcome: "not-applicable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["", " ", "1.0", "1e3", "-1", "+1", "2,000", "2000000001"])(
    "rejects noncanonical form quantity %s",
    (value) => {
      expect(() => parseInventoryQuantity(value)).toThrow();
    },
  );
  it.each(["0", "5", "2000000000"])("parses deliberate form digits %s as integer", (value) => {
    expect(parseInventoryQuantity(value)).toBe(Number(value));
  });
});
