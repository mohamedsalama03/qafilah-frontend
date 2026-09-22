import { z } from "zod";
import { catalogUuidSchema } from "../products/model";

export const maximumProductOptions = 3;
export const maximumOptionValues = 20;
export const maximumProductVariants = 100;
export const variantStatuses = ["active", "inactive"] as const;
export const variantPermissions = {
  view: "products.variants.view",
  create: "products.variants.create",
  update: "products.variants.update",
} as const;

/** Mirrors Laravel CatalogPlainText before measuring Unicode code points. */
export function canonicalizeVariantText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .normalize("NFKC")
    .replace(/^[\p{Z}\u0009-\u000d\u0085]+|[\p{Z}\u0009-\u000d\u0085]+$/gu, "");
}

export const variantTextSchema = (maximum: number) =>
  z
    .string()
    .transform(canonicalizeVariantText)
    .refine(
      (value) =>
        [...value].length >= 1 &&
        [...value].length <= maximum &&
        !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value),
      `Use 1–${maximum} characters of supported single-line text.`,
    );

export const optionPositionSchema = z.number().int().min(0).max(10000);
export const optionPayloadSchema = z.strictObject({
  name: variantTextSchema(80),
  position: optionPositionSchema,
});
export const valuePayloadSchema = z.strictObject({
  value: variantTextSchema(80),
  position: optionPositionSchema,
});
export const variantValueIdsSchema = z
  .array(catalogUuidSchema)
  .min(1)
  .max(maximumProductOptions)
  .refine((ids) => new Set(ids).size === ids.length, "Select each Value only once.");
export const createVariantPayloadSchema = z.strictObject({
  value_ids: variantValueIdsSchema,
  sku: variantTextSchema(64).nullable().optional(),
});
export const updateVariantPayloadSchema = z
  .strictObject({
    sku: variantTextSchema(64).nullable().optional(),
    status: z.enum(variantStatuses).optional(),
  })
  .refine((value) => value.sku !== undefined || value.status !== undefined, {
    path: ["variant"],
    message: "Change the SKU or status.",
  });

export type OptionPayload = z.infer<typeof optionPayloadSchema>;
export type ValuePayload = z.infer<typeof valuePayloadSchema>;
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;
export type UpdateVariantPayload = z.infer<typeof updateVariantPayloadSchema>;

/** Current configuration helps the form; Laravel rechecks ownership and completeness. */
export function isCompleteVariantCombination(
  options: readonly { values: readonly { id: string }[] }[],
  valueIds: readonly string[],
): boolean {
  const parsed = variantValueIdsSchema.safeParse(valueIds);
  if (!parsed.success || options.length !== parsed.data.length) return false;
  return options.every(
    (option) =>
      option.values.filter((value) => parsed.data.includes(value.id.toLowerCase())).length === 1,
  );
}
