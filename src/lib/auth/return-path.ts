import { hasAsciiControlCharacters } from "../api/control-characters";

const trustedBase = new URL("https://return-path.invalid");

/** Return only a local path whose final serialized navigation stays on the trusted origin. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || hasAsciiControlCharacters(value, true)) return "/";
  try {
    // Decode the path once for ambiguous delimiters. Query/hash remain URL data;
    // valid escaped query values (including URLs) do not become navigation targets.
    const encodedPath = value.split(/[?#]/, 1)[0]!;
    const decodedPath = decodeURIComponent(encodedPath);
    if (
      decodedPath.startsWith("//") ||
      decodedPath.includes("\\") ||
      hasAsciiControlCharacters(decodedPath, true) ||
      /%[0-9a-f]{2}/i.test(decodedPath)
    )
      return "/";

    const resolved = new URL(value, trustedBase);
    if (resolved.origin !== trustedBase.origin || resolved.username || resolved.password)
      return "/";

    const output = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // A local input can normalize to a protocol-relative string (/.//host).
    // Prove the returned string itself, not only the URL parsed from the input.
    if (!/^\/(?!\/)/.test(output) || new URL(output, trustedBase).origin !== trustedBase.origin)
      return "/";
    return output;
  } catch {
    return "/";
  }
}
