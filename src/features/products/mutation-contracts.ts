import type { ProductReadInput } from "./contracts";
import type { CreateProductPayload, UpdateProductPayload } from "./mutation-model";

export interface CreateProductInput {
  storeUuid: string;
  data: CreateProductPayload;
}
export interface UpdateProductInput extends ProductReadInput {
  data: UpdateProductPayload;
}
export type ProductLifecycleInput = ProductReadInput;

// Only reviewed Laravel fields are decoded; raw backend messages remain undisplayable.
export const productMutationErrorFields = [
  "name",
  "slug",
  "description",
  "seo_title",
  "seo_description",
  "category_ids",
  ...Array.from({ length: 20 }, (_, index) => `category_ids.${index}`),
  "type",
  "requires_shipping",
  "product",
  "status",
] as const;
