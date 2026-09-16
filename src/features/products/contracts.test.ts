// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { merchantContracts } from "../../lib/backend/contracts";
import { createMerchantApi } from "../../lib/backend/client";
import {
  decodeCategoryPage,
  decodeMerchantProduct,
  decodeProductPage,
  type ProductListInput,
} from "./contracts";

const productListPath = merchantContracts.products.path;
const productDetailPath = merchantContracts.product.path;
const categoryListPath = merchantContracts.categories.path;

const storeUuid = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
const productUuid = "8f4f4b30-e590-4a6c-b29f-081cfef0d046";
const requestId = "c2a725d8-bbc4-4258-9164-f3f16f07a14f";
const at = "2026-09-16T09:00:00+00:00";
const category = {
  id: requestId,
  name: "Synthetic Category",
  slug: "synthetic-category",
  seo_title: null,
  seo_description: null,
  status: "hidden",
  created_at: at,
  updated_at: at,
};
const product = {
  id: productUuid,
  name: "Synthetic Product",
  slug: "synthetic-product",
  description: "First line\n<script>This remains literal plain text</script>",
  seo_title: null,
  seo_description: null,
  status: "draft",
  type: "simple",
  requires_shipping: true,
  published_at: null,
  price: { amount: 10500, currency: "LYD" },
  quantity: 0,
  availability: "out_of_stock",
  categories: [category],
  created_at: at,
  updated_at: at,
};
const pagination = { per_page: 25, next_cursor: "opaque+/=&token", previous_cursor: null };
const effectiveRange = {
  created_from: "2025-09-15T09:00:00.123456+00:00",
  created_to: "2026-09-16T09:00:00.123456+00:00",
};
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: requestId },
  message: null,
});
const productPage = () => ({
  ...envelope([product]),
  meta: {
    request_id: requestId,
    pagination: { ...pagination },
    effective_range: { ...effectiveRange },
  },
});
const categoryPage = () => ({
  ...envelope([category]),
  meta: { request_id: requestId, limit: 100, pagination: { ...pagination, per_page: 100 } },
});
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const setup = () => {
  const fetcher = vi.fn<typeof fetch>();
  return {
    fetcher,
    api: createMerchantApi({ apiOrigin: "https://api.example.test", fetch: fetcher }),
  };
};

describe("exact F3-A registry paths", () => {
  it("adds exactly three reviewed GET contracts with no bodies", () => {
    expect(Object.keys(merchantContracts).slice(0, 9)).toEqual([
      "csrf",
      "login",
      "identity",
      "logout",
      "stores",
      "context",
      "products",
      "product",
      "categories",
    ]);
    for (const contract of [
      merchantContracts.products,
      merchantContracts.product,
      merchantContracts.categories,
    ]) {
      expect(contract.method).toBe("GET");
      expect(contract).not.toHaveProperty("body");
      expect(contract.evidence.source).toContain("6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf");
    }
  });
  it("encodes opaque cursors and reviewed criteria without decoding or inventing pages", () => {
    const path = productListPath({
      storeUuid,
      cursor: pagination.next_cursor,
      criteria: {
        q: "  ＡＢ & tea  ",
        category: requestId,
        ...effectiveRange,
        per_page: 10,
        status: "published",
        sort: "name_asc",
      },
    });
    const url = new URL(path, "https://api.example.test");
    expect(url.pathname).toBe(`/api/v1/stores/${storeUuid}/catalog/products`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "AB & tea",
      category: requestId,
      ...effectiveRange,
      per_page: "10",
      status: "published",
      sort: "name_asc",
      cursor: pagination.next_cursor,
    });
    expect(productDetailPath({ storeUuid, productUuid })).toBe(
      `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}`,
    );
    expect(categoryListPath({ storeUuid })).toBe(
      `/api/v1/stores/${storeUuid}/catalog/categories?sort=newest&per_page=100`,
    );
  });
  it.each(["../me", "//attacker.test", "not-a-uuid", `${productUuid}/media`])(
    "rejects Product path injection %s",
    (value) => {
      expect(() => productDetailPath({ storeUuid, productUuid: value })).toThrow();
      expect(() => productListPath({ storeUuid: value })).toThrow();
    },
  );
  it("rejects unreviewed fields and unbounded cursors", () => {
    expect(() =>
      productListPath({ storeUuid, criteria: { sku: "forbidden" } } as ProductListInput),
    ).toThrow();
    expect(() => productListPath({ storeUuid, cursor: "x".repeat(4097) })).toThrow();
  });
});

describe("strict published Product Resources", () => {
  it("preserves literal multiline description and hidden Categories as Product-authorized fields", () => {
    expect(decodeMerchantProduct(envelope(product))).toEqual(product);
    expect(decodeProductPage(productPage())).toEqual({
      products: [product],
      pagination,
      effectiveRange,
    });
    expect(decodeCategoryPage(categoryPage())).toEqual({
      categories: [category],
      pagination: { ...pagination, per_page: 100 },
      limit: 100,
    });
  });
  it("accepts zero records without pretending a failed response is empty", () => {
    expect(decodeProductPage({ ...productPage(), data: [] }).products).toEqual([]);
    expect(() =>
      decodeProductPage({ success: false, data: [], meta: productPage().meta, message: null }),
    ).toThrow();
  });
  it("accepts independent Variant aggregate availability and an unconfigured simple Product", () => {
    expect(
      decodeMerchantProduct(
        envelope({ ...product, type: "variant", quantity: null, availability: "in_stock" }),
      ),
    ).toMatchObject({ quantity: null, availability: "in_stock", price: product.price });
    expect(
      decodeMerchantProduct(
        envelope({ ...product, price: null, quantity: null, availability: "unavailable" }),
      ),
    ).toMatchObject({ price: null, quantity: null, availability: "unavailable" });
  });
  it.each([
    { id: "not-uuid" },
    { status: "deleted" },
    { type: "bundle" },
    { requires_shipping: 1 },
    { name: "x" },
    { description: "" },
    { description: "a\u200Eb" },
    { description: "a".repeat(5001) },
    { price: { amount: "10500", currency: "LYD" } },
    { price: { amount: 10.5, currency: "LYD" } },
    { price: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "LYD" } },
    { price: { amount: 1, currency: "GBP" } },
    { price: { amount: 0, currency: "LYD" } },
    { quantity: -1 },
    { quantity: "1" },
    { quantity: 1, availability: "out_of_stock" },
    { type: "variant", quantity: 1 },
    { created_at: null },
    { updated_at: "yesterday" },
    { published_at: "2026-09-16" },
    { categories: [category, category] },
    { categories: [{ ...category, parent_id: productUuid }] },
    { sku: "not-published" },
    { media: [] },
    { store_id: storeUuid },
    { tenant_id: "forged" },
  ])("rejects expanded or malformed Product %j", (changes) => {
    expect(() => decodeMerchantProduct(envelope({ ...product, ...changes }))).toThrow();
  });
  it("uses Unicode code-point limits rather than UTF-16 length", () => {
    expect(
      decodeMerchantProduct(
        envelope({ ...product, name: "😀".repeat(160), description: "😀".repeat(5000) }),
      ).name,
    ).toHaveLength(320);
  });
  it.each([
    (page: ReturnType<typeof productPage>) => ({ ...page, data: [product, product] }),
    (page: ReturnType<typeof productPage>) => ({ ...page, meta: { ...page.meta, total: 1 } }),
    (page: ReturnType<typeof productPage>) => ({
      ...page,
      meta: { ...page.meta, pagination: { ...page.meta.pagination, current_page: 1 } },
    }),
    (page: ReturnType<typeof productPage>) => ({
      ...page,
      meta: { ...page.meta, pagination: { ...page.meta.pagination, per_page: 51 } },
    }),
    (page: ReturnType<typeof productPage>) => ({
      ...page,
      meta: {
        ...page.meta,
        pagination: { ...page.meta.pagination, next_cursor: "x".repeat(4097) },
      },
    }),
    (page: ReturnType<typeof productPage>) => ({
      ...page,
      meta: {
        ...page.meta,
        effective_range: { ...effectiveRange, created_to: "2026-09-16T09:00:00.123457+00:00" },
      },
    }),
  ])("rejects contradictory or invented pagination", (change) => {
    expect(() => decodeProductPage(change(productPage()))).toThrow();
  });
  it("rejects conflicting Category limits and excess rows", () => {
    const page = categoryPage();
    expect(() => decodeCategoryPage({ ...page, meta: { ...page.meta, limit: 99 } })).toThrow();
    expect(() => decodeCategoryPage({ ...page, data: [category, category] })).toThrow();
  });
});

describe("central Merchant Product transport", () => {
  it("uses only three bodyless credentialed reads, without row fanout or CSRF bootstrap", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response(productPage()))
      .mockResolvedValueOnce(response(envelope(product)))
      .mockResolvedValueOnce(response(categoryPage()));
    expect((await api.listProducts({ storeUuid })).products).toHaveLength(1);
    expect((await api.loadProduct({ storeUuid, productUuid })).id).toBe(productUuid);
    expect((await api.listCategories({ storeUuid })).categories).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
      });
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    }
  });
  it("rejects a response for another Product and mismatched requested page sizes", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response(envelope({ ...product, id: storeUuid })))
      .mockResolvedValueOnce(response(productPage()))
      .mockResolvedValueOnce(response(categoryPage()));
    await expect(api.loadProduct({ storeUuid, productUuid })).rejects.toMatchObject({
      kind: "invalid-response",
    });
    await expect(api.listProducts({ storeUuid, criteria: { per_page: 10 } })).rejects.toMatchObject(
      { kind: "invalid-response" },
    );
    await expect(
      api.listCategories({ storeUuid, criteria: { per_page: 10 } }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("normalizes invalid local inputs before any network request", async () => {
    const { api, fetcher } = setup();
    await expect(api.loadProduct({ storeUuid, productUuid: "../me" })).rejects.toMatchObject({
      kind: "configuration",
    });
    await expect(api.listProducts({ storeUuid, criteria: { q: "x" } })).rejects.toMatchObject({
      kind: "configuration",
    });
    await expect(
      api.listCategories({ storeUuid, criteria: { per_page: 101 } }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [419, "session-expired"],
    [422, "validation"],
    [429, "rate-limited"],
    [500, "server"],
  ] as const)("preserves normalized %s semantics with no mutation/replay", async (status, kind) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValue(
      response(
        {
          success: false,
          data: null,
          meta: { request_id: requestId },
          message: "SQLSTATE private internals",
          errors: {},
        },
        status,
      ),
    );
    await expect(api.loadProduct({ storeUuid, productUuid })).rejects.toMatchObject({
      status,
      kind,
      requestId,
      mutationOutcome: "not-applicable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("limits validation fields and strips unsafe messages while retaining cursor restart evidence", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValue(
      response(
        {
          success: false,
          data: null,
          meta: { request_id: requestId },
          message: "Private detail",
          errors: {
            cursor: ["The cursor is invalid."],
            q: ["SQLSTATE secret"],
            store_id: ["Unreviewed authority"],
          },
        },
        422,
      ),
    );
    await expect(api.listProducts({ storeUuid })).rejects.toMatchObject({
      kind: "validation",
      fieldErrors: { cursor: ["The cursor is invalid."], q: [] },
    });
    const error = await api.listProducts({ storeUuid }).catch((error: unknown) => error);
    expect(error).not.toHaveProperty("fieldErrors.store_id");
  });
  it("cancels reads through the certified transport", async () => {
    const { api, fetcher } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(api.listProducts({ storeUuid }, controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
