import { hasAsciiControlCharacters } from "../api/control-characters";

/** Accept only local application paths; excludes protocol-relative and encoded redirects. */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    hasAsciiControlCharacters(decoded, true) ||
    /%[0-9a-f]{2}/i.test(decoded)
  )
    return fallback;
  const base = "https://return-path.invalid";
  const url = new URL(value, base);
  if (url.origin !== base || url.username || url.password) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
