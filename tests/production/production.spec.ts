import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const expectedNotFound =
      testInfo.title === "every development review route is unavailable in the production build" &&
      /Failed to load resource.*404/.test(message.text());
    if (["error", "warning"].includes(message.type()) && !expectedNotFound)
      errors.push(`${message.type()}: ${message.text()}`);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = faults.get(page) ?? [];
  const directory = path.resolve("artifacts/production-console");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`),
    JSON.stringify({ test: testInfo.title, unexpectedBrowserWarningsOrErrors: messages }, null, 2),
  );
  expect(messages).toEqual([]);
});

test("production entry points fail closed without merchant data, credentials or review navigation", async ({
  page,
}) => {
  for (const route of ["/login", "/"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Sign in to your workspace", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign-in is not available yet" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open component review" })).toHaveCount(0);
    const html = await response!.text();
    expect(html).not.toMatch(
      /QAFILAH_F1_DEVELOPMENT_FIXTURE_ONLY|Everyday canvas tote|EX-001|Woven storage basket/,
    );
    expect(html).not.toContain("Store overview");
    expect(html).not.toContain("Main navigation");
  }
});

test("every development review route is unavailable in the production build", async ({
  page,
  request,
}) => {
  for (const route of [
    "/design-system",
    "/design-system/overview",
    "/design-system/table",
    "/design-system/detail",
    "/design-system/form",
    "/design-system/components",
    "/design-system/login",
    "/design-system/unknown/path",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    const html = await response.text();
    expect(html, route).not.toMatch(
      /QAFILAH_F1_DEVELOPMENT_FIXTURE_ONLY|Everyday canvas tote|EX-001|Woven storage basket/,
    );
    expect(html, route).toContain("Page not found");
  }
  await page.goto("/design-system/table");
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("private documents use fresh script nonces, no unsafe script directives and no-store indexing protection", async ({
  page,
  request,
}) => {
  const response = await page.goto("/login");
  expect(response).not.toBeNull();
  const headers = response!.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  const scriptSource =
    csp.split(";").find((directive) => directive.trim().startsWith("script-src ")) ?? "";
  const nonce = scriptSource.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(scriptSource).toContain("'strict-dynamic'");
  expect(scriptSource).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["cache-control"]).toMatch(/private/);
  expect(headers["cache-control"]).toMatch(/no-store/);
  expect(headers["x-robots-tag"]).toMatch(/noindex/);
  expect(headers["x-robots-tag"]).toMatch(/nofollow/);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
  const inlineScripts = await page.locator("script:not([src])").evaluateAll((scripts) =>
    scripts
      .filter(
        (script) =>
          !script.getAttribute("type") || /javascript|module/.test(script.getAttribute("type")!),
      )
      .map((script) => ({
        nonce: (script as HTMLScriptElement).nonce,
        length: script.textContent?.length ?? 0,
      })),
  );
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const script of inlineScripts) if (script.length > 0) expect(script.nonce).toBe(nonce);
  const second = await request.get("/login");
  const secondNonce = second.headers()["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
  expect(secondNonce).toBeTruthy();
  expect(secondNonce).not.toBe(nonce);
});

test("production renders without auth storage or external requests and records delivered JavaScript", async ({
  page,
  context,
}, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign-in is not available yet" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  expect(storage).toEqual({ local: [], session: [], databases: [] });
  expect(await context.cookies()).toEqual([]);
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/_next/") && /\.js(?:\?|$)/.test(entry.name))
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          file: new URL(resource.name).pathname,
          transferBytes: resource.transferSize,
          encodedBodyBytes: resource.encodedBodySize,
          decodedBodyBytes: resource.decodedBodySize,
        };
      }),
  );
  const metrics = {
    route: "/login",
    source: "Chromium Resource Timing; delivered files for this route only",
    scripts,
    totalTransferBytes: scripts.reduce((total, script) => total + script.transferBytes, 0),
    totalEncodedBodyBytes: scripts.reduce((total, script) => total + script.encodedBodyBytes, 0),
  };
  expect(scripts.length).toBeGreaterThan(0);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await writeFile(
    path.resolve("artifacts/production-js-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  await testInfo.attach("production-js-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});

for (const width of [1440, 390]) {
  test(`production sign-in surface is accessible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in to your workspace", level: 1 }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await testInfo.attach("accessibility-results", {
      body: JSON.stringify(
        {
          passes: results.passes.length,
          incomplete: results.incomplete,
          violations: results.violations,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    await mkdir(path.resolve("artifacts/screenshots"), { recursive: true });
    await page.screenshot({
      path: path.resolve(`artifacts/screenshots/production-login-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
