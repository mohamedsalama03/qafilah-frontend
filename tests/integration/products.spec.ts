import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ProductFixture = { id: string; name: string };
type StoreFixture = {
  id: string;
  name: string;
  products: ProductFixture[];
  category: string | null;
};
type MerchantFixture = { email: string; password: string; stores: StoreFixture[] };
type Fixtures = Record<
  "browse" | "zero" | "denied" | "revocation" | "membership" | "identity" | "expiry",
  MerchantFixture
> & {
  readers: MerchantFixture[];
  variant: ProductFixture;
  historic: ProductFixture & { from: string; to: string };
  foreign: ProductFixture & { storeName: string };
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3a/runtime/product-fixtures.json"), "utf8"),
) as Fixtures;
const apiOrigin = "http://localhost:3842";
let readerIndex = 0;
const traffic = new WeakMap<
  Page,
  { method: string; path: string; status?: number; authorization: boolean }[]
>();
const faults = new WeakMap<Page, string[]>();

async function evidence(name: string, value: unknown) {
  await mkdir(path.resolve("artifacts/f3a/browser"), { recursive: true });
  await writeFile(
    path.resolve(`artifacts/f3a/browser/${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  traffic.set(page, []);
  faults.set(page, []);
  page.on("pageerror", (error) => faults.get(page)!.push(error.message));
  page.on("console", (message) => {
    if (
      /hydration|did not match|invalid hook|refused to.*script|content security policy/i.test(
        message.text(),
      )
    )
      faults.get(page)!.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith(apiOrigin))
      traffic.get(page)!.push({
        method: request.method(),
        path: new URL(request.url()).pathname + new URL(request.url()).search,
        authorization: !!request.headers().authorization,
      });
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(apiOrigin)) return;
    const responsePath = new URL(response.url()).pathname + new URL(response.url()).search;
    const item = traffic
      .get(page)!
      .findLast(
        (entry) =>
          entry.path === responsePath &&
          entry.method === response.request().method() &&
          entry.status === undefined,
      );
    if (item) item.status = response.status();
  });
});

test.afterEach(async ({ page }, info) => {
  await evidence(info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), {
    requests: traffic.get(page),
    runtimeErrors: faults.get(page),
  });
  expect(faults.get(page)).toEqual([]);
  expect(traffic.get(page)!.some((entry) => entry.authorization)).toBe(false);
  expect(
    traffic
      .get(page)!
      .filter((entry) => entry.path.includes("/catalog/") && entry.method !== "GET"),
  ).toEqual([]);
  expect(traffic.get(page)!.some((entry) => /\/storefront\/|\/platform\//.test(entry.path))).toBe(
    false,
  );
});

async function login(
  page: Page,
  group: keyof Pick<
    Fixtures,
    "browse" | "zero" | "denied" | "revocation" | "membership" | "identity" | "expiry"
  >,
  destination?: string,
) {
  const fixture =
    group === "browse"
      ? fixtures.readers[readerIndex++ % fixtures.readers.length]
      : fixtures[group];
  const target = destination ?? `/stores/${fixture.stores[0].id}/products`;
  await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
}

async function listReady(page: Page, store = fixtures.browse.stores[0]) {
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current store", exact: true })).toHaveAttribute(
    "data-store-uuid",
    store.id,
  );
  await expect(page.getByLabel("Search products", { exact: true })).toBeVisible();
}

function listResponse(page: Page, store = fixtures.browse.stores[0]) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/stores/${store.id}/catalog/products` &&
      response.request().method() === "GET",
  );
}

async function apply(page: Page, store = fixtures.browse.stores[0]) {
  const response = listResponse(page, store);
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  return result.json();
}

function change(group: string, operation: string) {
  const result = execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--",
      "docker",
      "exec",
      "qafilah-f2-runtime-app-1",
      "qafilah-entrypoint",
      "php",
      "/tmp/f3-fixtures.php",
      group,
      operation,
    ],
    { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(JSON.parse(result)).toEqual({ changed: operation, group });
}

async function refreshAccess(page: Page, store: StoreFixture) {
  const response = page.waitForResponse(`${apiOrigin}/api/v1/stores/${store.id}/context`);
  await page.getByRole("button", { name: "Refresh access", exact: true }).click();
  return response;
}

test("real nonowner Products list uses one batched resource request and opaque next previous cursors", async ({
  page,
}) => {
  const store = fixtures.browse.stores[0];
  const firstResponse = listResponse(page);
  await login(page, "browse");
  await listReady(page);
  const first = await (await firstResponse).json();
  expect(first.data.length).toBeGreaterThan(0);
  expect(first.data.length).toBeLessThan(29);
  expect(first.meta.pagination.next_cursor).toEqual(expect.any(String));
  expect(first.meta.pagination.previous_cursor).toBeNull();
  await expect(page.locator("body")).toContainText(/366|created between|creation window/i);
  await expect(page.locator("body")).not.toContainText(fixtures.historic.name);
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  const nextResponse = listResponse(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const next = await (await nextResponse).json();
  expect(next.data.length).toBeGreaterThan(0);
  expect(
    next.data.some((product: ProductFixture) =>
      first.data.some((prior: ProductFixture) => prior.id === product.id),
    ),
  ).toBe(false);
  expect(next.meta.effective_range).toEqual(first.meta.effective_range);
  const previousResponse = listResponse(page);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  const previous = await (await previousResponse).json();
  expect(previous.data.map((item: ProductFixture) => item.id)).toEqual(
    first.data.map((item: ProductFixture) => item.id),
  );
  const catalog = traffic.get(page)!.filter((entry) => entry.path.includes("/catalog/"));
  expect(
    catalog.every(
      (entry) =>
        new URL(apiOrigin + entry.path).pathname ===
          `/api/v1/stores/${store.id}/catalog/products` ||
        new URL(apiOrigin + entry.path).pathname ===
          `/api/v1/stores/${store.id}/catalog/categories`,
    ),
  ).toBe(true);
  expect(catalog.filter((entry) => entry.path.includes("/categories")).length).toBeLessThanOrEqual(
    2,
  );
});

test("real page size and sort changes reset opaque cursor navigation", async ({ page }) => {
  await login(page, "browse");
  await listReady(page);
  await page.getByLabel("Page size", { exact: true }).selectOption("10");
  const resized = await apply(page);
  expect(resized.data).toHaveLength(10);
  expect(resized.meta.pagination.per_page).toBe(10);
  const nextResponse = listResponse(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect((await nextResponse).status()).toBe(200);
  await page.getByLabel("Sort", { exact: true }).selectOption("name_asc");
  const sorted = await apply(page);
  expect(sorted.data[0].name).toBe("Atlas 01 Linen");
  expect(sorted.meta.pagination.previous_cursor).toBeNull();
  const request = traffic
    .get(page)!
    .findLast((entry) => entry.path.includes("/catalog/products?"))!;
  expect(new URL(apiOrigin + request.path).searchParams.has("cursor")).toBe(false);
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
});

test("real filters perform name prefix status category and deterministic sorting without unsupported fields", async ({
  page,
}) => {
  await login(page, "browse");
  await listReady(page);
  const beforeTyping = traffic.get(page)!.length;
  await page.getByLabel("Search products", { exact: true }).fill("Atlas 0");
  await page.getByLabel("Status", { exact: true }).selectOption("published");
  await page.getByLabel("Sort", { exact: true }).selectOption("name_asc");
  await page.getByText("Date and category filters", { exact: true }).click();
  await page
    .getByLabel("Category", { exact: true })
    .selectOption(fixtures.browse.stores[0].category!);
  expect(
    traffic
      .get(page)!
      .slice(beforeTyping)
      .filter((entry) => entry.path.includes("/products")),
  ).toEqual([]);
  const filtered = await apply(page);
  expect(filtered.data.map((item: ProductFixture) => item.name)).toEqual([
    "Atlas 02 Linen",
    "Atlas 04 Linen",
    "Atlas 06 Linen",
    "Atlas 08 Linen",
  ]);
  await expect(page.getByRole("link", { name: "Atlas 02 Linen", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Atlas 01 Linen", exact: true })).toHaveCount(0);
  await page.getByLabel("Search products", { exact: true }).fill("Linen");
  const noSubstring = await apply(page);
  expect(noSubstring.data).toEqual([]);
  await expect(page.locator("body")).toContainText(
    /no products match|no matching products|no search results/i,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("real historical creation and updated ranges find older Products without widening the default window", async ({
  page,
}) => {
  await login(page, "browse");
  await listReady(page);
  await expect(page.locator("body")).not.toContainText(fixtures.historic.name);
  await page.getByText("Date and category filters", { exact: true }).click();
  await page.getByLabel("Created from", { exact: true }).fill(fixtures.historic.from);
  await page.getByLabel("Created to", { exact: true }).fill(fixtures.historic.to);
  const historical = await apply(page);
  expect(historical.data.map((item: ProductFixture) => item.id)).toEqual([fixtures.historic.id]);
  await expect(page.getByRole("link", { name: fixtures.historic.name, exact: true })).toBeVisible();
  await page.getByLabel("Updated from", { exact: true }).fill(fixtures.historic.from);
  await page.getByLabel("Updated to", { exact: true }).fill(fixtures.historic.to);
  expect((await apply(page)).data).toEqual([]);
});

test("real Product detail renders plain text and exact simple and Variant commercial values", async ({
  page,
}) => {
  const store = fixtures.browse.stores[0];
  const product = store.products[0];
  await login(page, "browse", `/stores/${store.id}/products/${product.id}`);
  await expect(page.getByRole("heading", { name: product.name, exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("12.345 LYD");
  await expect(page.locator("body")).toContainText(/7/);
  await expect(page.locator("body")).toContainText("<b>literal markup</b>");
  expect(await page.evaluate(() => "__productDescriptionExecuted" in window)).toBe(false);
  await expect(
    page.getByRole("button", { name: /^(Edit|Create|Delete|Publish|Archive)/i }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: product.name, exact: true })).toBeVisible();
  await page.goto(`/stores/${store.id}/products/${fixtures.variant.id}`);
  await expect(
    page.getByRole("heading", { name: fixtures.variant.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText("From 10.500 LYD");
  await expect(page.locator("body")).toContainText(/in stock/i);
  await expect(page.locator("body")).toContainText(
    /per variant|individual variant|different variants/i,
  );
  await expect(page.locator("body")).not.toContainText("From 0.100 LYD");
  expect(
    traffic
      .get(page)!
      .some(
        (entry) =>
          /\/(pricing|inventory|variants|media)(?:\?|$)/.test(entry.path) &&
          !(
            entry.method === "GET" &&
            entry.path === `/api/v1/stores/${store.id}/catalog/products/${product.id}/inventory`
          ),
      ),
  ).toBe(false);
});

test("real products.view alone browses without requesting Categories and distinguishes unconfigured price", async ({
  page,
}) => {
  const store = fixtures.browse.stores[1];
  await login(page, "browse", `/stores/${store.id}/products`);
  await listReady(page, store);
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  await expect(page.getByLabel("Category", { exact: true })).toHaveCount(0);
  expect(traffic.get(page)!.some((entry) => entry.path.includes("/categories"))).toBe(false);
  const first = fixtures.browse.stores[0];
  await page.goto(`/stores/${first.id}/products/${first.products[1].id}`);
  await expect(
    page.getByRole("heading", { name: first.products[1].name, exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    /price not configured|price unconfigured|not configured/i,
  );
});

test("real zero Products is an empty success rather than failed discovery", async ({ page }) => {
  const response = listResponse(page, fixtures.zero.stores[0]);
  await login(page, "zero");
  await listReady(page, fixtures.zero.stores[0]);
  expect((await response).status()).toBe(200);
  await expect(page.locator("body")).toContainText(
    /no products yet|no products in this|no products found/i,
  );
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/could not load|unable to load/i);
});

test("real misleading Owner Administrator Role has no Product authority and direct backend denies", async ({
  page,
}) => {
  const store = fixtures.denied.stores[0];
  await login(page, "denied");
  await expect(page.locator("body")).toContainText(/permission|access/i);
  await expect(page.getByLabel("Search products", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Products", exact: true }),
  ).toHaveCount(0);
  expect(traffic.get(page)!.some((entry) => entry.path.includes("/catalog/"))).toBe(false);
  const status = await page.evaluate(
    async (url) =>
      (await fetch(url, { credentials: "include", headers: { Accept: "application/json" } }))
        .status,
    `${apiOrigin}/api/v1/stores/${store.id}/catalog/products`,
  );
  expect(status).toBe(403);
  await expect(page.locator("body")).not.toContainText(store.products[0].name);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("real same-session Product permission removal clears navigation and private data after context refresh", async ({
  page,
}) => {
  const store = fixtures.revocation.stores[0];
  await login(page, "revocation");
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  change("revocation", "products-permission");
  expect((await refreshAccess(page, store)).status()).toBe(200);
  await expect(page.getByLabel("Search products", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(store.products[0].name);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Products", exact: true }),
  ).toHaveCount(0);
  const status = await page.evaluate(
    async (url) =>
      (await fetch(url, { credentials: "include", headers: { Accept: "application/json" } }))
        .status,
    `${apiOrigin}/api/v1/stores/${store.id}/catalog/products/${store.products[0].id}`,
  );
  expect(status).toBe(403);
  await expect(page).not.toHaveURL(/\/login/);
});

test("real foreign Product returns 404 without disclosing Product or Store and keeps the session", async ({
  page,
}) => {
  const store = fixtures.browse.stores[0];
  const response = page.waitForResponse(
    `${apiOrigin}/api/v1/stores/${store.id}/catalog/products/${fixtures.foreign.id}`,
  );
  await login(page, "browse", `/stores/${store.id}/products/${fixtures.foreign.id}`);
  expect((await response).status()).toBe(404);
  await expect(page.locator("body")).toContainText(/product not found|product is unavailable/i);
  await expect(page.locator("body")).not.toContainText(fixtures.foreign.name);
  await expect(page.locator("body")).not.toContainText(fixtures.foreign.storeName);
  await expect(page).not.toHaveURL(/\/login/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(`/stores/${store.id}/products/${store.products[0].id}`);
  await expect(
    page.getByRole("heading", { name: store.products[0].name, exact: true }),
  ).toBeVisible();
});

test("real delayed Store A Product response never appears beneath Store B", async ({ page }) => {
  const [a, b] = fixtures.browse.stores;
  await login(page, "browse");
  await listReady(page);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route(`${apiOrigin}/api/v1/stores/${a.id}/catalog/products?**`, async (route) => {
    const response = await route.fetch();
    observed();
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await intercepted;
  await page.evaluate(
    ({ target, names }) => {
      const leaks: string[] = [];
      Object.assign(window, { __f3Leaks: leaks });
      new MutationObserver(() => {
        if (
          location.pathname.includes(target) &&
          names.some((name) => document.body.innerText.includes(name))
        )
          leaks.push("A Product visible at B URL");
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    { target: b.id, names: [...a.products.map((product) => product.name), fixtures.variant.name] },
  );
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${b.id}/products$`));
  release();
  await listReady(page, b);
  await expect(page.getByRole("link", { name: b.products[0].name, exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(a.products[0].name);
  expect(
    await page.evaluate(() => (window as unknown as { __f3Leaks: string[] }).__f3Leaks),
  ).toEqual([]);
});

test("real Store A detail switches to Store B list without retaining private detail", async ({
  page,
}) => {
  const [a, b] = fixtures.browse.stores;
  await login(page, "browse", `/stores/${a.id}/products/${a.products[0].id}`);
  await expect(page.getByRole("heading", { name: a.products[0].name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${b.id}/products$`));
  await listReady(page, b);
  await expect(page.locator("body")).not.toContainText(a.products[0].name);
  await expect(page.getByRole("link", { name: b.products[0].name, exact: true })).toBeVisible();
});

test("real invalid cursor response safely restarts Product discovery", async ({ page }) => {
  await login(page, "browse");
  await listReady(page);
  let corrupted = false;
  await page.route(
    `${apiOrigin}/api/v1/stores/${fixtures.browse.stores[0].id}/catalog/products?**`,
    async (route) => {
      const url = new URL(route.request().url());
      if (!corrupted && url.searchParams.has("cursor")) {
        corrupted = true;
        url.searchParams.set("cursor", "invalid-synthetic-cursor");
        const response = await route.fetch({ url: url.toString() });
        await route.fulfill({ response });
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restart discovery", exact: true })).toBeVisible();
  expect(traffic.get(page)!.some((entry) => entry.status === 422)).toBe(true);
  await page.getByRole("button", { name: "Restart discovery", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/SQLSTATE|Stack trace|vendor\//);
});

test("real Membership 403 clears the denied Store while another Store remains accessible", async ({
  page,
}) => {
  const store = fixtures.membership.stores[0];
  await login(page, "membership");
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  change("membership", "membership");
  expect((await refreshAccess(page, store)).status()).toBe(403);
  await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/stores/${fixtures.membership.stores[1].id}/products`);
  await listReady(page, fixtures.membership.stores[1]);
});

test("real global Identity suspension from a Product page clears private content", async ({
  page,
}) => {
  const store = fixtures.identity.stores[0];
  await login(page, "identity");
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  change("identity", "identity");
  const response = page.waitForResponse(`${apiOrigin}/api/v1/me`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await response).status()).toBe(401);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("body")).not.toContainText(store.products[0].name);
});

test("real expired session and logout preserve Product privacy including pagehide and browser back", async ({
  page,
  context,
}) => {
  const store = fixtures.expiry.stores[0];
  await login(page, "expiry");
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  const privateSnapshot = await page.evaluate((name) => {
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find(
      (element) => element.textContent === name,
    )!;
    const before = link.checkVisibility({ checkVisibilityCSS: true });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return {
      before,
      after: link.isConnected && link.checkVisibility({ checkVisibilityCSS: true }),
    };
  }, store.products[0].name);
  expect(privateSnapshot).toEqual({ before: true, after: false });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  // Removing only the session cookie models an expired browser session while
  // retaining its stale CSRF cookie. Laravel supplies the real 401 response.
  const sessionNames = (await context.cookies(apiOrigin))
    .filter((cookie) => cookie.httpOnly)
    .map((cookie) => cookie.name);
  for (const name of sessionNames) await context.clearCookies({ name });
  const response = page.waitForResponse(`${apiOrigin}/api/v1/me`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await response).status()).toBe(401);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("body")).not.toContainText(store.products[0].name);
  await login(page, "expiry");
  await expect(page.getByRole("link", { name: store.products[0].name, exact: true })).toBeVisible();
  const logout = page.waitForResponse(`${apiOrigin}/api/v1/auth/logout`);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  expect((await logout).status()).toBe(200);
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page.locator("body")).not.toContainText(store.products[0].name);
});

test("controlled real-adapter rate-limit server and network failures stay safe and recover", async ({
  page,
}) => {
  await login(page, "browse");
  await listReady(page);
  const url = `${apiOrigin}/api/v1/stores/${fixtures.browse.stores[0].id}/catalog/products?**`;
  for (const failure of [429, 500, "network"] as const) {
    await page.route(url, async (route) => {
      if (failure === "network") await route.abort("failed");
      else
        await route.fulfill({
          status: failure,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify({
            success: false,
            data: null,
            message: "SQLSTATE private backend internals",
            errors: {},
            meta: { request_id: "9771a4b5-0aa9-40eb-a4ec-48715c4c519e" },
          }),
        });
    });
    await page.getByRole("button", { name: "Refresh products", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Products couldn’t be loaded", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SQLSTATE");
    await expect(page.locator("body")).not.toContainText("No products in this creation window");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.unroute(url);
    await page.getByRole("button", { name: "Refresh products", exact: true }).click();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  }
});

test("real Product list detail filters and pagination are keyboard accessible at five widths", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "browse");
  await listReady(page);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  const observations = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.getByLabel("Search products", { exact: true }).focus();
    await expect(page.getByLabel("Search products", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      const style = getComputedStyle(active);
      return { tag: active.tagName, outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(focus.tag).not.toBe("BODY");
    expect(focus.outline !== "none" || focus.shadow !== "none").toBe(true);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    observations.push({
      width,
      surface: "list",
      violations: scan.violations,
      passes: scan.passes.length,
      focus,
    });
    await page.screenshot({
      path: path.resolve(`artifacts/f3a/browser/products-list-${width}.png`),
      fullPage: true,
    });
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: path.resolve(`artifacts/f3a/browser/products-list-viewport-${width}.png`),
      });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const link = page.getByRole("link", { name: fixtures.variant.name, exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: fixtures.variant.name, exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    observations.push({
      width,
      surface: "detail",
      violations: scan.violations,
      passes: scan.passes.length,
    });
    await page.screenshot({
      path: path.resolve(`artifacts/f3a/browser/products-detail-${width}.png`),
      fullPage: true,
    });
  }
  await evidence("accessibility-responsive", observations);
});
