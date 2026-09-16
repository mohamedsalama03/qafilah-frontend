import { safeReturnPath } from "@/lib/auth/return-path";
import { parseStoreUuid } from "@/lib/query/keys";
import { z } from "zod";

/** Only implemented Merchant routes are post-login destinations; the backend still checks access. */
export function loginDestination(value: unknown): string {
  const safe = safeReturnPath(value);
  const url = new URL(safe, "https://merchant.invalid");
  if (url.pathname === "/") return safe;
  const match = /^\/stores\/([^/]+)(?:\/products(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (!match) return "/";
  try {
    parseStoreUuid(match[1]);
    if (match[2]) z.uuid().parse(match[2]);
    return safe;
  } catch {
    return "/";
  }
}
