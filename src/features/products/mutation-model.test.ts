// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MerchantProduct } from "./contracts";
import {
  allowsProductTransition,
  normalizeCreateProductPayload,
  normalizeUpdateProductPayload,
  productMutationPermissions,
  productUpdateChanges,
} from "./mutation-model";

const first = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
const second = "8f4f4b30-e590-4a6c-b29f-081cfef0d046";
const valid = { name: "Product name", slug: "product-name", description: "Plain text" };

describe("verified Product mutation payloads", () => {
  it("preserves server defaults by omitting optional creation fields", () => {
    expect(normalizeCreateProductPayload(valid)).toEqual(valid);
    expect(
      normalizeCreateProductPayload({ ...valid, type: "variant", requires_shipping: false }),
    ).toMatchObject({ type: "variant", requires_shipping: false });
  });
  it("canonicalizes NFKC, Unicode edge spaces and line breaks before code-point validation", () => {
    expect(
      normalizeCreateProductPayload({
        ...valid,
        name: "\u2003 Ｐｒｏｄｕｃｔ \u2003",
        description: "\r\nFirst\r\nSecond\rThird\n",
        seo_title: " Ｔｉｔｌｅ ",
      }),
    ).toMatchObject({ name: "Product", description: "First\nSecond\nThird", seo_title: "Title" });
    expect(normalizeCreateProductPayload({ ...valid, name: "😀".repeat(160) }).name).toHaveLength(
      320,
    );
    expect(
      normalizeCreateProductPayload({ ...valid, description: "<script>literal</script>" })
        .description,
    ).toBe("<script>literal</script>");
  });
  it.each([
    ["name", "x"],
    ["name", "x".repeat(161)],
    ["description", ""],
    ["description", "x".repeat(5001)],
    ["name", "a\nb"],
    ["name", "a\tb"],
    ["description", "a\tb"],
    ["description", "a\u200eb"],
    ["name", "a\ud800b"],
    ["name", "\ufeffProduct"],
    ["seo_title", "x".repeat(71)],
    ["seo_description", "x".repeat(321)],
    ["seo_title", " "],
    ["slug", "Product"],
    ["slug", "a--b"],
    ["slug", "a_b"],
    ["slug", " a-b "],
    ["slug", "a"],
    ["slug", "x".repeat(161)],
    ["type", "digital"],
    ["requires_shipping", "true"],
    ["requires_shipping", 1],
  ])("rejects unsupported %s value", (field, value) => {
    expect(() => normalizeCreateProductPayload({ ...valid, [field]: value })).toThrow();
  });
  it.each([
    "status",
    "published_at",
    "price",
    "quantity",
    "store_id",
    "tenant_id",
    "SKU",
    "barcode",
    "media",
    "variants",
  ])("never admits forbidden creation field %s", (field) => {
    expect(() => normalizeCreateProductPayload({ ...valid, [field]: "unsupported" })).toThrow();
    expect(() =>
      normalizeUpdateProductPayload({ name: "Changed", [field]: "unsupported" }),
    ).toThrow();
  });
  it("limits distinct Category UUIDs without claiming Store authority", () => {
    expect(
      normalizeCreateProductPayload({ ...valid, category_ids: [first.toUpperCase()] }).category_ids,
    ).toEqual([first]);
    for (const category_ids of [
      [first, first],
      [first, first.toUpperCase()],
      ["foreign-selector"],
      Array(21).fill(first),
    ])
      expect(() => normalizeCreateProductPayload({ ...valid, category_ids })).toThrow();
    expect(normalizeUpdateProductPayload({ category_ids: [] })).toEqual({ category_ids: [] });
  });
  it("keeps update partial, permits SEO clearing and rejects type changes or empty updates", () => {
    expect(
      normalizeUpdateProductPayload({
        seo_title: null,
        seo_description: null,
        requires_shipping: false,
      }),
    ).toEqual({ seo_title: null, seo_description: null, requires_shipping: false });
    expect(() => normalizeUpdateProductPayload({})).toThrow();
    expect(() => normalizeUpdateProductPayload({ name: undefined })).toThrow();
    expect(() => normalizeUpdateProductPayload({ type: "variant" })).toThrow();
    expect(() => normalizeUpdateProductPayload({ description: null })).toThrow();
  });
  it("omits unchanged canonical fields and Category ordering while preserving deliberate clears", () => {
    const current = {
      ...valid,
      seo_title: "Title",
      seo_description: null,
      requires_shipping: true,
      categories: [{ id: first }, { id: second }],
    } as MerchantProduct;
    expect(
      productUpdateChanges(current, {
        name: " Ｐｒｏｄｕｃｔ ｎａｍｅ ",
        category_ids: [second, first],
      }),
    ).toBeNull();
    expect(
      productUpdateChanges(current, {
        name: valid.name,
        seo_title: null,
        category_ids: [],
        requires_shipping: false,
      }),
    ).toEqual({ seo_title: null, category_ids: [], requires_shipping: false });
  });
});

describe("canonical Product action semantics", () => {
  it("uses only the published canonical capabilities", () => {
    expect(productMutationPermissions).toEqual({
      create: "products.create",
      update: "products.update",
      publish: "products.publish",
      unpublish: "products.publish",
      archive: "products.update",
    });
  });
  it.each([
    ["draft", true, false, true],
    ["published", false, true, true],
    ["archived", false, false, false],
  ] as const)("allows only verified transitions from %s", (status, publish, unpublish, archive) => {
    expect(allowsProductTransition(status, "publish")).toBe(publish);
    expect(allowsProductTransition(status, "unpublish")).toBe(unpublish);
    expect(allowsProductTransition(status, "archive")).toBe(archive);
  });
});
