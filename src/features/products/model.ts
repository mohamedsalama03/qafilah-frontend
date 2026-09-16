import { z } from "zod";

export const productSorts = ["newest", "oldest", "name_asc", "name_desc"] as const;
export const productStatuses = ["draft", "published", "archived"] as const;
export const catalogCurrencyExponents = { LYD: 3, USD: 2, EUR: 2 } as const;

export const catalogUuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const catalogTimestampSchema = z.iso
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
export const catalogCursorSchema = z.string().min(1).max(4096);

const normalizedSearchSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .refine((value) => {
    const length = [...value].length;
    return length >= 2 && length <= 80 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
  }, "Enter a Product-name prefix of 2–80 characters.");

const optionalSearchSchema = z.preprocess(
  (value) => (typeof value === "string" && !value.normalize("NFKC").trim() ? undefined : value),
  normalizedSearchSchema.optional(),
);

// Compare at Laravel's microsecond precision without truncating opaque cursor-bound ranges.
function timestampMicroseconds(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
  return (
    BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}

export function isValidCatalogRange(from: string, to: string): boolean {
  if (
    !catalogTimestampSchema.safeParse(from).success ||
    !catalogTimestampSchema.safeParse(to).success
  )
    return false;
  const difference = timestampMicroseconds(to) - timestampMicroseconds(from);
  return difference >= 0n && difference <= 366n * 24n * 60n * 60n * 1000000n;
}

export const productCriteriaSchema = z
  .strictObject({
    status: z.enum(productStatuses).optional(),
    category: catalogUuidSchema.optional(),
    q: optionalSearchSchema,
    sort: z.enum(productSorts).default("newest"),
    created_from: catalogTimestampSchema.optional(),
    created_to: catalogTimestampSchema.optional(),
    updated_from: catalogTimestampSchema.optional(),
    updated_to: catalogTimestampSchema.optional(),
    per_page: z.number().int().min(1).max(50).default(25),
  })
  .superRefine((value, context) => {
    for (const [from, to] of [
      ["created_from", "created_to"],
      ["updated_from", "updated_to"],
    ] as const) {
      if ((value[from] === undefined) !== (value[to] === undefined)) {
        context.addIssue({
          code: "custom",
          path: [value[from] ? to : from],
          message: "Choose both dates for this range.",
        });
      } else if (value[from] && value[to] && !isValidCatalogRange(value[from], value[to])) {
        context.addIssue({
          code: "custom",
          path: [to],
          message: "Choose an ascending range of no more than 366 days.",
        });
      }
    }
  });

export const categoryCriteriaSchema = z.strictObject({
  status: z.enum(["hidden", "visible"]).optional(),
  q: optionalSearchSchema,
  sort: z.enum(productSorts).default("newest"),
  per_page: z.number().int().min(1).max(100).default(100),
});

export type ProductCriteria = z.output<typeof productCriteriaSchema>;
export type ProductCriteriaInput = z.input<typeof productCriteriaSchema>;
export type CategoryCriteria = z.output<typeof categoryCriteriaSchema>;
export type CategoryCriteriaInput = z.input<typeof categoryCriteriaSchema>;
export type ProductSort = (typeof productSorts)[number];
export type ProductStatus = (typeof productStatuses)[number];
export type CatalogCurrency = keyof typeof catalogCurrencyExponents;
export interface CatalogMoney {
  amount: number;
  currency: CatalogCurrency;
}

/** Normalize request syntax only; the backend remains the source of Store authority and search case folding. */
export function normalizeProductCriteria(input: ProductCriteriaInput = {}): ProductCriteria {
  return productCriteriaSchema.parse(input);
}

export function normalizeCategoryCriteria(input: CategoryCriteriaInput = {}): CategoryCriteria {
  return categoryCriteriaSchema.parse(input);
}

/** Splits validated integer digits; no division, multiplication, rounding or floating-point conversion. */
export function minorUnitsToDecimal(amount: number, currency: CatalogCurrency): string {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Object.hasOwn(catalogCurrencyExponents, currency)
  )
    throw new RangeError("Money requires a safe nonnegative integer and a supported currency.");
  const exponent = catalogCurrencyExponents[currency];
  const digits = String(amount).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function formatProductPrice(product: {
  price: CatalogMoney | null;
  type: "simple" | "variant";
}): string {
  if (product.price === null) return "Price not configured";
  const { amount, currency } = product.price;
  return `${product.type === "variant" ? "From " : ""}${minorUnitsToDecimal(amount, currency)} ${currency}`;
}
