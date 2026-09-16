import { z } from "zod";
import {
  catalogCursorSchema,
  catalogTimestampSchema,
  catalogUuidSchema,
  categoryCriteriaSchema,
  isValidCatalogRange,
  productCriteriaSchema,
  productStatuses,
  type CategoryCriteriaInput,
  type ProductCriteriaInput,
} from "./model";

const canonicalText = (minimum: number, maximum: number, multiline = false) =>
  z.string().refine((value) => {
    const length = [...value].length;
    const controlCandidate = multiline ? value.replaceAll("\n", "") : value;
    return (
      length >= minimum &&
      length <= maximum &&
      !!value.trim() &&
      !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(controlCandidate)
    );
  });
const slug = z
  .string()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const meta = z.strictObject({ request_id: catalogUuidSchema });
const distinctIds = (items: { id: string }[]) =>
  new Set(items.map(({ id }) => id)).size === items.length;

export const merchantCategorySchema = z.strictObject({
  id: catalogUuidSchema,
  name: canonicalText(2, 120),
  slug,
  seo_title: canonicalText(1, 70).nullable(),
  seo_description: canonicalText(1, 320).nullable(),
  status: z.enum(["hidden", "visible"]),
  created_at: catalogTimestampSchema,
  updated_at: catalogTimestampSchema,
});

const money = z.strictObject({
  amount: z.number().int().positive().max(999999999999).safe(),
  currency: z.enum(["LYD", "USD", "EUR"]),
});
export const merchantProductSchema = z
  .strictObject({
    id: catalogUuidSchema,
    name: canonicalText(2, 160),
    slug,
    description: canonicalText(1, 5000, true),
    seo_title: canonicalText(1, 70).nullable(),
    seo_description: canonicalText(1, 320).nullable(),
    status: z.enum(productStatuses),
    type: z.enum(["simple", "variant"]),
    requires_shipping: z.boolean(),
    published_at: catalogTimestampSchema.nullable(),
    price: money.nullable(),
    quantity: z.number().int().min(0).max(2000000000).nullable(),
    availability: z.enum(["unavailable", "out_of_stock", "in_stock"]),
    categories: z.array(merchantCategorySchema).max(20).refine(distinctIds),
    created_at: catalogTimestampSchema,
    updated_at: catalogTimestampSchema,
  })
  .refine((product) =>
    product.type === "variant"
      ? product.quantity === null
      : product.availability ===
        (product.quantity === null
          ? "unavailable"
          : product.quantity === 0
            ? "out_of_stock"
            : "in_stock"),
  );

const paginationSchema = (maximum: number) =>
  z.strictObject({
    per_page: z.number().int().min(1).max(maximum),
    next_cursor: catalogCursorSchema.nullable(),
    previous_cursor: catalogCursorSchema.nullable(),
  });
const effectiveRangeSchema = z
  .strictObject({
    created_from: catalogTimestampSchema,
    created_to: catalogTimestampSchema,
  })
  .refine(({ created_from, created_to }) => isValidCatalogRange(created_from, created_to));

const productEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: merchantProductSchema,
  meta,
  message: z.null(),
});
const productPageSchema = z
  .strictObject({
    success: z.literal(true),
    data: z.array(merchantProductSchema).max(50).refine(distinctIds),
    meta: z.strictObject({
      request_id: catalogUuidSchema,
      pagination: paginationSchema(50),
      effective_range: effectiveRangeSchema,
    }),
    message: z.null(),
  })
  .refine((page) => page.data.length <= page.meta.pagination.per_page);
const categoryPageSchema = z
  .strictObject({
    success: z.literal(true),
    data: z.array(merchantCategorySchema).max(100).refine(distinctIds),
    meta: z.strictObject({
      request_id: catalogUuidSchema,
      limit: z.number().int().min(1).max(100),
      pagination: paginationSchema(100),
    }),
    message: z.null(),
  })
  .refine(
    (page) =>
      page.meta.limit === page.meta.pagination.per_page && page.data.length <= page.meta.limit,
  );

export type MerchantProduct = z.infer<typeof merchantProductSchema>;
export type MerchantCategory = z.infer<typeof merchantCategorySchema>;
export interface ProductReadInput {
  storeUuid: string;
  productUuid: string;
}
export interface ProductListInput {
  storeUuid: string;
  criteria?: ProductCriteriaInput;
  cursor?: string | null;
}
export interface CategoryListInput {
  storeUuid: string;
  criteria?: CategoryCriteriaInput;
  cursor?: string | null;
}
export interface ProductPage {
  products: MerchantProduct[];
  pagination: z.infer<ReturnType<typeof paginationSchema>>;
  effectiveRange: z.infer<typeof effectiveRangeSchema>;
}
export interface CategoryPage {
  categories: MerchantCategory[];
  pagination: z.infer<ReturnType<typeof paginationSchema>>;
  limit: number;
}

function queryString(
  criteria: Record<string, string | number | undefined>,
  cursor?: string | null,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria))
    if (value !== undefined) query.set(key, String(value));
  if (cursor !== undefined && cursor !== null)
    query.set("cursor", catalogCursorSchema.parse(cursor));
  return query.toString();
}

export function productQueryString(
  criteria: ProductCriteriaInput = {},
  cursor?: string | null,
): string {
  return queryString(productCriteriaSchema.parse(criteria), cursor);
}
export function categoryQueryString(
  criteria: CategoryCriteriaInput = {},
  cursor?: string | null,
): string {
  return queryString(categoryCriteriaSchema.parse(criteria), cursor);
}
export function decodeMerchantProduct(payload: unknown): MerchantProduct {
  return productEnvelopeSchema.parse(payload).data;
}
export function decodeProductPage(payload: unknown): ProductPage {
  const parsed = productPageSchema.parse(payload);
  return {
    products: parsed.data,
    pagination: parsed.meta.pagination,
    effectiveRange: parsed.meta.effective_range,
  };
}
export function decodeCategoryPage(payload: unknown): CategoryPage {
  const parsed = categoryPageSchema.parse(payload);
  return { categories: parsed.data, pagination: parsed.meta.pagination, limit: parsed.meta.limit };
}
