// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { merchantContracts } from "@/lib/backend/contracts";
import { createMerchantApi } from "@/lib/backend/client";
import type { CreateProductInput, UpdateProductInput } from "./mutation-contracts";

const storeUuid = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
const productUuid = "8f4f4b30-e590-4a6c-b29f-081cfef0d046";
const requestId = "c2a725d8-bbc4-4258-9164-f3f16f07a14f";
const at = "2026-09-16T09:00:00+00:00";
const data = {
  name: "Mutation test product",
  slug: "mutation-test-product",
  description: "Plain text",
};
const product = {
  ...data,
  id: productUuid,
  seo_title: null,
  seo_description: null,
  status: "draft",
  type: "simple",
  requires_shipping: true,
  published_at: null,
  price: null,
  quantity: null,
  availability: "unavailable",
  categories: [],
  created_at: at,
  updated_at: at,
};
const envelope = (value: unknown) => ({
  success: true,
  data: value,
  meta: { request_id: requestId },
  message: null,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const errorEnvelope = (errors: Record<string, string[]>) => ({
  success: false,
  data: null,
  meta: { request_id: requestId },
  message: "Never display raw backend internals",
  errors,
});
const operations = [
  "createProduct",
  "updateProduct",
  "publishProduct",
  "unpublishProduct",
  "archiveProduct",
] as const;
function setup() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 }));
  const api = createMerchantApi({
    apiOrigin: "https://api.example.test",
    fetch: fetcher,
    readCookie: () => "XSRF-TOKEN=synthetic%3Dtoken",
  });
  return { api, fetcher };
}
const input = { storeUuid, productUuid, data };

describe("five published Product mutation contracts", () => {
  it("activates exactly five writes in addition to the certified registry", () => {
    expect(Object.keys(merchantContracts)).toHaveLength(14);
    expect(
      operations.map((key) => [
        key,
        merchantContracts[key].method,
        merchantContracts[key].path(input),
      ]),
    ).toEqual([
      ["createProduct", "POST", `/api/v1/stores/${storeUuid}/catalog/products`],
      ["updateProduct", "PATCH", `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}`],
      [
        "publishProduct",
        "POST",
        `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}/publish`,
      ],
      [
        "unpublishProduct",
        "POST",
        `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}/unpublish`,
      ],
      [
        "archiveProduct",
        "POST",
        `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}/archive`,
      ],
    ]);
    for (const key of operations)
      expect(merchantContracts[key].evidence.source).toContain(
        "6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf",
      );
    for (const key of operations.slice(2))
      expect(merchantContracts[key]).not.toHaveProperty("body");
  });
  it.each(operations)("dispatches one %s with fresh CSRF and verified response", async (key) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(envelope(product), key === "createProduct" ? 201 : 200));
    expect(await api[key](input)).toEqual(product);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.example.test/sanctum/csrf-cookie");
    const request = fetcher.mock.calls[1]![1]!;
    expect(request.method).toBe(merchantContracts[key].method);
    expect(request.credentials).toBe("include");
    expect(new Headers(request.headers).get("X-XSRF-TOKEN")).toBe("synthetic=token");
    expect(new Headers(request.headers).has("Authorization")).toBe(false);
    expect(request.body).toBe(
      key === "createProduct" || key === "updateProduct" ? JSON.stringify(data) : undefined,
    );
  });
  it("rejects invalid input before CSRF or mutation dispatch", async () => {
    const { api, fetcher } = setup();
    await expect(
      api.createProduct({
        storeUuid,
        data: { ...data, status: "published" },
      } as CreateProductInput),
    ).rejects.toMatchObject({ kind: "configuration", mutationOutcome: "not-applicable" });
    await expect(
      api.updateProduct({ ...input, data: { type: "variant" } } as unknown as UpdateProductInput),
    ).rejects.toMatchObject({ kind: "configuration" });
    await expect(
      api.publishProduct({ storeUuid, productUuid: "../other-store" }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(operations.slice(1))(
    "rejects a foreign %s response as an unknown outcome",
    async (key) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(response(envelope({ ...product, id: requestId })));
      await expect(api[key](input)).rejects.toMatchObject({
        kind: "invalid-response",
        mutationOutcome: "unknown",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(operations)("never replays %s after network loss", async (key) => {
    const { api, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new TypeError("connection lost"));
    await expect(api[key](input)).rejects.toMatchObject({
      kind: "network",
      mutationOutcome: "unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([500, 502, 503])("marks dispatched %s as unknown without replay", async (status) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(errorEnvelope({}), status));
    await expect(api.updateProduct(input)).rejects.toMatchObject({
      kind: "server",
      mutationOutcome: "unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...product, internal_id: 17 },
    { ...product, quantity: -1 },
    { ...product, price: "12.50" },
  ])("strictly rejects malformed mutation resources", async (value) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(envelope(value)));
    await expect(api.createProduct(input)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "unknown",
    });
  });
  it("maps only safe actual field/lifecycle errors including Category item errors", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      response(
        errorEnvelope({
          slug: ["The Product slug has already been taken in this Store."],
          "category_ids.0": ["The category_ids.0 field must be a valid UUID."],
          product: ["An archived Product cannot be updated."],
          internal_path: ["Never display"],
          description: ["SQLSTATE exception /var/app/file.php"],
        }),
        422,
      ),
    );
    await expect(api.updateProduct(input)).rejects.toMatchObject({
      kind: "validation",
      mutationOutcome: "not-applicable",
      fieldErrors: {
        slug: ["The Product slug has already been taken in this Store."],
        "category_ids.0": ["The category_ids.0 field must be a valid UUID."],
        product: ["An archived Product cannot be updated."],
        description: [],
      },
    });
    expect(
      merchantContracts.archiveProduct.decodeError(
        errorEnvelope({
          status: ["The Product cannot transition from its current state."],
          product: ["unreviewed"],
        }),
      ),
    ).toEqual({
      fieldErrors: { status: ["The Product cannot transition from its current state."] },
    });
  });
});
