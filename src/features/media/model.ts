import { z } from "zod";
import { variantTextSchema } from "../variants/model";

export const mediaPermissions = {
  view: "products.media.view",
  create: "products.media.create",
  update: "products.media.update",
  delete: "products.media.delete",
} as const;
export const maximumProductMedia = 10;
export const maximumVariantMedia = 5;
export const maximumMediaBytes = 5_242_880;
export const maximumMediaDimension = 8_000;
export const maximumMediaPixels = 40_000_000;
export const mediaMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const mediaPositionSchema = z.number().int().min(0).max(10_000);
export const mediaAltTextSchema = variantTextSchema(250).nullable();
export const mediaImageSchema = z
  .custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "Choose a JPEG, PNG, or WebP image.",
  )
  .refine(
    (file) => file != null && file.size >= 1 && file.size <= maximumMediaBytes,
    "Choose an image up to 5 MiB.",
  )
  .refine(
    (file) => file != null && (mediaMimeTypes as readonly string[]).includes(file.type),
    "Choose a JPEG, PNG, or WebP image.",
  );
const metadata = {
  alt_text: mediaAltTextSchema.optional(),
  position: mediaPositionSchema.optional(),
};
export const productMediaUploadSchema = z.strictObject({
  image: mediaImageSchema,
  ...metadata,
  is_primary: z.boolean().optional(),
});
export const variantMediaUploadSchema = z.strictObject({ image: mediaImageSchema, ...metadata });
export const productMediaUpdateSchema = z
  .strictObject({ ...metadata, is_primary: z.literal(true).optional() })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Change at least one image field.",
  );
export const variantMediaUpdateSchema = z
  .strictObject(metadata)
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Change at least one image field.",
  );
export type CreateProductMediaPayload = z.infer<typeof productMediaUploadSchema>;
export type CreateVariantMediaPayload = z.infer<typeof variantMediaUploadSchema>;
export type UpdateProductMediaPayload = z.infer<typeof productMediaUpdateSchema>;
export type UpdateVariantMediaPayload = z.infer<typeof variantMediaUpdateSchema>;
export const normalizeCreateProductMediaPayload = (input: unknown) =>
  productMediaUploadSchema.parse(input);
export const normalizeCreateVariantMediaPayload = (input: unknown) =>
  variantMediaUploadSchema.parse(input);
export const normalizeUpdateProductMediaPayload = (input: unknown) =>
  productMediaUpdateSchema.parse(input);
export const normalizeUpdateVariantMediaPayload = (input: unknown) =>
  variantMediaUpdateSchema.parse(input);

/** Advisory browser dimension check. Laravel inspects actual bytes and remains final authority. */
export function validMediaDimensions(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= maximumMediaDimension &&
    height <= maximumMediaDimension &&
    width * height <= maximumMediaPixels
  );
}

export function mediaUploadFormData(
  data: CreateProductMediaPayload | CreateVariantMediaPayload,
): FormData {
  const form = new FormData();
  form.append("image", data.image, data.image.name);
  if (data.alt_text !== undefined) form.append("alt_text", data.alt_text ?? "");
  if (data.position !== undefined) form.append("position", String(data.position));
  if ("is_primary" in data && data.is_primary !== undefined)
    form.append("is_primary", data.is_primary ? "1" : "0");
  return form;
}

export function normalizeMediaAltText(raw: string | null): string | null {
  return mediaAltTextSchema.parse(raw === null || !raw.trim() ? null : raw);
}
export function parseMediaPosition(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error("Enter a whole position from 0 to 10,000.");
  return mediaPositionSchema.parse(Number(raw.trim()));
}
export function validateMediaImage(file: File): File {
  return mediaImageSchema.parse(file);
}
