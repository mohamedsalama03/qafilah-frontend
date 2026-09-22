import { z } from "zod";
import { catalogTimestampSchema, catalogUuidSchema } from "../products/model";
import {
  canonicalizeVariantText,
  maximumOptionValues,
  maximumProductOptions,
  maximumProductVariants,
  optionPositionSchema,
  variantStatuses,
  variantTextSchema,
  variantValueIdsSchema,
  type CreateVariantPayload,
  type OptionPayload,
  type UpdateVariantPayload,
  type ValuePayload,
} from "./model";

export type {
  CreateVariantPayload,
  OptionPayload,
  UpdateVariantPayload,
  ValuePayload,
} from "./model";

const resourceText = (maximum: number) =>
  z
    .string()
    .refine(
      (value) =>
        value === canonicalizeVariantText(value) &&
        variantTextSchema(maximum).safeParse(value).success,
    );
const distinctIds = (values: { id: string }[]) =>
  new Set(values.map((value) => value.id)).size === values.length;

export const merchantProductOptionValueSchema = z.strictObject({
  id: catalogUuidSchema,
  value: resourceText(80),
  position: optionPositionSchema,
});
export const merchantProductOptionSchema = z.strictObject({
  id: catalogUuidSchema,
  name: resourceText(80),
  position: optionPositionSchema,
  values: z
    .array(merchantProductOptionValueSchema)
    .max(maximumOptionValues)
    .refine(distinctIds)
    .refine(
      (values) => new Set(values.map(({ value }) => value.toLowerCase())).size === values.length,
    ),
});
export const merchantVariantSchema = z
  .strictObject({
    id: catalogUuidSchema,
    value_ids: variantValueIdsSchema,
    sku: resourceText(64).nullable(),
    status: z.enum(variantStatuses),
    price: z
      .strictObject({
        amount: z.number().int().positive().max(999999999999),
        currency: z.enum(["LYD", "USD", "EUR"]),
      })
      .nullable(),
    quantity: z.number().int().min(0).max(2_000_000_000).nullable(),
    availability: z.enum(["unavailable", "out_of_stock", "in_stock"]),
    created_at: catalogTimestampSchema,
    updated_at: catalogTimestampSchema,
  })
  .refine(
    (variant) =>
      variant.availability ===
      (variant.quantity === null
        ? "unavailable"
        : variant.quantity === 0
          ? "out_of_stock"
          : "in_stock"),
  );

const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    success: z.literal(true),
    data,
    meta: z.strictObject({ request_id: catalogUuidSchema }),
    message: z.null(),
  });
const optionsSchema = z
  .array(merchantProductOptionSchema)
  .max(maximumProductOptions)
  .refine(distinctIds)
  .refine(
    (options) => new Set(options.map(({ name }) => name.toLowerCase())).size === options.length,
  )
  .refine((options) => distinctIds(options.flatMap((option) => option.values)));
const variantsSchema = z
  .array(merchantVariantSchema)
  .max(maximumProductVariants)
  .refine(distinctIds)
  .refine(
    (variants) =>
      new Set(variants.map((variant) => [...variant.value_ids].sort().join("/"))).size ===
      variants.length,
  )
  .refine((variants) => {
    const skus = variants.flatMap((variant) => (variant.sku === null ? [] : [variant.sku]));
    return new Set(skus).size === skus.length;
  });

export type MerchantProductOption = z.infer<typeof merchantProductOptionSchema>;
export type MerchantProductOptionValue = z.infer<typeof merchantProductOptionValueSchema>;
export type MerchantVariant = z.infer<typeof merchantVariantSchema>;
export interface ProductOptionsReadInput {
  storeUuid: string;
  productUuid: string;
}
export type ProductVariantsReadInput = ProductOptionsReadInput;
export interface ProductVariantReadInput extends ProductOptionsReadInput {
  variantUuid: string;
}
export interface CreateProductOptionInput extends ProductOptionsReadInput {
  data: OptionPayload;
}
export interface UpdateProductOptionInput extends CreateProductOptionInput {
  optionUuid: string;
}
export interface CreateProductOptionValueInput extends ProductOptionsReadInput {
  optionUuid: string;
  data: ValuePayload;
}
export interface UpdateProductOptionValueInput extends CreateProductOptionValueInput {
  valueUuid: string;
}
export interface CreateProductVariantInput extends ProductOptionsReadInput {
  data: CreateVariantPayload;
}
export interface UpdateProductVariantInput extends ProductVariantReadInput {
  data: UpdateVariantPayload;
}

export function decodeMerchantProductOption(payload: unknown): MerchantProductOption {
  return envelope(merchantProductOptionSchema).parse(payload).data;
}
export function decodeProductOptions(payload: unknown): MerchantProductOption[] {
  return envelope(optionsSchema).parse(payload).data;
}
export function decodeMerchantVariant(payload: unknown): MerchantVariant {
  return envelope(merchantVariantSchema).parse(payload).data;
}
export function decodeProductVariants(payload: unknown): MerchantVariant[] {
  return envelope(variantsSchema).parse(payload).data;
}
