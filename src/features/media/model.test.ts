// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  mediaPermissions,
  normalizeMediaAltText,
  parseMediaPosition,
  validateMediaImage,
  validMediaDimensions,
  productMediaUploadSchema,
  variantMediaUploadSchema,
  productMediaUpdateSchema,
  variantMediaUpdateSchema,
  mediaUploadFormData,
  maximumMediaBytes,
} from "./model";
const file = () => new File(["synthetic"], "image.png", { type: "image/png" });
describe("published media input boundary", () => {
  it("keeps every grant independent", () =>
    expect(Object.values(mediaPermissions)).toEqual([
      "products.media.view",
      "products.media.create",
      "products.media.update",
      "products.media.delete",
    ]));
  it("normalizes optional alt text without counting UTF-16 units", () => {
    expect(normalizeMediaAltText("  Ａ  ")).toBe("A");
    expect(normalizeMediaAltText(" ")).toBeNull();
    expect(normalizeMediaAltText(null)).toBeNull();
    expect(normalizeMediaAltText("😀".repeat(250))).toHaveLength(500);
  });
  it.each(["a\nb", "a\rb", "a\tb", "a\u200bb", "a\u202eb", "a".repeat(251)])(
    "rejects invalid alt text %s",
    (value) => expect(() => normalizeMediaAltText(value)).toThrow(),
  );
  it.each([0, 10000])("accepts exact position boundary %i", (value) =>
    expect(parseMediaPosition(String(value))).toBe(value),
  );
  it.each(["-1", "10001", "1.5", "1e2", "", "true"])("rejects invalid position %s", (value) =>
    expect(() => parseMediaPosition(value)).toThrow(),
  );
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts declared supported MIME %s subject to Laravel byte inspection",
    (type) => expect(validateMediaImage(new File(["x"], "image", { type })).size).toBe(1),
  );
  it.each([
    new File([], "empty.png", { type: "image/png" }),
    new File(["x"], "file.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(maximumMediaBytes + 1)], "large.png", { type: "image/png" }),
  ])("rejects invalid file %s", (value) => expect(() => validateMediaImage(value)).toThrow());
  it("accepts inclusive file size maximum", () =>
    expect(
      validateMediaImage(
        new File([new Uint8Array(maximumMediaBytes)], "maximum.png", { type: "image/png" }),
      ).size,
    ).toBe(maximumMediaBytes));
  it.each([
    [1, 1, true],
    [8000, 5000, true],
    [5000, 8000, true],
    [8001, 1, false],
    [1, 8001, false],
    [8000, 5001, false],
    [0, 1, false],
    [1.5, 2, false],
  ])("checks dimensions %i x %i", (width, height, valid) =>
    expect(validMediaDimensions(Number(width), Number(height))).toBe(valid),
  );
  it("only Product POST can choose a primary flag and each FormData is fresh", () => {
    const data = productMediaUploadSchema.parse({
      image: file(),
      alt_text: null,
      position: 0,
      is_primary: false,
    });
    const form = mediaUploadFormData(data);
    expect([...form.keys()]).toEqual(["image", "alt_text", "position", "is_primary"]);
    expect(form.get("alt_text")).toBe("");
    expect(form.get("is_primary")).toBe("0");
    expect(mediaUploadFormData(data)).not.toBe(form);
    expect(variantMediaUploadSchema.safeParse(data).success).toBe(false);
  });
  it("PATCH rejects byte replacement, false primary, empty and expanded payloads", () => {
    for (const input of [
      {},
      { is_primary: false },
      { image: file() },
      { position: 0, store_id: "foreign" },
    ])
      expect(productMediaUpdateSchema.safeParse(input).success).toBe(false);
    expect(productMediaUpdateSchema.parse({ is_primary: true })).toEqual({ is_primary: true });
    expect(variantMediaUpdateSchema.safeParse({ is_primary: true }).success).toBe(false);
    expect(variantMediaUpdateSchema.parse({ alt_text: null })).toEqual({ alt_text: null });
    expect(productMediaUploadSchema.safeParse({ image: null }).success).toBe(false);
  });
});
