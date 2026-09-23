// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
afterEach(() => vi.unstubAllEnvs());
describe("Catalog media CSP", () => {
  it("permits only the validated API Catalog path without changing script protections", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.example.test");
    const response = proxy(new NextRequest("https://dashboard.example.test/products"));
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp.split("; ").find((value) => value.startsWith("img-src"))).toBe(
      "img-src 'self' data: https://api.example.test/storage/catalog/",
    );
    expect(csp).not.toContain("*");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("keeps unconfigured image delivery closed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "");
    const csp = proxy(new NextRequest("https://dashboard.example.test")).headers.get(
      "Content-Security-Policy",
    )!;
    expect(csp.split("; ").find((value) => value.startsWith("img-src"))).toBe(
      "img-src 'self' data:",
    );
  });
  it.each([
    "https://api.example.test/storage/",
    "https://user@api.example.test",
    "http://evil.example.test",
  ])("rejects invalid API origin %s before producing a CSP allowance", (origin) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", origin);
    expect(() => proxy(new NextRequest("https://dashboard.example.test"))).toThrow();
  });
});
