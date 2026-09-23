import { validateApiOrigin } from "./env";

const mediaPath =
  /^\/storage\/catalog\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Published opaque Catalog storage path only; no arbitrary URL resolution or browser origin. */
export function isSafeMediaPath(value: unknown): value is string {
  return typeof value === "string" && mediaPath.test(value);
}

export function resolveMediaUrl(
  path: string,
  apiOrigin: string,
  mode: string = "production",
): string {
  if (!isSafeMediaPath(path)) throw new Error("Unsafe Catalog media URL.");
  const origin = validateApiOrigin(apiOrigin, mode);
  return new URL(path, origin).href;
}
