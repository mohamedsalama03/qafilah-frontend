import { z } from "zod";
import type { MerchantProduct } from "./contracts";
import { catalogUuidSchema, type ProductStatus } from "./model";

// Mirrors CatalogPlainText: canonicalize before measuring Unicode code points.
const plainText = (minimum: number, maximum: number, multiline = false) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .normalize("NFKC")
        .replace(/^[\p{Z}\u0009-\u000d\u0085]+|[\p{Z}\u0009-\u000d\u0085]+$/gu, ""),
    )
    .refine(
      (value) => {
        const length = [...value].length;
        return (
          length >= minimum &&
          length <= maximum &&
          !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(multiline ? value.replaceAll("\n", "") : value)
        );
      },
      { message: `Use ${minimum}–${maximum} characters of supported plain text.` },
    );

const categoryIds = z
  .array(catalogUuidSchema)
  .max(20, "Select no more than 20 categories.")
  .refine((values) => new Set(values).size === values.length, "Select each category only once.");
const editableFields = {
  name: plainText(2, 160),
  slug: z
    .string()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
  description: plainText(1, 5000, true),
  seo_title: plainText(1, 70).nullable().optional(),
  seo_description: plainText(1, 320).nullable().optional(),
  category_ids: categoryIds.optional(),
  requires_shipping: z.boolean().optional(),
};

export const createProductPayloadSchema = z.strictObject({
  ...editableFields,
  type: z.enum(["simple", "variant"]).optional(),
});
export const updateProductPayloadSchema = z
  .strictObject(editableFields)
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Change at least one product field.",
    path: ["product"],
  });

export type CreateProductPayload = z.infer<typeof createProductPayloadSchema>;
export type UpdateProductPayload = z.infer<typeof updateProductPayloadSchema>;
export type ProductLifecycleAction = "publish" | "unpublish" | "archive";

export function normalizeCreateProductPayload(input: unknown): CreateProductPayload {
  return createProductPayloadSchema.parse(input);
}
export function normalizeUpdateProductPayload(input: unknown): UpdateProductPayload {
  return updateProductPayloadSchema.parse(input);
}

export const productMutationPermissions = {
  create: "products.create",
  update: "products.update",
  publish: "products.publish",
  unpublish: "products.publish",
  archive: "products.update",
} as const;

/** UX transition gating only; current Merchant context and backend retain authority. */
export function allowsProductTransition(status: ProductStatus, action: ProductLifecycleAction) {
  if (action === "publish") return status === "draft";
  if (action === "unpublish") return status === "published";
  return status === "draft" || status === "published";
}

/** Omit unchanged data; there is no backend version/ETag precondition. */
export function productUpdateChanges(
  current: MerchantProduct,
  candidate: UpdateProductPayload,
): UpdateProductPayload | null {
  const normalized = normalizeUpdateProductPayload(candidate);
  const changed: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(normalized)) {
    if (value === undefined) continue;
    if (field === "category_ids") {
      const ids = value as string[];
      const previous = new Set(current.categories.map(({ id }) => id));
      if (ids.length !== previous.size || ids.some((id) => !previous.has(id))) changed[field] = ids;
    } else if (value !== current[field as keyof MerchantProduct]) changed[field] = value;
  }
  return Object.keys(changed).length ? normalizeUpdateProductPayload(changed) : null;
}
