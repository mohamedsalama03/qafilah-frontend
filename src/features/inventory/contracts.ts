import { z } from "zod";
import type { ProductReadInput } from "../products/contracts";
import { inventoryPayloadSchema, inventoryQuantitySchema } from "./model";

export const productInventorySchema = z
  .strictObject({
    quantity: inventoryQuantitySchema.nullable(),
    availability: z.enum(["unavailable", "out_of_stock", "in_stock"]),
  })
  .refine((value) =>
    value.quantity === null
      ? value.availability === "unavailable"
      : value.quantity === 0
        ? value.availability === "out_of_stock"
        : value.availability === "in_stock",
  );

const inventoryEnvelope = z.strictObject({
  success: z.literal(true),
  data: productInventorySchema,
  meta: z.strictObject({ request_id: z.uuid() }),
  message: z.null(),
});

export type ProductInventory = z.infer<typeof productInventorySchema>;
export type InventoryPayload = z.infer<typeof inventoryPayloadSchema>;
export type ProductInventoryReadInput = ProductReadInput;
export interface UpdateProductInventoryInput extends ProductInventoryReadInput {
  data: InventoryPayload;
}

export function decodeProductInventory(payload: unknown): ProductInventory {
  return inventoryEnvelope.parse(payload).data;
}
