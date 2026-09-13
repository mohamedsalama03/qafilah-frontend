import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";
import { formatTimestamp } from "./timestamp";

// Synthetic formatter inputs only; these are never Merchant projections or dashboard fixtures.
describe("precise money display", () => {
  it("preserves digits beyond floating-point precision", () => {
    expect(
      formatMoney("123456789012345678901234567890.12345678901234567890", {
        currency: "USD",
        locale: "en-US",
      }),
    ).toBe("USD\u00a0123,456,789,012,345,678,901,234,567,890.12345678901234567890");
  });
  it("preserves authoritative trailing digits without rounding to currency scale", () => {
    expect(formatMoney("12.34500", { currency: "USD", locale: "en-US" })).toBe("USD\u00a012.34500");
    expect(formatMoney("12.345", { currency: "JPY", locale: "en-US" })).toBe("JPY\u00a012.345");
  });
  it("uses the supplied currency's standard padding without a global currency assumption", () => {
    expect(formatMoney("12", { currency: "USD", locale: "en-US" })).toBe("USD\u00a012.00");
    expect(formatMoney("12", { currency: "JPY", locale: "en-US" })).toBe("JPY\u00a012");
    expect(formatMoney("12", { currency: "LYD", locale: "en-US" })).toBe("LYD\u00a012.000");
  });
  it("preserves the sign for a negative amount below one", () => {
    expect(formatMoney("-0.05", { currency: "USD", locale: "en-US" })).toBe("-USD\u00a00.05");
  });
  it("uses explicit regional separators and currency placement", () => {
    expect(formatMoney("1234.50", { currency: "EUR", locale: "de-DE" })).toBe("1.234,50\u00a0EUR");
    expect(
      formatMoney("1234.50", { currency: "EUR", locale: "de-DE", currencyDisplay: "symbol" }),
    ).toBe("1.234,50\u00a0€");
  });
  it("localizes fractional digits without converting the amount to a number", () => {
    const value = formatMoney("1234.56789", { currency: "LYD", locale: "ar-LY-u-nu-arab" });
    expect(value).toContain("١٬٢٣٤٫٥٦٧٨٩");
    expect(value).toContain("LYD");
  });
  it.each(["NaN", "Infinity", "1e6", "1,000.00", " 12.00 ", "", ".5", "12."])(
    "rejects ambiguous amount input %s",
    (amount) => {
      expect(() => formatMoney(amount, { currency: "USD", locale: "en-US" })).toThrow(RangeError);
    },
  );
  it("requires an explicit currency and supported locale", () => {
    expect(() => formatMoney("1", { currency: "", locale: "en-US" })).toThrow();
    expect(() => formatMoney("1", { currency: "USD", locale: "" })).toThrow();
    expect(() => formatMoney("1", { currency: "USD", locale: "zz-ZZ" })).toThrow();
    expect(() =>
      Reflect.apply(formatMoney, undefined, [1.25, { currency: "USD", locale: "en-US" }]),
    ).toThrow();
  });
});

describe("explicit timestamp display", () => {
  it("displays equivalent offset and UTC timestamps as the same instant", () => {
    const options = { locale: "en-GB", timeZone: "Africa/Tripoli" };
    expect(formatTimestamp("2026-09-13T10:30:45+02:00", options)).toBe(
      formatTimestamp("2026-09-13T08:30:45Z", options),
    );
  });
  it("requires and visibly applies the chosen display timezone", () => {
    const utc = formatTimestamp("2026-09-13T08:30:45Z", { locale: "en-GB", timeZone: "UTC" });
    const tripoli = formatTimestamp("2026-09-13T08:30:45Z", {
      locale: "en-GB",
      timeZone: "Africa/Tripoli",
    });
    expect(utc).toContain("08:30:45");
    expect(tripoli).toContain("10:30:45");
    expect(utc).not.toEqual(tripoli);
  });
  it("preserves server subsecond precision rather than silently truncating it", () => {
    expect(
      formatTimestamp("2026-09-13T08:30:45.123456Z", { locale: "en-GB", timeZone: "UTC" }),
    ).toContain("08:30:45.123456");
  });
  it.each([
    "2026-09-13",
    "2026-09-13T08:30:45",
    "2026-02-30T08:30:45Z",
    "2026-13-13T08:30:45Z",
    "2026-09-13T25:30:45Z",
    "09/13/2026",
    "invalid",
  ])("rejects invalid or ambiguous timestamps %s", (timestamp) => {
    expect(() => formatTimestamp(timestamp, { locale: "en-GB", timeZone: "UTC" })).toThrow();
  });
  it("never silently uses the browser timezone or locale", () => {
    expect(() =>
      formatTimestamp("2026-09-13T08:30:45Z", { locale: "en-GB", timeZone: "" }),
    ).toThrow();
    expect(() =>
      formatTimestamp("2026-09-13T08:30:45Z", { locale: "", timeZone: "UTC" }),
    ).toThrow();
    expect(() =>
      formatTimestamp("2026-09-13T08:30:45Z", { locale: "en-GB", timeZone: "Not/A-Timezone" }),
    ).toThrow();
  });
});
