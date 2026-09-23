import { describe, expect, it } from "vitest";
import { parsePublicEnvironment, validateApiOrigin } from "./env";

describe("public environment", () => {
  it("keeps integration inert without configuration", () => {
    expect(parsePublicEnvironment({})).toEqual({ apiOrigin: null });
  });
  it("accepts only a clean secure production origin", () => {
    expect(parsePublicEnvironment({ NEXT_PUBLIC_API_ORIGIN: "https://api.example.test/" })).toEqual(
      { apiOrigin: "https://api.example.test" },
    );
  });
  it.each([
    "http://api.example.test",
    "https://*.example.test",
    "https://%2A.example.test",
    "https://api.*.example.test",
    "https://api.%2a.example.test",
    "http://localhost:8000",
    "https://user:secret@api.example.test",
    "https://api.example.test/api",
    "https://api.example.test?key=secret",
    "https://api.example.test#fragment",
    "invalid",
  ])("rejects unsafe production configuration %s", (origin) => {
    expect(() => validateApiOrigin(origin)).toThrow();
  });
  it("bounds local HTTP to non-production loopback", () => {
    expect(validateApiOrigin("http://127.0.0.1:8000", "development")).toBe("http://127.0.0.1:8000");
    expect(() => validateApiOrigin("http://api.example.test", "development")).toThrow();
  });
});
