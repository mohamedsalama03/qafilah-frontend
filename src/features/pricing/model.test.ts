import { describe, expect, it } from "vitest";
import { catalogCurrencyExponents, minorUnitsToDecimal } from "../products/model";
import { parsePriceAmount, pricePayloadSchema } from "./model";
import { decodePricing } from "./contracts";

describe("exact pricing money", () => {
  it("uses the published currency exponents", () =>
    expect(catalogCurrencyExponents).toEqual({ LYD: 3, USD: 2, EUR: 2 }));
  it.each(["LYD", "USD", "EUR"] as const)("round trips exact minor units for %s", (currency) => {
    for (const amount of [1, 9, 10, 99, 100, 101, 1000, 12345, 999999999998, 999999999999]) {
      expect(() => parsePriceAmount(minorUnitsToDecimal(amount, currency), currency)).not.toThrow();
      expect(parsePriceAmount(minorUnitsToDecimal(amount, currency), currency)).toBe(amount);
    }
  });
  it.each([
    ["LYD", "0.001", 1],
    ["USD", "0.01", 1],
    ["EUR", "0.01", 1],
    ["LYD", "999999999.999", 999999999999],
    ["USD", "9999999999.99", 999999999999],
    ["EUR", "9999999999.99", 999999999999],
    ["LYD", "00012.030", 12030],
    ["USD", "00012.30", 1230],
    ["EUR", "12", 1200],
    ["LYD", " 12.3 ", 12300],
  ] as const)("converts %s %s without rounding", (currency, text, expected) => {
    expect(() => parsePriceAmount(text, currency)).not.toThrow();
    expect(parsePriceAmount(text, currency)).toBe(expected);
  });
  it.each([
    "",
    " ",
    "0",
    "0.00",
    "-1",
    "+1",
    "1e2",
    "1E2",
    "NaN",
    "Infinity",
    "1,20",
    "1 200",
    ".5",
    "1.",
    "1.2.3",
    "١.٢",
    "0x10",
    "1\n2",
    "9999999999999999999999999999999999999999999",
    "0.0001",
    "1.2300",
  ])("rejects malformed/out-of-range decimal text %j", (text) => {
    for (const currency of ["LYD", "USD", "EUR"] as const)
      expect(() => parsePriceAmount(text, currency)).toThrow();
  });
  it.each(["USD", "EUR"] as const)("rejects excess precision for %s", (currency) =>
    expect(() => parsePriceAmount("1.001", currency)).toThrow(),
  );
  it.each([0, -1, 1000000000000, 1.5, "1", null, true, {}, []])(
    "requires a strict positive JSON integer: %j",
    (amount) => expect(pricePayloadSchema.safeParse({ amount }).success).toBe(false),
  );
  it("never submits currency or accepts extra payload fields", () =>
    expect(pricePayloadSchema.safeParse({ amount: 1, currency: "LYD" }).success).toBe(false));
});
describe("pricing response boundary", () => {
  const envelope = (price: unknown) => ({
    success: true,
    data: { price },
    meta: { request_id: "11111111-1111-4111-8111-111111111111" },
    message: null,
  });
  it("preserves unconfigured price", () =>
    expect(decodePricing(envelope(null))).toEqual({ price: null }));
  it.each(["LYD", "USD", "EUR"])("decodes %s money", (currency) =>
    expect(decodePricing(envelope({ amount: 1, currency }))).toEqual({
      price: { amount: 1, currency },
    }),
  );
  it.each([
    { amount: 0, currency: "LYD" },
    { amount: 1, currency: "GBP" },
    { amount: "1", currency: "USD" },
    { amount: 1 },
    { amount: 1, currency: null },
    { amount: 1, currency: "EUR", version: 1 },
  ])("rejects malformed money %j", (price) =>
    expect(() => decodePricing(envelope(price))).toThrow(),
  );
});
