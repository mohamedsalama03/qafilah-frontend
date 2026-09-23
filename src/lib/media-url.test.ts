// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isSafeMediaPath, resolveMediaUrl } from "./media-url";
const path = "/storage/catalog/11111111-1111-4111-8111-111111111111";
describe("central Catalog media URL boundary", () => {
  it("resolves only against the validated API origin", () => {
    expect(resolveMediaUrl(path, "https://api.example.test")).toBe(
      `https://api.example.test${path}`,
    );
    expect(resolveMediaUrl(path, "http://localhost:3842", "development")).toBe(
      `http://localhost:3842${path}`,
    );
  });
  it.each([
    "",
    "storage/catalog/11111111-1111-4111-8111-111111111111",
    "https://api.example.test" + path,
    "https://evil.test" + path,
    "//evil.test" + path,
    path + "?x=1",
    path + "#x",
    path + "/",
    path + ".png",
    path + "\n",
    "/storage/catalog/../secret",
    "/storage/catalog/%2e%2e",
    "/storage/catalog/not-a-uuid",
    "/storage/catalog/00000000-0000-0000-0000-000000000000",
    path.replace("/catalog/", "/Catalog/"),
    path.replace("/catalog/", "/catalog\\"),
    "data:image/png;base64,a",
    "blob:https://example.test/id",
  ])("rejects unsafe media path %s", (value) => {
    expect(isSafeMediaPath(value)).toBe(false);
    expect(() => resolveMediaUrl(value, "https://api.example.test")).toThrow();
  });
  it.each([
    "https://api.example.test/path",
    "https://user:secret@api.example.test",
    "https://api.example.test?x=1",
    "http://api.example.test",
    "http://localhost:3842",
  ])("rejects invalid production API origin %s", (origin) => {
    expect(() => resolveMediaUrl(path, origin)).toThrow();
  });
});
