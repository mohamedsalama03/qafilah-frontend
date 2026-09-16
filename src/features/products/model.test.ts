// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatProductPrice,
  isValidCatalogRange,
  minorUnitsToDecimal,
  normalizeCategoryCriteria,
  normalizeProductCriteria,
  type CatalogCurrency,
  type ProductCriteriaInput,
} from "./model";

describe("Merchant Product integer minor-unit display", () => {
  it.each([
    [10500, "LYD", "10.500"],
    [10500, "USD", "105.00"],
    [10500, "EUR", "105.00"],
    [1, "LYD", "0.001"],
    [1, "USD", "0.01"],
    [0, "LYD", "0.000"],
    [999999999999, "LYD", "999999999.999"],
    [Number.MAX_SAFE_INTEGER, "USD", "90071992547409.91"],
  ] as const)("preserves exact digits for %s %s", (amount, currency, expected) => {
    expect(minorUnitsToDecimal(amount, currency)).toBe(expected);
  });
  it.each([1.2, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid amount %s",
    (amount) => {
      expect(() => minorUnitsToDecimal(amount, "LYD")).toThrow(RangeError);
    },
  );
  it.each(["GBP", "toString", "__proto__"])("rejects unsupported currency %s", (currency) => {
    expect(() => minorUnitsToDecimal(10, currency as CatalogCurrency)).toThrow(RangeError);
  });
  it("distinguishes unconfigured, exact simple, and independent Variant minimum prices", () => {
    expect(formatProductPrice({ price: null, type: "simple" })).toBe("Price not configured");
    expect(formatProductPrice({ price: null, type: "variant" })).toBe("Price not configured");
    expect(formatProductPrice({ price: { amount: 10500, currency: "LYD" }, type: "simple" })).toBe(
      "10.500 LYD",
    );
    expect(formatProductPrice({ price: { amount: 10500, currency: "LYD" }, type: "variant" })).toBe(
      "From 10.500 LYD",
    );
  });
});

describe("published Product criteria", () => {
  it("keeps the server-owned rolling creation window implicit and uses modest defaults", () => {
    expect(normalizeProductCriteria()).toEqual({ sort: "newest", per_page: 25 });
    expect(normalizeCategoryCriteria()).toEqual({ sort: "newest", per_page: 100 });
  });
  it("normalizes Unicode and whitespace without inventing substring or client case-folding semantics", () => {
    expect(normalizeProductCriteria({ q: "  Ｃａｔａｌｏｇ  " }).q).toBe("Catalog");
    expect(normalizeProductCriteria({ q: "   " }).q).toBeUndefined();
    expect(normalizeProductCriteria({ q: "İ".repeat(80) }).q).toBe("İ".repeat(80));
    expect(normalizeProductCriteria({ q: "😀".repeat(80) }).q).toBe("😀".repeat(80));
  });
  it.each(["x", "x".repeat(81), "a\nb", "a\tb", "a\u200Eb", "a\uD800b"])(
    "rejects unsupported prefix %j",
    (q) => {
      expect(() => normalizeProductCriteria({ q })).toThrow();
    },
  );
  it.each([
    { status: "deleted" },
    { sort: "price" },
    { category: "../another-store" },
    { per_page: 0 },
    { per_page: 51 },
    { per_page: 1.5 },
    { page: 1 },
    { sku: "private" },
    { store_id: "authority" },
    { tenant_id: "authority" },
  ])("rejects unsupported fields/values %j", (criteria) => {
    expect(() => normalizeProductCriteria(criteria as ProductCriteriaInput)).toThrow();
  });
  it("normalizes Category UUID syntax without using it as Store authority", () => {
    expect(
      normalizeProductCriteria({ category: "15913D0D-10A1-40ED-BC6F-3E491F81A56F" }).category,
    ).toBe("15913d0d-10a1-40ed-bc6f-3e491f81a56f");
  });
  it("retains cursor-bound microseconds in explicit creation and updated criteria", () => {
    const criteria = {
      created_from: "2025-09-15T09:12:34.123456+00:00",
      created_to: "2026-09-16T09:12:34.123456+00:00",
      updated_from: "2026-09-01T00:00:00+02:00",
      updated_to: "2026-09-10T00:00:00+02:00",
    };
    expect(normalizeProductCriteria(criteria)).toMatchObject(criteria);
  });
  it.each([
    { created_from: "2026-01-01T00:00:00Z" },
    { updated_to: "2026-01-01T00:00:00Z" },
    { created_from: "2026-02-01T00:00:00Z", created_to: "2026-01-01T00:00:00Z" },
    { updated_from: "2025-01-01T00:00:00Z", updated_to: "2026-01-03T00:00:00Z" },
    { created_from: "2026-01-01", created_to: "2026-01-02" },
    { created_from: "2026-02-30T00:00:00Z", created_to: "2026-03-03T00:00:00Z" },
  ])("rejects incomplete or invalid ranges %j", (criteria) => {
    expect(() => normalizeProductCriteria(criteria)).toThrow();
  });
  it("enforces the exact 366-day boundary including offset equivalence and microseconds", () => {
    expect(
      isValidCatalogRange("2025-09-15T09:12:34.123456Z", "2026-09-16T11:12:34.123456+02:00"),
    ).toBe(true);
    expect(isValidCatalogRange("2025-09-15T09:12:34.123456Z", "2026-09-16T09:12:34.123457Z")).toBe(
      false,
    );
    expect(isValidCatalogRange("2026-09-16T09:12:34.123457Z", "2026-09-16T09:12:34.123456Z")).toBe(
      false,
    );
    expect(isValidCatalogRange("invalid", "invalid")).toBe(false);
  });
  it("uses only the bounded Category lookup contract", () => {
    expect(normalizeCategoryCriteria({ q: "  ＡＢ  ", status: "hidden", per_page: 100 })).toEqual({
      q: "AB",
      status: "hidden",
      sort: "newest",
      per_page: 100,
    });
    expect(() => normalizeCategoryCriteria({ per_page: 101 })).toThrow();
    expect(() => normalizeCategoryCriteria({ category: "unsupported" } as never)).toThrow();
  });
});
