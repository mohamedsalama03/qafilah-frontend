// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { backendBaseline, merchantContracts } from "../src/lib/backend/contracts";
import {
  inspectArchitecture,
  isProductionSource,
  type ArchitectureRule,
} from "./architecture-policy";

const root = process.cwd();
const merchantFile = "src/features/example/components/example.tsx";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("permanent executable architecture boundaries", () => {
  it("keeps the pristine production source and image configuration within policy", () => {
    const files = [...sourceFiles(join(root, "src")), join(root, "next.config.ts")];
    const violations = files.flatMap((file) => {
      const path = relative(root, file);
      return isProductionSource(path) ? inspectArchitecture(path, readFileSync(file, "utf8")) : [];
    });
    expect(violations).toEqual([]);
  });

  const mutants: Array<[string, ArchitectureRule, string, string?]> = [
    [
      "Storefront Product substitution",
      "verified-contract-registry",
      'export const merchantContracts = { products: { method: "GET", path: input => `/api/v1/storefront/catalog/products?${input.query}` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Platform Product substitution",
      "verified-contract-registry",
      'export const merchantContracts = { product: { method: "GET", path: input => `/api/v1/platform/products/${input.productUuid}` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product create reuses approved collection path",
      "verified-contract-registry",
      'export const merchantContracts = { products: { method: "POST", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products?${input.query}` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product update reuses approved detail path",
      "verified-contract-registry",
      'export const merchantContracts = { product: { method: "PATCH", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product hard delete added as a new registry entry",
      "verified-contract-registry",
      'export const merchantContracts = { deleteProduct: { method: "DELETE", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product media read is outside authorized core Product scope",
      "verified-contract-registry",
      'export const merchantContracts = { media: { method: "GET", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}/media` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product read attempts to attach a mutation body",
      "verified-contract-registry",
      'export const merchantContracts = { product: { method: "GET", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}`, body: input => ({name: input.name}) } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product UUID presence grants read capability",
      "uuid-derived-authority",
      "const canViewProducts = Boolean(productUuid);",
    ],
    [
      "Product response UUID grants authority",
      "uuid-derived-authority",
      "function hasPermission(product) { return !!product.id; }",
    ],
    [
      "client tenant ID grants authority",
      "uuid-derived-authority",
      "const canViewProducts = !!input.tenant_id;",
    ],
    [
      "client Product request supplies a Store authority selector",
      "tenant-selector-authority",
      "const body = { store_id: selectedStore, q: prefix };",
    ],
    [
      "client Product request supplies a tenant authority selector",
      "tenant-selector-authority",
      "const params = { tenant_id: tenantUuid };",
    ],
    [
      "Store header claims tenant authority",
      "tenant-selector-authority",
      'const headers = new Headers(); headers.set("X-Store-Id", storeUuid);',
    ],
    [
      "tenant header claims authority",
      "tenant-selector-authority",
      'const headers = { "X-Tenant-Id": tenantUuid };',
    ],
    [
      "Product list cache uses only a Store UUID",
      "product-query-isolation",
      'useQuery({ queryKey: ["products", storeUuid], queryFn });',
    ],
    [
      "Product detail cache lacks principal and scope revision",
      "product-query-isolation",
      'useQuery({ queryKey: ["product", storeUuid, productUuid], queryFn });',
    ],
    [
      "Product Category lookup uses a global cache",
      "product-query-isolation",
      'useQuery({ queryKey: ["product-categories"], queryFn });',
    ],
    [
      "Product component bypasses the scoped read hook",
      "product-query-isolation",
      "api.loadProduct({ storeUuid, productUuid });",
    ],
    [
      "Product component performs direct business fetch",
      "central-api-boundary",
      "fetch(`/api/v1/stores/${storeUuid}/catalog/products`);",
    ],
    [
      "Product description is interpreted as HTML",
      "unsafe-html",
      "const content = <div dangerouslySetInnerHTML={{ __html: product.description }} />;",
    ],
    [
      "Product permissions inferred from a Manager label",
      "role-derived-authority",
      'const canViewProducts = context.role.name === "Manager";',
    ],
    [
      "Storefront Product helper imported",
      "merchant-surface-boundary",
      'import { readProduct } from "@/features/storefront/catalog";',
    ],
    [
      "Product cursor persisted between principals",
      "browser-persistence",
      'sessionStorage.setItem("product-cursor", cursor);',
    ],
    [
      "contract copy overrides a reviewed path",
      "verified-contract-registry",
      'const endpoint = { ...merchantContracts.identity, path: () => "/api/v1/invented" };',
      "src/lib/backend/extra.ts",
    ],
    [
      "UUID arrow function authorizes",
      "uuid-derived-authority",
      "const canAccessStore = (storeUuid: string) => !!storeUuid;",
    ],
    [
      "endpoint definition outside reviewed registry",
      "verified-contract-registry",
      'const endpoint = { method: "GET", path: () => "/api/v1/me", decode: value => value };',
      "src/lib/backend/extra.ts",
    ],
    [
      "owner-only Store discovery substituted for Merchant membership discovery",
      "verified-contract-registry",
      'export const merchantContracts = { stores: { method: "GET", path: () => "/api/v1/stores" } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "invented endpoint disguised by trusted evidence",
      "verified-contract-registry",
      'export const merchantContracts = { identity: { evidence: {source:"certified"}, method: "GET", path: () => "/api/v1/invented-me" } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "extra Platform endpoint in registered source",
      "verified-contract-registry",
      'export const merchantContracts = { directory: { method: "GET", path: () => "/api/v1/platform/stores" } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "membership admin inference endpoint",
      "verified-contract-registry",
      'export const merchantContracts = { stores: { method: "GET", path: () => "/api/v1/store-memberships" } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "permission catalog inference endpoint",
      "verified-contract-registry",
      'export const merchantContracts = { context: { method: "GET", path: id => `/api/v1/stores/${id}/permissions` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Product endpoint replaces the Store context authority endpoint",
      "verified-contract-registry",
      'export const merchantContracts = { context: { method: "GET", path: id => `/api/v1/stores/${id}/catalog/products` } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "unreviewed method change",
      "verified-contract-registry",
      'export const merchantContracts = { identity: { method: "POST", path: () => "/api/v1/me" } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "unreviewable dynamic endpoint path",
      "verified-contract-registry",
      'export const merchantContracts = { identity: { method: "GET", path: () => process.env.ENDPOINT } };',
      "src/lib/backend/contracts.ts",
    ],
    [
      "Role name capability shortcut",
      "role-derived-authority",
      'const canEdit = context.role.name === "Owner";',
    ],
    [
      "Role kind wildcard",
      "role-derived-authority",
      'const grants = role.kind === "owner" ? ["*"] : context.permissions;',
    ],
    [
      "Role name alias",
      "role-derived-authority",
      'const currentRole = context.role; if (currentRole.name === "Administrator") enableWrites();',
    ],
    [
      "destructured Role name inference",
      "role-derived-authority",
      'const { name: roleName } = context.role; const canEdit = roleName === "Owner";',
    ],
    [
      "normalized Role name inference",
      "role-derived-authority",
      'const canEdit = context.role.name.toLowerCase() === "owner";',
    ],
    [
      "Role allowlist inference",
      "role-derived-authority",
      'const canEdit = ["Owner", "Manager"].includes(context.role.name);',
    ],
    [
      "UUID presence grants access",
      "uuid-derived-authority",
      "const canAccessStore = !!storeUuid;",
    ],
    [
      "UUID boolean alias grants access",
      "uuid-derived-authority",
      "const requested = route.storeUuid; const authorized = Boolean(requested);",
    ],
    [
      "UUID presence authorization result",
      "uuid-derived-authority",
      "const decision = { allowed: !!store.id };",
    ],
    [
      "UUID function authorizes",
      "uuid-derived-authority",
      "function canAccessStore(storeUuid) { return !!storeUuid; }",
    ],
    ["localStorage token write", "browser-persistence", 'localStorage.setItem("token", token);'],
    [
      "sessionStorage write",
      "browser-persistence",
      'window.sessionStorage.setItem("identity", identity);',
    ],
    [
      "computed persistence access",
      "browser-persistence",
      'globalThis["localStorage"].setItem("token", token);',
    ],
    [
      "storage alias",
      "browser-persistence",
      'const storage = window.localStorage; storage.setItem("token", token);',
    ],
    [
      "destructured storage alias",
      "browser-persistence",
      'const { localStorage: storage } = window; storage.setItem("token", token);',
    ],
    ["IndexedDB persistence", "browser-persistence", 'indexedDB.open("merchant-cache");'],
    ["JavaScript cookie write", "browser-persistence", 'document.cookie = "session=" + token;'],
    ["random component fetch", "central-api-boundary", 'fetch("/invented");'],
    ["computed global fetch", "central-api-boundary", 'window["fetch"]("/invented");'],
    [
      "destructured fetch",
      "central-api-boundary",
      'const { fetch: request } = globalThis; request("/invented");',
    ],
    ["fetch alias", "central-api-boundary", 'const request = fetch; request("/invented");'],
    ["XMLHttpRequest construction", "central-api-boundary", "new XMLHttpRequest();"],
    [
      "second HTTP client",
      "central-api-boundary",
      'import axios from "axios"; axios.get("/invented");',
    ],
    [
      "Authorization object header",
      "token-authentication",
      'const headers = { Authorization: "Bearer " + token };',
    ],
    [
      "computed Authorization header",
      "token-authentication",
      'const key = "Authorization"; const headers = { [key]: token };',
    ],
    ["Authorization setter", "token-authentication", 'headers.set("authorization", token);'],
    [
      "identifier-bound Headers mutation-only Bearer setter",
      "token-authentication",
      'const headers = new Headers(); if (mutation) { headers.set("Authorization", "Bearer " + token); }',
      "src/lib/api/client.ts",
    ],
    [
      "identifier-bound Headers lowercase append",
      "token-authentication",
      'const headers = new Headers(); headers.append("authorization", token);',
    ],
    [
      "identifier-bound Headers uppercase setter",
      "token-authentication",
      'const headers = new Headers(); headers.set("AUTHORIZATION", token);',
    ],
    [
      "Headers constructor object",
      "token-authentication",
      'new Headers({ authorization: "Bearer " + token });',
    ],
    [
      "Headers constructor aliased tuples",
      "token-authentication",
      'const entries = [["Authorization", token]]; new Headers(entries);',
    ],
    [
      "Headers instance alias and computed setter",
      "token-authentication",
      'const headers = new Headers(); const copy = headers; const name = "Authorization"; copy["set"](name, token);',
    ],
    [
      "local Headers factory helper",
      "token-authentication",
      'function makeHeaders() { return new Headers(); } const headers = makeHeaders(); headers.append("Authorization", token);',
    ],
    [
      "arrow Headers factory helper",
      "token-authentication",
      'const makeHeaders = () => new Headers(); const headers = makeHeaders(); headers.set("Authorization", token);',
    ],
    [
      "local factory returns a same-named Headers binding",
      "token-authentication",
      'function makeHeaders() { const headers = new Headers(); return headers; } const headers = makeHeaders(); headers.set("Authorization", token);',
    ],
    [
      "nested decoy binding cannot hide an outer Headers instance",
      "token-authentication",
      'const headers = new Headers(); function example() { const headers = "comment-like data"; } headers.set("Authorization", token);',
    ],
    [
      "helper mutates a Headers parameter",
      "token-authentication",
      'function authorize(headers: Headers, token: string) { headers.set("Authorization", "Bearer " + token); } authorize(new Headers(), token);',
    ],
    ["Authorization tuple", "token-authentication", 'new Headers([["Authorization", token]]);'],
    [
      "XHR Authorization header",
      "token-authentication",
      'request.setRequestHeader("Authorization", token);',
    ],
    ["Bearer header value", "token-authentication", 'headers.set("X-Session", "Bearer token");'],
    ["JWT library", "token-authentication", 'import { SignJWT } from "jose";'],
    [
      "dangerous React HTML",
      "unsafe-html",
      "const result = <div dangerouslySetInnerHTML={{ __html: response }} />;",
    ],
    [
      "spread dangerous HTML",
      "unsafe-html",
      "const props = { dangerouslySetInnerHTML: { __html: response } };",
    ],
    ["direct HTML assignment", "unsafe-html", "element.innerHTML = response;"],
    ["HTML insertion", "unsafe-html", 'element.insertAdjacentHTML("beforeend", response);'],
    [
      "Platform API import",
      "merchant-surface-boundary",
      'import { list } from "@/features/platform/api";',
    ],
    [
      "diagnostics dynamic import",
      "merchant-surface-boundary",
      'await import("@/features/diagnostics/notifications");',
    ],
    [
      "production query devtools",
      "merchant-surface-boundary",
      'import { ReactQueryDevtools } from "@tanstack/react-query-devtools";',
    ],
    [
      "external analytics",
      "merchant-surface-boundary",
      'import { Analytics } from "@vercel/analytics/react";',
    ],
    ["telemetry require", "merchant-surface-boundary", 'const telemetry = require("posthog-js");'],
    [
      "unguarded development import",
      "production-development-import",
      'const fixture = await import("@/dev/design-review");',
    ],
    [
      "public fixture override",
      "production-development-import",
      'if (process.env.NEXT_PUBLIC_FIXTURE === "true") { await import("@/dev/design-review"); }',
    ],
    [
      "non-production permits tests",
      "production-development-import",
      'if (process.env.NODE_ENV !== "production") { await import("@/dev/design-review"); }',
    ],
    [
      "wildcard image host",
      "restricted-image-hosts",
      'export default { images: { remotePatterns: [{ hostname: "**" }] } };',
      "next.config.ts",
    ],
    [
      "omitted image host",
      "restricted-image-hosts",
      'export default { images: { remotePatterns: [{ protocol: "https" }] } };',
      "next.config.ts",
    ],
    [
      "wildcard URL image host",
      "restricted-image-hosts",
      'export default { images: { remotePatterns: [new URL("https://**/**")] } };',
      "next.config.ts",
    ],
    [
      "unreviewable dynamic image hosts",
      "restricted-image-hosts",
      "export default { images: { remotePatterns: process.env.IMAGE_HOSTS } };",
      "next.config.ts",
    ],
  ];

  it.each(mutants)("rejects mutant: %s", (_description, rule, source, file) => {
    expect(
      inspectArchitecture(file ?? merchantFile, source).map((violation) => violation.rule),
    ).toContain(rule);
  });

  it("ignores comment and string decoys while scanning the same executable source", () => {
    const source = `
      // localStorage.setItem("token", token); fetch("/invented");
      /* import { Analytics } from "@vercel/analytics"; */
      const guidance = "Never use Authorization Bearer, dangerouslySetInnerHTML or localStorage";
      const example = 'fetch("/not-a-real-request")';
      const message = <p>Do not persist tokens in localStorage.</p>;
      const validator = /authorization|cookie|host/;
      // const headers = new Headers(); if (mutation) headers.set("Authorization", "Bearer " + token);
      const headerExample = 'const headers = new Headers(); headers.append("AUTHORIZATION", "Bearer " + token)';
      const headers = new Headers({ Accept: "application/json" });
      headers.set("X-Request-ID", "synthetic");
      // const canEdit = role.name === "Owner";
      const roleExample = 'const canAccessStore = !!storeUuid;';
      const endpointExample = '{method:"GET",path:()=>"/api/v1/platform/stores"}';
      const roleLabel = <span>{context.role.name}</span>;
      const hasPermission = context.permissions.includes("orders.view");
      const requestedUuid = parseStoreUuid(params.storeUuid);
      // api.createProduct({data}); setTimeout(() => mutation.execute(command), 0);
      const mutationExample = 'queryClient.invalidateQueries({queryKey:["products"]}); retry: 2';
    `;
    expect(inspectArchitecture(merchantFile, source)).toEqual([]);
  });

  it.each([
    "docs/security.md",
    "src/dev/example.tsx",
    "tests/example.test.ts",
    "src/lib/api/client.test.ts",
    "src/__fixtures__/sample.ts",
  ])("excludes authorized development/test/documentation scope: %s", (file) =>
    expect(
      inspectArchitecture(file, 'fetch("/synthetic"); localStorage.setItem("test", "value");'),
    ).toEqual([]),
  );

  it("allows credentialed transport only in the central API directory", () => {
    expect(
      inspectArchitecture("src/lib/api/client.ts", 'fetch(url, { credentials: "include" });'),
    ).toEqual([]);
  });

  it("allows explicit image hosts and an empty allowlist", () => {
    expect(
      inspectArchitecture("next.config.ts", "export default { images: { remotePatterns: [] } };"),
    ).toEqual([]);
    expect(
      inspectArchitecture(
        "next.config.ts",
        'export default { images: { remotePatterns: [{ protocol: "https", hostname: "media.example.test", pathname: "/approved/**" }] } };',
      ),
    ).toEqual([]);
  });

  it("keeps the actual development route behind the strict NODE_ENV guard", () => {
    const file = "src/app/(development)/design-system/[[...pattern]]/page.tsx";
    const source = readFileSync(join(root, file), "utf8");
    expect(inspectArchitecture(file, source)).toEqual([]);
    // The modified text is parsed again as executable syntax, never written to disk.
    const mutant = source.replace('process.env.NODE_ENV === "development"', "true");
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, mutant).map((violation) => violation.rule)).toContain(
      "production-development-import",
    );
  });

  it("rejects the original mutation-only Bearer mutant in the actual transport source", () => {
    const file = "src/lib/api/client.ts";
    const source = readFileSync(join(root, file), "utf8");
    expect(inspectArchitecture(file, source)).toEqual([]);
    const anchor = "if (mutation && options.csrf) {";
    const mutant = source.replace(
      anchor,
      `${anchor}\n headers.set("Authorization", "Bearer " + "mutation-only-token");`,
    );
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, mutant).map((violation) => violation.rule)).toContain(
      "token-authentication",
    );
  });

  it("activates exactly published F2–F3-E and eight media contracts", () => {
    const uuid = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
    expect(backendBaseline).toBe("7cd52e549c2a657dc66643b36701356d1d024de5");
    expect(Object.keys(merchantContracts).sort()).toEqual([
      "archiveProduct",
      "categories",
      "context",
      "createProduct",
      "createProductMedia",
      "createProductOption",
      "createProductOptionValue",
      "createProductVariant",
      "createVariantMedia",
      "csrf",
      "deleteProductMedia",
      "deleteVariantMedia",
      "identity",
      "login",
      "logout",
      "product",
      "productInventory",
      "productMedia",
      "productOptions",
      "productVariant",
      "productVariants",
      "products",
      "publishProduct",
      "stores",
      "unpublishProduct",
      "updateProduct",
      "updateProductInventory",
      "updateProductMedia",
      "updateProductOption",
      "updateProductOptionValue",
      "updateProductVariant",
      "updateVariantInventory",
      "updateVariantMedia",
      "variantInventory",
      "variantMedia",
    ]);
    expect([
      [merchantContracts.csrf.method, merchantContracts.csrf.path()],
      [merchantContracts.login.method, merchantContracts.login.path()],
      [merchantContracts.identity.method, merchantContracts.identity.path()],
      [merchantContracts.logout.method, merchantContracts.logout.path()],
      [merchantContracts.stores.method, merchantContracts.stores.path(2)],
      [merchantContracts.context.method, merchantContracts.context.path(uuid)],
      [merchantContracts.products.method, merchantContracts.products.path({ storeUuid: uuid })],
      [
        merchantContracts.product.method,
        merchantContracts.product.path({ storeUuid: uuid, productUuid: uuid }),
      ],
      [merchantContracts.categories.method, merchantContracts.categories.path({ storeUuid: uuid })],
      [
        merchantContracts.createProduct.method,
        merchantContracts.createProduct.path({
          storeUuid: uuid,
          data: { name: "Sample", slug: "sample", description: "Description" },
        }),
      ],
      [
        merchantContracts.updateProduct.method,
        merchantContracts.updateProduct.path({
          storeUuid: uuid,
          productUuid: uuid,
          data: { name: "Changed" },
        }),
      ],
      [
        merchantContracts.publishProduct.method,
        merchantContracts.publishProduct.path({ storeUuid: uuid, productUuid: uuid }),
      ],
      [
        merchantContracts.unpublishProduct.method,
        merchantContracts.unpublishProduct.path({ storeUuid: uuid, productUuid: uuid }),
      ],
      [
        merchantContracts.archiveProduct.method,
        merchantContracts.archiveProduct.path({ storeUuid: uuid, productUuid: uuid }),
      ],
      [
        merchantContracts.productInventory.method,
        merchantContracts.productInventory.path({ storeUuid: uuid, productUuid: uuid }),
      ],
      [
        merchantContracts.updateProductInventory.method,
        merchantContracts.updateProductInventory.path({
          storeUuid: uuid,
          productUuid: uuid,
          data: { quantity: 0 },
        }),
      ],
    ]).toEqual([
      ["GET", "/sanctum/csrf-cookie"],
      ["POST", "/api/v1/auth/login"],
      ["GET", "/api/v1/me"],
      ["POST", "/api/v1/auth/logout"],
      ["GET", "/api/v1/me/stores?page=2"],
      ["GET", `/api/v1/stores/${uuid}/context`],
      ["GET", `/api/v1/stores/${uuid}/catalog/products?sort=newest&per_page=25`],
      ["GET", `/api/v1/stores/${uuid}/catalog/products/${uuid}`],
      ["GET", `/api/v1/stores/${uuid}/catalog/categories?sort=newest&per_page=100`],
      ["POST", `/api/v1/stores/${uuid}/catalog/products`],
      ["PATCH", `/api/v1/stores/${uuid}/catalog/products/${uuid}`],
      ["POST", `/api/v1/stores/${uuid}/catalog/products/${uuid}/publish`],
      ["POST", `/api/v1/stores/${uuid}/catalog/products/${uuid}/unpublish`],
      ["POST", `/api/v1/stores/${uuid}/catalog/products/${uuid}/archive`],
      ["GET", `/api/v1/stores/${uuid}/catalog/products/${uuid}/inventory`],
      ["PATCH", `/api/v1/stores/${uuid}/catalog/products/${uuid}/inventory`],
    ]);
    expect(() => merchantContracts.stores.path(0)).toThrow();
    expect(() => merchantContracts.context.path("valid-shape-is-not-membership")).toThrow();
  });

  it.each([
    [
      "list",
      'storeKeys.resource(scope, "products", { criteria, cursor })',
      'storeKeys.resource(scope, "products", { criteria })',
    ],
    [
      "normalized criteria",
      'storeKeys.resource(scope, "products", { criteria, cursor })',
      'storeKeys.resource(scope, "products", { cursor })',
    ],
    [
      "Product UUID",
      'storeKeys.resource(scope, "product", { productUuid })',
      'storeKeys.resource(scope, "product", {})',
    ],
    [
      "scope",
      'storeKeys.resource(scope, "product", { productUuid })',
      'storeKeys.resource({ storeUuid: productUuid }, "product", { productUuid })',
    ],
    [
      "Category scope",
      'storeKeys.resource(scope, "product-categories", { criteria, cursor })',
      'storeKeys.resource(storeUuid, "product-categories", { criteria, cursor })',
    ],
    [
      "Product key global array",
      'storeKeys.resource(scope, "product", { productUuid })',
      '["product", productUuid]',
    ],
  ])("rejects actual Product key mutant omitting %s", (_label, anchor, replacement) => {
    const file = "src/features/products/queries.ts";
    const source = readFileSync(join(root, file), "utf8");
    expect(inspectArchitecture(file, source)).toEqual([]);
    const mutant = source.replace(anchor, replacement);
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, mutant).map(({ rule }) => rule)).toContain(
      "product-query-isolation",
    );
  });

  it.each(["publish", "unpublish", "archive", "pricing", "inventory", "variants", "media"])(
    "rejects replacing the Product GET with a %s route in the actual registry",
    (suffix) => {
      const file = "src/lib/backend/contracts.ts";
      const source = readFileSync(join(root, file), "utf8");
      const anchor = "/catalog/products/${catalogUuidSchema.parse(input.productUuid)}";
      const mutant = source.replace(anchor, `${anchor}/${suffix}`);
      expect(mutant).not.toBe(source);
      expect(inspectArchitecture(file, mutant).map(({ rule }) => rule)).toContain(
        "verified-contract-registry",
      );
    },
  );

  it("rejects an invented route mutation in the actual activated contract source", () => {
    const file = "src/lib/backend/contracts.ts";
    const source = readFileSync(join(root, file), "utf8");
    expect(inspectArchitecture(file, source)).toEqual([]);
    const mutant = source.replace('"/api/v1/me"', '"/api/v1/invented-me"');
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, mutant).map(({ rule }) => rule)).toContain(
      "verified-contract-registry",
    );
  });

  it.each([
    ["restoreProduct", "POST", "restore"],
    ["updateProductPrice", "PATCH", "pricing"],
    ["adjustProductInventory", "POST", "inventory/adjustments"],
    ["createVariant", "POST", "variants"],
    ["attachMedia", "POST", "media"],
  ])("rejects out-of-scope mutation contract %s", (name, method, suffix) => {
    const source = `export const merchantContracts = { ${name}: { method: "${method}", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/${suffix}\` } };`;
    expect(
      inspectArchitecture("src/lib/backend/contracts.ts", source).map(({ rule }) => rule),
    ).toContain("verified-contract-registry");
  });

  it.each([
    "createProduct",
    "updateProduct",
    "publishProduct",
    "unpublishProduct",
    "archiveProduct",
  ])("requires the shared scoped mutation lifecycle for %s", (name) => {
    expect(
      inspectArchitecture(merchantFile, `api.${name}(input);`).map(({ rule }) => rule),
    ).toContain("product-mutation-boundary");
    expect(
      inspectArchitecture("src/features/products/mutations.ts", `api.${name}(input);`),
    ).toEqual([]);
  });

  it.each([
    "useMutation({ mutationFn: write, retry: true });",
    "useMutation({ mutationFn: write, retry: 2 });",
    "useMutation({ mutationFn: write, retry: () => true });",
    "setTimeout(() => controller.execute(command), 10);",
    "window.setInterval(() => controller.execute(command), 10);",
  ])("rejects automatic mutation replay scheduling: %s", (source) => {
    expect(
      inspectArchitecture("src/features/products/mutations.ts", source).map(({ rule }) => rule),
    ).toContain("product-mutation-retry");
  });

  it.each([
    'queryClient.setQueryData(["product", productUuid], product);',
    "queryClient.invalidateQueries();",
    'queryClient.invalidateQueries({queryKey: ["products"]});',
    "queryClient.removeQueries({predicate: () => true});",
    'queryClient.cancelQueries({queryKey: storeKeys.resource(otherScope, "products")});',
    "queryClient.setQueryData(productKeys.detail(storeUuid, productUuid), product);",
  ])("rejects unscoped mutation cache reconciliation: %s", (source) => {
    expect(
      inspectArchitecture("src/features/products/mutations.ts", source).map(({ rule }) => rule),
    ).toContain("product-mutation-isolation");
  });

  it("keeps mutation retries disabled in the actual QueryClient defaults", () => {
    const file = "src/lib/query/client.ts";
    const source = readFileSync(join(root, file), "utf8");
    const mutant = source.replace("mutations: { retry: false }", "mutations: { retry: true }");
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, source)).toEqual([]);
    expect(inspectArchitecture(file, mutant).map(({ rule }) => rule)).toContain(
      "product-mutation-retry",
    );
  });

  it.each([
    ['storeKeys.resource(scope, "products")', 'storeKeys.resource(otherScope, "products")'],
    ["productKeys.detail(scope, product.id)", '["product", product.id]'],
  ])("rejects operative scoped mutation cache mutant: %s", (anchor, replacement) => {
    const file = "src/features/products/mutations.ts";
    const source = readFileSync(join(root, file), "utf8");
    const mutant = source.replace(anchor, replacement);
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(file, source)).toEqual([]);
    expect(inspectArchitecture(file, mutant).map(({ rule }) => rule)).toContain(
      "product-mutation-isolation",
    );
  });

  it.each(["publishProduct", "unpublishProduct", "archiveProduct"])(
    "rejects hidden mutation fields on the bodyless %s contract",
    (entry) => {
      const suffix = entry.replace("Product", "");
      const source = `export const merchantContracts = { ${entry}: { method: "POST", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/${suffix}\`, body: input => ({status: input.status}) } };`;
      expect(
        inspectArchitecture("src/lib/backend/contracts.ts", source).map(({ rule }) => rule),
      ).toContain("verified-contract-registry");
    },
  );

  const inventoryFile = "src/features/inventory/mutations.ts";
  it.each([
    [
      "component write",
      "inventory-mutation-boundary",
      "api.updateProductInventory(input);",
      merchantFile,
    ],
    [
      "component read",
      "inventory-query-isolation",
      "api.loadProductInventory(input);",
      merchantFile,
    ],
    [
      "global inventory query",
      "inventory-query-isolation",
      'useQuery({queryKey:["product-inventory", productUuid]});',
    ],
    [
      "missing Product key",
      "inventory-query-isolation",
      'const inventoryKeys = {detail: (scope, productUuid) => storeKeys.resource(scope, "product-inventory")};',
    ],
    [
      "missing scope key",
      "inventory-query-isolation",
      'const inventoryKeys = {detail: (scope, productUuid) => storeKeys.resource(otherScope, "product-inventory", {productUuid})};',
    ],
    [
      "missing principal/revision",
      "inventory-query-isolation",
      'const inventoryKeys = {detail: (scope, productUuid) => [scope.storeUuid, productUuid, "inventory"]};',
    ],
    [
      "global cache write",
      "inventory-mutation-isolation",
      'cache.setQueryData(["inventory", productUuid], inventory);',
    ],
    [
      "foreign scope cache write",
      "inventory-mutation-isolation",
      "cache.setQueryData(inventoryKeys.detail(otherScope, productUuid), inventory);",
    ],
    [
      "unscoped invalidation",
      "inventory-mutation-isolation",
      'cache.invalidateQueries({queryKey:["products"]});',
    ],
    [
      "automatic retry",
      "inventory-mutation-retry",
      "useMutation({mutationFn: write, retry: true});",
    ],
    [
      "delayed replay",
      "inventory-mutation-retry",
      "setTimeout(() => api.updateProductInventory(input), 100);",
    ],
    [
      "replay after a rejected PATCH",
      "inventory-mutation-retry",
      "api.updateProductInventory(input).catch(() => api.updateProductInventory(input));",
    ],
    [
      "optimistic addition",
      "inventory-absolute-quantity",
      "const next = current.quantity + delta;",
    ],
    [
      "optimistic subtraction",
      "inventory-absolute-quantity",
      "const next = current.quantity - delta;",
    ],
    ["optimistic increment", "inventory-absolute-quantity", "inventory.quantity++;"],
    [
      "null coerced to zero",
      "inventory-absolute-quantity",
      "const quantity = inventory.quantity ?? 0;",
    ],
    [
      "null/zero truthiness conflation",
      "inventory-absolute-quantity",
      "const quantity = inventory.quantity || 0;",
    ],
    [
      "inventory Role authority",
      "role-derived-authority",
      'const canEditInventory = context.role.name === "Owner";',
    ],
    [
      "inventory UUID authority",
      "uuid-derived-authority",
      "const canSetQuantity = Boolean(productUuid);",
    ],
    [
      "persisted mutation authority",
      "browser-persistence",
      'sessionStorage.setItem("inventory-slot", slot);',
    ],
    [
      "inventory bypasses central transport",
      "central-api-boundary",
      'fetch("/api/v1/stores/example/catalog/products/example/inventory", {method:"PATCH"});',
    ],
  ] as Array<[string, ArchitectureRule, string, string?]>)(
    "rejects inventory architecture mutant: %s",
    (_name, rule, source, file) => {
      expect(inspectArchitecture(file ?? inventoryFile, source).map((item) => item.rule)).toContain(
        rule,
      );
    },
  );

  it.each(["pricing", "media", "options", "variants/variant/inventory"])(
    "rejects substituting inventory with deferred %s capability",
    (suffix) => {
      const source = `export const merchantContracts = { updateProductInventory: {method: "PATCH", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/${suffix}\`} };`;
      expect(
        inspectArchitecture("src/lib/backend/contracts.ts", source).map((item) => item.rule),
      ).toContain("verified-contract-registry");
    },
  );

  it("allows inventory scope keys, explicit absolute values and executable decoys", () => {
    const source = `
      const inventoryKeys = { detail: (scope, productUuid) => storeKeys.resource(scope, "product-inventory", { productUuid }) };
      cache.setQueryData(inventoryKeys.detail(scope, productUuid), authoritative);
      cache.invalidateQueries({ queryKey: productKeys.detail(scope, productUuid) });
      const input = { quantity: 0 };
      const hasPermission = context.permissions.includes("products.inventory.update");
      const label = inventory.quantity === null ? "Not configured" : String(inventory.quantity);
      // inventory.quantity++; retry: true; api.updateProductInventory(input);
      const explanation = "inventory.quantity ?? 0; retry: true; localStorage.setItem('authority', slot)";
    `;
    expect(inspectArchitecture(inventoryFile, source)).toEqual([]);
  });

  it.each(["productInventory", "updateProductInventory"])(
    "requires strict inventory decoding for %s rather than asserting a response type",
    (entry) => {
      const method = entry === "productInventory" ? "GET" : "PATCH";
      const source = `export const merchantContracts = { ${entry}: {method: "${method}", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/inventory\`, decode: payload => payload.data as ProductInventory} };`;
      expect(
        inspectArchitecture("src/lib/backend/contracts.ts", source).map((item) => item.rule),
      ).toContain("inventory-response-boundary");
    },
  );
});
