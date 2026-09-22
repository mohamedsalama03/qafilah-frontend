// @vitest-environment node
import { describe, expect, it } from "vitest";
import { merchantContracts } from "@/lib/backend/contracts";
import {
  decodeMerchantProductOption,
  decodeMerchantVariant,
  decodeProductOptions,
  decodeProductVariants,
} from "./contracts";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const option = {
  id: id(3),
  name: "Size",
  position: 0,
  values: [{ id: id(4), value: "Large", position: 1 }],
};
const variant = {
  id: id(5),
  value_ids: [id(4)],
  sku: null,
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: "2026-09-22T01:02:03+00:00",
  updated_at: "2026-09-22T01:02:03+00:00",
};
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: id(99) },
  message: null,
});

describe("published Option and Variant resource boundaries", () => {
  it("activates exactly nine structural contracts with no deferred paths", () => {
    const input = {
      storeUuid: id(1),
      productUuid: id(2),
      optionUuid: id(3),
      valueUuid: id(4),
      variantUuid: id(5),
    };
    const prefix = `/api/v1/stores/${id(1)}/catalog/products/${id(2)}`;
    const expected = [
      ["productOptions", "GET", "/options"],
      ["createProductOption", "POST", "/options"],
      ["updateProductOption", "PATCH", `/options/${id(3)}`],
      ["createProductOptionValue", "POST", `/options/${id(3)}/values`],
      ["updateProductOptionValue", "PATCH", `/options/${id(3)}/values/${id(4)}`],
      ["productVariants", "GET", "/variants"],
      ["createProductVariant", "POST", "/variants"],
      ["productVariant", "GET", `/variants/${id(5)}`],
      ["updateProductVariant", "PATCH", `/variants/${id(5)}`],
    ] as const;
    expect(Object.keys(merchantContracts)).toHaveLength(25);
    for (const [key, method, suffix] of expected) {
      const contract = merchantContracts[key];
      expect(contract.method).toBe(method);
      expect(contract.path(input as never)).toBe(prefix + suffix);
      expect(contract.evidence.source).toContain("6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf");
      if (method === "GET") expect(contract).not.toHaveProperty("body");
    }
  });
  it("decodes complete parent Options, unpaginated lists, and read-only projections", () => {
    expect(decodeMerchantProductOption(envelope(option))).toEqual(option);
    expect(decodeProductOptions(envelope([option]))).toEqual([option]);
    expect(decodeMerchantVariant(envelope(variant))).toEqual(variant);
    expect(decodeProductVariants(envelope([variant]))).toEqual([variant]);
    expect(decodeProductOptions(envelope([]))).toEqual([]);
    expect(decodeProductVariants(envelope([]))).toEqual([]);
  });
  it.each([
    { quantity: 0, availability: "out_of_stock", price: null },
    {
      quantity: 2_000_000_000,
      availability: "in_stock",
      price: { amount: 999999999999, currency: "LYD" },
    },
    { quantity: 1, availability: "in_stock", price: { amount: 1, currency: "USD" } },
    { quantity: null, availability: "unavailable", price: { amount: 250, currency: "EUR" } },
  ])("decodes projections independently of activation: %j", (projection) => {
    expect(
      decodeMerchantVariant(envelope({ ...variant, ...projection, status: "inactive" })),
    ).toMatchObject(projection);
  });
  it.each([
    { name: " Size " },
    { name: "Ｓｉｚｅ" },
    { name: "A\nB" },
    { name: "A".repeat(81) },
    { position: "1" },
    { position: 10001 },
    { product_id: id(2) },
    { values: [{ ...option.values[0], private_id: 3 }] },
    { values: [option.values[0], option.values[0]] },
  ])("rejects malformed or expanded Option resource %j", (changes) => {
    expect(() => decodeMerchantProductOption(envelope({ ...option, ...changes }))).toThrow();
  });
  it.each([
    { sku: " trailing " },
    { sku: "A".repeat(65) },
    { status: "archived" },
    { product_id: id(2) },
    { quantity: "0" },
    { quantity: -1 },
    { quantity: 2_000_000_001 },
    { quantity: 0, availability: "in_stock" },
    { quantity: 2, availability: "unavailable" },
    { price: { amount: 0, currency: "USD" } },
    { price: { amount: 1, currency: "GBP" } },
    { price: { amount: 1, currency: "USD", gross: 1 } },
    { value_ids: [] },
    { value_ids: [id(4), id(4)] },
    { value_ids: ["invalid"] },
    { created_at: null },
    { updated_at: "not-a-date" },
  ])("rejects malformed or expanded Variant resource %j", (changes) => {
    expect(() => decodeMerchantVariant(envelope({ ...variant, ...changes }))).toThrow();
  });
  it("enforces Option/Value bounds and rejects duplicate or cross-parent Value identifiers", () => {
    const options = Array.from({ length: 3 }, (_, index) => ({
      ...option,
      id: id(10 + index),
      name: `Option ${index}`,
      values: [],
    }));
    expect(decodeProductOptions(envelope(options))).toHaveLength(3);
    expect(() => decodeProductOptions(envelope([...options, { ...option, id: id(13) }]))).toThrow();
    expect(() => decodeProductOptions(envelope([option, option]))).toThrow();
    expect(() => decodeProductOptions(envelope([option, { ...option, id: id(11) }]))).toThrow();
    const values = Array.from({ length: 20 }, (_, index) => ({
      id: id(100 + index),
      value: `Value ${index}`,
      position: index,
    }));
    expect(decodeMerchantProductOption(envelope({ ...option, values }))).toHaveProperty(
      "values",
      values,
    );
    expect(() =>
      decodeMerchantProductOption(
        envelope({
          ...option,
          values: [...values, { id: id(121), value: "Too many", position: 20 }],
        }),
      ),
    ).toThrow();
  });
  it("counts inactive Variants toward 100 and rejects duplicate IDs/combinations/SKUs", () => {
    const variants = Array.from({ length: 100 }, (_, index) => ({
      ...variant,
      id: id(index + 100),
      value_ids: [id(index + 300)],
      status: "inactive",
    }));
    expect(decodeProductVariants(envelope(variants))).toHaveLength(100);
    expect(() =>
      decodeProductVariants(
        envelope([...variants, { ...variant, id: id(250), value_ids: [id(450)] }]),
      ),
    ).toThrow();
    expect(() =>
      decodeProductVariants(envelope([variant, { ...variant, value_ids: [id(6)] }])),
    ).toThrow();
    expect(() =>
      decodeProductVariants(
        envelope([
          { ...variant, value_ids: [id(4), id(6)] },
          { ...variant, id: id(7), value_ids: [id(6), id(4)] },
        ]),
      ),
    ).toThrow();
    expect(() =>
      decodeProductVariants(
        envelope([
          { ...variant, sku: "SKU" },
          { ...variant, id: id(7), value_ids: [id(6)], sku: "SKU" },
        ]),
      ),
    ).toThrow();
    expect(
      decodeProductVariants(
        envelope([
          { ...variant, sku: "SKU" },
          { ...variant, id: id(7), value_ids: [id(6)], sku: "sku" },
        ]),
      ),
    ).toHaveLength(2);
  });
  it("rejects case-insensitive duplicate Option and Value labels within their parents", () => {
    expect(() =>
      decodeProductOptions(envelope([option, { ...option, id: id(6), name: "SIZE", values: [] }])),
    ).toThrow();
    expect(() =>
      decodeMerchantProductOption(
        envelope({
          ...option,
          values: [option.values[0], { id: id(6), value: "LARGE", position: 2 }],
        }),
      ),
    ).toThrow();
    expect(
      decodeProductOptions(
        envelope([
          option,
          {
            ...option,
            id: id(6),
            name: "Style",
            values: [{ id: id(7), value: "Large", position: 1 }],
          },
        ]),
      ),
    ).toHaveLength(2);
  });
  it.each([
    { success: false },
    { meta: { request_id: id(99), pagination: {} } },
    { message: "Created" },
    { extra: true },
    { meta: {} },
  ])("rejects malformed or expanded envelopes %j", (changes) => {
    expect(() => decodeMerchantVariant({ ...envelope(variant), ...changes })).toThrow();
    expect(() => decodeMerchantProductOption({ ...envelope(option), ...changes })).toThrow();
  });
});
