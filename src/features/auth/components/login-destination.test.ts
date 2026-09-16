import { describe, expect, it } from "vitest";
import { loginDestination } from "./login-destination";

const store = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
describe("verified Product post-login destinations", () => {
  it.each([`/stores/${store}/products`, `/stores/${store}/products/${product}`])(
    "preserves implemented route %s without granting authority",
    (route) => {
      expect(loginDestination(route)).toBe(route);
    },
  );
  it.each([
    `/stores/${store}/products/create`,
    `/stores/${store}/products/${product}/edit`,
    `/stores/${store}/products/${product}/publish`,
    `/stores/${store}/categories`,
    `/stores/invalid/products`,
    `/stores/${store}/products/invalid`,
    `//evil.example/stores/${store}/products`,
    `https://evil.example/stores/${store}/products`,
    `/platform/stores/${store}/products`,
    `/storefront/products/${product}`,
  ])("rejects unimplemented or unsafe destination %s", (route) => {
    expect(loginDestination(route)).toBe("/");
  });
});
