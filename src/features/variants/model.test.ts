// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createVariantPayloadSchema,
  isCompleteVariantCombination,
  maximumOptionValues,
  maximumProductOptions,
  maximumProductVariants,
  optionPayloadSchema,
  updateVariantPayloadSchema,
  valuePayloadSchema,
  variantPermissions,
} from "./model";

const first = "abcdefab-1111-4111-8111-111111111111";
const second = "abcdefab-2222-4222-8222-222222222222";
const third = "abcdefab-3333-4333-8333-333333333333";

describe("published structural payload rules", () => {
  it("keeps exact limits and independent permission slugs", () => {
    expect([maximumProductOptions, maximumOptionValues, maximumProductVariants]).toEqual([
      3, 20, 100,
    ]);
    expect(variantPermissions).toEqual({
      view: "products.variants.view",
      create: "products.variants.create",
      update: "products.variants.update",
    });
  });

  it("canonicalizes NFKC, boundary whitespace, and code point lengths for labels", () => {
    expect(optionPayloadSchema.parse({ name: "\u2003Ｓｉｚｅ\r\n", position: 0 })).toEqual({
      name: "Size",
      position: 0,
    });
    expect(valuePayloadSchema.parse({ value: "  كبيـر  ", position: 10000 })).toEqual({
      value: "كبيـر",
      position: 10000,
    });
    expect(optionPayloadSchema.parse({ name: "😀".repeat(80), position: 1 }).name).toBe(
      "😀".repeat(80),
    );
    expect(optionPayloadSchema.safeParse({ name: "😀".repeat(81), position: 1 }).success).toBe(
      false,
    );
    expect(optionPayloadSchema.safeParse({ name: "ﬃ".repeat(27), position: 1 }).success).toBe(
      false,
    );
  });

  it.each([
    "",
    " \t\r\n ",
    "line\nbreak",
    "line\rbreak",
    "tab\tinside",
    "null\0inside",
    "hidden\u200b",
    "rtl\u202e",
    "\ud800",
  ])("rejects unsupported label %j", (name) => {
    expect(optionPayloadSchema.safeParse({ name, position: 0 }).success).toBe(false);
    expect(valuePayloadSchema.safeParse({ value: name, position: 0 }).success).toBe(false);
  });

  it.each([-1, 10001, 1.5, "0", null, NaN, Infinity])(
    "rejects unsupported position %s",
    (position) => {
      expect(optionPayloadSchema.safeParse({ name: "Size", position }).success).toBe(false);
      expect(valuePayloadSchema.safeParse({ value: "Large", position }).success).toBe(false);
    },
  );

  it.each([
    { name: "Size" },
    { position: 1 },
    { name: "Size", position: 1, store_id: first },
    { name: "Size", position: 1, values: [] },
  ])("requires a complete closed Option payload %j", (payload) => {
    expect(optionPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it.each([{ value: "Large" }, { position: 1 }, { value: "Large", position: 1, option_id: first }])(
    "requires a complete closed Value payload %j",
    (payload) => {
      expect(valuePayloadSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("supports omitted, null, and case-sensitive normalized SKU with Unicode bounds", () => {
    expect(createVariantPayloadSchema.parse({ value_ids: [first] })).toEqual({
      value_ids: [first],
    });
    expect(createVariantPayloadSchema.parse({ value_ids: [first], sku: null }).sku).toBeNull();
    expect(
      createVariantPayloadSchema.parse({ value_ids: [first.toUpperCase()], sku: " Ａbc " }),
    ).toEqual({ value_ids: [first], sku: "Abc" });
    expect(updateVariantPayloadSchema.parse({ sku: "😀".repeat(64) }).sku).toBe("😀".repeat(64));
    expect(updateVariantPayloadSchema.safeParse({ sku: "😀".repeat(65) }).success).toBe(false);
  });
  it.each(["", "   ", "A\nB", "A\u200bB"])("rejects invalid non-null SKU %j", (sku) => {
    expect(createVariantPayloadSchema.safeParse({ value_ids: [first], sku }).success).toBe(false);
    expect(updateVariantPayloadSchema.safeParse({ sku }).success).toBe(false);
  });
  it.each([
    { value_ids: [] },
    { value_ids: [first, first] },
    { value_ids: [first, first.toUpperCase()] },
    { value_ids: [first, second, third, first] },
    { value_ids: ["7"] },
    { value_ids: ["../value"] },
  ])("rejects invalid combination identifiers $value_ids", ({ value_ids }) => {
    expect(createVariantPayloadSchema.safeParse({ value_ids }).success).toBe(false);
  });
  it.each([
    {},
    { sku: undefined },
    { status: "archived" },
    { value_ids: [first] },
    { price: 500 },
    { quantity: 1 },
    { sku: null, tenant_id: first },
  ])("rejects unsupported or empty Variant update %j", (data) => {
    expect(updateVariantPayloadSchema.safeParse(data).success).toBe(false);
  });
  it("permits clearing SKU or toggling only status, but prohibits creation status", () => {
    expect(updateVariantPayloadSchema.parse({ sku: null })).toEqual({ sku: null });
    expect(updateVariantPayloadSchema.parse({ status: "inactive" })).toEqual({
      status: "inactive",
    });
    expect(updateVariantPayloadSchema.parse({ sku: "AbC", status: "active" })).toEqual({
      sku: "AbC",
      status: "active",
    });
    expect(
      createVariantPayloadSchema.safeParse({ value_ids: [first], status: "inactive" }).success,
    ).toBe(false);
  });
  it("requires exactly one owned Value per Option without generating a matrix", () => {
    const options = [{ values: [{ id: first }, { id: second }] }, { values: [{ id: third }] }];
    expect(isCompleteVariantCombination(options, [first, third])).toBe(true);
    expect(isCompleteVariantCombination(options, [third, second])).toBe(true);
    expect(isCompleteVariantCombination(options, [first, second])).toBe(false);
    expect(isCompleteVariantCombination(options, [first])).toBe(false);
    expect(isCompleteVariantCombination(options, [first, third, second])).toBe(false);
    expect(isCompleteVariantCombination([], [])).toBe(false);
    expect(isCompleteVariantCombination([{ values: [] }], [first])).toBe(false);
  });
});
