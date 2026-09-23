import { z } from "zod";

export interface PublicEnvironment {
  /** An origin is configuration, never evidence that API contracts were reviewed. */
  apiOrigin: string | null;
}

export function validateApiOrigin(value: string, mode: string = "production"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_API_ORIGIN must be an absolute origin.");
  }

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowedProtocol =
    url.protocol === "https:" || (mode !== "production" && local && url.protocol === "http:");
  if (
    !allowedProtocol ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_ORIGIN must be a secure origin without credentials, a path, a query, or a fragment.",
    );
  }
  return url.origin;
}

export function parsePublicEnvironment(
  input: Record<string, unknown>,
  mode: string = "production",
): PublicEnvironment {
  const parsed = z.object({ NEXT_PUBLIC_API_ORIGIN: z.string().trim().optional() }).parse(input);
  const value = parsed.NEXT_PUBLIC_API_ORIGIN;
  // Backend access is unavailable in F1. An absent origin deliberately leaves integration inert.
  return { apiOrigin: value ? validateApiOrigin(value, mode) : null };
}
