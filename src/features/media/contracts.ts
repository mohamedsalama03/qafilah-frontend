import { z } from "zod";
import { isSafeMediaPath } from "@/lib/media-url";
import { catalogUuidSchema } from "../products/model";
import { canonicalizeVariantText } from "../variants/model";
import {
  maximumMediaBytes,
  maximumMediaDimension,
  maximumMediaPixels,
  maximumProductMedia,
  maximumVariantMedia,
  mediaMimeTypes,
  mediaPositionSchema,
  type CreateProductMediaPayload,
  type CreateVariantMediaPayload,
  type UpdateProductMediaPayload,
  type UpdateVariantMediaPayload,
} from "./model";

export type MediaTarget =
  | { kind: "product"; productUuid: string }
  | { kind: "variant"; productUuid: string; variantUuid: string };
const returnedAltText = z
  .string()
  .refine(
    (value) =>
      value === canonicalizeVariantText(value) &&
      [...value].length >= 1 &&
      [...value].length <= 250 &&
      !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value),
  )
  .nullable();
const shape = {
  id: catalogUuidSchema,
  url: z.string().refine(isSafeMediaPath),
  mime_type: z.enum(mediaMimeTypes),
  byte_size: z.number().int().min(1).max(maximumMediaBytes),
  width: z.number().int().min(1).max(maximumMediaDimension),
  height: z.number().int().min(1).max(maximumMediaDimension),
  alt_text: returnedAltText,
  position: mediaPositionSchema,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
};
export const productMediaSchema = z
  .strictObject({ ...shape, is_primary: z.boolean() })
  .refine((value) => value.width * value.height <= maximumMediaPixels);
export const variantMediaSchema = z
  .strictObject(shape)
  .refine((value) => value.width * value.height <= maximumMediaPixels);
export type ProductMedia = z.infer<typeof productMediaSchema>;
export type VariantMedia = z.infer<typeof variantMediaSchema>;
export type MerchantMedia = ProductMedia | VariantMedia;
export interface ProductMediaReadInput {
  storeUuid: string;
  productUuid: string;
}
export interface VariantMediaReadInput extends ProductMediaReadInput {
  variantUuid: string;
}
export interface CreateProductMediaInput extends ProductMediaReadInput {
  data: CreateProductMediaPayload;
}
export interface CreateVariantMediaInput extends VariantMediaReadInput {
  data: CreateVariantMediaPayload;
}
export interface UpdateProductMediaInput extends ProductMediaReadInput {
  mediaUuid: string;
  data: UpdateProductMediaPayload;
}
export interface UpdateVariantMediaInput extends VariantMediaReadInput {
  mediaUuid: string;
  data: UpdateVariantMediaPayload;
}
export interface DeleteProductMediaInput extends ProductMediaReadInput {
  mediaUuid: string;
}
export interface DeleteVariantMediaInput extends VariantMediaReadInput {
  mediaUuid: string;
}
const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    success: z.literal(true),
    data,
    meta: z.strictObject({ request_id: z.uuid() }),
    message: z.null(),
  });
const orderedUnique = (items: MerchantMedia[]) =>
  new Set(items.map((item) => item.id)).size === items.length &&
  items.every((item, index) => index === 0 || items[index - 1]!.position <= item.position);
const productCollection = z
  .array(productMediaSchema)
  .max(maximumProductMedia)
  .refine(orderedUnique)
  .refine((items) => items.length === 0 || items.filter((item) => item.is_primary).length === 1);
const variantCollection = z
  .array(variantMediaSchema)
  .max(maximumVariantMedia)
  .refine(orderedUnique);
export const decodeProductMedia = (payload: unknown): ProductMedia =>
  envelope(productMediaSchema).parse(payload).data;
export const decodeVariantMedia = (payload: unknown): VariantMedia =>
  envelope(variantMediaSchema).parse(payload).data;
export const decodeProductMediaList = (payload: unknown): ProductMedia[] =>
  envelope(productCollection).parse(payload).data;
export const decodeVariantMediaList = (payload: unknown): VariantMedia[] =>
  envelope(variantCollection).parse(payload).data;
export function decodeDeletedMedia(payload: unknown): void {
  if (payload !== undefined) throw new Error("Media deletion must have no response body.");
}
