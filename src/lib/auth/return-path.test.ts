// @vitest-environment node
import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

const navigationBase = new URL("https://merchant.example.test/workspace");

function expectLocalNavigation(input: unknown, expected?: string): string {
  const output = safeReturnPath(input);
  if (expected !== undefined) expect(output).toBe(expected);
  expect(output).toMatch(/^\/(?!\/)/);
  // Independent of the helper's synthetic origin: browser resolution must also
  // remain local at a real-shaped deployment origin and a non-root current path.
  expect(new URL(output, navigationBase).origin).toBe(navigationBase.origin);
  return output;
}

describe("final serialized return-path navigation", () => {
  it.each([
    ["/", "/"],
    ["/orders", "/orders"],
    ["/orders?page=2", "/orders?page=2"],
    ["/orders/123?tab=details#shipping", "/orders/123?tab=details#shipping"],
    ["/orders/../inventory?sort=name#items", "/inventory?sort=name#items"],
    ["/orders/%2e/details", "/orders/details"],
    [
      "/orders?q=caf%C3%A9&label=two%20words#shipping",
      "/orders?q=caf%C3%A9&label=two%20words#shipping",
    ],
    [
      "/orders?next=https%3A%2F%2Fexample.test%2Fa%3Fx%3D1#details",
      "/orders?next=https%3A%2F%2Fexample.test%2Fa%3Fx%3D1#details",
    ],
  ])("preserves local path/query/hash: %s", (input, expected) => {
    expectLocalNavigation(input, expected);
  });

  it.each([
    null,
    undefined,
    {},
    42,
    "",
    "orders",
    "?page=2",
    "#shipping",
    "//evil.test",
    "///evil.test",
    "//user@evil.test",
    "//return-path.invalid",
    "https://evil.test",
    "http://evil.test",
    "https://return-path.invalid/orders",
    "javascript:alert(1)",
    "data:text/html,example",
    "file:///etc/passwd",
    "blob:https://evil.test/id",
    "mailto:merchant@example.test",
    "custom:orders",
    "/.//evil.test",
    "/..//evil.test",
    "/a/..//evil.test",
    "/%2e//evil.test",
    "/.//evil.test/path?x=1",
    "/a/%2e%2e//evil.test",
    "/%2E.//evil.test",
    "/.//return-path.invalid",
    "/.//user@evil.test",
    "/.///evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "/\\/evil.test",
    "/a/..\\/evil.test",
    "/%2fevil.test",
    "/%2F%2Fevil.test",
    "/%5c%5cevil.test",
    "/%252fevil.test",
    "/%255Cevil.test",
    "/%252e//evil.test",
    "/%zz",
    "/%E0%A4%A",
    " /.//evil.test",
    "\t/.//evil.test",
    "\n//evil.test",
    "\r//evil.test",
    "/orders\t",
    "/orders\n",
    "/orders\r",
    "/\n/evil.test",
    "/%09/evil.test",
    "/%0a/evil.test",
    "/%0d/evil.test",
    "/%00/evil.test",
    "/%7f/evil.test",
  ])("falls back for unsafe or ambiguous input: %s", (input) => {
    expectLocalNavigation(input, "/");
  });

  it("keeps generated dot-segment, delimiter and encoding combinations local", () => {
    const prefixes = ["", "/", "/.", "/..", "/a/..", "/%2e", "/%2e%2e", "/a/%2E."];
    const delimiters = ["/", "//", "///", "\\", "/\\", "%2f", "%5c", "%252f"];
    const destinations = ["evil.test", "user@evil.test", "return-path.invalid", "orders"];
    const suffixes = ["", "/path?x=1#part", "?next=%2F%2Fevil.test", "\n"];
    for (const prefix of prefixes)
      for (const delimiter of delimiters)
        for (const destination of destinations)
          for (const suffix of suffixes)
            expectLocalNavigation(`${prefix}${delimiter}${destination}${suffix}`);
  });
});
