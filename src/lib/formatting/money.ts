import { decimalSeparator, localizeDigits, validateDisplayLocale } from "./locale";

export interface MoneyDisplayOptions {
  currency: string;
  locale: string;
  currencyDisplay?: "code" | "symbol" | "narrowSymbol";
}

/**
 * Formats a backend decimal projection. Never totals, converts currencies, or rounds.
 * Backend fractional precision is preserved, including trailing zeros. Intl supplies
 * currency padding and placement; extra supplied precision is never discarded.
 */
export function formatMoney(amount: string, options: MoneyDisplayOptions): string {
  validateDisplayLocale(options.locale);
  if (!/^[A-Z]{3}$/.test(options.currency))
    throw new RangeError("An explicit currency code is required.");
  if (typeof amount !== "string" || amount.length > 4096 || !/^-?\d+(?:\.\d+)?$/.test(amount)) {
    throw new RangeError("Money display requires a bounded plain decimal string.");
  }
  const [integer, suppliedFraction = ""] = amount.split(".");
  const currencyFormatter = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency,
    currencyDisplay: options.currencyDisplay ?? "code",
  });
  const fraction = suppliedFraction.padEnd(
    currencyFormatter.resolvedOptions().minimumFractionDigits ?? 0,
    "0",
  );
  const integerValue = BigInt(integer);
  const negativeZero = integer.startsWith("-") && integerValue === 0n;
  const parts = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency,
    currencyDisplay: options.currencyDisplay ?? "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(negativeZero ? -1n : integerValue);
  let integerEnd = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].type === "integer") {
      integerEnd = index;
      if (negativeZero)
        parts[index] = { type: "integer", value: localizeDigits("0", options.locale) };
    }
  }
  if (fraction)
    parts.splice(
      integerEnd + 1,
      0,
      { type: "decimal", value: decimalSeparator(options.locale) },
      { type: "fraction", value: localizeDigits(fraction, options.locale) },
    );
  return parts.map((part) => part.value).join("");
}
