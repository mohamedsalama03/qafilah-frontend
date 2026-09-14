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
      "domain feature endpoint outside F2",
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

  it("activates exactly the six published F2 method/path contracts", () => {
    const uuid = "15913d0d-10a1-40ed-bc6f-3e491f81a56f";
    expect(backendBaseline).toBe("6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf");
    expect(Object.keys(merchantContracts).sort()).toEqual([
      "context",
      "csrf",
      "identity",
      "login",
      "logout",
      "stores",
    ]);
    expect([
      [merchantContracts.csrf.method, merchantContracts.csrf.path()],
      [merchantContracts.login.method, merchantContracts.login.path()],
      [merchantContracts.identity.method, merchantContracts.identity.path()],
      [merchantContracts.logout.method, merchantContracts.logout.path()],
      [merchantContracts.stores.method, merchantContracts.stores.path(2)],
      [merchantContracts.context.method, merchantContracts.context.path(uuid)],
    ]).toEqual([
      ["GET", "/sanctum/csrf-cookie"],
      ["POST", "/api/v1/auth/login"],
      ["GET", "/api/v1/me"],
      ["POST", "/api/v1/auth/logout"],
      ["GET", "/api/v1/me/stores?page=2"],
      ["GET", `/api/v1/stores/${uuid}/context`],
    ]);
    expect(() => merchantContracts.stores.path(0)).toThrow();
    expect(() => merchantContracts.context.path("valid-shape-is-not-membership")).toThrow();
  });

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
});
