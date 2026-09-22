import { z } from "zod";

export const maximumVariantInventoryQuantity = 2_000_000_000;
export const variantInventoryQuantitySchema = z
  .number()
  .int()
  .min(0)
  .max(maximumVariantInventoryQuantity);
export const variantInventoryPayloadSchema = z.strictObject({
  quantity: variantInventoryQuantitySchema,
});

/** Laravel accepts integer strings; this form deliberately submits JSON numeric integers. */
export function parseVariantInventoryQuantity(input: string): number {
  if (!/^\d+$/.test(input.trim()))
    throw new Error("Enter a whole quantity from 0 to 2,000,000,000.");
  return variantInventoryQuantitySchema.parse(Number(input.trim()));
}

export function variantInventoryQuantityLabel(quantity: number | null): string {
  return quantity === null ? "Not configured" : new Intl.NumberFormat("en").format(quantity);
}

export const variantInventoryAvailabilityLabels = {
  unavailable: "Not configured",
  out_of_stock: "Out of stock",
  in_stock: "In stock",
} as const;
