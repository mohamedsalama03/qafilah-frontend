// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
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
});
