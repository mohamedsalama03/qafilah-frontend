import { z } from "zod";

export const maximumInventoryQuantity = 2_000_000_000;
export const inventoryQuantitySchema = z.number().int().min(0).max(maximumInventoryQuantity);
export const inventoryPayloadSchema = z.strictObject({ quantity: inventoryQuantitySchema });

/** The form accepts decimal digits; the transport only receives a strict JSON integer. */
export function parseInventoryQuantity(input: string): number {
  if (!/^\d+$/.test(input.trim()))
    throw new Error("Enter a whole quantity from 0 to 2,000,000,000.");
  return inventoryQuantitySchema.parse(Number(input.trim()));
}

export function inventoryQuantityLabel(quantity: number | null): string {
  return quantity === null ? "Not configured" : new Intl.NumberFormat("en").format(quantity);
}

export const inventoryAvailabilityLabels = {
  unavailable: "Not configured",
  out_of_stock: "Out of stock",
  in_stock: "In stock",
} as const;
