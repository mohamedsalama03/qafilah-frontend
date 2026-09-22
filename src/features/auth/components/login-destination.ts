import { safeReturnPath } from "@/lib/auth/return-path";
import { parseStoreUuid } from "@/lib/query/keys";
import { z } from "zod";

/** Only implemented Merchant routes are post-login destinations; the backend still checks access. */
export function loginDestination(value: unknown): string {
  const safe = safeReturnPath(value);
  const url = new URL(safe, "https://merchant.invalid");
  if (url.pathname === "/") return safe;
  const match =
    /^\/stores\/([^/]+)(?:\/products(?:\/(new|[^/]+)(?:\/(edit|variants)(?:\/([^/]+))?)?)?)?$/.exec(
      url.pathname,
    );
  if (!match) return "/";
  try {
    parseStoreUuid(match[1]);
    if (match[2] === "new" && match[3]) return "/";
    if (match[2] && match[2] !== "new") z.uuid().parse(match[2]);
    if (match[4] && match[3] !== "variants") return "/";
    if (match[4]) z.uuid().parse(match[4]);
    return safe;
  } catch {
    return "/";
  }
}
