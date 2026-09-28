import { z } from "zod";
import { catalogCurrencyExponents, type CatalogCurrency } from "../products/model";

export const maximumPriceAmount = 999_999_999_999;
export const priceAmountSchema = z.number().int().min(1).max(maximumPriceAmount);
export const pricePayloadSchema = z.strictObject({ amount: priceAmountSchema });

/** Decimal text is authoritative until its exact minor-unit digits pass the bound. */
export function parsePriceAmount(input: string, currency: CatalogCurrency): number {
  if (!Object.hasOwn(catalogCurrencyExponents, currency)) throw new Error("Unsupported currency.");
  const exponent = catalogCurrencyExponents[currency];
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match || (match[2]?.length ?? 0) > exponent)
    throw new Error(`Enter a positive price with at most ${exponent} decimal places.`);
  const digits = (match[1] + (match[2] ?? "").padEnd(exponent, "0")).replace(/^0+/, "");
  const maximum = String(maximumPriceAmount);
  if (
    !digits ||
    digits.length > maximum.length ||
    (digits.length === maximum.length && digits > maximum)
  )
    throw new Error("Enter a price within the supported range.");
  // The proven bound is below Number.MAX_SAFE_INTEGER. No floating-point money arithmetic.
  return priceAmountSchema.parse(Number(digits));
}
