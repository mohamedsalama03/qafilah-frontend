import { z } from "zod";
import type { ProductVariantReadInput } from "../variants/contracts";
import { variantInventoryPayloadSchema, variantInventoryQuantitySchema } from "./model";

export const variantInventorySchema = z
  .strictObject({
    quantity: variantInventoryQuantitySchema.nullable(),
    availability: z.enum(["unavailable", "out_of_stock", "in_stock"]),
  })
  .refine((value) =>
    value.quantity === null
      ? value.availability === "unavailable"
      : value.quantity === 0
        ? value.availability === "out_of_stock"
        : value.availability === "in_stock",
  );

const variantInventoryEnvelope = z.strictObject({
  success: z.literal(true),
  data: variantInventorySchema,
  meta: z.strictObject({ request_id: z.uuid() }),
  message: z.null(),
});

export type VariantInventory = z.infer<typeof variantInventorySchema>;
export type VariantInventoryPayload = z.infer<typeof variantInventoryPayloadSchema>;
export type VariantInventoryReadInput = ProductVariantReadInput;
export interface UpdateVariantInventoryInput extends VariantInventoryReadInput {
  data: VariantInventoryPayload;
}

export function decodeVariantInventory(payload: unknown): VariantInventory {
  return variantInventoryEnvelope.parse(payload).data;
}
