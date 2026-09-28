import { z } from "zod";
import type { ProductReadInput } from "../products/contracts";
import type { ProductVariantReadInput } from "../variants/contracts";
import { priceAmountSchema, pricePayloadSchema } from "./model";

export const pricingSchema = z.strictObject({
  price: z
    .strictObject({ amount: priceAmountSchema, currency: z.enum(["LYD", "USD", "EUR"]) })
    .nullable(),
});
const pricingEnvelope = z.strictObject({
  success: z.literal(true),
  data: pricingSchema,
  meta: z.strictObject({ request_id: z.uuid() }),
  message: z.null(),
});
export type Pricing = z.infer<typeof pricingSchema>;
export type PricePayload = z.infer<typeof pricePayloadSchema>;
export type ProductPricingReadInput = ProductReadInput;
export type VariantPricingReadInput = ProductVariantReadInput;
export interface UpdateProductPricingInput extends ProductPricingReadInput {
  data: PricePayload;
}
export interface UpdateVariantPricingInput extends VariantPricingReadInput {
  data: PricePayload;
}
export function decodePricing(payload: unknown): Pricing {
  return pricingEnvelope.parse(payload).data;
}
