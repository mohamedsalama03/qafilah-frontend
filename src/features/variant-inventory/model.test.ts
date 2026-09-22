import { describe, expect, it } from "vitest";
import {
  parseVariantInventoryQuantity,
  variantInventoryAvailabilityLabels,
  variantInventoryPayloadSchema,
  variantInventoryQuantityLabel,
} from "./model";

describe("Variant absolute inventory input", () => {
  it.each([0, 1, 2_000_000_000])("accepts numeric quantity %i", (quantity) => {
    expect(variantInventoryPayloadSchema.parse({ quantity })).toEqual({ quantity });
    expect(parseVariantInventoryQuantity(String(quantity))).toBe(quantity);
  });

  it.each([null, undefined, "5", true, -1, 1.5, 2_000_000_001, NaN, Infinity])(
    "rejects invalid JSON quantity %s without coercion",
    (quantity) => {
      expect(() => variantInventoryPayloadSchema.parse({ quantity })).toThrow();
    },
  );

  it.each(["", " ", "1.0", "1e3", "-1", "+1", "2,000", "2000000001", "Infinity"])(
    "rejects form text %s that is not an in-range whole quantity",
    (text) => {
      expect(() => parseVariantInventoryQuantity(text)).toThrow();
    },
  );

  it.each(["delta", "increment", "decrement", "expected_quantity", "version", "location_id"])(
    "rejects unsupported payload field %s",
    (field) => {
      expect(() => variantInventoryPayloadSchema.parse({ quantity: 5, [field]: 1 })).toThrow();
    },
  );

  it("distinguishes unconfigured stock from configured zero stock", () => {
    expect(variantInventoryQuantityLabel(null)).toBe("Not configured");
    expect(variantInventoryQuantityLabel(0)).toBe("0");
    expect(variantInventoryQuantityLabel(2_000_000_000)).toBe("2,000,000,000");
    expect(variantInventoryAvailabilityLabels).toEqual({
      unavailable: "Not configured",
      out_of_stock: "Out of stock",
      in_stock: "In stock",
    });
  });
});
